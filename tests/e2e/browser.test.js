/**
 * tests/e2e/browser.test.js
 * ----------------------------------------------------------------------------
 * End-to-end tests in a real browser (Chromium, driven by Playwright) against
 * the BUILT site in _site/.
 *
 * Run with:   npm run build && npm run test:e2e
 * In CI the workflow installs Chromium first (npx playwright install chromium).
 *
 * The tests are hermetic: a tiny local web server serves _site/, and every
 * request to another host (Google Fonts, Tableau Public thumbnails) is
 * blocked, so results never depend on the network.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const SITE_DIR = path.join(__dirname, "..", "..", "_site");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };

/** Widths covering small phones up to wide desktops. */
const WIDTHS = [320, 390, 768, 1024, 1440];

/**
 * Starts a static file server for _site/ on a free port, serving folders as
 * index.html and unknown paths as 404.html (like GitHub Pages).
 * @returns {Promise<{server: http.Server, base: string}>}
 */
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(SITE_DIR, urlPath);
    if (urlPath.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(SITE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      res.end(fs.readFileSync(path.join(SITE_DIR, "404.html")));
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/**
 * Lists every page of the built site as a URL path ("/articles/", …).
 * @returns {string[]}
 */
function allPagePaths() {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : e.name === "index.html" ? [full] : [];
    });
  return walk(SITE_DIR).map((file) => "/" + path.relative(SITE_DIR, path.dirname(file)).split(path.sep).join("/") + "/").map((p) => p.replace("//", "/"));
}

/**
 * Opens a browser context that blocks external requests and records
 * JavaScript errors and console errors for the given page.
 * @returns {Promise<{context: import("playwright").BrowserContext, page: import("playwright").Page, errors: string[]}>}
 */
async function openPage(browser, options = {}) {
  const context = await browser.newContext(options);
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`JS error: ${error.message}`));
  page.on("console", (message) => {
    // Blocked external resources log "Failed to load resource"; those are expected here.
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  return { context, page, errors };
}

/** Reads whether the menu panel is currently shown to the user. */
function panelIsVisible(page) {
  return page.locator("#menu-panel").isVisible();
}

let server;
let base;
let browser;

test.before(async () => {
  assert.ok(fs.existsSync(path.join(SITE_DIR, "index.html")), "Build the site first: npm run build");
  ({ server, base } = await startServer());
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  server?.close();
});

/**
 * CSS added to every page in a second pass to imitate a wider fallback font
 * (fonts differ between computers), so layouts that only just fit fail here
 * rather than on a visitor's phone.
 */
const WIDE_TEXT = "* { letter-spacing: 0.1em !important; word-spacing: 0.1em !important; }";

test("every page loads without errors and never scrolls sideways", async () => {
  const pages = allPagePaths();
  assert.ok(pages.length > 40, `expected the full site, found ${pages.length} pages`);
  for (const width of WIDTHS) {
    const { context, page, errors } = await openPage(browser, { viewport: { width, height: 900 } });
    for (const urlPath of pages) {
      const response = await page.goto(base + urlPath, { waitUntil: "load" });
      assert.equal(response.status(), 200, `${urlPath} returned ${response.status()}`);
      for (const pass of ["normal text", "wide text"]) {
        if (pass === "wide text") await page.addStyleTag({ content: WIDE_TEXT });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `${urlPath} overflows by ${overflow}px at ${width}px wide (${pass})`);
      }
    }
    assert.deepEqual(errors, [], `errors at ${width}px`);
    await context.close();
  }
});

