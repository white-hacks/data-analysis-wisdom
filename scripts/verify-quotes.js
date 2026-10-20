#!/usr/bin/env node
/**
 * scripts/verify-quotes.js
 * ----------------------------------------------------------------------------
 * Confirms that every quote in content/quotes.yaml still appears word for
 * word in its source article.
 *
 * WHEN TO RUN
 *   After adding or editing quotes, and occasionally to catch articles that
 *   were edited or taken down:
 *     npm run verify:quotes
 *   Behind a proxy:  NODE_USE_ENV_PROXY=1 npm run verify:quotes
 *
 * HOW IT MATCHES
 *   Both the quote and the page text are normalised (lower case, curly and
 *   straight quotes unified, dashes unified, ALL whitespace removed) so that
 *   line breaks or HTML formatting inside a sentence don't cause false alarms.
 *   A leading/trailing "…" in the quote marks a cut sentence and is ignored.
 *
 * OPTIONS
 *   --text-dir <dir>   Read "<dir>/<article-id>.txt" instead of fetching the
 *                      page (useful offline, and for PDFs, which this script
 *                      cannot read itself). May be given more than once.
 *   --only <id,...>    Only check quotes from these article ids.
 *
 * Exits with code 1 when a quote cannot be found, so it can run in CI.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadContent } = require("../lib/load-content");
const { request, mapWithConcurrency } = require("../lib/http");
const { htmlToText, quoteAppearsIn } = require("../lib/text");

/**
 * Reads command-line options.
 * @returns {{textDirs: string[], only: Set<string>|null}}
 */
function parseArgs(argv) {
  const textDirs = [];
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--text-dir") textDirs.push(argv[++i]);
    else if (argv[i] === "--only") only = new Set(argv[++i].split(","));
  }
  return { textDirs, only };
}

/**
 * Gets the plain text of an article: from a --text-dir file when available,
 * otherwise by downloading the page.
 *
 * @param {object} article  An entry from articles.yaml.
 * @param {string[]} textDirs
 * @returns {Promise<{text: string|null, note?: string}>}
 */
async function getArticleText(article, textDirs) {
  for (const dir of textDirs) {
    const file = path.join(dir, `${article.id}.txt`);
    if (fs.existsSync(file)) return { text: fs.readFileSync(file, "utf8") };
  }
  try {
    const response = await request(article.url, { timeoutMs: 30000 });
    const type = response.headers.get("content-type") || "";
    if (type.includes("pdf")) return { text: null, note: "PDF: check by hand or pass --text-dir" };
    if (!response.ok) return { text: null, note: `HTTP ${response.status}` };
    const text = htmlToText(await response.text());
    // Single-page apps send an almost empty HTML shell and draw the article
    // with JavaScript, so there is nothing to search in.
    if (text.length < 1500) return { text: null, note: "page is drawn by JavaScript: check by hand or pass --text-dir" };
    return { text };
  } catch (error) {
    return { text: null, note: error.message };
  }
}

/** Entry point. */
async function main() {
  const { textDirs, only } = parseArgs(process.argv.slice(2));
  const { quotes, articles } = loadContent();
  const articlesById = new Map(articles.map((a) => [a.id, a]));
  const selected = quotes.filter((q) => !only || only.has(q.article));

  // Download each source article once, even if it has several quotes.
  const neededIds = [...new Set(selected.map((q) => q.article))];
  const texts = new Map();
  await mapWithConcurrency(neededIds, 6, async (id) => {
    const article = articlesById.get(id);
    texts.set(id, article ? await getArticleText(article, textDirs) : { text: null, note: "unknown article id" });
  });

  let failures = 0;
  let unchecked = 0;
  for (const quote of selected) {
    const source = texts.get(quote.article);
    const label = `${quote.author} (${quote.article})`;
    if (!source.text) {
      unchecked++;
      console.log(`?  ${label}: not checked: ${source.note}`);
      continue;
    }
    const found = quoteAppearsIn(source.text, quote.text);
    if (!found) failures++;
    console.log(`${found ? "✓" : "✗"}  ${label}: ${quote.text.slice(0, 70)}${quote.text.length > 70 ? "…" : ""}`);
  }
  console.log(`\n${selected.length} quotes: ${selected.length - failures - unchecked} verified, ${failures} not found, ${unchecked} not checked.`);
  process.exitCode = failures ? 1 : 0;
}

main();
