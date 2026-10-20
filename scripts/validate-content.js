#!/usr/bin/env node
/**
 * scripts/validate-content.js
 * ----------------------------------------------------------------------------
 * Checks the files in /content for mistakes (see lib/validate.js) and prints
 * a short report. Works offline.
 *
 * WHEN TO RUN
 *   After every edit to a content file:
 *     npm run validate
 *   The build runs the same checks and stops if there are errors.
 */

const { loadContent } = require("../lib/load-content");
const { validateContent } = require("../lib/validate");

const { errors, warnings } = validateContent(loadContent());
for (const warning of warnings) console.log(`warning: ${warning}`);
for (const error of errors) console.log(`ERROR:   ${error}`);
console.log(errors.length ? `\n${errors.length} error(s) to fix.` : "\nContent is valid.");
process.exitCode = errors.length ? 1 : 0;
