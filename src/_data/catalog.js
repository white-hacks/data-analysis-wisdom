/**
 * src/_data/catalog.js
 * ----------------------------------------------------------------------------
 * Makes the whole site's content available to every template as `catalog`
 * (e.g. `catalog.categories`, `catalog.people`, `catalog.navigation`).
 *
 * Eleventy calls this once per build. The content itself lives in /content;
 * the shaping logic lives in lib/catalog.js.
 */

const { loadContent } = require("../../lib/load-content");
const { buildCatalog } = require("../../lib/catalog");

module.exports = () => buildCatalog(loadContent());
