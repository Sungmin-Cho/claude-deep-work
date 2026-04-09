'use strict';

/**
 * Sensor execution engine.
 *
 * Ties together the detection engine and parsers to run sensors against
 * changed files and format agent-readable feedback.
 *
 * Commands from registry.json are trusted config -- execSync is intentional.
 */

const { execSync } = require('node:child_process');
const path = require('node:path');

// -- Default timeouts (seconds) ------------------------------------------------
const DEFAULT_TIMEOUTS = {
  lint: 30,
  typecheck: 60,
  coverage: 120,
  mutation: 300,
};

// -- Lazy-loaded PARSERS registry -----------------------------------------------
// Parsers are ES modules; we use dynamic import() to load them.
let _parsersCache = null;

async function getParsers() {
  if (_parsersCache) return _parsersCache;
  const [
    { parseEslint },
    { parseTsc },
    { parseRuff },
    { parseGenericLine },
    { parseGenericJson },
    { parseStryker },
    { parseDotnet },
    { parseClang },
  ] = await Promise.all([
    import('./parsers/eslint-parser.js'),
    import('./parsers/tsc-parser.js'),
    import('./parsers/ruff-parser.js'),
    import('./parsers/generic-line.js'),
    import('./parsers/generic-json.js'),
    import('./parsers/stryker-parser.js'),
    import('./parsers/dotnet-parser.js'),
    import('./parsers/clang-parser.js'),
  ]);

  _parsersCache = {
    eslint: (output, type, gate) => parseEslint(output),
    tsc: (output, type, gate) => parseTsc(output),
    ruff: (output, type, gate) => parseRuff(output),
    'generic-line': (output, type, gate) => parseGenericLine(output, type, gate),
    'generic-json': (output, type, gate) => parseGenericJson(output, type, gate),
    stryker: (output, type, gate) => parseStryker(output),
    dotnet: (output, type, gate) => parseDotnet(output, type, gate),
    'clang-tidy': (output, type, gate) => parseClang(output),
  };

  return _parsersCache;
}

function getParserSync(parserName) {
  if (!_parsersCache) return null;
  return _parsersCache[parserName] ?? null;
}

// -- selectSensorsForFiles ------------------------------------------------------

/**
 * Filter ecosystems to those that have at least one changed file matching
 * their file_extensions list.
 *
 * @param {string[]} changedFiles - List of changed file paths
 * @param {object[]} ecosystems   - Ecosystem objects from detectEcosystems()
 * @returns {object[]} Filtered ecosystem objects (references preserved)
 */
function selectSensorsForFiles(changedFiles, ecosystems) {
  return ecosystems.filter(eco => {
    const exts = eco.file_extensions ?? [];
    return changedFiles.some(f => {
      const ext = path.extname(f);
      return exts.includes(ext);
    });
  });
}

// -- runSensor -----------------------------------------------------------------

/**
 * Run a sensor command synchronously and parse its output.
 *
 * Commands from registry.json are trusted config -- execSync is intentional.
 *
 * @param {string} cmd         - Shell command to run
 * @param {string} parserName  - Name of parser to use (e.g. "eslint", "tsc")
 * @param {string} sensorType  - "lint" | "typecheck" | "coverage" | "mutation"
 * @param {string} gateType    - "required" | "advisory"
 * @param {number} [timeoutSec] - Timeout in seconds (default from DEFAULT_TIMEOUTS)
 * @returns {object} Standard sensor result
 */
function runSensor(cmd, parserName, sensorType, gateType, timeoutSec) {
  const timeout = (timeoutSec ?? DEFAULT_TIMEOUTS[sensorType] ?? 30) * 1000;

  const parser = getParserSync(parserName);
  if (!parser) {
    return {
      sensor: parserName,
      type: sensorType,
      gate: gateType,
      status: 'fail',
      errors: 1,
      warnings: 0,
      items: [{ file: null, line: null, rule: null, severity: 'error', message: 'Unknown parser: ' + parserName, fix: null }],
      summary: '1 errors, 0 warnings',
    };
  }

  let rawOutput = '';
  try {
    // Commands are trusted config -- execSync is intentional (not execFileSync)
    rawOutput = execSync(cmd, { timeout, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
      return {
        sensor: parserName,
        type: sensorType,
        gate: gateType,
        status: 'timeout',
        errors: 0,
        warnings: 0,
        items: [],
        summary: 'Sensor timed out after ' + (timeoutSec ?? DEFAULT_TIMEOUTS[sensorType] ?? 30) + 's',
      };
    }
    rawOutput = (err.stderr || err.stdout || '').toString();
  }

  return parser(rawOutput, sensorType, gateType);
}

// -- formatFeedback ------------------------------------------------------------

/**
 * Generate agent-readable FIX format feedback from a sensor result.
 *
 * @param {object} sensorResult - Standard sensor result object
 * @param {number} round        - Current correction round
 * @param {number} maxRounds    - Maximum correction rounds
 * @returns {string} Formatted feedback string
 */
function formatFeedback(sensorResult, round, maxRounds) {
  const { sensor, errors, items } = sensorResult;
  const lines = [];

  lines.push('[SENSOR_FAIL] ' + sensor + ' -- ' + errors + ' errors (correction round ' + round + '/' + maxRounds + ')');
  lines.push('');

  items.forEach(function(item, i) {
    const idx = i + 1;
    const location = [item.file, item.line].filter(Boolean).join(':');
    const rule = item.rule ? ' -- ' + item.rule : '';
    lines.push('ERROR ' + idx + ': ' + location + rule);
    lines.push('  ' + item.message);
    if (item.fix) {
      lines.push('  FIX: ' + item.fix);
    }
  });

  return lines.join('\n');
}

// -- buildSensorResult ---------------------------------------------------------

/**
 * Check if all required sensors for an ecosystem are not_installed.
 *
 * @param {object} eco - Ecosystem object with sensors map
 * @returns {object} Result with all_not_applicable boolean
 */
function buildSensorResult(eco) {
  const sensors = eco.sensors ?? {};
  const entries = Object.values(sensors);

  if (entries.length === 0) {
    return { all_not_applicable: true };
  }

  const allNotInstalled = entries.every(function(s) { return s.status === 'not_installed'; });

  return { all_not_applicable: allNotInstalled };
}

// -- Exports -------------------------------------------------------------------

module.exports = {
  selectSensorsForFiles,
  runSensor,
  formatFeedback,
  buildSensorResult,
  DEFAULT_TIMEOUTS,
  getParsers,
};

// -- CLI -----------------------------------------------------------------------
// Usage: node run-sensors.js <cmd> <parser> [type] [gate] [timeout]

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const parserName = args[1];
  const sensorType = args[2] || 'lint';
  const gateType = args[3] || 'required';
  const timeoutArg = args[4];

  if (!cmd || !parserName) {
    process.stderr.write('Usage: node run-sensors.js <cmd> <parser> [type] [gate] [timeout]\n');
    process.exit(1);
  }

  const timeoutSec = timeoutArg ? Number(timeoutArg) : undefined;

  getParsers().then(function() {
    const result = runSensor(cmd, parserName, sensorType, gateType, timeoutSec);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch(function(err) {
    process.stderr.write('Error: ' + err.message + '\n');
    process.exit(1);
  });
}
