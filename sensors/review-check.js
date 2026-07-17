'use strict';
const sensorRuntime = require('../runtime/sensor-runtime.js');

/**
 * Run review-check sensor against a project.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {object} [options]
 * @param {string} [options.topology] - Topology ID (e.g. 'nextjs-app', 'generic')
 * @param {string[]} [options.changedFiles] - Changed files (reserved for v2 scoping)
 * @param {object} [refactorContext] - Optional contextual journal metadata
 * @returns {object|Promise<object>}
 */
function runReviewCheck(projectRoot, options = {}, refactorContext) {
  return sensorRuntime.runReviewCheck(projectRoot, options, refactorContext);
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