test("desktop: the menu is hidden until hovered, and fly-outs show sub-pages", async () => {
  const { context, page, errors } = await openPage(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(base + "/articles/tableau-basics/data-relationships/");

  assert.equal(await panelIsVisible(page), false, "menu should start hidden");
  await page.hover(".menu__trigger");
  await page.locator("#menu-panel").waitFor({ state: "visible" });

  const articles = page.locator(".menu__list--level-1 > .menu__item", { hasText: "Articles" }).first();
  await articles.locator(":scope > .menu__link").hover();
  const categories = articles.locator(":scope > .menu__list");
  await categories.waitFor({ state: "visible" });
  assert.equal(await categories.locator(":scope > .menu__item").count(), 6);

  const basics = categories.locator(":scope > .menu__item", { hasText: "Tableau basics" }).first();
  await basics.locator(":scope > .menu__link").hover();
  const topics = basics.locator(":scope > .menu__list");
  await topics.waitFor({ state: "visible" });
  assert.ok(await topics.getByRole("link", { name: "Data cleaning" }).isVisible());

  // The fly-outs stay inside the window.
  for (const box of [await categories.boundingBox(), await topics.boundingBox()]) {
    assert.ok(box.x >= 0 && box.x + box.width <= 1440, `fly-out off screen: ${JSON.stringify(box)}`);
  }

  // Clicking a sub-page link navigates there.
  await topics.getByRole("link", { name: "Data cleaning" }).click();
  await page.waitForURL("**/articles/tableau-basics/data-cleaning/");

  // Moving the mouse away hides the menu again.
  await page.mouse.move(700, 800);
  await page.locator("#menu-panel").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  await context.close();
});

test("desktop: the Visualizations and Short quotes entries list their sub-pages", async () => {
  const { context, page } = await openPage(browser, { viewport: { width: 1280, height: 900 } });
  await page.goto(base + "/");
  await page.hover(".menu__trigger");
  for (const [entry, expected] of [["Visualizations", "Andy Kriebel"], ["Short quotes", "Data career tips"]]) {
    const item = page.locator(".menu__list--level-1 > .menu__item", { hasText: entry }).first();
    await item.locator(":scope > .menu__link").hover();
    await item.locator(":scope > .menu__list").waitFor({ state: "visible" });
    assert.ok(await item.locator(":scope > .menu__list").getByRole("link", { name: expected }).isVisible());
  }
  await context.close();
});

/**
 * Moves the mouse in a straight line from the centre of one element to the
 * centre of another in `steps` steps of about 16ms, like a real pointer.
 */
async function glide(page, fromLocator, toLocator, steps) {
  const a = await fromLocator.boundingBox();
  const b = await toLocator.boundingBox();
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x + ((end.x - start.x) * i) / steps, start.y + ((end.y - start.y) * i) / steps);
    await page.waitForTimeout(16);
  }
}

test("desktop: moving diagonally to a fly-out never lets a neighbour take over (menu aim)", async () => {
  const { context, page, errors } = await openPage(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(base + "/");
  const level1 = (name) => page.locator(".menu__list--level-1 > .menu__item", { hasText: name }).first();
  const cases = [
    ["Visualizations", "Jonathan Drummey", 8],
    ["Visualizations", "Jonathan Drummey", 30],
    ["Articles", "Miscellaneous", 8],
    ["Articles", "Miscellaneous", 30],
    ["Short quotes", "Tableau basics", 12],
  ];
  for (const [entry, target, steps] of cases) {
    await page.mouse.move(5, 5);
    await page.locator("#menu-panel").waitFor({ state: "hidden" });
    await page.hover(".menu__trigger");
    const item = level1(entry);
    await item.locator(":scope > .menu__link").hover();
    const link = item.locator(":scope > .menu__list").getByRole("link", { name: target });
    await link.waitFor({ state: "visible" });
    await glide(page, item.locator(":scope > .menu__link"), link, steps);
    await page.waitForTimeout(450);
    assert.ok(await link.isVisible(), `${entry} → ${target} in ${steps} steps: the fly-out closed on the way`);
  }

  // Three levels: Articles → Data manipulation → its last topic.
  await page.mouse.move(5, 5);
  await page.locator("#menu-panel").waitFor({ state: "hidden" });
  await page.hover(".menu__trigger");
  const articles = level1("Articles");
  await articles.locator(":scope > .menu__link").hover();
  const manipulation = articles.locator(":scope > .menu__list > .menu__item", { hasText: "Data manipulation" }).first();
  await glide(page, articles.locator(":scope > .menu__link"), manipulation.locator(":scope > .menu__link"), 15);
  const lastTopic = manipulation.locator(":scope > .menu__list").getByRole("link", { name: "Sets vs. parameters" });
  await lastTopic.waitFor({ state: "visible" });
  await glide(page, manipulation.locator(":scope > .menu__link"), lastTopic, 15);
  await page.waitForTimeout(450);
  assert.ok(await lastTopic.isVisible(), "third-level fly-out closed on the way");
  await lastTopic.click();
  await page.waitForURL("**/articles/data-manipulation/sets-vs-parameters/");
  assert.deepEqual(errors, []);
  await context.close();
});

test("desktop: without JavaScript the menu still opens on hover (CSS fallback)", async () => {
  const { context, page } = await openPage(browser, { viewport: { width: 1280, height: 800 }, javaScriptEnabled: false });
  // Playwright's hover() waits for animation frames, which never come with
  // JavaScript off, so move the mouse to the element's centre directly.
  const pointAt = async (locator) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  };
  await page.goto(base + "/");
  await pointAt(page.locator(".menu__trigger"));
  await page.locator("#menu-panel").waitFor({ state: "visible" });
  const articles = page.locator(".menu__list--level-1 > .menu__item", { hasText: "Articles" }).first();
  await pointAt(articles.locator(":scope > .menu__link"));
  await articles.locator(":scope > .menu__list").waitFor({ state: "visible" });
  await page.mouse.move(5, 700);
  await page.locator("#menu-panel").waitFor({ state: "hidden" });
  await context.close();
});

