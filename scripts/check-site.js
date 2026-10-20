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
 *   - no template leftovers such as "undefined", "NaN" or "[object Object]".
 *
 * Exits with code 1 when anything is wrong, listing each problem.
 */

const fs = require("node:fs");
const path = require("node:path");

/** The built site checked by default. Tests pass their own folder. */
const DEFAULT_SITE_DIR = path.join(__dirname, "..", "_site");

/**
 * Lists every .html file under a folder, recursively.
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
 * folders ("/articles/" → "_site/articles/index.html").
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
 * Collects the values of one attribute for every matching tag.
 * Deliberately simple: the site's own HTML is regular and generated.
 * @param {string} html
 * @param {string} tag
 * @param {string} attribute
 * @returns {string[]}
 */
function attributeValues(html, tag, attribute) {
  const values = [];
  const tagPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const attrPattern = new RegExp(`\\s${attribute}="([^"]*)"`, "i");
  for (const match of html.matchAll(tagPattern)) {
    const attr = match[0].match(attrPattern);
    if (attr) values.push(attr[1]);
  }
  return values;
}

/**
 * Strips scripts, styles and tags to get the visible text of a page.
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
 * Runs every check on one page.
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
    const href = (tag.match(/\shref="([^"]*)"/i) || [])[1];
    if (href === undefined) continue;
    if (/target="_blank"/i.test(tag) && !/rel="[^"]*noopener/i.test(tag)) problems.push(`${where}: new-tab link without rel="noopener": ${href}`);
    if (!href || /^(https?:|mailto:|tel:)/i.test(href)) continue;

    // Internal link: resolve relative to the current page.
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
  }

  const text = visibleText(html);
  for (const leftover of ["undefined", "[object Object]", "NaN"]) {
    if (new RegExp(`(^|[^A-Za-z])${leftover.replace(/[[\]]/g, "\\$&")}([^A-Za-z]|$)`).test(text)) {
      problems.push(`${where}: page text contains "${leftover}"`);
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
