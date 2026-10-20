/**
 * eleventy.config.js
 * ----------------------------------------------------------------------------
 * Configuration for Eleventy (https://www.11ty.dev), the static site
 * generator that turns /src templates + /content data into the HTML in /_site.
 *
 *   npm start       → local preview with live reload (http://localhost:8080)
 *   npm run build   → production build into /_site
 *
 * The filters registered below are small helpers the templates call, e.g.
 * {{ article.published | readableDate }}.
 */

const { loadContent } = require("./lib/load-content");
const { validateContent } = require("./lib/validate");

/** Month names for readableDate. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a "YYYY", "YYYY-MM" or "YYYY-MM-DD" string for display
 * ("2019-11" → "Nov 2019", "2019-11-22" → "22 Nov 2019").
 * Used by the article card.
 *
 * @param {string|number|undefined} value
 * @returns {string}
 */
function readableDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!month) return year;
  const monthName = MONTHS[Number(month) - 1];
  return day ? `${Number(day)} ${monthName} ${year}` : `${monthName} ${year}`;
}

/**
 * Shortens large numbers for viz statistics (9271 → "9.3K", 4399555 → "4.4M").
 *
 * @param {number} value
 * @returns {string}
 */
function compactNumber(value) {
  return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

/**
 * Returns the bare host name of a URL for display ("https://www.vizwiz.com/x" → "vizwiz.com").
 *
 * @param {string} url
 * @returns {string}
 */
function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

module.exports = function (eleventyConfig) {
  // Stop the build with a readable list of problems if the content is broken.
  eleventyConfig.on("eleventy.before", () => {
    const { errors } = validateContent(loadContent());
    if (errors.length) {
      throw new Error(`Content has ${errors.length} error(s):\n- ${errors.join("\n- ")}\nRun "npm run validate" for details.`);
    }
  });

  // Rebuild when content files change during `npm start`.
  eleventyConfig.addWatchTarget("./content/");
  eleventyConfig.addWatchTarget("./lib/");

  // Static files copied as-is.
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });

  // Template helpers.
  eleventyConfig.addFilter("readableDate", readableDate);
  eleventyConfig.addFilter("compactNumber", compactNumber);
  eleventyConfig.addFilter("hostname", hostname);
  /** Joins a site-relative path to the site's public address (for canonical/OG tags). */
  eleventyConfig.addFilter("absoluteUrl", (path, base) => new URL(path, base).href);
  /** True when `currentUrl` is `itemUrl` or one of its sub-pages (menu highlighting). */
  eleventyConfig.addFilter("isWithin", (currentUrl, itemUrl) =>
    itemUrl === "/" ? currentUrl === "/" : String(currentUrl).startsWith(itemUrl),
  );
  /** Picks "article"/"articles" style plurals: {{ count | plural("article") }}. */
  eleventyConfig.addFilter("plural", (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`);

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    templateFormats: ["njk", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};

module.exports.readableDate = readableDate;
module.exports.compactNumber = compactNumber;
module.exports.hostname = hostname;
