'use strict';
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Fitness Validator — schema validation, rule dispatch, and aggregation
// ---------------------------------------------------------------------------

const SUPPORTED_VERSION = 1;

const VALID_TYPES = new Set(['dependency', 'file-metric', 'forbidden-pattern', 'structure']);

const REQUIRED_FIELDS = ['id', 'type', 'severity'];

/**
 * Validate a parsed fitness.json object.
 * Checks version, required fields, valid types, and duplicate IDs.
 *
 * @param {object} parsed - parsed fitness.json content
 * @returns {{ valid: boolean, errors: string[], validRules: object[], skippedRules: object[] }}
 */
function validateFitness(parsed) {
  const errors = [];
  const validRules = [];
  const skippedRules = [];

  // Version check
  if (parsed.version !== SUPPORTED_VERSION) {
    errors.push(`Unsupported version: ${parsed.version}. Expected ${SUPPORTED_VERSION}`);
    return { valid: false, errors, validRules, skippedRules };
  }

  const rules = parsed.rules || [];
  const seenIds = new Set();

  for (const rule of rules) {
    const ruleErrors = [];

    // Required fields check
    for (const field of REQUIRED_FIELDS) {
      if (!rule[field]) {
        ruleErrors.push(`Rule is missing required field: '${field}'`);
      }
    }

    // Valid type check
    if (rule.type && !VALID_TYPES.has(rule.type)) {
      ruleErrors.push(`Unknown rule type: '${rule.type}'`);
    }

    // Duplicate ID check
    if (rule.id && seenIds.has(rule.id)) {
      ruleErrors.push(`Duplicate rule id: '${rule.id}'`);
    }

    if (ruleErrors.length > 0) {
      errors.push(...ruleErrors);
      skippedRules.push({ rule, errors: ruleErrors });
    } else {
      seenIds.add(rule.id);
      validRules.push(rule);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    validRules,
    skippedRules,
  };
}

/**
 * Run fitness checks for a set of validated rules.
 * Dispatches each rule to the appropriate checker by type.
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {object[]} validRules - array of validated rule objects
 * @param {object} [options]    - options passed to checkers
 * @returns {{ total: number, passed: number, failed: number, notApplicable: number, requiredMissing: number, results: object[] }}
 */
function runFitnessCheck(projectRoot, validRules, options = {}) {
  const { checkFileMetric } = require('./rule-checkers/file-metric-checker.js');
  const { checkForbiddenPattern } = require('./rule-checkers/pattern-checker.js');
  const { checkStructure } = require('./rule-checkers/structure-checker.js');
  const { checkDependency } = require('./rule-checkers/dependency-checker.js');

  const results = [];
  let passed = 0;
  let failed = 0;
  let notApplicable = 0;
  let requiredMissing = 0;

  for (const rule of validRules) {
    let result;

    switch (rule.type) {
      case 'file-metric': result = checkFileMetric(projectRoot, rule); break;
      case 'forbidden-pattern': result = checkForbiddenPattern(projectRoot, rule); break;
      case 'structure': result = checkStructure(projectRoot, rule); break;
      case 'dependency': result = checkDependency(projectRoot, rule, options); break;
      default:
        result = { ruleId: rule.id, status: 'unsupported', passed: true, violations: [] };
        break;
    }

    results.push(result);

    if (result.status === 'not_applicable') {
      notApplicable++;
    } else if (result.status === 'required_missing') {
      requiredMissing++;
    } else if (result.passed) {
      passed++;
    } else {
      failed++;
    }
  }

  return {
    total: validRules.length,
    passed,
    failed,
    notApplicable,
    requiredMissing,
    results,
  };
}

/**
 * Load and parse .deep-review/fitness.json from a project root.
 *
 * @param {string} projectRoot - absolute path to the project
 * @returns {object|null} parsed fitness.json or null on missing/error
 */
function loadFitness(projectRoot) {
  const filePath = path.join(projectRoot, '.deep-review', 'fitness.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { validateFitness, runFitnessCheck, loadFitness };
