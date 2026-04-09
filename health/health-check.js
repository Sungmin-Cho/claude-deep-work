'use strict';
const path = require('node:path');
const { scanDeadExports, loadHealthIgnore } = require('./drift/dead-export.js');
const { scanStaleConfig } = require('./drift/stale-config.js');
const { scanDependencyVuln } = require('./drift/dependency-vuln.js');
const { analyzeCoverageTrend } = require('./drift/coverage-trend.js');
const { validateFitness, runFitnessCheck } = require('./fitness/fitness-validator.js');

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout. Resolves with { value } or { timeout: true }.
 */
function withTimeout(fn, ms) {
  return Promise.race([
    fn().then(value => ({ value })),
    new Promise(resolve => {
      const timer = setTimeout(() => resolve({ timeout: true }), ms);
      timer.unref();
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Safe-run wrapper: isolates sensor errors
// ---------------------------------------------------------------------------

async function safeRun(fn, ms) {
  try {
    const result = await withTimeout(fn, ms);
    if (result.timeout) return { _timeout: true };
    return result.value;
  } catch (err) {
    return { _error: true, message: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Drift result normalizers
// ---------------------------------------------------------------------------

function normalizeDeadExports(raw) {
  if (!raw) return { status: 'error', count: 0, items: [] };
  if (raw._timeout) return { status: 'timeout', count: 0, items: [] };
  if (raw._error) return { status: 'error', count: 0, items: [], error: raw.message };
  if (raw.status === 'not_applicable') return { status: 'not_applicable', count: 0, items: [] };
  const count = raw.count || 0;
  return {
    status: count > 0 ? 'advisory' : 'pass',
    count,
    items: raw.deadExports || [],
  };
}

function normalizeStaleConfig(raw) {
  if (!raw) return { status: 'error', count: 0, items: [] };
  if (raw._timeout) return { status: 'timeout', count: 0, items: [] };
  if (raw._error) return { status: 'error', count: 0, items: [], error: raw.message };
  const count = raw.count || 0;
  return {
    status: count > 0 ? 'advisory' : 'pass',
    count,
    items: raw.issues || [],
  };
}

function normalizeDepVuln(raw) {
  if (!raw) return { status: 'error', critical: 0, high: 0, items: [] };
  if (raw._timeout) return { status: 'timeout', critical: 0, high: 0, items: [] };
  if (raw._error) return { status: 'error', critical: 0, high: 0, items: [], error: raw.message };

  // Aggregate across ecosystems
  let critical = 0;
  let high = 0;
  const items = [];
  for (const [eco, result] of Object.entries(raw)) {
    if (result.status === 'not_applicable') continue;
    critical += result.critical || 0;
    high += result.high || 0;
    if (result.vulnerabilities) {
      for (const v of result.vulnerabilities) {
        items.push({ ...v, ecosystem: eco });
      }
    }
  }
  // Check if any ecosystem returned error
  const hasError = Object.values(raw).some(r => r.error || r.status === 'error');
  const hasVulns = critical > 0 || high > 0;
  return {
    status: hasError && !hasVulns ? 'error' : hasVulns ? 'required_fail' : 'pass',
    critical,
    high,
    items,
  };
}

function normalizeCoverageTrend(raw) {
  if (!raw) return { status: 'not_applicable', baseline: null, current: null, delta: null };
  if (raw._timeout) return { status: 'timeout', baseline: null, current: null, delta: null };
  if (raw._error) return { status: 'error', baseline: null, current: null, delta: null };
  if (raw.status === 'not_applicable') {
    return { status: 'not_applicable', baseline: null, current: null, delta: null };
  }
  return {
    status: raw.degraded ? 'advisory' : 'pass',
    baseline: raw.baseline,
    current: raw.current,
    delta: raw.delta,
  };
}

// ---------------------------------------------------------------------------
// Fitness result normalizer
// ---------------------------------------------------------------------------

function normalizeFitness(fitnessData, validationResult, checkResult) {
  if (!fitnessData) {
    return {
      yaml_exists: false,
      total_rules: 0,
      passed: 0,
      failed: 0,
      not_applicable: 0,
      required_missing: 0,
      violations: [],
      validation_errors: [],
      skipped_rules: [],
    };
  }

  const violations = [];
  if (checkResult && checkResult.results) {
    for (const r of checkResult.results) {
      if (!r.passed && r.violations) {
        violations.push(...r.violations);
      }
    }
  }

  return {
    yaml_exists: true,
    total_rules: checkResult ? checkResult.total : 0,
    passed: checkResult ? checkResult.passed : 0,
    failed: checkResult ? checkResult.failed : 0,
    not_applicable: checkResult ? checkResult.notApplicable : 0,
    required_missing: checkResult ? checkResult.requiredMissing : 0,
    violations,
    validation_errors: validationResult ? validationResult.errors : [],
    skipped_rules: validationResult ? validationResult.skippedRules : [],
  };
}

// ---------------------------------------------------------------------------
// Health Check Orchestrator
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUTS = {
  deadExport: 30000,
  depVuln: 30000,
  staleConfig: 10000,
  coverage: 60000,
  fitness: 60000,
  total: 180000,
};

/**
 * Run a complete health check on a project.
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {object} [options] - configuration options
 * @returns {Promise<object>} health report
 */
async function runHealthCheck(projectRoot, options = {}) {
  const {
    ecosystems = {},
    baseline = null,
    fitness = null,
    commit = null,
    branch = null,
    currentCoverage = null,
    skipAudit = false,
    depCruiserAvailable = false,
    healthIgnore: providedHealthIgnore,
    timeouts: userTimeouts = {},
  } = options;

  const timeouts = { ...DEFAULT_TIMEOUTS, ...userTimeouts };

  // 1. Load health-ignore.json if not provided
  const healthIgnore = providedHealthIgnore !== undefined ? providedHealthIgnore : loadHealthIgnore(projectRoot);
  const ignoreList = healthIgnore.dead_export_ignore || [];

  // 2. Total timeout wrapper
  let totalTimer;
  const totalTimeoutPromise = new Promise((_, reject) => {
    totalTimer = setTimeout(() => reject(new Error('Health check exceeded total timeout')), timeouts.total);
    totalTimer.unref();
  });

  const runChecks = async () => {
    // Test hook: inject artificial delay to test total timeout enforcement
    if (options._testDelay) {
      await new Promise(resolve => { const t = setTimeout(resolve, options._testDelay); t.unref(); });
    }

    // 3. Promise.allSettled — dead-export + stale-config + dep-vuln parallel
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
    const [deadExportResult, staleConfigResult, depVulnResult] = await Promise.allSettled([
      safeRun(() => scanDeadExports(projectRoot, extensions, { ignoreList }), timeouts.deadExport),
      safeRun(() => Promise.resolve(scanStaleConfig(projectRoot)), timeouts.staleConfig),
      safeRun(() => {
        if (skipAudit) return Promise.resolve({});
        return Promise.resolve(scanDependencyVuln(ecosystems, timeouts.depVuln));
      }, timeouts.depVuln),
    ]);

    const deadExportRaw = deadExportResult.status === 'fulfilled' ? deadExportResult.value : null;
    const staleConfigRaw = staleConfigResult.status === 'fulfilled' ? staleConfigResult.value : null;
    const depVulnRaw = depVulnResult.status === 'fulfilled' ? depVulnResult.value : null;

    // 4. coverage-trend sequential (currentCoverage null → not_applicable)
    const coverageRaw = analyzeCoverageTrend(baseline, currentCoverage);

    // 5. fitness-validator sequential (fitness null → not_applicable)
    let validationResult = null;
    let checkResult = null;
    if (fitness) {
      validationResult = validateFitness(fitness);
      if (validationResult.validRules.length > 0) {
        checkResult = runFitnessCheck(projectRoot, validationResult.validRules, { depCruiserAvailable });
      }
    }

    // 6. Return report
    return {
      scan_time: new Date().toISOString(),
      scan_commit: commit,
      drift: {
        dead_exports: normalizeDeadExports(deadExportRaw),
        stale_config: normalizeStaleConfig(staleConfigRaw),
        dependency_vuln: normalizeDepVuln(depVulnRaw),
        coverage_trend: normalizeCoverageTrend(coverageRaw),
      },
      fitness: normalizeFitness(fitness, validationResult, checkResult),
    };
  };

  return Promise.race([runChecks(), totalTimeoutPromise])
    .finally(() => clearTimeout(totalTimer));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const projectRoot = process.argv[2] || process.cwd();
  const skipAudit = process.argv.includes('--skip-audit');
  runHealthCheck(projectRoot, { skipAudit })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { runHealthCheck };
