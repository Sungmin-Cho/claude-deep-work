/**
 * ESLint-specific parser for sensor output.
 *
 * ESLint JSON format (--format json):
 *   [{filePath, messages: [{ruleId, severity(2=error,1=warning), message, line, column, fix}],
 *     errorCount, warningCount}]
 *
 * Auto-fixable items (those with a non-null `fix` property) get:
 *   fix: "Auto-fixable: apply eslint --fix"
 */

/**
 * Normalise ESLint numeric severity to "error" | "warning".
 * @param {number|string} raw
 * @returns {string}
 */
function normalizeSeverity(raw) {
  if (raw === 2 || raw === '2') return 'error';
  if (raw === 1 || raw === '1') return 'warning';
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower === 'error') return 'error';
    if (lower === 'warning' || lower === 'warn') return 'warning';
  }
  return 'error';
}

/**
 * Parse raw ESLint JSON output and return a standard sensor result.
 *
 * @param {string} rawOutput - Raw stdout from `eslint --format json`
 * @returns {object} Standard sensor result
 */
function parseEslint(rawOutput) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (err) {
    return {
      sensor: 'eslint',
      type: 'lint',
      gate: 'required',
      status: 'fail',
      errors: 1,
      warnings: 0,
      items: [{ file: null, line: null, rule: null, severity: 'error', message: `JSON parse error: ${err.message}`, fix: null }],
      summary: '1 errors, 0 warnings',
    };
  }

  const items = [];

  for (const fileResult of (Array.isArray(parsed) ? parsed : [])) {
    const filePath = fileResult.filePath ?? fileResult.file ?? '';
    for (const msg of (fileResult.messages ?? [])) {
      const severity = normalizeSeverity(msg.severity);
      // A non-null `fix` object means the issue is auto-fixable
      const fixValue = msg.fix != null ? 'Auto-fixable: apply eslint --fix' : '';
      items.push({
        file: filePath,
        line: msg.line ?? null,
        rule: msg.ruleId ?? null,
        severity,
        message: msg.message ?? '',
        fix: fixValue,
      });
    }
  }

  const errors = items.filter(i => i.severity === 'error').length;
  const warnings = items.filter(i => i.severity === 'warning').length;

  return {
    sensor: 'eslint',
    type: 'lint',
    gate: 'required',
    status: errors > 0 ? 'fail' : 'pass',
    errors,
    warnings,
    items,
    summary: `${errors} errors, ${warnings} warnings`,
  };
}

module.exports = { parseEslint };
