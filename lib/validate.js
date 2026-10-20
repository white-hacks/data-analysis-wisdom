/**
 * lib/validate.js
 * ----------------------------------------------------------------------------
 * Checks the raw content for mistakes that would break pages or links:
 * missing fields, duplicate ids, placements pointing at topics that don't
 * exist, quotes pointing at unknown articles, and so on.
 *
 * Used by `npm run validate`, by the tests, and by the build (which stops
 * with a clear message instead of publishing a broken site).
 */

/** Accent colours defined in src/assets/css/main.css. */
const COLORS = new Set(["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"]);

/** Accepted shapes for `published`: "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
const DATE_PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * True when `value` is a real "YYYY", "YYYY-MM" or "YYYY-MM-DD" date
 * (so "2019-13" and "2019-02-31" are rejected). Called for every
 * `published` value in articles.yaml.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidDate(value) {
  const match = DATE_PATTERN.exec(String(value));
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  if (match[2] && (month < 1 || month > 12)) return false;
  if (match[3]) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  }
  return true;
}

/**
 * Collects the valid placement targets declared in categories.yaml: every
 * subcategory ("category/subcategory") and every category. Called once by
 * validateContent().
 *
 * @param {object[]} categories
 * @returns {Map<string, Set<string>>} topic key → set of section slugs
 */
function topicIndex(categories) {
  const topics = new Map();
  for (const category of categories) {
    topics.set(category.slug, new Set());
    for (const sub of category.subcategories || []) {
      topics.set(`${category.slug}/${sub.slug}`, new Set((sub.sections || []).map((s) => s.slug)));
    }
  }
  return topics;
}

/**
 * Reports values that appear more than once. Called for ids, slugs and URLs.
 *
 * @param {string[]} values
 * @returns {string[]} The duplicated values.
 */
function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated];
}

