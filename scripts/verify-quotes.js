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
 * A quote passes when it is found in the article or in one of its
 * "alternates" (the same article published elsewhere). Exits with code 1
 * when a quote cannot be found or its source no longer answers (404, 410,
 * server error, no response), so it can run in CI. PDFs, pages that block
 * scripts and pages drawn by JavaScript are listed as "not checked".
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadContent } = require("../lib/load-content");
const { request, mapWithConcurrency } = require("../lib/http");
const { htmlToText, quoteAppearsIn } = require("../lib/text");

/**
 * Reads command-line options. Stops with a message when an option is
 * missing its value.
 * Called once by main().
 * @returns {{textDirs: string[], only: Set<string>|null}}
 */
function parseArgs(argv) {
  const textDirs = [];
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    const value = argv[i + 1];
    if ((name === "--text-dir" || name === "--only") && (!value || value.startsWith("--"))) {
      console.error(`verify-quotes: ${name} needs a value`);
      process.exit(2);
    }
    if (name === "--text-dir") textDirs.push(argv[++i]);
    else if (name === "--only") only = new Set(argv[++i].split(","));
    else {
      console.error(`verify-quotes: unknown option ${name}`);
      process.exit(2);
    }
  }
  return { textDirs, only };
}

/** Statuses from sites that refuse scripts but work in a browser. */
const BLOCKED_STATUSES = new Set([401, 403, 429]);

/**
 * Downloads one page and returns its plain text. Called for each source of
 * a quoted article (its URL and any alternates).
 * Called by getArticleTexts().
 *
 * @param {string} url
 * @returns {Promise<{text: string|null, gone?: boolean, note?: string}>}
 *   `gone` marks a source that no longer answers (404, 410, server error or
 *   no response): a failure, unlike PDFs and bot blocks, which a person has
 *   to check by hand.
 */
async function fetchPageText(url) {
  try {
    const response = await request(url, { timeoutMs: 30000 });
    const type = response.headers.get("content-type") || "";
    if (BLOCKED_STATUSES.has(response.status)) return { text: null, note: `HTTP ${response.status}: the site blocks scripts, check in a browser` };
    if (!response.ok) return { text: null, gone: true, note: `source unreachable: HTTP ${response.status}` };
    if (type.includes("pdf")) return { text: null, note: "PDF: check by hand or pass --text-dir" };
    return { text: htmlToText(await response.text()) };
  } catch (error) {
    return { text: null, gone: true, note: `source unreachable: ${error.message}` };
  }
}

/**
 * Gets the plain text of every version of an article: a --text-dir file for
 * the article itself when available (otherwise its page), plus the pages of
 * its alternates (other places the same article was published).
 * Called by main() once per quoted article.
 *
 * @param {object} article  An entry from articles.yaml.
 * @param {string[]} textDirs
 * @returns {Promise<{text: string|null, gone?: boolean, note?: string}[]>} Main source first.
 */
async function getArticleTexts(article, textDirs) {
  const local = textDirs.map((dir) => path.join(dir, `${article.id}.txt`)).find((file) => fs.existsSync(file));
  const main = local ? { text: fs.readFileSync(local, "utf8") } : await fetchPageText(article.url);
  const alternates = await Promise.all((article.alternates || []).map((alt) => fetchPageText(alt.url)));
  return [main, ...alternates];
}

/**
 * Decides what to report for one quote, given the texts of its sources.
 * Called by main() for every selected quote.
 *
 * @param {string} quoteText
 * @param {{text: string|null, gone?: boolean, note?: string}[]} sources  Main source first.
 * @returns {{status: "found"|"missing"|"unchecked", note?: string}}
 */
function judgeQuote(quoteText, sources) {
  if (sources.some((source) => source.text && quoteAppearsIn(source.text, quoteText))) return { status: "found" };
  const [main] = sources;
  if (main.gone) return { status: "missing", note: main.note };
  const readable = sources.filter((source) => source.text);
  if (!readable.length) return { status: "unchecked", note: main.note };
  // Single-page apps send an almost empty HTML shell and draw the article
  // with JavaScript, so a short page may simply not contain the text yet.
  if (readable.every((source) => source.text.length < 1500)) {
    return { status: "unchecked", note: "page may be drawn by JavaScript: check by hand or pass --text-dir" };
  }
  return { status: "missing", note: "not found in the source" };
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
    texts.set(id, article ? await getArticleTexts(article, textDirs) : [{ text: null, gone: true, note: "unknown article id" }]);
  });

  const counts = { found: 0, missing: 0, unchecked: 0 };
  for (const quote of selected) {
    const label = `${quote.author} (${quote.article})`;
    const { status, note } = judgeQuote(quote.text, texts.get(quote.article));
    counts[status]++;
    const mark = { found: "✓", missing: "✗", unchecked: "?" }[status];
    const excerpt = `${quote.text.slice(0, 70)}${quote.text.length > 70 ? "…" : ""}`;
    console.log(`${mark}  ${label}: ${status === "unchecked" ? `not checked: ${note}` : excerpt}${status === "missing" ? `  (${note})` : ""}`);
  }
  console.log(`\n${selected.length} quotes: ${counts.found} verified, ${counts.missing} not found or unreachable, ${counts.unchecked} not checked.`);
  process.exitCode = counts.missing ? 1 : 0;
}

if (require.main === module) main();

module.exports = { judgeQuote };
