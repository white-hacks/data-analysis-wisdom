#!/usr/bin/env node
/**
 * scripts/check-links.js
 * ----------------------------------------------------------------------------
 * Checks that every article URL in content/articles.yaml (and every Tableau
 * Public profile in content/people.yaml) still responds.
 *
 * It always uses GET: some hosts (e.g. Blogger, behind vizwiz.com and
 * flerlagetwins.com) answer HEAD with 200 even for deleted posts. Tableau
 * Public profile pages answer 200 for any name, so profiles are checked
 * through the JSON endpoint behind them, which returns 404 for unknown names.
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
 * Checks one URL with a GET request (the body is not downloaded).
 * Called once per URL collected by collectUrls().
 *
 * @param {string} url      The URL to request.
 * @param {string} [shown]  The URL to report, when `url` is an API address
 *                          standing in for a page (Tableau Public profiles).
 * @returns {Promise<{url: string, status: number, finalUrl: string, error?: string}>}
 */
async function checkUrl(url, shown = url) {
  try {
    const response = await request(url);
    await response.body?.cancel().catch(() => {});
    return { url: shown, status: response.status, finalUrl: shown === url ? response.url : shown };
  } catch (error) {
    return { url: shown, status: 0, finalUrl: shown, error: error.message };
  }
}

/**
 * Maps a Tableau Public profile page to the JSON endpoint behind it
 * ("…/app/profile/andy.kriebel" → "…/profile/api/andy.kriebel"), or returns
 * null for other URLs. Called by collectUrls() for people.yaml profiles.
 *
 * @param {string} url
 * @returns {string|null}
 */
function profileApiUrl(url) {
  const match = /^https:\/\/public\.tableau\.com\/(?:app\/)?profile\/([^/?#]+)/.exec(url);
  return match ? `https://public.tableau.com/profile/api/${match[1]}` : null;
}

/**
 * Collects every external URL the site links to, labelled with where it
 * comes from so a broken link is easy to find in the content files.
 * Called once by main().
 *
 * @param {ReturnType<typeof loadContent>} content
 * @returns {{label: string, url: string, checkUrl?: string|null}[]}
 */
function collectUrls(content) {
  const urls = content.articles.flatMap((article) => [
    { label: `article:${article.id}`, url: article.url },
    ...(article.alternates || []).map((alt) => ({ label: `article:${article.id}:alternate`, url: alt.url })),
  ]);
  for (const person of content.people) {
    if (person.tableauPublic) urls.push({ label: `person:${person.slug}`, url: person.tableauPublic, checkUrl: profileApiUrl(person.tableauPublic) });
    if (person.website) urls.push({ label: `person:${person.slug}:website`, url: person.website });
  }
  return urls;
}

/** Entry point: runs the checks and prints a report. */
async function main() {
  const asJson = process.argv.includes("--json");
  const targets = collectUrls(loadContent());
  const results = await mapWithConcurrency(targets, 8, async ({ label, url, checkUrl: apiUrl }) => ({
    label,
    ...(await checkUrl(apiUrl || url, url)),
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
