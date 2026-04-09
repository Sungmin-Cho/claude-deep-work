/**
 * TypeScript compiler (tsc) output parser.
 *
 * tsc output format: file(line,col): error TSXXXX: message
 * Regex: /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm
 *
 * Common fix suggestions:
 *   TS7006 -> "Add explicit type annotation"
 *   TS2304 -> "Import or declare the missing name"
 */

const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm;

const FIX_SUGGESTIONS = {
  TS7006: 'Add explicit type annotation',
  TS2304: 'Import or declare the missing name',
};

/**
 * Normalise tsc severity string.
 * @param {string} raw
 * @returns {string}
 */
function normalizeSeverity(raw) {
  if (!raw) return 'error';
  return raw.toLowerCase() === 'warning' ? 'warning' : 'error';
}

/**
 * Parse raw tsc output and return a standard sensor result.
 *
 * @param {string} rawOutput - Raw stdout from `tsc --noEmit`
 * @returns {object} Standard sensor result
 */
function parseTsc(rawOutput) {
  const items = [];

  if (rawOutput && rawOutput.trim().length > 0) {
    let match;
    TSC_LINE_RE.lastIndex = 0;
    while ((match = TSC_LINE_RE.exec(rawOutput)) !== null) {
      const [, file, lineStr, , severityRaw, rule, message] = match;
      const severity = normalizeSeverity(severityRaw);
      const fix = FIX_SUGGESTIONS[rule] ?? '';
      items.push({
        file,
        line: Number(lineStr),
        rule,
        severity,
        message: message.trim(),
        fix,
      });
    }
  }

  const errors = items.filter(i => i.severity === 'error').length;
  const warnings = items.filter(i => i.severity === 'warning').length;

  return {
    sensor: 'tsc',
    type: 'typecheck',
    gate: 'required',
    status: errors > 0 ? 'fail' : 'pass',
    errors,
    warnings,
    items,
    summary: `${errors} errors, ${warnings} warnings`,
  };
}

module.exports = { parseTsc };
