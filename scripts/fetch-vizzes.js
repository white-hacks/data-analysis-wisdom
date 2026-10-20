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
 *                      favourited (default 300; Tableau Public serves 50 per
 *                      request).
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
 * Reads command-line options.
 * @returns {{only: Set<string>|null, limit: number, scan: number}}
 */
function parseArgs(argv) {
  const options = { only: null, limit: 12, scan: 300 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") options.only = new Set(argv[++i].split(","));
    else if (argv[i] === "--limit") options.limit = Number(argv[++i]);
    else if (argv[i] === "--scan") options.scan = Number(argv[++i]);
  }
  return options;
}

/**
 * Extracts the profile name from a Tableau Public profile URL
 * ("https://public.tableau.com/app/profile/andy.kriebel" → "andy.kriebel").
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
 * @param {string} profileName
 * @param {object} workbook  Record from the workbooks endpoint.
 * @returns {{title: string, url: string, thumbnail: string, views: number, favorites: number}}
 */
function toViz(profileName, workbook) {
  // defaultViewRepoUrl looks like "Workbook/sheets/Sheet".
  const [repo, , sheet] = workbook.defaultViewRepoUrl.split("/");
  return {
    title: workbook.title,
    url: `https://public.tableau.com/app/profile/${profileName}/viz/${repo}/${sheet}`,
    thumbnail: `https://public.tableau.com/static/images/${repo.slice(0, 2)}/${repo}/${sheet}/1.png`,
    views: workbook.viewCount || 0,
    favorites: workbook.numberOfFavorites || 0,
  };
}

/**
 * Downloads one person's profile and picks their most favourited vizzes
 * (ties broken by view count).
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
  const options = parseArgs(process.argv.slice(2));
  const { people, vizzes: existing } = loadContent();
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
