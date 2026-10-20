/**
 * lib/text.js
 * ----------------------------------------------------------------------------
 * Plain-text helpers shared by the quote checker and the tests.
 * No network access and no dependencies: safe to call from anywhere.
 */

/**
 * Converts an HTML document to plain text (scripts, styles and tags removed,
 * common entities decoded, whitespace collapsed).
 *
 * Call it on a downloaded page before searching it for a quote. It is
 * deliberately simple and dependency-free rather than a full HTML parser.
 *
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalises text for loose comparison: unifies curly/straight quotes,
 * dashes and ellipses, lowercases, and collapses whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
function normaliseForComparison(text) {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Builds the key used to compare a quote with its source: normalised text
 * with every whitespace character removed, so line breaks and HTML
 * formatting inside a sentence never cause a false mismatch.
 *
 * @param {string} text
 * @returns {string}
 */
function comparisonKey(text) {
  return normaliseForComparison(text).replace(/\s+/g, "");
}

/**
 * Removes the leading/trailing "…" (or "...") that marks a quote cut
 * mid-sentence.
 *
 * @param {string} quote
 * @returns {string}
 */
function stripEllipses(quote) {
  return quote.replace(/^\s*(…|\.\.\.)\s*/, "").replace(/\s*(…|\.\.\.)\s*$/, "");
}

/**
 * Tells whether `quote` appears word for word in `sourceText`.
 *
 * Call it from scripts/verify-quotes.js (and the tests). Returns false for
 * an empty quote so a blank entry can never pass.
 *
 * @param {string} sourceText  Plain text of the article.
 * @param {string} quote       The quote as written in quotes.yaml.
 * @returns {boolean}
 */
function quoteAppearsIn(sourceText, quote) {
  const needle = comparisonKey(stripEllipses(quote));
  return needle.length > 0 && comparisonKey(sourceText).includes(needle);
}

module.exports = { htmlToText, normaliseForComparison, comparisonKey, stripEllipses, quoteAppearsIn };
