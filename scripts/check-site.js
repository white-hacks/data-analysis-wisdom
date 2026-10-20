#!/usr/bin/env node
/**
 * scripts/check-site.js
 * ----------------------------------------------------------------------------
 * Checks the BUILT website in _site/ for problems a visitor would notice.
 * Works offline and needs no extra packages.
 *
 * WHEN TO RUN
 *   After `npm run build` (CI runs it on every push):
 *     npm run check:site
 *
 * WHAT IT CHECKS, on every HTML page
 *   - internal links point to a page that exists, and "#anchors" to an id
 *     that exists on that page;
 *   - the page has a <title>, a meta description and exactly one <h1>;
 *   - no id is used twice; every <img> has an alt attribute;
 *   - links that open a new tab carry rel="noopener";
 *   - no template leftovers such as "undefined", "NaN" or "[object Object]",
 *     in the text or in attributes people see or hear (alt, title,
 *     aria-label, meta content).
 *
 * Exits with code 1 when anything is wrong, listing each problem.
 */

const fs = require("node:fs");
const path = require("node:path");

/** The built site checked by default. Tests pass their own folder. */
const DEFAULT_SITE_DIR = path.join(__dirname, "..", "_site");

/**
 * Lists every .html file under a folder, recursively.
 * Called by checkSite() to find the pages to check.
 * @param {string} dir
 * @returns {string[]} Absolute file paths.
 */
function listHtmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listHtmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

/**
 * Converts a file path in the site folder to the URL path it is served at
 * ("_site/articles/index.html" → "/articles/").
 * Called by checkPage() to name the page in problem reports.
 * @param {string} siteDir
 * @param {string} file
 * @returns {string}
 */
function urlPathFor(siteDir, file) {
  const relative = "/" + path.relative(siteDir, file).split(path.sep).join("/");
  return relative.endsWith("/index.html") ? relative.slice(0, -"index.html".length) : relative;
}

/**
 * Finds the file that serves a URL path, mirroring how GitHub Pages serves
 * folders ("/articles/" → "_site/articles/index.html"). Throws URIError for
 * a malformed %-escape; checkPage() reports that as a problem.
 * Called by checkPage() for every internal link.
 * @param {string} siteDir
 * @param {string} urlPath
 * @returns {string|null}
 */
function fileForUrlPath(siteDir, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const candidates = clean.endsWith("/")
    ? [path.join(siteDir, clean, "index.html")]
    : [path.join(siteDir, clean), path.join(siteDir, clean, "index.html"), path.join(siteDir, `${clean}.html`)];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

/**
 * Reads one attribute from a tag's source ('<a href="/x/">' → "/x/"),
 * with double or single quotes. Returns undefined when it is absent.
 * Called by attributeValues() and checkPage().
 * @param {string} tagSource
 * @param {string} attribute
 * @returns {string|undefined}
 */
function attributeOf(tagSource, attribute) {
  const match = tagSource.match(new RegExp(`\\s${attribute}=("|')(.*?)\\1`, "is"));
  return match ? match[2] : undefined;
}

/**
 * Collects the values of one attribute for every matching tag.
 * Deliberately simple: the site's own HTML is regular and generated.
 * Called for ids (duplicate and #anchor checks).
 * @param {string} html
 * @param {string} tag
 * @param {string} attribute
 * @returns {string[]}
 */
function attributeValues(html, tag, attribute) {
  const values = [];
  const tagPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  for (const match of html.matchAll(tagPattern)) {
    const value = attributeOf(match[0], attribute);
    if (value !== undefined) values.push(value);
  }
  return values;
}

/**
 * Strips scripts, styles and tags to get the visible text of a page.
 * Called by checkPage() for the template-leftover check.
 * @param {string} html
 * @returns {string}
 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/**
 * Runs every check on one page. Called by checkSite() for each HTML file.
 * @param {string} siteDir
 * @param {string} file
 * @param {Map<string, Set<string>>} idsByFile  ids defined on each page (for #anchor checks)
 * @returns {string[]} Problems found.
 */
function checkPage(siteDir, file, idsByFile) {
  const html = fs.readFileSync(file, "utf8");
  const where = urlPathFor(siteDir, file);
  const problems = [];

  if (!/<title>[^<]+<\/title>/i.test(html)) problems.push(`${where}: missing <title>`);
  if (!/<meta name="description" content="[^"]+"/i.test(html)) problems.push(`${where}: missing meta description`);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) problems.push(`${where}: has ${h1Count} <h1> elements (expected 1)`);

  const ids = attributeValues(html, "[a-z0-9]+", "id");
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\salt="/i.test(match[0])) problems.push(`${where}: <img> without alt attribute`);
  }

  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const href = attributeOf(tag, "href");
    if (href === undefined) continue;
    const rel = attributeOf(tag, "rel") || "";
    if (attributeOf(tag, "target") === "_blank" && !/\bnoopener\b/i.test(rel)) problems.push(`${where}: new-tab link without rel="noopener": ${href}`);
    // External links (including protocol-relative "//host/…") are checked
    // by `npm run check:links`, not here.
    if (!href || /^(https?:|mailto:|tel:|\/\/)/i.test(href)) continue;

    // Internal link: resolve relative to the current page.
    try {
      const resolved = new URL(href, `https://site.local${where}`);
      const target = resolved.pathname === where || href.startsWith("#") ? file : fileForUrlPath(siteDir, resolved.pathname);
      if (!target) {
        problems.push(`${where}: broken internal link ${href}`);
        continue;
      }
      const fragment = decodeURIComponent(resolved.hash.slice(1));
      if (fragment && target.endsWith(".html") && !(idsByFile.get(target) || new Set()).has(fragment)) {
        problems.push(`${where}: link ${href} points to a missing anchor`);
      }
    } catch {
      problems.push(`${where}: malformed URL ${href}`);
    }
  }

  // Template leftovers, in the text and in attributes people see or hear.
  const attributeText = ["alt", "title", "aria-label", "content"].flatMap((name) => attributeValues(html, "[a-z0-9]+", name));
  const text = [visibleText(html), ...attributeText].join(" | ");
  for (const leftover of ["undefined", "[object Object]", "NaN"]) {
    if (new RegExp(`(^|[^A-Za-z])${leftover.replace(/[[\]]/g, "\\$&")}([^A-Za-z]|$)`).test(text)) {
      problems.push(`${where}: page contains "${leftover}"`);
    }
  }
  return problems;
}

/**
 * Checks every page of a built site.
 * Call it from tests with a folder of your own; the command line uses _site/.
 * @param {string} [siteDir]
 * @returns {{pages: number, problems: string[]}}
 */
function checkSite(siteDir = DEFAULT_SITE_DIR) {
  const files = listHtmlFiles(siteDir);
  const idsByFile = new Map(files.map((file) => [file, new Set(attributeValues(fs.readFileSync(file, "utf8"), "[a-z0-9]+", "id"))]));
  return { pages: files.length, problems: files.flatMap((file) => checkPage(siteDir, file, idsByFile)) };
}

/** Entry point when run from the command line. */
function main() {
  if (!fs.existsSync(DEFAULT_SITE_DIR)) {
    console.error("No _site/ folder: run `npm run build` first.");
    process.exitCode = 1;
    return;
  }
  const { pages, problems } = checkSite();
  for (const problem of problems) console.log(`✗ ${problem}`);
  console.log(`\n${pages} pages checked, ${problems.length} problem(s).`);
  process.exitCode = problems.length ? 1 : 0;
}

if (require.main === module) main();

module.exports = { checkSite };
