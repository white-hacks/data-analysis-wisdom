/**
 * lib/catalog.js
 * ----------------------------------------------------------------------------
 * Turns the raw content files (see lib/load-content.js) into the structures
 * the page templates need: the topic tree with its articles and quotes, the
 * people with their vizzes, and the navigation menu.
 *
 * Everything here is a pure function of the content (no file or network
 * access), so it is easy to test and reuse. The website gets the result
 * through src/_data/catalog.js as the global `catalog` variable.
 *
 * URL scheme (single source of truth: the `urls` helpers below)
 *   /articles/                         all categories
 *   /articles/<category>/              one category (its subcategories)
 *   /articles/<category>/<topic>/      one subcategory (its articles)
 *   /quotes/  and  /quotes/<category>/ quotes, grouped the same way
 *   /visualizations/ and /visualizations/<person>/
 */

/** Builds every URL on the site. Change the URL scheme here only. */
const urls = {
  home: () => "/",
  articles: () => "/articles/",
  category: (categorySlug) => `/articles/${categorySlug}/`,
  topic: (categorySlug, topicSlug) => `/articles/${categorySlug}/${topicSlug}/`,
  quotes: () => "/quotes/",
  quoteCategory: (categorySlug) => `/quotes/${categorySlug}/`,
  visualizations: () => "/visualizations/",
  person: (personSlug) => `/visualizations/${personSlug}/`,
};

/**
 * Splits a placement topic ("category/subcategory" or just "category") into
 * its two slugs.
 *
 * @param {string} topic
 * @returns {{categorySlug: string, topicSlug: string|null}}
 */
function parseTopic(topic) {
  const [categorySlug, topicSlug = null] = String(topic).split("/");
  return { categorySlug, topicSlug };
}

/**
 * Creates a lookup of featured people by display name, so article authors
 * and quote authors can link to the person's Visualizations page.
 *
 * @param {object[]} people  Entries from people.yaml.
 * @returns {Map<string, object>}
 */
function indexPeopleByName(people) {
  return new Map(people.map((person) => [person.name, person]));
}

/**
 * Decorates an article with display helpers used by the article card:
 * its author list (each linked to a person page when we feature them).
 *
 * @param {object} article       Entry from articles.yaml.
 * @param {Map<string, object>} peopleByName
 * @returns {object} A shallow copy with an `authorLinks` array added.
 */
function decorateArticle(article, peopleByName) {
  return {
    ...article,
    authorLinks: (article.authors || []).map((name) => {
      const person = peopleByName.get(name);
      return { name, url: person ? urls.person(person.slug) : null };
    }),
  };
}

/**
 * Lists the articles placed on one topic page, grouped into the unnumbered
 * sections declared in categories.yaml. Articles without a section come
 * first, under `main`.
 *
 * @param {object[]} articles      Decorated articles, in file order.
 * @param {string} topic           "category/subcategory" or "category".
 * @param {object[]} [sections]    Section declarations for that topic.
 * @returns {{main: object[], sections: {slug: string, title: string, items: object[]}[], count: number}}
 *          Each item is `{ article, note }`.
 */
function collectPlacements(articles, topic, sections = []) {
  const main = [];
  const bySection = new Map(sections.map((s) => [s.slug, { ...s, items: [] }]));
  const unique = new Set();

  for (const article of articles) {
    for (const placement of article.placements || []) {
      if (placement.topic !== topic) continue;
      const item = { article, note: placement.note || null };
      if (placement.section && bySection.has(placement.section)) bySection.get(placement.section).items.push(item);
      else main.push(item);
      unique.add(article.id);
    }
  }
  return { main, sections: [...bySection.values()], count: unique.size };
}

/**
 * Works out which topic each quote belongs to: its explicit `topic`, or the
 * first placement of its source article.
 *
 * @param {object} quote
 * @param {Map<string, object>} articlesById
 * @returns {string|null}
 */
function quoteTopic(quote, articlesById) {
  if (quote.topic) return quote.topic;
  const article = articlesById.get(quote.article);
  return article && article.placements && article.placements[0] ? article.placements[0].topic : null;
}

/**
 * Decorates a quote with its source article and a link to the author's page.
 *
 * @param {object} quote
 * @param {Map<string, object>} articlesById
 * @param {Map<string, object>} peopleByName
 * @returns {object}
 */
function decorateQuote(quote, articlesById, peopleByName) {
  const person = peopleByName.get(quote.author);
  return {
    ...quote,
    topic: quoteTopic(quote, articlesById),
    source: articlesById.get(quote.article) || null,
    authorUrl: person ? urls.person(person.slug) : null,
  };
}

