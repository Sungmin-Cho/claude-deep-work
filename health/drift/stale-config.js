'use strict';
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Package.json scanner
// ---------------------------------------------------------------------------

/**
 * Check that paths referenced in package.json (main, types, typings, module, bin)
 * actually exist on disk.
 */
function scanPackageJson(projectRoot) {
  const issues = [];
  const pkgPath = path.join(projectRoot, 'package.json');

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); }
  catch { return issues; }

  const fields = ['main', 'types', 'typings', 'module'];
  for (const field of fields) {
    if (typeof pkg[field] !== 'string') continue;
    const resolved = path.resolve(projectRoot, pkg[field]);
    if (!fs.existsSync(resolved)) {
      issues.push({ file: 'package.json', field, value: pkg[field], reason: 'path_not_found' });
    }
  }

  // bin can be string or object
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') {
      const resolved = path.resolve(projectRoot, pkg.bin);
      if (!fs.existsSync(resolved)) {
        issues.push({ file: 'package.json', field: 'bin', value: pkg.bin, reason: 'path_not_found' });
      }
    } else if (typeof pkg.bin === 'object') {
      for (const [key, val] of Object.entries(pkg.bin)) {
        if (typeof val !== 'string') continue;
        const resolved = path.resolve(projectRoot, val);
        if (!fs.existsSync(resolved)) {
          issues.push({ file: 'package.json', field: `bin.${key}`, value: val, reason: 'path_not_found' });
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// tsconfig.json scanner
// ---------------------------------------------------------------------------

/**
 * Strip single-line and multi-line comments from JSON-like content.
 * tsconfig.json allows comments, but JSON.parse does not.
 */
function stripJsonComments(text) {
  // Remove single-line comments (// ...)
  // Remove multi-line comments (/* ... */)
  // Be careful not to strip inside strings
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;
  while (i < text.length) {
    if (inString) {
      if (text[i] === '\\') {
        result += text[i] + (text[i + 1] || '');
        i += 2;
        continue;
      }
      if (text[i] === stringChar) {
        inString = false;
      }
      result += text[i];
      i++;
    } else {
      if (text[i] === '"' || text[i] === "'") {
        inString = true;
        stringChar = text[i];
        result += text[i];
        i++;
      } else if (text[i] === '/' && text[i + 1] === '/') {
        // Single-line comment: skip to end of line
        while (i < text.length && text[i] !== '\n') i++;
      } else if (text[i] === '/' && text[i + 1] === '*') {
        // Multi-line comment: skip to */
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2; // skip */
      } else {
        result += text[i];
        i++;
      }
    }
  }
  return result;
}

/**
 * Check that compilerOptions.paths targets in tsconfig.json resolve to
 * directories that exist on disk (strip the glob part like /*).
 */
function scanTsConfig(projectRoot) {
  const issues = [];
  const tscPath = path.join(projectRoot, 'tsconfig.json');

  let raw;
  try { raw = fs.readFileSync(tscPath, 'utf-8'); }
  catch { return issues; }

  let tsc;
  try { tsc = JSON.parse(stripJsonComments(raw)); }
  catch { return issues; }

  const paths = tsc.compilerOptions && tsc.compilerOptions.paths;
  if (!paths || typeof paths !== 'object') return issues;

  for (const [alias, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      // Strip trailing glob (e.g., ./src/utils/* -> ./src/utils)
      const cleaned = target.replace(/\/\*$/, '');
      const resolved = path.resolve(projectRoot, cleaned);
      if (!fs.existsSync(resolved)) {
        issues.push({
          file: 'tsconfig.json',
          field: `compilerOptions.paths["${alias}"]`,
          value: target,
          reason: 'path_not_found',
        });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// .eslintrc scanner
// ---------------------------------------------------------------------------

/**
 * Check that extends/plugins referenced in .eslintrc/.eslintrc.json
 * are installed in node_modules.
 */
function scanEslintrc(projectRoot) {
  const issues = [];

  // Try .eslintrc.json first, then .eslintrc
  let eslintPath = path.join(projectRoot, '.eslintrc.json');
  let eslintFile = '.eslintrc.json';
  if (!fs.existsSync(eslintPath)) {
    eslintPath = path.join(projectRoot, '.eslintrc');
    eslintFile = '.eslintrc';
    if (!fs.existsSync(eslintPath)) return issues;
  }

  let config;
  try { config = JSON.parse(fs.readFileSync(eslintPath, 'utf-8')); }
  catch { return issues; }

  const nodeModules = path.join(projectRoot, 'node_modules');

  // Check plugins
  if (Array.isArray(config.plugins)) {
    for (const plugin of config.plugins) {
      const pkgName = resolveEslintPluginPackage(plugin);
      const pkgDir = path.join(nodeModules, pkgName);
      if (!fs.existsSync(pkgDir)) {
        issues.push({
          file: eslintFile,
          field: 'plugins',
          value: plugin,
          reason: 'not_installed',
        });
      }
    }
  }

  // Check extends
  if (Array.isArray(config.extends)) {
    for (const ext of config.extends) {
      // Built-in configs like "eslint:recommended" don't need node_modules
      if (ext.startsWith('eslint:')) continue;

      // plugin:NAME/config -> check the plugin package
      const pluginMatch = ext.match(/^plugin:(.+?)\//);
      if (pluginMatch) {
        const pkgName = resolveEslintPluginPackage(pluginMatch[1]);
        const pkgDir = path.join(nodeModules, pkgName);
        if (!fs.existsSync(pkgDir)) {
          issues.push({
            file: eslintFile,
            field: 'extends',
            value: ext,
            reason: 'not_installed',
          });
        }
        continue;
      }

      // Shared config: eslint-config-NAME or scoped
      const configPkg = resolveEslintConfigPackage(ext);
      if (configPkg) {
        const pkgDir = path.join(nodeModules, configPkg);
        if (!fs.existsSync(pkgDir)) {
          issues.push({
            file: eslintFile,
            field: 'extends',
            value: ext,
            reason: 'not_installed',
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Resolve an eslint plugin short name to its npm package name.
 * "@typescript-eslint" -> "@typescript-eslint/eslint-plugin"
 * "react" -> "eslint-plugin-react"
 */
function resolveEslintPluginPackage(name) {
  if (name.startsWith('@')) {
    // Scoped: @scope/name -> @scope/eslint-plugin-name
    // Or @scope -> @scope/eslint-plugin
    const parts = name.split('/');
    if (parts.length === 1) {
      return `${parts[0]}/eslint-plugin`;
    }
    return `${parts[0]}/eslint-plugin-${parts[1]}`;
  }
  return `eslint-plugin-${name}`;
}

/**
 * Resolve an eslint shared config name to its npm package name.
 * "airbnb" -> "eslint-config-airbnb"
 */
function resolveEslintConfigPackage(name) {
  if (name.startsWith('@')) {
    const parts = name.split('/');
    if (parts.length === 1) {
      return `${parts[0]}/eslint-config`;
    }
    return `${parts[0]}/eslint-config-${parts[1]}`;
  }
  // Simple name
  return `eslint-config-${name}`;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate all stale-config checks.
 * @param {string} projectRoot
 * @returns {{ issues: Array<{file: string, field: string, value: string, reason: string}>, count: number }}
 */
function scanStaleConfig(projectRoot) {
  const issues = [
    ...scanPackageJson(projectRoot),
    ...scanTsConfig(projectRoot),
    ...scanEslintrc(projectRoot),
  ];
  return { issues, count: issues.length };
}

module.exports = { scanStaleConfig };
