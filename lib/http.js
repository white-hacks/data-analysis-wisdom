/**
 * lib/http.js
 * ----------------------------------------------------------------------------
 * Small HTTP helpers shared by the maintenance scripts in /scripts
 * (link checking, quote verification, Tableau Public fetching).
 *
 * The website build itself never uses the network: everything it needs is
 * committed in /content.
 *
 * Behind a corporate proxy, run the scripts with NODE_USE_ENV_PROXY=1 so
 * Node's built-in fetch honours HTTPS_PROXY (Node >= 22.21).
 */

/** A browser-like User-Agent: some sites refuse requests from unknown clients. */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0 Safari/537.36 TheTableauRepoBot/1.0 (+https://thetableaurepo.com)";

/**
 * Fetches a URL with a timeout and the shared User-Agent.
 *
 * Call it instead of fetch() in scripts, so every request behaves the same.
 * Redirects are followed; `response.url` holds the final address.
 *
 * @param {string} url
 * @param {{timeoutMs?: number, method?: string, headers?: object}} [options]
 * @returns {Promise<Response>}
 */
async function request(url, { timeoutMs = 20000, method = "GET", headers = {} } = {}) {
  return fetch(url, {
    method,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...headers },
  });
}

/**
 * Runs `worker` over `items` with at most `limit` requests in flight.
 *
 * Call it to check many URLs quickly without hammering a single site.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>} Results in the same order as `items`.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

module.exports = { USER_AGENT, request, mapWithConcurrency };
