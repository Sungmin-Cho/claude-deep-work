'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { collectByGlob } = require('./file-metric-checker.js');

// ---------------------------------------------------------------------------
// Forbidden Pattern Fitness Rule Checker
// ---------------------------------------------------------------------------

/**
 * Test whether a filename matches a simple exclude glob.
 * Supports patterns like "**\/*.test.*" — checks if the basename contains
 * the inner fragment (e.g. ".test.").
 *
 * @param {string} relPath  - relative file path
 * @param {string} pattern  - exclude glob, e.g. "**\/*.test.*"
 * @returns {boolean}
 */
function matchesExclude(relPath, pattern) {
  const basename = path.basename(relPath);

  // Handle **/*.test.* style → look for ".test." in basename
  const m = pattern.match(/\*\*\/\*(\.[^*]+)\.\*$/);
  if (m) {
    return basename.includes(m[1] + '.');
  }

  // Handle **/*.ext style → check extension
  const extMatch = pattern.match(/\*\*\/\*(\.\w+)$/);
  if (extMatch) {
    return basename.endsWith(extMatch[1]);
  }

  // Handle directory prefix style → "src/config/**" matches "src/config/env.js"
  const dirMatch = pattern.match(/^([^*]+)\/\*\*$/);
  if (dirMatch) {
    return relPath.startsWith(dirMatch[1] + '/') || relPath.startsWith(dirMatch[1]);
  }

  return false;
}

/**
 * Check a forbidden-pattern fitness rule.
 * Scans each collected file line-by-line for the regex.
 * Respects `rule.exclude` to skip matching files.
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {object} rule        - fitness rule object
 * @returns {{ ruleId: string, passed: boolean, violations: object[] }}
 */
function checkForbiddenPattern(projectRoot, rule) {
  const files = collectByGlob(projectRoot, rule.include);
  const regex = new RegExp(rule.pattern);
  const violations = [];

  for (const file of files) {
    const relPath = path.relative(projectRoot, file);

    // Apply exclude filter
    if (rule.exclude && matchesExclude(relPath, rule.exclude)) continue;

    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(regex);
      if (m) {
        violations.push({
          file: relPath,
          line: i + 1,
          match: m[0],
        });
      }
    }
  }

  return { ruleId: rule.id, passed: violations.length === 0, violations };
}

module.exports = { checkForbiddenPattern };
