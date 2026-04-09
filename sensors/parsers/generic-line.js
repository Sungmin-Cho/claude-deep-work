/**
 * Generic line-based parser for sensor output.
 *
 * Handles the common `file:line[:col]: [severity:] message` format used by
 * many compilers and linters (TypeScript tsc, mypy, clang, etc.).
 *
 * Regex patterns are ordered most-specific to least-specific:
 *   1. file:line:col: severity: message
 *   2. file:line:col: message
 *   3. file:line: severity: message
 *   4. file:line: message
 *
 * For patterns 1 and 3 (those that capture an explicit severity keyword) the
 * remainder of the line after the severity is used verbatim as the message,
 * so colons inside the message are preserved correctly.
 */

const SEVERITY_KEYWORDS = /^(error|warning|warn|info|note|hint)/i;

/**
 * Normalise a captured severity string to "error" | "warning" | "info".
 * @param {string|undefined} raw
 * @returns {string}
 */
function normalizeSeverity(raw) {
  if (!raw) return 'error';
  const lower = raw.toLowerCase();
  if (lower === 'error') return 'error';
  if (lower === 'warning' || lower === 'warn') return 'warning';
  if (lower === 'info' || lower === 'note' || lower === 'hint') return 'info';
  return 'error';
}

/**
 * Try to parse a single non-empty line into a diagnostic item.
 *
 * Pattern priority (most specific first):
 *   1. file:line:col: severity: rest-of-message
 *   2. file:line:col: rest-of-message
 *   3. file:line: severity: rest-of-message
 *   4. file:line: rest-of-message
 *
 * Returns null for lines that do not match any pattern.
 *
 * @param {string} line
 * @returns {object|null}
 */
function parseLine(line) {
  // Pattern 1: file:line:col: severity: message
  // e.g. src/auth.ts:42:5: error TS2304: Cannot find name "foo"
  //      src/a.ts:10:1: error: Expected type: string but got: number
  const p1 = /^(.+?):(\d+):(\d+):\s*/;
  const p1match = line.match(p1);
  if (p1match) {
    const file = p1match[1];
    const lineNum = Number(p1match[2]);
    // remainder after "file:line:col: "
    const rest = line.slice(p1match[0].length);
    const sevMatch = rest.match(SEVERITY_KEYWORDS);
    if (sevMatch) {
      const severity = normalizeSeverity(sevMatch[1]);
      // Skip past the severity keyword; if followed by optional ":" trim it
      let msg = rest.slice(sevMatch[0].length).replace(/^\s*:\s*/, '').trim();
      return { file, line: lineNum, severity, message: msg, rule: null, fix: null };
    }
    // Pattern 2: file:line:col: message (no severity keyword)
    return { file, line: lineNum, severity: 'error', message: rest.trim(), rule: null, fix: null };
  }

  // Pattern 3: file:line: severity: message
  // Pattern 4: file:line: message
  const p3 = /^(.+?):(\d+):\s*/;
  const p3match = line.match(p3);
  if (p3match) {
    const file = p3match[1];
    const lineNum = Number(p3match[2]);
    const rest = line.slice(p3match[0].length);
    const sevMatch = rest.match(SEVERITY_KEYWORDS);
    if (sevMatch) {
      const severity = normalizeSeverity(sevMatch[1]);
      let msg = rest.slice(sevMatch[0].length).replace(/^\s*:\s*/, '').trim();
      return { file, line: lineNum, severity, message: msg, rule: null, fix: null };
    }
    // Pattern 4: no severity keyword
    return { file, line: lineNum, severity: 'error', message: rest.trim(), rule: null, fix: null };
  }

  return null;
}

/**
 * Parse raw line-based output from a tool and return a standard sensor result.
 *
 * @param {string} rawOutput - Raw stdout from the tool
 * @param {string} sensorType - "lint" | "typecheck" | "coverage" | "mutation"
 * @param {string} gateType   - "required" | "advisory"
 * @returns {object} Standard sensor result
 */
function parseGenericLine(rawOutput, sensorType, gateType) {
  const items = [];

  if (rawOutput && rawOutput.trim().length > 0) {
    const lines = rawOutput.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const item = parseLine(trimmed);
      if (item) items.push(item);
    }
  }

  const errors = items.filter(i => i.severity === 'error').length;
  const warnings = items.filter(i => i.severity === 'warning').length;
  const status = errors > 0 ? 'fail' : items.length === 0 ? 'pass' : 'pass';

  return {
    sensor: 'generic-line',
    type: sensorType,
    gate: gateType,
    status,
    errors,
    warnings,
    items,
    summary: `${errors} errors, ${warnings} warnings`,
  };
}

module.exports = { parseGenericLine };
