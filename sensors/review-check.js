'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadTemplate } = require('../templates/template-loader.js');
const { loadFitness, validateFitness, runFitnessCheck } = require('../health/fitness/fitness-validator.js');

// ---------------------------------------------------------------------------
// review-check Sensor
//
// Two-layer sensor that runs AFTER lint and typecheck in SENSOR_RUN pipeline.
//
// Always-on layer: loads topology template's guides.phase3 as advisory feedback.
//   - Skips only when topology is generic AND no rules.yaml AND no fitness.json.
//
// Fitness layer: loads .deep-review/fitness.json and runs all fitness rules
//   against the full project (v1: full-project scope, not changedFiles).
// ---------------------------------------------------------------------------

/**
 * Run review-check sensor against a project.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {object} [options]
 * @param {string} [options.topology] - Topology ID (e.g. 'nextjs-app', 'generic')
 * @param {string[]} [options.changedFiles] - Changed files (reserved for v2 scoping)
 * @returns {{
 *   status: 'completed'|'not_applicable'|'disabled',
 *   alwaysOn: object|null,
 *   fitness: object|null,
 *   violations: object[],
 *   hasRequired: boolean
 * }}
 */
function runReviewCheck(projectRoot, options = {}) {
  const { topology } = options;
  const violations = [];

  // Config disable check
  try {
    const configPath = path.join(projectRoot, '.deep-work', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.review_check === false) {
      return { status: 'disabled', alwaysOn: null, fitness: null, violations: [], hasRequired: false };
    }
  } catch { /* no config — proceed */ }

  // Always-on layer
  const template = loadTemplate(topology || 'generic');
  const isGeneric = (topology || 'generic') === 'generic';
  const hasGuides = template.guides?.phase3?.length > 0 && !isGeneric;

  // Fitness layer
  const fitnessData = loadFitness(projectRoot);

  // All sources missing → not_applicable
  if (!hasGuides && !fitnessData) {
    return { status: 'not_applicable', alwaysOn: null, fitness: null, violations: [], hasRequired: false };
  }

  let alwaysOn = null;
  if (hasGuides) {
    alwaysOn = {
      guides: template.guides.phase3,
      topology: template.display_name || topology,
    };
  }

  let fitness = null;
  if (fitnessData) {
    const validation = validateFitness(fitnessData);
    if (validation.valid || validation.validRules.length > 0) {
      // Build a map of ruleId → severity from the validated rules
      const severityMap = new Map(
        validation.validRules.map(rule => [rule.id, rule.severity || 'advisory'])
      );

      // v1: full-project fitness check (advisory). changedFiles scoping is v2.
      const fitnessResult = runFitnessCheck(projectRoot, validation.validRules);
      fitness = {
        total: fitnessResult.total,
        passed: fitnessResult.passed,
        failed: fitnessResult.failed,
        results: fitnessResult.results,
      };
      for (const r of fitnessResult.results) {
        if (!r.passed && r.status !== 'not_applicable') {
          violations.push({
            source: 'fitness',
            ruleId: r.ruleId,
            severity: severityMap.get(r.ruleId) || 'advisory',
            details: r.violations || [],
          });
        }
      }
    }
  }

  return {
    status: 'completed',
    alwaysOn,
    fitness,
    violations,
    hasRequired: violations.some(v => v.severity === 'required'),
  };
}

/**
 * Format review-check results into agent-readable feedback.
 *
 * @param {object} result    - Result from runReviewCheck()
 * @param {string} sliceName - Name of the current work slice
 * @returns {string|null} Formatted feedback string, or null if nothing to report
 */
function formatReviewCheckFeedback(result, sliceName) {
  if (result.status !== 'completed') return null;
  if (result.violations.length === 0 && !result.alwaysOn) return null;

  const lines = [];
  lines.push(`[REVIEW-CHECK] ${result.violations.length} violation(s) found in slice "${sliceName}"`);
  lines.push('');

  let idx = 1;
  for (const v of result.violations) {
    const tag = v.severity === 'required' ? 'REQUIRED' : 'ADVISORY';
    lines.push(`${idx}. [${tag}] ${v.source}: ${v.ruleId}`);
    if (v.details.length > 0) {
      for (const d of v.details.slice(0, 3)) {
        lines.push(`   ${d.file || d.message || JSON.stringify(d)}`);
      }
    }
    idx++;
  }

  if (result.alwaysOn) {
    lines.push('');
    lines.push(`[TOPOLOGY GUIDES] ${result.alwaysOn.topology}:`);
    for (const g of result.alwaysOn.guides) {
      lines.push(`  - ${g}`);
    }
  }

  return lines.join('\n');
}

module.exports = { runReviewCheck, formatReviewCheckFeedback };