/**
 * Builds the navigation tree used by the hover menu. Every node is
 * `{ title, url, children }`; a node only has children when its page has
 * sub-pages (the menu shows those titles on hover).
 *
 * @param {object[]} categories  Categories built by buildCatalog().
 * @param {object[]} people      People built by buildCatalog().
 * @returns {object[]}
 */
function buildNavigation(categories, people) {
  return [
    { title: "Home", url: urls.home(), children: [] },
    {
      title: "Articles",
      url: urls.articles(),
      children: categories.map((category) => ({
        title: category.title,
        url: category.url,
        children: category.topics.map((topic) => ({ title: topic.title, url: topic.url, children: [] })),
      })),
    },
    {
      title: "Visualizations",
      url: urls.visualizations(),
      children: people.map((person) => ({ title: person.name, url: person.url, children: [] })),
    },
    {
      title: "Short quotes",
      url: urls.quotes(),
      children: categories.map((category) => ({ title: category.title, url: category.quotesUrl, children: [] })),
    },
  ];
}

/**
 * Builds the complete, page-ready catalog from raw content.
 *
 * Call it once per build (src/_data/catalog.js does) or in tests. The result
 * contains no circular references, so templates can safely loop over it.
 *
 * @param {ReturnType<import("./load-content").loadContent>} content
 * @returns {object} { site, categories, topics, people, quotes, articles, navigation, stats, urls }
 */
function buildCatalog(content) {
  const peopleByName = indexPeopleByName(content.people);
  const articles = content.articles.map((article) => decorateArticle(article, peopleByName));
  const articlesById = new Map(articles.map((a) => [a.id, a]));
  const quotes = content.quotes.map((q) => decorateQuote(q, articlesById, peopleByName));

  const categories = content.categories.map((category) => {
    const base = {
      slug: category.slug,
      title: category.title,
      color: category.color,
      description: category.description,
      url: urls.category(category.slug),
      quotesUrl: urls.quoteCategory(category.slug),
    };

    const topics = (category.subcategories || []).map((sub) => {
      const topicKey = `${category.slug}/${sub.slug}`;
      return {
        ...sub,
        key: topicKey,
        url: urls.topic(category.slug, sub.slug),
        categorySlug: category.slug,
        categoryTitle: category.title,
        categoryUrl: base.url,
        quotesUrl: base.quotesUrl,
        color: category.color,
        placements: collectPlacements(articles, topicKey, sub.sections),
        quotes: quotes.filter((q) => q.topic === topicKey),
      };
    });

    // Previous / next links between sibling topics (the pager at the foot
    // of each topic page).
    topics.forEach((topic, index) => {
      const link = (t) => (t ? { title: t.title, url: t.url } : null);
      topic.previous = link(topics[index - 1]);
      topic.next = link(topics[index + 1]);
      topic.previewTitles = topic.placements.main.slice(0, 3).map((item) => item.article.title);
    });

    // A category without subcategories (Miscellaneous) lists its articles
    // and quotes directly.
    const direct = collectPlacements(articles, category.slug);
    const directQuotes = quotes.filter((q) => q.topic === category.slug);

    const articleIds = new Set();
    for (const article of articles) {
      if ((article.placements || []).some((p) => parseTopic(p.topic).categorySlug === category.slug)) articleIds.add(article.id);
    }

    const allQuotes = [...topics.flatMap((t) => t.quotes), ...directQuotes];

    return {
      ...base,
      topics,
      topicTitles: topics.map((t) => t.title),
      placements: direct,
      quotes: directQuotes,
      featuredQuote: allQuotes[0] || null,
      articleCount: articleIds.size,
      quoteCount: directQuotes.length + topics.reduce((sum, t) => sum + t.quotes.length, 0),
    };
  });

  const people = content.people.map((person) => {
    const gallery = content.vizzes[person.slug] || { vizzes: [] };
    return {
      ...person,
      url: urls.person(person.slug),
      gallery,
      articles: articles.filter((a) => (a.authors || []).includes(person.name)),
      quotes: quotes.filter((q) => q.author === person.name),
    };
  });

  const topics = categories.flatMap((category) => category.topics);

  return {
    site: content.site,
    categories,
    topics,
    people,
    quotes,
    articles,
    navigation: buildNavigation(categories, people),
    stats: {
      articles: articles.length,
      quotes: quotes.length,
      people: people.length,
      vizzes: people.reduce((sum, p) => sum + p.gallery.vizzes.length, 0),
      topics: topics.length,
    },
    urls,
  };
}

module.exports = {
  urls,
  parseTopic,
  indexPeopleByName,
  decorateArticle,
  collectPlacements,
  quoteTopic,
  decorateQuote,
  buildNavigation,
  buildCatalog,
};
