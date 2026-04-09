'use strict';
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Recursively collect files matching given extensions.
 * Skips node_modules and dotfile directories.
 */
function collectFiles(dir, extensions, _results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return _results; }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, extensions, _results);
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      _results.push(full);
    }
  }
  return _results;
}

// ---------------------------------------------------------------------------
// Export extraction (grep-based, not AST)
// ---------------------------------------------------------------------------

/**
 * Extract exported names from file content.
 * Patterns:
 *   1. export function NAME / export const NAME / export class NAME
 *   2. export { NAME, NAME2 }  (non-reexport only)
 *   3. module.exports = { NAME, NAME2 }
 */
function extractExportNames(content) {
  const names = [];

  // Pattern 1: export function/const/let/var/class NAME
  const declRe = /export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let m;
  while ((m = declRe.exec(content)) !== null) {
    names.push(m[1]);
  }

  // Pattern 2: export { a, b, c }  (but NOT  export { a } from './x'  -- those are re-exports)
  const namedExportRe = /export\s*\{([^}]+)\}/g;
  while ((m = namedExportRe.exec(content)) !== null) {
    // Check if this line is a re-export (has "from" after the closing brace)
    const afterBrace = content.slice(m.index + m[0].length, m.index + m[0].length + 50);
    if (/^\s*from\s/.test(afterBrace)) continue; // skip re-exports
    const inner = m[1];
    for (const part of inner.split(',')) {
      const trimmed = part.trim().split(/\s+as\s+/).pop().trim();
      if (trimmed && /^[A-Za-z_$]/.test(trimmed)) names.push(trimmed);
    }
  }

  // Pattern 3: module.exports = { a, b, c }
  const moduleExportsRe = /module\.exports\s*=\s*\{([^}]+)\}/g;
  while ((m = moduleExportsRe.exec(content)) !== null) {
    const inner = m[1];
    for (const part of inner.split(',')) {
      // Handle "key: value" and bare "key"
      const trimmed = part.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      const name = colonIdx >= 0 ? trimmed.slice(0, colonIdx).trim() : trimmed;
      if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.push(name);
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// Import extraction (grep-based)
// ---------------------------------------------------------------------------

/**
 * Extract imported names from file content.
 * Patterns:
 *   1. import { a, b } from '...'
 *   2. import NAME from '...'
 *   3. const { a, b } = require('...')
 *   4. export { a } from '...'  (re-export counts as usage)
 */
function extractImportNames(content) {
  const names = [];
  let m;

  // Pattern 1: import { a, b } from '...'
  const namedImportRe = /import\s*\{([^}]+)\}\s*from\s/g;
  while ((m = namedImportRe.exec(content)) !== null) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim().split(/\s+as\s+/)[0].trim();
      if (trimmed && /^[A-Za-z_$]/.test(trimmed)) names.push(trimmed);
    }
  }

  // Pattern 2: import NAME from '...'
  const defaultImportRe = /import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s/g;
  while ((m = defaultImportRe.exec(content)) !== null) {
    names.push(m[1]);
  }

  // Pattern 3: const { a, b } = require('...')
  const destructureRequireRe = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(/g;
  while ((m = destructureRequireRe.exec(content)) !== null) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim().split(/\s*:\s*/)[0].trim();
      if (trimmed && /^[A-Za-z_$]/.test(trimmed)) names.push(trimmed);
    }
  }

  // Pattern 4: re-export lines   export { a, b } from '...'
  // These count as importing the names from the source module
  const reExportRe = /export\s*\{([^}]+)\}\s*from\s/g;
  while ((m = reExportRe.exec(content)) !== null) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim().split(/\s+as\s+/)[0].trim();
      if (trimmed && /^[A-Za-z_$]/.test(trimmed)) names.push(trimmed);
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Is this an index/barrel file? */
function isBarrelFile(filePath) {
  const base = path.basename(filePath);
  return /^index\.[A-Za-z]+$/.test(base);
}

// ---------------------------------------------------------------------------
// Health-ignore loader
// ---------------------------------------------------------------------------

/**
 * Read .deep-work/health-ignore.json and return its contents.
 * Returns empty object if file does not exist.
 */
function loadHealthIgnore(projectRoot) {
  const filePath = path.join(projectRoot, '.deep-work', 'health-ignore.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

/**
 * Scan a project for dead (unused) exports.
 *
 * @param {string} projectRoot  - absolute path to the project root
 * @param {string[]} extensions - file extensions to scan, e.g. ['.js', '.ts']
 * @param {object}  [options]
 * @param {string[]} [options.ignoreList] - array of "file:name" strings to ignore
 * @returns {Promise<{ deadExports: Array<{file: string, name: string}>, count: number, status?: string, reason?: string }>}
 */
async function scanDeadExports(projectRoot, extensions, options = {}) {
  const ignoreList = options.ignoreList || [];

  // Read package.json
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')); }
  catch { /* no package.json */ }

  // Library detection: if package.json has "exports" field -> not applicable
  if (pkg.exports) {
    return { deadExports: [], count: 0, status: 'not_applicable', reason: 'library_project' };
  }

  // Determine entry point files to exclude
  const entryPointFiles = new Set();
  if (pkg.main) {
    entryPointFiles.add(path.resolve(projectRoot, pkg.main));
  }
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') {
      entryPointFiles.add(path.resolve(projectRoot, pkg.bin));
    } else if (typeof pkg.bin === 'object') {
      for (const val of Object.values(pkg.bin)) {
        entryPointFiles.add(path.resolve(projectRoot, val));
      }
    }
  }

  // Collect all files
  const files = collectFiles(projectRoot, extensions);
  if (files.length === 0) {
    return { deadExports: [], count: 0 };
  }

  // Build a global set of all imported names across the project
  const allImportedNames = new Set();
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf-8'); }
    catch { continue; }
    for (const name of extractImportNames(content)) {
      allImportedNames.add(name);
    }
  }

  // Build ignore set for fast lookup  ("relPath:name")
  const ignoreSet = new Set(ignoreList);

  // Scan each file for dead exports
  const deadExports = [];
  for (const file of files) {
    // Skip barrel files
    if (isBarrelFile(file)) continue;

    // Skip entry point files
    if (entryPointFiles.has(file)) continue;

    let content;
    try { content = fs.readFileSync(file, 'utf-8'); }
    catch { continue; }

    const exportedNames = extractExportNames(content);
    const relFile = path.relative(projectRoot, file);

    for (const name of exportedNames) {
      // Check ignore list
      if (ignoreSet.has(`${relFile}:${name}`)) continue;

      // If the name appears in the global import set, it is used
      if (allImportedNames.has(name)) continue;

      deadExports.push({ file: relFile, name });
    }
  }

  return { deadExports, count: deadExports.length };
}

module.exports = { scanDeadExports, loadHealthIgnore };
