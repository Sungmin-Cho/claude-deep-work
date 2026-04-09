'use strict';
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// File Metric Fitness Rule Checker
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage']);

/**
 * Parse a simple glob pattern like "src/**\/*.{ts,js}" into a directory prefix
 * and a set of allowed extensions.  This is intentionally minimal — it covers
 * the patterns used in fitness.json without pulling in a full glob library.
 *
 * @param {string} pattern - e.g. "src/**\/*.js" or "src/**\/*.{ts,js}"
 * @returns {{ dirPrefix: string, extensions: Set<string> }}
 */
function parseGlob(pattern) {
  // Split on the first "**" to get the dir prefix
  const starIdx = pattern.indexOf('**');
  const dirPrefix = starIdx > 0 ? pattern.slice(0, starIdx).replace(/\/+$/, '') : '.';

  // Extract extension(s) from the tail — supports *.js and *.{ts,js}
  const tail = starIdx >= 0 ? pattern.slice(starIdx) : pattern;
  const extMatch = tail.match(/\*\.(?:\{([^}]+)\}|(\w+))$/);
  const extensions = new Set();
  if (extMatch) {
    if (extMatch[1]) {
      extMatch[1].split(',').forEach(e => extensions.add('.' + e.trim()));
    } else {
      extensions.add('.' + extMatch[2]);
    }
  }
  return { dirPrefix, extensions };
}

/**
 * Recursively collect files under `rootDir` matching a simple glob pattern.
 * Skips node_modules, dotfiles/dotdirs, and common build output.
 *
 * @param {string} rootDir  - absolute project root
 * @param {string} pattern  - glob like "src/**\/*.js"
 * @returns {string[]}        array of absolute paths
 */
function collectByGlob(rootDir, pattern) {
  const { dirPrefix, extensions } = parseGlob(pattern);
  const baseDir = path.resolve(rootDir, dirPrefix);
  const results = [];

  if (!fs.existsSync(baseDir)) return results;

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;

      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (extensions.size === 0 || extensions.has(path.extname(name))) {
          results.push(full);
        }
      }
    }
  }

  walk(baseDir);
  return results;
}

/**
 * Check a file-metric fitness rule.
 * Currently supports `check: 'line-count'`.
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {object} rule        - fitness rule object
 * @returns {{ ruleId: string, passed: boolean, violations: object[] }}
 */
function checkFileMetric(projectRoot, rule) {
  const files = collectByGlob(projectRoot, rule.include);
  const violations = [];

  for (const file of files) {
    if (rule.check === 'line-count') {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
      if (lines > rule.max) {
        violations.push({
          file: path.relative(projectRoot, file),
          lines,
          max: rule.max,
        });
      }
    }
  }

  return { ruleId: rule.id, passed: violations.length === 0, violations };
}

module.exports = { checkFileMetric, collectByGlob };
