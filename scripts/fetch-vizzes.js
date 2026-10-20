#!/usr/bin/env node
/**
 * scripts/fetch-vizzes.js
 * ----------------------------------------------------------------------------
 * Downloads each featured person's Tableau Public profile and their most
 * favourited vizzes, and saves them to content/vizzes.json for the
 * Visualizations pages.
 *
 * WHEN TO RUN
 *   After adding someone to content/people.yaml, or every few months to
 *   refresh the galleries:
 *     npm run fetch:vizzes                     (everyone)
 *     npm run fetch:vizzes -- --only shreya-arya
 *   Behind a proxy:  NODE_USE_ENV_PROXY=1 npm run fetch:vizzes
 *
 * OPTIONS
 *   --only <slug,...>  Only refresh these people (others are kept as they are).
 *   --limit <n>        Vizzes kept per person (default 12).
 *   --scan <n>         Workbooks scanned per person before picking the most
 *                      favourited (default: all of them; Tableau Public
 *                      serves 50 per request).
 *
 * It uses the public JSON endpoints behind tableau.com profile pages. They are
 * not an official API, so if Tableau changes them this script is the one
 * place to update. The website build never calls Tableau Public: it reads
 * the saved JSON, and thumbnails are loaded from Tableau Public by the
 * visitor's browser.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadContent, CONTENT_DIR } = require("../lib/load-content");
const { request } = require("../lib/http");

const PAGE_SIZE = 50; // Maximum page size Tableau Public accepts.

/**
 * Thumbnails smaller than this are Tableau Public's grey "no preview"
 * placeholder (about 1.2 KB), not a picture of the viz.
 */
const PLACEHOLDER_MAX_BYTES = 2000;

/**
 * Reads command-line options. Stops with a message on a missing or invalid
 * value, so a typo can never wipe a gallery.
 *
 * @param {string[]} argv  process.argv without the first two entries.
 * @param {string[]} slugs  Valid person slugs (from people.yaml).
 * @returns {{only: Set<string>|null, limit: number, scan: number}}
 */
function parseArgs(argv, slugs) {
  const options = { only: null, limit: 12, scan: Infinity };
  const fail = (message) => {
    console.error(`fetch-vizzes: ${message}`);
    process.exit(2);
  };
  /** Reads the value after option `name`, which must be a whole number ≥ 1. */
  const positiveInteger = (name, value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) fail(`${name} needs a whole number of at least 1 (got "${value ?? ""}")`);
    return number;
  };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === "--only") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) fail("--only needs a comma-separated list of person slugs");
      const unknown = value.split(",").filter((slug) => !slugs.includes(slug));
      if (unknown.length) fail(`unknown person slug(s): ${unknown.join(", ")} (see content/people.yaml)`);
      options.only = new Set(value.split(","));
    } else if (name === "--limit") options.limit = positiveInteger(name, argv[++i]);
    else if (name === "--scan") options.scan = positiveInteger(name, argv[++i]);
    else fail(`unknown option ${name}`);
  }
  return options;
}

/**
 * Extracts the profile name from a Tableau Public profile URL
 * ("https://public.tableau.com/app/profile/andy.kriebel" → "andy.kriebel").
 * Called by fetchPerson() before any request.
 *
 * @param {string} url
 * @returns {string}
 */
