'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { detectTopology } = require('../../templates/topology-detector.js');
const { loadTemplate } = require('../../templates/template-loader.js');

// ---------------------------------------------------------------------------
// Fitness Generator — ecosystem-aware fitness.json rule generation
// ---------------------------------------------------------------------------

const UNIVERSAL_RULES = [
  {
    id: 'max-file-lines',
    type: 'file-metric',
    check: 'line-count',
    max: 500,
    include: 'src/**/*.{ts,js}',
    severity: 'advisory',
  },
];

const JS_TS_RULES = [
  {
    id: 'no-circular-deps',
    type: 'dependency',
    check: 'circular',
    severity: 'required',
  },
];

/**
 * Check whether projectRoot is a JS/TS project.
 * Looks for package.json or tsconfig.json in the root.
 *
 * @param {string} projectRoot
 * @returns {boolean}
 */
function isJsTsProject(projectRoot) {
  return (
    fs.existsSync(path.join(projectRoot, 'package.json')) ||
    fs.existsSync(path.join(projectRoot, 'tsconfig.json'))
  );
}

/**
 * Detect layered architecture (controllers/services/repositories directories).
 * Scans src/ subdirectories for layer-pattern names.
 *
 * @param {string} projectRoot
 * @returns {boolean}
 */
function detectLayers(projectRoot) {
  const srcDir = path.join(projectRoot, 'src');
  if (!fs.existsSync(srcDir)) return false;

  const patterns = ['controllers', 'services', 'repositories'];
  try {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name.toLowerCase());
    return patterns.every(p => dirs.includes(p));
  } catch {
    return false;
  }
}

/**
 * Detect config module (src/config/ or config/ directory).
 *
 * @param {string} projectRoot
 * @returns {boolean}
 */
function detectConfigModule(projectRoot) {
  return (
    fs.existsSync(path.join(projectRoot, 'src', 'config')) ||
    fs.existsSync(path.join(projectRoot, 'config'))
  );
}

/**
 * Detect colocated test pattern (*.test.* files inside src/).
 *
 * @param {string} projectRoot
 * @returns {boolean}
 */
function detectTestPattern(projectRoot) {
  const srcDir = path.join(projectRoot, 'src');
  if (!fs.existsSync(srcDir)) return false;

  try {
    return scanForTestFiles(srcDir);
  } catch {
    return false;
  }
}

/**
 * Recursively scan a directory for *.test.* files.
 * @param {string} dir
 * @returns {boolean}
 */
function scanForTestFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && /\.test\./.test(entry.name)) {
      return true;
    }
    if (entry.isDirectory()) {
      if (scanForTestFiles(path.join(dir, entry.name))) return true;
    }
  }
  return false;
}

/**
 * Get template-based fitness rules for a project by detecting its topology.
 *
 * @param {string} projectRoot
 * @returns {object[]} array of rule objects from the matching template's fitness_defaults
 */
function getTemplateRules(projectRoot) {
  const registryPath = path.join(__dirname, '..', '..', 'templates', 'topology-registry.json');
  const topoResult = detectTopology(projectRoot, registryPath);
  const template = loadTemplate(topoResult.id);
  return (template.fitness_defaults && template.fitness_defaults.rules) || [];
}

/**
 * Generate ecosystem-aware fitness rules for a project.
 *
 * - Always includes UNIVERSAL_RULES (max-file-lines)
 * - JS/TS projects get JS_TS_RULES (no-circular-deps)
 * - Layered architecture detected -> layer-direction rule
 * - Config module detected -> no-direct-env-access rule
 * - Colocated tests detected -> colocated-tests rule
 *
 * @param {string} projectRoot
 * @returns {object[]} array of rule objects
 */
function generateFitnessRules(projectRoot) {
  const rules = [...UNIVERSAL_RULES];

  const jsTs = isJsTsProject(projectRoot);

  if (jsTs) {
    rules.push(...JS_TS_RULES);
  }

  if (detectLayers(projectRoot)) {
    rules.push({
      id: 'layer-direction',
      type: 'dependency',
      check: 'layer-violation',
      layers: ['controllers', 'services', 'repositories'],
      severity: 'required',
    });
  }

  if (detectConfigModule(projectRoot)) {
    rules.push({
      id: 'no-direct-env-access',
      type: 'forbidden-pattern',
      pattern: 'process\\.env\\.',
      include: 'src/**/*.{ts,js}',
      exclude: 'src/config/**',
      severity: 'advisory',
    });
  }

  if (detectTestPattern(projectRoot)) {
    rules.push({
      id: 'colocated-tests',
      type: 'structure',
      check: 'colocated',
      source: 'src/**/*.{ts,js}',
      test: 'src/**/*.test.{ts,js}',
      severity: 'advisory',
    });
  }

  const templateRules = getTemplateRules(projectRoot);
  const existingIds = new Set(rules.map(r => r.id));
  for (const tr of templateRules) {
    if (!existingIds.has(tr.id)) rules.push(tr);
  }

  return rules;
}

/**
 * Format rules into a fitness.json string.
 *
 * @param {object[]} rules
 * @returns {string} pretty-printed JSON
 */
function formatFitnessJson(rules) {
  return JSON.stringify(
    {
      version: 1,
      generated_at: new Date().toISOString(),
      rules,
    },
    null,
    2,
  );
}

module.exports = { generateFitnessRules, formatFitnessJson, isJsTsProject, getTemplateRules };
