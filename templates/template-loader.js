'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Deep merge two objects.
 *
 * Rules:
 * - Scalar values: custom completely replaces base.
 * - Plain objects (non-array): recursive key-by-key merge; unspecified keys preserve base.
 * - Arrays: custom completely replaces base (NOT append).
 *
 * @param {object} base
 * @param {object} custom
 * @returns {object} New merged object (neither base nor custom is mutated)
 */
function deepMerge(base, custom) {
  // Start with a shallow copy of base
  const result = Object.assign({}, base);

  for (const key of Object.keys(custom)) {
    const baseVal = base[key];
    const customVal = custom[key];

    if (
      customVal !== null &&
      typeof customVal === 'object' &&
      !Array.isArray(customVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      // Both are plain objects — recurse
      result[key] = deepMerge(baseVal, customVal);
    } else {
      // Scalar, array, null, or type mismatch — custom wins entirely
      result[key] = customVal;
    }
  }

  return result;
}

/**
 * Load a built-in topology template JSON file.
 * Returns null if the file does not exist.
 *
 * @param {string} topologyId
 * @param {string} builtinsDir - Directory containing built-in topology JSON files
 * @returns {object|null}
 */
function loadBuiltin(topologyId, builtinsDir) {
  const filePath = path.join(builtinsDir, `${topologyId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load a custom override template JSON file if present.
 * Returns null if customDir is not provided or file does not exist.
 *
 * @param {string} topologyId
 * @param {string|undefined} customDir
 * @returns {object|null}
 */
function loadCustom(topologyId, customDir) {
  if (!customDir) return null;
  const filePath = path.join(customDir, `${topologyId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load a topology template with optional custom override.
 *
 * Loading priority:
 * 1. Load built-in template from builtinsDir/<topologyId>.json
 *    - If not found, fall back to generic.json
 * 2. Load custom override from customDir/<topologyId>.json (if customDir provided)
 * 3. Deep-merge custom on top of built-in
 *
 * @param {string} topologyId
 * @param {string} [builtinsDir] - Directory of built-in templates (defaults to ./topologies)
 * @param {string} [customDir] - Directory of custom override templates (defaults to ./custom)
 * @returns {object} Merged template object
 */
function loadTemplate(topologyId, builtinsDir, customDir) {
  const resolvedBuiltinsDir = builtinsDir || path.join(__dirname, 'topologies');
  const resolvedCustomDir = customDir !== undefined ? customDir : path.join(__dirname, 'custom');

  // Load built-in (fall back to generic if topology not found)
  let base = loadBuiltin(topologyId, resolvedBuiltinsDir);
  if (!base) {
    base = loadBuiltin('generic', resolvedBuiltinsDir);
    if (!base) {
      throw new Error(`Neither topology '${topologyId}' nor 'generic' found in ${resolvedBuiltinsDir}`);
    }
  }

  // Load and merge custom override if present
  const custom = loadCustom(topologyId, resolvedCustomDir);
  if (custom) {
    return deepMerge(base, custom);
  }

  return base;
}

module.exports = { deepMerge, loadTemplate };
