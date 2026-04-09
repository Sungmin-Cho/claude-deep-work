'use strict';

// ---------------------------------------------------------------------------
// Coverage Trend Drift Sensor
// ---------------------------------------------------------------------------

/**
 * Analyze coverage trend by comparing baseline coverage against current.
 * Phase 1 only — no test execution; currentCoverage is passed by the caller.
 *
 * @param {object|null} baseline       - baseline object from health-baseline.json
 * @param {object|null} currentCoverage - current coverage data, e.g. { line: 85 }
 * @param {number}      [threshold=5]  - degradation threshold in percentage points
 * @returns {{ status: string, baseline: number|null, current: number|null, delta: number|null, degraded: boolean }}
 */
function analyzeCoverageTrend(baseline, currentCoverage, threshold = 5) {
  // No baseline → not applicable
  if (baseline == null) {
    return { status: 'not_applicable', baseline: null, current: null, delta: null, degraded: false };
  }

  // Baseline exists but has no coverage field → not applicable
  if (!baseline.coverage || baseline.coverage.line == null) {
    return { status: 'not_applicable', baseline: null, current: null, delta: null, degraded: false };
  }

  // No current coverage data → not applicable
  if (currentCoverage == null || currentCoverage.line == null) {
    return { status: 'not_applicable', baseline: null, current: null, delta: null, degraded: false };
  }

  const baselineLine = baseline.coverage.line;
  const currentLine = currentCoverage.line;
  const delta = currentLine - baselineLine;
  const degraded = delta < -threshold;

  return {
    status: 'completed',
    baseline: baselineLine,
    current: currentLine,
    delta,
    degraded,
  };
}

module.exports = { analyzeCoverageTrend };
