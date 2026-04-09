'use strict';
const { execFileSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// Dependency Fitness Rule Checker
// ---------------------------------------------------------------------------

/**
 * Check whether dep-cruiser (depcruise) is available via npx --no-install.
 *
 * @returns {boolean}
 */
function isDepCruiserAvailable() {
  try {
    execFileSync('npx', ['--no-install', 'depcruise', '--version'], {
      stdio: 'pipe',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check a dependency fitness rule.
 *
 * Uses dep-cruiser to detect circular dependencies and other violations.
 * When dep-cruiser is not installed, the behaviour depends on severity:
 *   - required → status: 'required_missing', passed: false
 *   - advisory → status: 'not_applicable', passed: true
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {object} rule        - fitness rule object
 * @param {object} [options]   - optional overrides
 * @param {boolean} [options.depCruiserAvailable] - override auto-detection
 * @returns {{ ruleId: string, status: string, passed: boolean, message?: string, violations?: object[] }}
 */
function checkDependency(projectRoot, rule, options = {}) {
  const available = typeof options.depCruiserAvailable === 'boolean'
    ? options.depCruiserAvailable
    : isDepCruiserAvailable();

  if (!available) {
    if (rule.severity === 'required') {
      return {
        ruleId: rule.id,
        status: 'required_missing',
        passed: false,
        message: 'dep-cruiser is not installed but rule severity is required',
        violations: [],
      };
    }
    // advisory or any other severity
    return {
      ruleId: rule.id,
      status: 'not_applicable',
      passed: true,
      message: 'dep-cruiser is not installed; skipping advisory rule',
      violations: [],
    };
  }

  // Only 'circular' check is implemented in v1
  if (rule.check !== 'circular') {
    return {
      ruleId: rule.id,
      status: 'not_applicable',
      passed: true,
      message: `check type '${rule.check}' is not yet implemented in v1`,
      violations: [],
    };
  }

  // dep-cruiser is available — run circular dependency check
  const violations = [];
  try {
    const include = rule.include || 'src';
    const args = ['--no-install', 'depcruise', '--output-type', 'json', include];
    const stdout = execFileSync('npx', args, {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 60_000,
    }).toString();

    const report = JSON.parse(stdout);
    const modules = report.modules || report.output?.modules || [];

    for (const mod of modules) {
      const deps = mod.dependencies || [];
      for (const dep of deps) {
        if (dep.circular) {
          violations.push({
            file: mod.source,
            dependency: dep.resolved,
            message: `Circular dependency: ${mod.source} → ${dep.resolved}`,
          });
        }
      }
    }
  } catch (err) {
    return {
      ruleId: rule.id,
      status: 'error',
      passed: false,
      message: `dep-cruiser execution failed: ${err.message}`,
      violations: [],
    };
  }

  return {
    ruleId: rule.id,
    status: violations.length === 0 ? 'passed' : 'failed',
    passed: violations.length === 0,
    violations,
  };
}

module.exports = { checkDependency, isDepCruiserAvailable };
