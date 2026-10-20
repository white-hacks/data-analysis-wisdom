/**
 * tests/check-site.test.js
 * ----------------------------------------------------------------------------
 * Makes sure scripts/check-site.js really catches problems, using a tiny
 * hand-written "site" in a temporary folder.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkSite } = require("../scripts/check-site");

/** Writes `files` ({ "path/in/site": "html" }) into a fresh temporary folder. */
function makeSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tableau-repo-site-"));
  for (const [name, html] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), html);
  }
  return dir;
}

/** A page that passes every check, with `body` inserted. */
function page(body, { title = "T", h1 = "<h1>Heading</h1>" } = {}) {
  return `<!doctype html><html><head><title>${title}</title><meta name="description" content="d"></head><body>${h1}${body}</body></html>`;
}

test("a correct site has no problems", () => {
  const dir = makeSite({
    "index.html": page('<a href="/about/">About</a> <a href="/about/#team">Team</a> <a href="https://x.test" target="_blank" rel="noopener">X</a> <img src="a.png" alt="">'),
    "about/index.html": page('<section id="team"></section>'),
  });
  assert.deepEqual(checkSite(dir), { pages: 2, problems: [] });
});

test("broken links, missing anchors and markup mistakes are reported", () => {
  const dir = makeSite({
    "index.html": page(
      '<a href="/missing/">x</a> <a href="/about/#nope">y</a> <a href="https://x.test" target="_blank">z</a>' +
        '<img src="a.png"><p id="a"></p><p id="a"></p><p>Total: undefined</p>',
      { h1: "" },
    ),
    "about/index.html": page(""),
  });
  const { problems } = checkSite(dir);
  const expected = ["broken internal link /missing/", "missing anchor", "without rel=\"noopener\"", "without alt", 'duplicate id "a"', '"undefined"', "<h1> elements"];
  for (const fragment of expected) {
    assert.ok(problems.some((p) => p.includes(fragment)), `expected a problem mentioning ${fragment}\n${problems.join("\n")}`);
  }
});

test("odd links are reported one by one instead of stopping the check", () => {
  const dir = makeSite({
    "index.html": page(
      `<a href="/a%zz/">bad escape</a> <a href='/missing/'>single quotes</a> <a href="//fonts.example/css">protocol-relative</a>` +
        '<img src="a.png" alt="undefined"><meta property="og:title" content="NaN">',
    ),
  });
  const { problems } = checkSite(dir);
  assert.ok(problems.some((p) => p.includes("malformed URL /a%zz/")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("broken internal link /missing/")), problems.join("\n"));
  assert.ok(!problems.some((p) => p.includes("//fonts.example")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes('"undefined"')) && problems.some((p) => p.includes('"NaN"')), problems.join("\n"));
});
