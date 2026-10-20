/**
 * tests/content.test.js
 * ----------------------------------------------------------------------------
 * Checks the real content files and the catalog built from them.
 * Run with `npm test` (uses Node's built-in test runner, no extra packages).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadContent } = require("../lib/load-content");
const { buildCatalog } = require("../lib/catalog");
const { validateContent } = require("../lib/validate");

const content = loadContent();
const catalog = buildCatalog(content);

/** Finds a topic page in the built catalog by "category/subcategory". */
function topicByKey(key) {
  return catalog.topics.find((t) => t.key === key);
}

/** Lists the article ids shown anywhere on a topic page (main list + sections). */
function articleIdsOnTopic(key) {
  const topic = topicByKey(key);
  const items = [...topic.placements.main, ...topic.placements.sections.flatMap((s) => s.items)];
  return new Set(items.map((item) => item.article.id));
}

test("content files pass validation with no errors", () => {
  const { errors } = validateContent(content);
  assert.deepEqual(errors, []);
});

test("the six categories follow the guide, in order", () => {
  assert.deepEqual(
    catalog.categories.map((c) => c.title),
    ["Tableau basics", "Visualization", "Data manipulation", "Data career tips", "Extra", "Miscellaneous"],
  );
  assert.equal(catalog.categories.find((c) => c.slug === "miscellaneous").topics.length, 0);
});

test("an article re-listed in the guide appears on every topic it belongs to", () => {
  // "33 Ways to Tableau" is listed in Basic charting, then referenced again
  // in Best practices and Dashboard interactivity.
  for (const key of ["tableau-basics/basic-charting", "visualization/best-practices", "visualization/dashboard-interactivity"]) {
    assert.ok(articleIdsOnTopic(key).has("sleeper-33-ways"), `missing on ${key}`);
  }
  // Dimensions and Measures help page: Blue vs. green, then Dimensions vs. measures.
  assert.ok(articleIdsOnTopic("tableau-basics/blue-vs-green").has("tableau-dimensions-measures"));
  assert.ok(articleIdsOnTopic("tableau-basics/dimensions-vs-measures").has("tableau-dimensions-measures"));
});

test("special sections from the guide are populated", () => {
  const tableCalcs = topicByKey("data-manipulation/table-calculations");
  const partitioning = tableCalcs.placements.sections.find((s) => s.slug === "partitioning-vs-addressing");
  assert.ok(partitioning.items.length >= 3);
});

test("every quote is shown on an existing topic page or category", () => {
  const validTargets = new Set([...catalog.topics.map((t) => t.key), ...catalog.categories.map((c) => c.slug)]);
  for (const quote of catalog.quotes) {
    assert.ok(validTargets.has(quote.topic), `quote by ${quote.author} has no valid topic`);
    assert.ok(quote.source, `quote by ${quote.author} has no source article`);
  }
  const shown = catalog.categories.reduce((sum, c) => sum + c.quoteCount, 0);
  assert.equal(shown, catalog.quotes.length);
});

test("the menu lists Home, Articles, Visualizations and Short quotes with their sub-pages", () => {
  const [home, articles, visualizations, quotes] = catalog.navigation;
  assert.deepEqual(catalog.navigation.map((n) => n.title), ["Home", "Articles", "Visualizations", "Short quotes"]);
  assert.equal(home.children.length, 0);
  assert.equal(articles.children.length, catalog.categories.length);
  assert.equal(articles.children.find((c) => c.title === "Tableau basics").children.length, 6);
  assert.equal(articles.children.find((c) => c.title === "Miscellaneous").children.length, 0);
  assert.equal(visualizations.children.length, catalog.people.length);
  assert.equal(quotes.children.length, catalog.categories.length);
});

test("every page URL is unique", () => {
  const urls = [
    ...catalog.categories.flatMap((c) => [c.url, c.quotesUrl]),
    ...catalog.topics.map((t) => t.url),
    ...catalog.people.map((p) => p.url),
  ];
  assert.equal(new Set(urls).size, urls.length);
});

test("featured people link to a Tableau Public profile and have a gallery", () => {
  for (const person of catalog.people) {
    assert.match(person.tableauPublic, /^https:\/\/public\.tableau\.com\/app\/profile\//);
    assert.ok(person.gallery.vizzes.length > 0, `${person.name} has no vizzes`);
    for (const viz of person.gallery.vizzes) assert.match(viz.url, /^https:\/\/public\.tableau\.com\//);
  }
});

test("articles by featured people link to their Visualizations page", () => {
  const article = catalog.articles.find((a) => a.id === "lyons-top-15-lods");
  assert.deepEqual(article.authorLinks, [{ name: "Bethany Lyons", url: "/visualizations/bethany-lyons/" }]);
});