test("desktop: stopping on a neighbouring entry switches to it promptly", async () => {
  const { context, page } = await openPage(browser, { viewport: { width: 1280, height: 800 } });
  await page.goto(base + "/");
  await page.hover(".menu__trigger");
  const viz = page.locator(".menu__list--level-1 > .menu__item", { hasText: "Visualizations" }).first();
  const quotes = page.locator(".menu__list--level-1 > .menu__item", { hasText: "Short quotes" }).first();
  await viz.locator(":scope > .menu__link").hover();
  await viz.locator(":scope > .menu__list").waitFor({ state: "visible" });
  // Straight down onto "Short quotes", then rest there.
  await glide(page, viz.locator(":scope > .menu__link"), quotes.locator(":scope > .menu__link"), 6);
  await quotes.locator(":scope > .menu__list").waitFor({ state: "visible", timeout: 1000 });
  await viz.locator(":scope > .menu__list").waitFor({ state: "hidden", timeout: 1000 });
  await context.close();
});

test("desktop: every fly-out fits inside a short laptop window", async () => {
  const { context, page } = await openPage(browser, { viewport: { width: 1024, height: 600 } });
  await page.goto(base + "/");
  await page.hover(".menu__trigger");
  const parents = page.locator(".menu__list--level-1 > .menu__item--parent");
  for (let i = 0; i < (await parents.count()); i++) {
    const item = parents.nth(i);
    await item.locator(":scope > .menu__link").hover();
    const list = item.locator(":scope > .menu__list");
    await list.waitFor({ state: "visible" });
    const box = await list.boundingBox();
    assert.ok(box.x >= 0 && box.y + box.height <= 600, `fly-out ${i + 1} leaves the window: ${JSON.stringify(box)}`);
    const subParents = list.locator(":scope > .menu__item--parent");
    for (let j = 0; j < (await subParents.count()); j++) {
      const sub = subParents.nth(j);
      await sub.locator(":scope > .menu__link").hover();
      const subList = sub.locator(":scope > .menu__list");
      await subList.waitFor({ state: "visible" });
      const subBox = await subList.boundingBox();
      assert.ok(subBox.x >= 0 && subBox.y + subBox.height <= 600, `fly-out ${i + 1}.${j + 1} leaves the window: ${JSON.stringify(subBox)}`);
    }
  }
  await context.close();
});

