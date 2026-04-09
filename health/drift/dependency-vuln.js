'use strict';
const { execFileSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// npm audit parser
// ---------------------------------------------------------------------------

/**
 * Parse npm audit JSON output, filtering to high and critical only.
 *
 * @param {string} stdout - raw JSON string from `npm audit --json`
 * @returns {{ vulnerabilities: Array<{name: string, severity: string}>, high: number, critical: number, error?: boolean }}
 */
function parseNpmAudit(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { error: true, vulnerabilities: [], high: 0, critical: 0 };
  }

  const vulns = data.vulnerabilities || {};
  const filtered = [];
  let high = 0;
  let critical = 0;

  for (const [name, info] of Object.entries(vulns)) {
    const severity = info.severity;
    if (severity === 'high') {
      high++;
      filtered.push({ name, severity });
    } else if (severity === 'critical') {
      critical++;
      filtered.push({ name, severity });
    }
  }

  return { vulnerabilities: filtered, high, critical };
}

// ---------------------------------------------------------------------------
// Audit runner
// ---------------------------------------------------------------------------

/**
 * Run an audit command and return its stdout.
 * npm audit returns non-zero when vulnerabilities are found — stdout still has data.
 *
 * @param {string} binary - the command binary (e.g., "npm")
 * @param {string[]} args - arguments (e.g., ["audit", "--json"])
 * @param {number} timeout - timeout in ms
 * @returns {{ stdout: string, error?: boolean, killed?: boolean }}
 */
function runAudit(binary, args, timeout) {
  try {
    const stdout = execFileSync(binary, args, {
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout };
  } catch (err) {
    // npm audit returns non-zero when vulns are found — stdout still has data
    if (err.killed) {
      return { stdout: '', error: true, killed: true };
    }
    if (err.stdout) {
      return { stdout: err.stdout };
    }
    return { stdout: '', error: true };
  }
}

// ---------------------------------------------------------------------------
// Ecosystem scanner
// ---------------------------------------------------------------------------

/**
 * Run dependency vulnerability audit for each ecosystem that has an `audit` field.
 *
 * @param {object} ecosystems - object from registry.json ecosystems
 * @param {number} [timeout=60000] - timeout in ms per audit command
 * @returns {object} - keyed by ecosystem name, value is audit result
 */
function scanDependencyVuln(ecosystems, timeout = 60000) {
  const results = {};

  for (const [name, config] of Object.entries(ecosystems)) {
    if (!config.audit) {
      results[name] = { status: 'not_applicable' };
      continue;
    }

    const cmd = config.audit.cmd;
    const parts = cmd.split(/\s+/);
    const binary = parts[0];
    const args = parts.slice(1);

    const auditResult = runAudit(binary, args, timeout);

    if (auditResult.error) {
      results[name] = {
        error: true,
        killed: auditResult.killed || false,
        vulnerabilities: [],
        high: 0,
        critical: 0,
      };
      continue;
    }

    // Parse based on known parsers (currently only npm audit JSON format)
    results[name] = parseNpmAudit(auditResult.stdout);
  }

  return results;
}

module.exports = { scanDependencyVuln, parseNpmAudit };
