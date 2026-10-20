/**
 * lib/text.js
 * ----------------------------------------------------------------------------
 * Plain-text helpers shared by the quote checker and the tests.
 * No network access and no dependencies: safe to call from anywhere.
 */

/** Named HTML entities htmlToText() decodes (besides &amp;, &lt; and &gt;). */
const NAMED_ENTITIES = {
  nbsp: " ", quot: '"', apos: "'", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", shy: "\u00AD",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä",
  rarr: "→", larr: "←", times: "×", copy: "©", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•",
};

/**
 * Decodes one numeric character reference, or returns a space when the
 * number is not a valid Unicode code point (instead of throwing).
 * Called by htmlToText() for every numeric entity.
 * @param {number} code
 * @returns {string}
 */
function fromCodePoint(code) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

/**
 * Converts an HTML document to plain text (comments, scripts, styles and
 * tags removed, entities decoded, whitespace collapsed).
 *
 * Call it on a downloaded page before searching it for a quote. It is
 * deliberately simple and dependency-free rather than a full HTML parser.
 *
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // Last, so "&amp;lt;" becomes the text "&lt;", not "<".
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalises text for loose comparison: unifies curly/straight quotes,
 * dashes and ellipses, lowercases, and collapses whitespace.
 * Called by comparisonKey(); also handy in tests.
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
    .replace(/\u2212/g, "-") // minus sign
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "") // soft hyphens and zero-width characters
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Builds the key used to compare a quote with its source: normalised text
 * with every whitespace character removed, so line breaks and HTML
 * formatting inside a sentence never cause a false mismatch.
 * Called by quoteAppearsIn() on both the quote and the page text.
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
 * Called by quoteAppearsIn() before comparing.
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
 * Called by scripts/verify-quotes.js for every quote, and by the tests.
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
