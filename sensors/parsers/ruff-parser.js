/**
 * Ruff Python linter output parser.
 *
 * Ruff JSON format (--output-format json):
 *   [{code, message, filename, location: {row, column}, fix: {message, applicability}}]
 *
 * All ruff diagnostics are treated as errors (ruff --select controls which rules run).
 */

/**
 * Parse raw Ruff JSON output and return a standard sensor result.
 *
 * @param {string} rawOutput - Raw stdout from `ruff check --output-format json`
 * @returns {object} Standard sensor result
 */
function parseRuff(rawOutput) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (err) {
    return {
      sensor: 'ruff',
      type: 'lint',
      gate: 'required',
      status: 'fail',
      errors: 1,
      warnings: 0,
      items: [{ file: null, line: null, rule: null, severity: 'error', message: `JSON parse error: ${err.message}`, fix: '' }],
      summary: '1 errors, 0 warnings',
    };
  }

  const items = (Array.isArray(parsed) ? parsed : []).map(diag => {
    const fixText = diag.fix?.message ? diag.fix.message : '';
    return {
      file: diag.filename ?? '',
      line: diag.location?.row ?? null,
      rule: diag.code ?? null,
      severity: 'error',
      message: diag.message ?? '',
      fix: fixText,
    };
  });

  const errors = items.length;
  const warnings = 0;

  return {
    sensor: 'ruff',
    type: 'lint',
    gate: 'required',
    status: errors > 0 ? 'fail' : 'pass',
    errors,
    warnings,
    items,
    summary: `${errors} errors, ${warnings} warnings`,
  };
}

module.exports = { parseRuff };
