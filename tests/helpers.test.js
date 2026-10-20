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
const { validateContent, isValidDate } = require("../lib/validate");
const { readableDate, compactNumber, hostname, smartQuotes } = require("../eleventy.config.js");

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
  assert.equal(htmlToText("<p>Bars &amp; lines</p><script>var x = 1;</script><p>&ldquo;win&rdquo;</p>"), "Bars & lines “win”");
});

test("htmlToText and quote matching survive comments, invisible characters and odd entities", () => {
  assert.equal(htmlToText("a<!-- <b>hidden</b> -->b"), "a b");
  assert.equal(htmlToText("&amp;lt;b&amp;gt; caf&eacute;"), "&lt;b&gt; café");
  assert.equal(htmlToText("x &#99999999; &#x110000; y"), "x y");
  assert.ok(quoteAppearsIn(htmlToText("the visu&shy;alization of data&#8203;viz"), "the visualization of dataviz"));
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
      { id: "a3", title: "A3", authors: ["Cy"], publisher: "P", url: "https://a3.test", summary: "s", placements: [{ topic: "basics/pills" }] },
    ],
    quotes: [{ text: "Hello", author: "Ann", article: "a1" }],
    people: [{ slug: "ann", name: "Ann", tableauPublic: "https://public.tableau.com/app/profile/ann" }],
    vizzes: { ann: { vizzes: [{ title: "V", url: "https://public.tableau.com/x", thumbnail: "t", views: 1, favorites: 1 }] } },
  };
}

test("collectPlacements separates the main list from sections and shows each article once per page", () => {
  const { articles } = tinyContent();
  const result = collectPlacements(articles, "basics/pills", [{ slug: "deep", title: "Deep dive" }]);
  // a1 is placed in the main list AND the "deep" section: only the section
  // card (with its note) is kept.
  assert.deepEqual(result.main.map((item) => item.article.id), ["a3"]);
  assert.equal(result.sections[0].items.length, 1);
  assert.equal(result.sections[0].items[0].note, "again");
  assert.equal(result.count, 2);
});

test("topic cards preview section articles when the main list is empty", () => {
  const content = tinyContent();
  content.articles[2].placements = [{ topic: "misc" }];
  const catalog = buildCatalog(content);
  assert.deepEqual(catalog.topics[0].previewTitles, ["A1"]);
});

test("the quotes page features a short quote for each category", () => {
  const content = tinyContent();
  content.quotes.unshift({ text: "x".repeat(200), author: "Ann", article: "a1" });
  const catalog = buildCatalog(content);
  assert.equal(catalog.categories[0].featuredQuote.text, "Hello");
});

test("buildCatalog wires quotes, people and categories without subcategories", () => {
  const catalog = buildCatalog(tinyContent());
  const misc = catalog.categories.find((c) => c.slug === "misc");
  assert.equal(misc.placements.main[0].article.id, "a2");
  assert.equal(catalog.topics[0].quotes[0].authorUrl, "/visualizations/ann/");
  assert.equal(catalog.people[0].articles[0].id, "a1");
  assert.equal(catalog.stats.vizzes, 1);
});

test("validateContent checks alternates and duplicate URLs across them", () => {
  const content = tinyContent();
  content.articles[0].alternates = [{ publisher: "Orig", url: "https://a2.test" }, { publisher: "", url: "ftp://x" }, { publisher: "P", url: "https://ok.test", published: "May 2020" }];
  const { errors, warnings } = validateContent(content);
  assert.ok(errors.some((e) => e.includes("alternate without a publisher")));
  assert.ok(errors.some((e) => e.includes('alternate whose "published" date')));
  assert.ok(warnings.some((w) => w.includes("https://a2.test") && w.includes("listed twice")));
});

test("validateContent rejects impossible dates and articles placed on a category that has subcategories", () => {
  assert.ok(isValidDate("2019") && isValidDate("2019-02") && isValidDate("2020-02-29"));
  for (const bad of ["2019-13", "2019-00", "2019-02-31", "2021-02-29", "19-05-01", "May 2020"]) assert.equal(isValidDate(bad), false, bad);
  const content = tinyContent();
  content.articles[0].published = "2019-02-31";
  content.articles[1].placements.push({ topic: "basics" });
  const { errors } = validateContent(content);
  assert.ok(errors.some((e) => e.includes('"a1"') && e.includes("real")));
  assert.ok(errors.some((e) => e.includes('placed on "basics", which has subcategories')));
});

test("validateContent reports empty list entries instead of crashing", () => {
  const content = tinyContent();
  content.articles.push(null);
  content.quotes.push("just text");
  content.articles[0].placements.push(null);
  const { errors } = validateContent(content);
  assert.ok(errors.some((e) => e.startsWith("articles.yaml: entry #4")));
  assert.ok(errors.some((e) => e.startsWith("quotes.yaml: entry #2")));
  assert.ok(errors.some((e) => e.includes("empty placement")));
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
  assert.equal(compactNumber(4399555), "4.4M");
  assert.equal(compactNumber(1000), "1K");
  assert.equal(compactNumber(514), "514");
  assert.equal(compactNumber(999950), "1M");
  assert.equal(compactNumber(999949), "999.9K");
  assert.equal(hostname("https://www.vizwiz.com/2026/x.html"), "vizwiz.com");
  assert.equal(smartQuotes(`Don't say "level of detail" ('90s)`), "Don’t say “level of detail” (’90s)");
});
