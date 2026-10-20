/**
 * tests/helpers.test.js
 * ----------------------------------------------------------------------------
 * Unit tests for the small pure helpers: text matching, catalog building on
 * a tiny hand-made dataset, validation messages and template filters.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteAppearsIn, stripEllipses, htmlToText } = require("../lib/text");
const { buildCatalog, collectPlacements } = require("../lib/catalog");
const { validateContent } = require("../lib/validate");
const { readableDate, compactNumber, hostname } = require("../eleventy.config.js");

test("quoteAppearsIn tolerates curly quotes, dashes and line breaks", () => {
  const source = "Tap into your audience’s schemas —\n and you improve their   experience.";
  assert.ok(quoteAppearsIn(source, "Tap into your audience's schemas - and you improve their experience."));
});

test("quoteAppearsIn ignores the ellipses that mark a cut quote", () => {
  assert.equal(stripEllipses("…radical surgery is needed…"), "radical surgery is needed");
  assert.ok(quoteAppearsIn("The conclusion is that radical surgery is needed, and more.", "…radical surgery is needed…"));
});

test("quoteAppearsIn rejects missing and empty quotes", () => {
  assert.equal(quoteAppearsIn("Some article text.", "Words that are not there."), false);
  assert.equal(quoteAppearsIn("Some article text.", "   "), false);
});

test("htmlToText drops scripts and tags and decodes entities", () => {
  assert.equal(htmlToText("<p>Bars &amp; lines</p><script>var x = 1;</script><p>&ldquo;win&rdquo;</p>"), 'Bars & lines "win"');
});

/** A minimal but complete content set used by the next tests. */
function tinyContent() {
  return {
    site: { name: "Test", url: "https://example.com", tagline: "t" },
    categories: [
      { slug: "basics", title: "Basics", color: "blue", subcategories: [{ slug: "pills", title: "Pills", sections: [{ slug: "deep", title: "Deep dive" }] }] },
      { slug: "misc", title: "Misc", color: "green", subcategories: [] },
    ],
    articles: [
      { id: "a1", title: "A1", authors: ["Ann"], publisher: "P", url: "https://a1.test", summary: "s", placements: [{ topic: "basics/pills" }, { topic: "basics/pills", section: "deep", note: "again" }] },
      { id: "a2", title: "A2", authors: ["Bo"], publisher: "P", url: "https://a2.test", summary: "s", placements: [{ topic: "misc" }] },
    ],
    quotes: [{ text: "Hello", author: "Ann", article: "a1" }],
    people: [{ slug: "ann", name: "Ann", tableauPublic: "https://public.tableau.com/app/profile/ann" }],
    vizzes: { ann: { vizzes: [{ title: "V", url: "https://public.tableau.com/x", thumbnail: "t", views: 1, favorites: 1 }] } },
  };
}

test("collectPlacements separates the main list from sections and counts each article once", () => {
  const { articles } = tinyContent();
  const result = collectPlacements(articles, "basics/pills", [{ slug: "deep", title: "Deep dive" }]);
  assert.equal(result.main.length, 1);
  assert.equal(result.sections[0].items.length, 1);
  assert.equal(result.sections[0].items[0].note, "again");
  assert.equal(result.count, 1);
});

test("buildCatalog wires quotes, people and categories without subcategories", () => {
  const catalog = buildCatalog(tinyContent());
  const misc = catalog.categories.find((c) => c.slug === "misc");
  assert.equal(misc.placements.main[0].article.id, "a2");
  assert.equal(catalog.topics[0].quotes[0].authorUrl, "/visualizations/ann/");
  assert.equal(catalog.people[0].articles[0].id, "a1");
  assert.equal(catalog.stats.vizzes, 1);
});

test("validateContent reports broken references", () => {
  const content = tinyContent();
  content.articles[0].placements.push({ topic: "basics/nope" });
  content.quotes.push({ text: "x", author: "y", article: "missing" });
  const { errors } = validateContent(content);
  assert.ok(errors.some((e) => e.includes('unknown topic "basics/nope"')));
  assert.ok(errors.some((e) => e.includes('unknown article "missing"')));
});

test("template filters format dates, numbers and host names", () => {
  assert.equal(readableDate("2019"), "2019");
  assert.equal(readableDate("2019-11"), "Nov 2019");
  assert.equal(readableDate("2019-11-02"), "2 Nov 2019");
  assert.equal(compactNumber(9271), "9.3K");
  assert.equal(hostname("https://www.vizwiz.com/2026/x.html"), "vizwiz.com");
});
