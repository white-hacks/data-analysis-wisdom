#!/usr/bin/env node
/**
 * scripts/check-links.js
 * ----------------------------------------------------------------------------
 * Checks that every article URL in content/articles.yaml (and every Tableau
 * Public profile in content/people.yaml) still responds.
 *
 * WHEN TO RUN
 *   Every few months, or before publishing a batch of new articles:
 *     npm run check:links
 *   Behind a proxy:  NODE_USE_ENV_PROXY=1 npm run check:links
 *
 * OUTPUT
 *   One line per URL: status code, the URL, and the final URL if the page
 *   redirected somewhere else. Exits with code 1 when any link is broken
 *   (status >= 400 or no response), so it can run in CI.
 *   401/403/429 answers are reported as "blocked" but not counted as broken:
 *   sites behind bot protection (e.g. Medium) refuse scripts but work in a
 *   browser, so open those by hand.
 *
 * OPTIONS
 *   --json   Print the results as JSON instead of text.
 */

const { loadContent } = require("../lib/load-content");
const { request, mapWithConcurrency } = require("../lib/http");

/**
 * Checks one URL. Tries a HEAD request first (cheap) and falls back to GET
 * because many sites reject HEAD.
 *
 * @param {string} url
 * @returns {Promise<{url: string, status: number, finalUrl: string, error?: string}>}
 */
async function checkUrl(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await request(url, { method });
      // Drain the body so the connection can be reused.
      if (method === "GET") await response.arrayBuffer().catch(() => {});
      if (method === "HEAD" && response.status >= 400) continue;
      return { url, status: response.status, finalUrl: response.url };
    } catch (error) {
      if (method === "GET") return { url, status: 0, finalUrl: url, error: error.message };
    }
  }
  return { url, status: 0, finalUrl: url, error: "unreachable" };
}

/**
 * Collects every external URL the site links to, labelled with where it
 * comes from so a broken link is easy to find in the content files.
 *
 * @param {ReturnType<typeof loadContent>} content
 * @returns {{label: string, url: string}[]}
 */
function collectUrls(content) {
  const urls = content.articles.map((article) => ({ label: `article:${article.id}`, url: article.url }));
  for (const person of content.people) {
    if (person.tableauPublic) urls.push({ label: `person:${person.slug}`, url: person.tableauPublic });
    if (person.website) urls.push({ label: `person:${person.slug}:website`, url: person.website });
  }
  return urls;
}

/** Entry point: runs the checks and prints a report. */
async function main() {
  const asJson = process.argv.includes("--json");
  const targets = collectUrls(loadContent());
  const results = await mapWithConcurrency(targets, 8, async (target) => ({
    ...target,
    ...(await checkUrl(target.url)),
  }));

  const blockedStatuses = new Set([401, 403, 429]);
  const blocked = results.filter((r) => blockedStatuses.has(r.status));
  const broken = results.filter((r) => (r.status === 0 || r.status >= 400) && !blockedStatuses.has(r.status));
  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      const moved = r.finalUrl && r.finalUrl !== r.url ? `  →  ${r.finalUrl}` : "";
      const error = r.error ? `  (${r.error})` : blockedStatuses.has(r.status) ? "  (blocked for scripts: check in a browser)" : "";
      console.log(`${String(r.status).padStart(3)}  ${r.label}  ${r.url}${moved}${error}`);
    }
    console.log(`\n${results.length} links checked, ${broken.length} broken, ${blocked.length} blocked for scripts.`);
  }
  process.exitCode = broken.length ? 1 : 0;
}

main();
