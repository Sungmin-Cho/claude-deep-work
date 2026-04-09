/**
 * Generic JSON parser for sensor output.
 * Handles three common JSON shapes:
 *   1. Flat array:  [{file, line, message, severity}, ...]
 *   2. ESLint-style nested: {results: [{filePath, messages: [{ruleId, severity, message, line}]}]}
 *   3. errors/warnings object: {errors: [...], warnings: [...]}
 */

/**
 * Normalise severity values to "error" | "warning" | "info".
 * ESLint uses numeric codes: 2 = error, 1 = warning.
 * String values are lower-cased and matched.
 * @param {number|string} raw
 * @returns {string}
 */
function normalizeSeverity(raw) {
  if (raw === 2 || raw === '2') return 'error';
  if (raw === 1 || raw === '1') return 'warning';
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (lower === 'error' || lower === 'err') return 'error';
    if (lower === 'warning' || lower === 'warn') return 'warning';
    if (lower === 'info' || lower === 'information' || lower === 'note') return 'info';
  }
  return 'error'; // default
}

/**
 * Build a standard sensor result object.
 * @param {object} opts
 * @returns {object}
 */
function buildResult({ sensor = 'generic-json', type, gate, status, errors, warnings, items, summary }) {
  const e = errors ?? items.filter(i => i.severity === 'error').length;
  const w = warnings ?? items.filter(i => i.severity === 'warning').length;
  return {
    sensor,
    type,
    gate,
    status: status ?? (e > 0 ? 'fail' : 'pass'),
    errors: e,
    warnings: w,
    items,
    summary: summary ?? `${e} errors, ${w} warnings`,
  };
}

/**
 * Parse a flat array of diagnostic objects.
 * Each element is expected to have at least {file, line, message, severity}.
 * @param {Array} arr
 * @returns {Array} normalised items
 */
function parseFlatArray(arr) {
  return arr.map(item => ({
    file: item.file ?? item.filePath ?? '',
    line: item.line ?? item.lineNumber ?? null,
    rule: item.rule ?? item.ruleId ?? item.code ?? null,
    severity: normalizeSeverity(item.severity),
    message: item.message ?? '',
    fix: item.fix ?? null,
  }));
}

/**
 * Parse ESLint-style nested structure.
 * Shape: {results: [{filePath, messages: [{ruleId, severity, message, line}]}]}
 * @param {object} obj
 * @returns {Array} normalised items
 */
function parseEslintStyle(obj) {
  const items = [];
  for (const fileResult of obj.results) {
    const filePath = fileResult.filePath ?? fileResult.file ?? '';
    for (const msg of (fileResult.messages ?? [])) {
      items.push({
        file: filePath,
        line: msg.line ?? null,
        rule: msg.ruleId ?? msg.rule ?? null,
        severity: normalizeSeverity(msg.severity),
        message: msg.message ?? '',
        fix: msg.fix ?? null,
      });
    }
  }
  return items;
}

/**
 * Parse an errors/warnings keyed object.
 * Shape: {errors: [{file, line, message}], warnings: [...]}
 * @param {object} obj
 * @returns {Array} normalised items
 */
function parseErrorsWarningsObject(obj) {
  const items = [];
  for (const item of (obj.errors ?? [])) {
    items.push({
      file: item.file ?? item.filePath ?? '',
      line: item.line ?? null,
      rule: item.rule ?? item.ruleId ?? null,
      severity: 'error',
      message: item.message ?? '',
      fix: item.fix ?? null,
    });
  }
  for (const item of (obj.warnings ?? [])) {
    items.push({
      file: item.file ?? item.filePath ?? '',
      line: item.line ?? null,
      rule: item.rule ?? item.ruleId ?? null,
      severity: 'warning',
      message: item.message ?? '',
      fix: item.fix ?? null,
    });
  }
  return items;
}

/**
 * Parse raw JSON output from a tool and return a standard sensor result.
 *
 * @param {string} rawOutput - Raw stdout from the tool
 * @param {string} sensorType - "lint" | "typecheck" | "coverage" | "mutation"
 * @param {string} gateType   - "required" | "advisory"
 * @returns {object} Standard sensor result
 */
function parseGenericJson(rawOutput, sensorType, gateType) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (err) {
    // Invalid JSON → fail result with parse error item
    return buildResult({
      type: sensorType,
      gate: gateType,
      status: 'fail',
      errors: 1,
      warnings: 0,
      items: [
        {
          file: null,
          line: null,
          rule: null,
          severity: 'error',
          message: `JSON parse error: ${err.message}`,
          fix: null,
        },
      ],
      summary: '1 errors, 0 warnings',
    });
  }

  let items;

  if (Array.isArray(parsed)) {
    // Pattern 1: flat array
    items = parseFlatArray(parsed);
  } else if (parsed && Array.isArray(parsed.results)) {
    // Pattern 2: ESLint-style nested
    items = parseEslintStyle(parsed);
  } else if (parsed && (Array.isArray(parsed.errors) || Array.isArray(parsed.warnings))) {
    // Pattern 3: errors/warnings object
    items = parseErrorsWarningsObject(parsed);
  } else {
    // Unknown shape — treat as empty
    items = [];
  }

  return buildResult({ type: sensorType, gate: gateType, items });
}

module.exports = { parseGenericJson };