test("keyboard: Enter opens the menu, Tab reaches its links, Escape closes it", async () => {
  const { context, page } = await openPage(browser, { viewport: { width: 1280, height: 900 } });
  await page.goto(base + "/quotes/");
  await page.focus(".menu__trigger");
  await page.keyboard.press("Enter");
  assert.equal(await page.getAttribute(".menu__trigger", "aria-expanded"), "true");
  assert.ok(await panelIsVisible(page));
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Home");
  await page.keyboard.press("Escape");
  await page.locator("#menu-panel").waitFor({ state: "hidden" });
  assert.equal(await page.getAttribute(".menu__trigger", "aria-expanded"), "false");
  // Focus returns to the Menu button so keyboard users keep their place.
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains("menu__trigger")));
  // Enter on the Menu button opens it again.
  await page.keyboard.press("Enter");
  assert.ok(await panelIsVisible(page));
  assert.equal(await page.getAttribute(".menu__trigger", "aria-expanded"), "true");
  await context.close();
});

test("touch screen: tapping opens a full-screen menu with expandable sections", async () => {
  const { context, page, errors } = await openPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(base + "/");
  assert.equal(await panelIsVisible(page), false);

  await page.tap(".menu__trigger");
  const panel = page.locator("#menu-panel");
  await panel.waitFor({ state: "visible" });
  const box = await panel.boundingBox();
  assert.ok(box.height > 700, `menu sheet should fill the screen, height ${box.height}`);
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "hidden");

  // Expand Articles, then Data manipulation, then follow a topic link.
  const articles = page.locator(".menu__list--level-1 > .menu__item", { hasText: "Articles" }).first();
  assert.equal(await articles.locator(":scope > .menu__list").isVisible(), false);
  await articles.locator(":scope > .menu__expand").tap();
  assert.equal(await articles.locator(":scope > .menu__expand").getAttribute("aria-expanded"), "true");
  const manipulation = articles.locator(":scope > .menu__list > .menu__item", { hasText: "Data manipulation" }).first();
  await manipulation.locator(":scope > .menu__expand").tap();
  await manipulation.getByRole("link", { name: "LOD expressions" }).tap();
  await page.waitForURL("**/articles/data-manipulation/lod-expressions/");

  // After navigating, the menu is closed and the page scrolls normally.
  assert.equal(await panelIsVisible(page), false);
  assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "");
  assert.deepEqual(errors, []);
  await context.close();
});

test("touch screen: the menu opens on the current section", async () => {
  const { context, page } = await openPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(base + "/visualizations/shreya-arya/");
  await page.tap(".menu__trigger");
  const current = page.locator('#menu-panel a[aria-current="page"]');
  assert.equal(await current.count(), 1);
  assert.ok(await current.isVisible(), "the current page's link should be visible in the opened menu");
  await context.close();
});

test("unknown addresses get the 404 page", async () => {
  const { context, page } = await openPage(browser);
  const response = await page.goto(base + "/no-such-page/");
  assert.equal(response.status(), 404);
  assert.match(await page.textContent("h1"), /Page not found/);
  await context.close();
});

test("an article published in two places shows its alternate version", async () => {
  const { context, page } = await openPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(base + "/articles/visualization/psychology/");
  const card = page.locator(".article-card", { hasText: "psychological schemas" }).first();
  const alternate = card.locator(".article-card__alternate a");
  assert.equal(await alternate.count(), 1);
  assert.match(await alternate.getAttribute("href"), /^https:\/\/playfairdata\.com\//);
  assert.match(await alternate.textContent(), /Playfair Data, 18 Oct 2016/);
  // The ↗ icon stays inline (not styled as a block label).
  assert.equal(await alternate.locator(".external").evaluate((el) => getComputedStyle(el).display), "inline-block");
  await context.close();
});

test("every article link opens the original in a new tab", async () => {
  const { context, page } = await openPage(browser);
  await page.goto(base + "/articles/visualization/best-practices/");
  const links = page.locator(".article-card__title a");
  assert.ok((await links.count()) > 5);
  for (const link of await links.all()) {
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.match(await link.getAttribute("rel"), /noopener/);
    assert.match(await link.getAttribute("href"), /^https:\/\//);
  }
  await context.close();
});