/**
 * Validates every content file.
 *
 * Call it with the result of loadContent(). Returns two lists: `errors`
 * (must be fixed: the build fails) and `warnings` (worth a look).
 *
 * @param {ReturnType<import("./load-content").loadContent>} content
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateContent(content) {
  const errors = [];
  const warnings = [];
  const { site, vizzes } = content;

  // Each file must hold a list of entries ("- id: …"). Drop entries that are
  // not objects (e.g. a stray "-" line) after reporting them, so the checks
  // below can read their fields safely.
  /** Returns the object entries of a list file, reporting anything else. */
  const entries = (list, fileName) => {
    if (!Array.isArray(list)) {
      errors.push(`${fileName}: expected a list of entries, each starting with "- "`);
      return [];
    }
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") errors.push(`${fileName}: entry #${index + 1} is empty or not a set of fields`);
    });
    return list.filter((entry) => entry && typeof entry === "object");
  };
  const categories = entries(content.categories, "categories.yaml");
  const articles = entries(content.articles, "articles.yaml");
  const quotes = entries(content.quotes, "quotes.yaml");
  const people = entries(content.people, "people.yaml");

  // --- site.yaml ---------------------------------------------------------------
  for (const key of ["name", "url", "tagline"]) if (!site || !site[key]) errors.push(`site.yaml: missing "${key}"`);

  // --- categories.yaml ---------------------------------------------------------
  for (const slug of duplicates(categories.map((c) => c.slug))) errors.push(`categories.yaml: duplicate category slug "${slug}"`);
  for (const category of categories) {
    if (!category.slug || !category.title) errors.push(`categories.yaml: a category is missing slug or title`);
    if (!COLORS.has(category.color)) errors.push(`categories.yaml: "${category.slug}" has unknown color "${category.color}"`);
    const subs = category.subcategories || [];
    for (const slug of duplicates(subs.map((s) => s.slug))) errors.push(`categories.yaml: duplicate subcategory "${category.slug}/${slug}"`);
    for (const sub of subs) {
      if (!sub.slug || !sub.title) errors.push(`categories.yaml: a subcategory of "${category.slug}" is missing slug or title`);
      for (const slug of duplicates((sub.sections || []).map((s) => s.slug))) errors.push(`categories.yaml: duplicate section "${slug}" in "${sub.slug}"`);
    }
  }
  const topics = topicIndex(categories);

  // --- articles.yaml -----------------------------------------------------------
  for (const id of duplicates(articles.map((a) => a.id))) errors.push(`articles.yaml: duplicate id "${id}"`);
  const allUrls = articles.flatMap((a) => [a.url, ...(a.alternates || []).map((alt) => alt.url)]);
  for (const url of duplicates(allUrls)) warnings.push(`articles.yaml: the URL ${url} is listed twice; place one article in several topics, or list the copy under "alternates"`);
  const placed = new Map([...topics.keys()].map((key) => [key, 0]));
  const categoriesWithTopics = new Set(categories.filter((c) => (c.subcategories || []).length).map((c) => c.slug));
  for (const article of articles) {
    const where = `articles.yaml: "${article.id || article.title}"`;
    for (const key of ["id", "title", "url", "publisher", "summary"]) if (!article[key]) errors.push(`${where} is missing "${key}"`);
    if (!Array.isArray(article.authors) || article.authors.length === 0) errors.push(`${where} needs at least one author`);
    if (article.url && !/^https?:\/\//.test(article.url)) errors.push(`${where} has a URL that doesn't start with http(s)://`);
    if (article.published && !isValidDate(article.published)) errors.push(`${where} has a "published" date that isn't a real YYYY, YYYY-MM or YYYY-MM-DD date`);
    if (article.alternates !== undefined && !Array.isArray(article.alternates)) errors.push(`${where} has "alternates" that is not a list`);
    for (const alt of Array.isArray(article.alternates) ? article.alternates : []) {
      if (!alt || !alt.publisher || !/^https?:\/\//.test(alt.url || "")) errors.push(`${where} has an alternate without a publisher or an http(s) URL`);
      if (alt && alt.published && !isValidDate(alt.published)) errors.push(`${where} has an alternate whose "published" date isn't a real YYYY, YYYY-MM or YYYY-MM-DD date`);
    }
    if (!Array.isArray(article.placements) || article.placements.length === 0) errors.push(`${where} has no placements`);
    for (const placement of Array.isArray(article.placements) ? article.placements : []) {
      if (!placement || typeof placement !== "object") {
        errors.push(`${where} has an empty placement`);
        continue;
      }
      if (!topics.has(placement.topic)) {
        errors.push(`${where} is placed in unknown topic "${placement.topic}"`);
        continue;
      }
      if (categoriesWithTopics.has(placement.topic)) {
        // The category page lists its subcategories, not articles, so the
        // article would appear nowhere.
        errors.push(`${where} is placed on "${placement.topic}", which has subcategories: place it on one of them`);
        continue;
      }
      placed.set(placement.topic, placed.get(placement.topic) + 1);
      if (placement.section && !topics.get(placement.topic).has(placement.section)) {
        errors.push(`${where} uses unknown section "${placement.section}" in "${placement.topic}"`);
      }
    }
  }
  for (const category of categories) {
    // Categories with subcategories list those, so only check their leaves.
    const leaves = (category.subcategories || []).length ? category.subcategories.map((s) => `${category.slug}/${s.slug}`) : [category.slug];
    for (const key of leaves) if (!placed.get(key)) warnings.push(`topic "${key}" has no articles yet`);
  }

  // --- quotes.yaml -------------------------------------------------------------
  const articleIds = new Set(articles.map((a) => a.id));
  quotes.forEach((quote, index) => {
    const where = `quotes.yaml: quote #${index + 1}`;
    if (!quote.text || !String(quote.text).trim()) errors.push(`${where} has no text`);
    if (!quote.author) errors.push(`${where} has no author`);
    if (!articleIds.has(quote.article)) errors.push(`${where} refers to unknown article "${quote.article}"`);
    if (quote.topic && !topics.has(quote.topic)) errors.push(`${where} uses unknown topic "${quote.topic}"`);
  });

  // --- people.yaml / vizzes.json -----------------------------------------------
  for (const slug of duplicates(people.map((p) => p.slug))) errors.push(`people.yaml: duplicate slug "${slug}"`);
  for (const person of people) {
    const where = `people.yaml: "${person.slug || person.name}"`;
    if (!person.slug || !person.name) errors.push(`${where} is missing slug or name`);
    if (!/^https:\/\/public\.tableau\.com\/.*profile\/[^/]+/.test(person.tableauPublic || "")) {
      errors.push(`${where} needs a Tableau Public profile URL (https://public.tableau.com/app/profile/<name>)`);
    }
    if (!vizzes[person.slug]) warnings.push(`${where} has no vizzes yet: run "npm run fetch:vizzes -- --only ${person.slug}"`);
  }

  return { errors, warnings };
}

module.exports = { COLORS, isValidDate, validateContent };
