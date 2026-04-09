'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { collectByGlob } = require('./file-metric-checker.js');

// ---------------------------------------------------------------------------
// Structure Fitness Rule Checker
// ---------------------------------------------------------------------------

/**
 * Derive the expected test filename from a source filename and a test glob.
 * For source "utils.ts" and test pattern "src/**\/*.test.ts",
 * the expected test basename is "utils.test.ts".
 *
 * @param {string} sourceBasename - e.g. "utils.ts"
 * @param {string} testPattern    - e.g. "src/**\/*.test.ts"
 * @returns {string}               expected test basename
 */
function deriveTestName(sourceBasename, testPattern) {
  // Extract the ".test" fragment and extension from the test pattern tail
  // Pattern tail example: "*.test.ts" → insert ".test" before extension
  const tail = testPattern.includes('**') ? testPattern.split('**').pop().replace(/^\/?\*/, '') : '';
  // tail is e.g. ".test.ts"
  const ext = path.extname(sourceBasename);
  const stem = sourceBasename.slice(0, -ext.length);
  // Build: stem + tail → e.g. "utils" + ".test.ts"
  return stem + tail;
}

/**
 * Build a regex that matches test filenames from a test glob pattern.
 * E.g. "src/**\/*.test.ts" → matches any basename containing ".test."
 *
 * @param {string} testPattern - e.g. "src/**\/*.test.ts"
 * @returns {RegExp}
 */
function buildTestFileRegex(testPattern) {
  // Extract the tail after **/ — e.g. "*.test.ts"
  const tail = testPattern.includes('**/') ? testPattern.split('**/').pop() : path.basename(testPattern);
  // tail: "*.test.ts" → marker is ".test."
  const m = tail.match(/^\*(.+)\.\w+$/);
  if (m) {
    // Escape dots for regex: ".test." → "\\.test\\."
    const marker = m[1].replace(/\./g, '\\.');
    return new RegExp(marker + '\\.');
  }
  return null;
}

/**
 * Check a structure fitness rule.
 * Currently supports `check: 'colocated'` — verifies that each source file
 * has a corresponding test file in the same directory.
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {object} rule        - fitness rule object
 * @returns {{ ruleId: string, passed: boolean, violations: object[] }}
 */
function checkStructure(projectRoot, rule) {
  const violations = [];

  if (rule.check === 'colocated') {
    const sourceFiles = collectByGlob(projectRoot, rule.source);
    const testFiles = new Set(collectByGlob(projectRoot, rule.test));
    const testFileRegex = buildTestFileRegex(rule.test);

    for (const sourceFile of sourceFiles) {
      const basename = path.basename(sourceFile);

      // Skip files that are themselves test files
      if (testFileRegex && testFileRegex.test(basename)) continue;

      const testName = deriveTestName(basename, rule.test);
      const expectedTestPath = path.join(path.dirname(sourceFile), testName);
      if (!testFiles.has(expectedTestPath)) {
        violations.push({
          file: path.relative(projectRoot, sourceFile),
          message: `No colocated test found. Expected: ${path.relative(projectRoot, expectedTestPath)}`,
        });
      }
    }
  }

  return { ruleId: rule.id, passed: violations.length === 0, violations };
}

module.exports = { checkStructure };