function profileNameFromUrl(url) {
  const match = url.match(/\/profile\/([^/?#]+)/);
  if (!match) throw new Error(`Not a Tableau Public profile URL: ${url}`);
  return decodeURIComponent(match[1]);
}

/**
 * GETs a Tableau Public JSON endpoint.
 * Called by fetchPerson() for the profile and each page of workbooks.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function getJson(url) {
  const response = await request(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

/**
 * Converts one workbook record from Tableau Public into the shape the site
 * uses: title, viz page URL, thumbnail URL and popularity counts.
 *
 * The thumbnail is the 736×454 preview Tableau Public's own galleries use
 * (".../4_3.png"); the full-size render (".../1.png") can be several MB.
 * Called by fetchPerson() for every workbook.
 *
 * @param {string} profileName
 * @param {object} workbook  Record from the workbooks endpoint.
 * @returns {{title: string, url: string, thumbnail: string|null, views: number, favorites: number}}
 */
function toViz(profileName, workbook) {
  // defaultViewRepoUrl looks like "Workbook/sheets/Sheet".
  const [repo, , sheet] = workbook.defaultViewRepoUrl.split("/");
  return {
    title: workbook.title,
    url: `https://public.tableau.com/app/profile/${profileName}/viz/${repo}/${sheet}`,
    thumbnail: `https://public.tableau.com/static/images/${repo.slice(0, 2)}/${repo}/${sheet}/4_3.png`,
    views: workbook.viewCount || 0,
    favorites: workbook.numberOfFavorites || 0,
  };
}

/**
 * Checks that a viz's thumbnail is a real picture. Tableau Public answers
 * 200 with a tiny grey placeholder when it has no preview for a viz; the
 * site then shows a titled tile instead (vizCard in macros/components.njk).
 * Called for each viz kept in a gallery.
 *
 * @param {{thumbnail: string|null}} viz  Updated in place.
 */
async function checkThumbnail(viz) {
  if (!viz.thumbnail) return;
  try {
    const response = await request(viz.thumbnail);
    const bytes = (await response.arrayBuffer()).byteLength;
    if (!response.ok || bytes < PLACEHOLDER_MAX_BYTES) viz.thumbnail = null;
  } catch {
    // Network trouble: keep the URL; the next refresh checks it again.
  }
}

/**
 * Downloads one person's profile and picks their most favourited vizzes
 * (ties broken by view count).
 * Called by main() for each person being refreshed.
 *
 * @param {object} person  Entry from people.yaml.
 * @param {{limit: number, scan: number}} options
 * @returns {Promise<object>} The record stored in vizzes.json.
 */
async function fetchPerson(person, { limit, scan }) {
  const profileName = profileNameFromUrl(person.tableauPublic);
  const profile = await getJson(`https://public.tableau.com/profile/api/${encodeURIComponent(profileName)}`);

  const workbooks = [];
  for (let start = 0; start < scan; start += PAGE_SIZE) {
    const page = await getJson(
      `https://public.tableau.com/public/apis/workbooks?profileName=${encodeURIComponent(profileName)}` +
        `&start=${start}&count=${PAGE_SIZE}&visibility=NON_HIDDEN`,
    );
    workbooks.push(...(page.contents || []));
    if (!page.contents || page.contents.length < PAGE_SIZE) break;
  }

  const vizzes = workbooks
    .filter((wb) => wb.defaultViewRepoUrl)
    .map((wb) => toViz(profileName, wb))
    .sort((a, b) => b.favorites - a.favorites || b.views - a.views)
    .slice(0, limit);
  for (const viz of vizzes) await checkThumbnail(viz);

  return {
    profileName,
    displayName: profile.name || person.name,
    avatarUrl: profile.avatarUrl || null,
    workbookCount: profile.visibleWorkbookCount || workbooks.length,
    followers: profile.totalNumberOfFollowers || 0,
    fetchedAt: new Date().toISOString().slice(0, 10),
    vizzes,
  };
}

/** Entry point: refreshes vizzes.json. */
async function main() {
  const { people, vizzes: existing } = loadContent();
  const options = parseArgs(process.argv.slice(2), people.map((p) => p.slug));
  const output = { ...existing };

  for (const person of people) {
    if (options.only && !options.only.has(person.slug)) continue;
    try {
      output[person.slug] = await fetchPerson(person, options);
      console.log(`✓ ${person.name}: ${output[person.slug].vizzes.length} vizzes`);
    } catch (error) {
      console.error(`✗ ${person.name}: ${error.message} (kept previous data)`);
      process.exitCode = 1;
    }
  }

  // Drop people who were removed from people.yaml.
  const slugs = new Set(people.map((p) => p.slug));
  for (const key of Object.keys(output)) if (!slugs.has(key)) delete output[key];

  fs.writeFileSync(path.join(CONTENT_DIR, "vizzes.json"), JSON.stringify(output, null, 2) + "\n");
  console.log("Saved content/vizzes.json");
}

main();
