'use strict';

/**
 * Sensor execution engine.
 *
 * Ties together the detection engine and parsers to run sensors against
 * changed files and format agent-readable feedback.
 *
 * Process specifications are structured argv and execute through runtime/sensor-runtime.
 */

const path = require('node:path');
const { runSensor: runRuntimeSensor } = require('../runtime/sensor-runtime.js');

// -- Default timeouts (seconds) ------------------------------------------------
const DEFAULT_TIMEOUTS = {
  lint: 30,
  typecheck: 60,
  coverage: 120,
  mutation: 300,
};

// -- PARSERS registry (sync require, all parsers are now CJS) ------------------
const { parseEslint } = require('./parsers/eslint-parser.js');
const { parseTsc } = require('./parsers/tsc-parser.js');
const { parseRuff } = require('./parsers/ruff-parser.js');
const { parseGenericLine } = require('./parsers/generic-line.js');
const { parseGenericJson } = require('./parsers/generic-json.js');
const { parseStryker } = require('./parsers/stryker-parser.js');
const { parseDotnet } = require('./parsers/dotnet-parser.js');
const { parseClang } = require('./parsers/clang-parser.js');

const PARSERS = {
  eslint: (output, type, gate) => parseEslint(output),
  tsc: (output, type, gate) => parseTsc(output),
  ruff: (output, type, gate) => parseRuff(output),
  'generic-line': (output, type, gate) => parseGenericLine(output, type, gate),
  'generic-json': (output, type, gate) => parseGenericJson(output, type, gate),
  stryker: (output, type, gate) => parseStryker(output),
  dotnet: (output, type, gate) => parseDotnet(output, type, gate),
  'clang-tidy': (output, type, gate) => parseClang(output),
};

function getParsers() {
  return Promise.resolve(PARSERS);
}

function getParserSync(parserName) {
  return PARSERS[parserName] ?? null;
}

// -- selectSensorsForFiles ------------------------------------------------------

// Marker files that should trigger ecosystem-wide sensor scan
const MARKER_FILES = {
  javascript: ['package.json', 'package-lock.json', '.eslintrc', '.eslintrc.json', '.eslintrc.js', 'eslint.config.js'],
  typescript: ['tsconfig.json', 'package.json', 'package-lock.json', '.eslintrc', '.eslintrc.json', 'eslint.config.js'],
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', '.flake8', 'ruff.toml'],
  csharp: ['.csproj', '.sln', 'Directory.Build.props'],
  cpp: ['CMakeLists.txt', '.clang-tidy'],
};

/**
 * Filter ecosystems to those that have at least one changed file matching
 * their file_extensions list or marker/config file list.
 *
 * @param {string[]} changedFiles - List of changed file paths
 * @param {object[]} ecosystems   - Ecosystem objects from detectEcosystems()
 * @returns {object[]} Filtered ecosystem objects (references preserved)
 */
function selectSensorsForFiles(changedFiles, ecosystems) {
  return ecosystems.filter(eco => {
    const exts = eco.file_extensions ?? [];
    const markers = MARKER_FILES[eco.name] || [];

    return changedFiles.some(f => {
      // Match by extension
      if (exts.some(ext => f.endsWith(ext))) return true;
      // Match by marker filename
      const basename = f.split('/').pop();
      if (markers.some(m => m.startsWith('.') ? basename === m : basename === m || basename.endsWith(m))) return true;
      return false;
    });
  });
}

// -- runSensor -----------------------------------------------------------------

/**
 * Run a structured sensor process specification and parse its output.
 *
 * @param {object} processSpec - Structured native-executable or node-package-bin spec
 * @param {string} parserName  - Name of parser to use (e.g. "eslint", "tsc")
 * @param {string} sensorType  - "lint" | "typecheck" | "coverage" | "mutation"
 * @param {string} gateType    - "required" | "advisory"
 * @param {number} [timeoutSec] - Timeout in seconds (default from DEFAULT_TIMEOUTS)
 * @returns {object} Standard sensor result
 */
async function runSensor(processSpec, parserName, sensorType, gateType, timeoutSec, projectRoot = process.cwd()) {
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

  const runtime = await runRuntimeSensor({kind:sensorType,processSpec,parser:parserName,
    budgetMs:timeout,projectRoot});
  if (runtime.status === 'timeout') return {sensor:parserName,type:sensorType,gate:gateType,
    status:'timeout',errors:0,warnings:0,items:[],summary:`Sensor timed out after ${timeout / 1000}s`};
  if (runtime.status === 'not-installed') return {sensor:parserName,type:sensorType,gate:gateType,
    status:'not_installed',errors:0,warnings:0,items:[],summary:'Sensor tool is not installed'};
  const items = runtime.status === 'pass' ? runtime.warnings : runtime.errors;
  const rawOutput = items.map(item => item.message || JSON.stringify(item)).join('\n');
  const result = parser(rawOutput, sensorType, gateType);
  if (runtime.status !== 'pass' && (!result.items || result.items.length === 0)) {
    result.status='fail';result.errors=1;result.items=[{file:'',line:0,rule:'SENSOR_EXECUTION_ERROR',
      severity:'error',message:'Structured sensor failed without parseable diagnostics.',fix:'Check the sensor process specification.'}];
    result.summary='Sensor execution error';
  }
  return result;
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

// Re-export review-check for pipeline orchestration
const { runReviewCheck, formatReviewCheckFeedback } = require('./review-check.js');
module.exports.runReviewCheck = runReviewCheck;
module.exports.formatReviewCheckFeedback = formatReviewCheckFeedback;

// -- CLI -----------------------------------------------------------------------
// Usage: node run-sensors.js <process-spec-json> <parser> [type] [gate] [timeout]

if (require.main === module) {
  const args = process.argv.slice(2);
  const processSpecText = args[0];
  const parserName = args[1];
  const sensorType = args[2] || 'lint';
  const gateType = args[3] || 'required';
  const timeoutArg = args[4];

  if (!processSpecText || !parserName) {
    process.stderr.write('Usage: node run-sensors.js <process-spec-json> <parser> [type] [gate] [timeout]\n');
    process.exit(1);
  }

  const timeoutSec = timeoutArg ? Number(timeoutArg) : undefined;

  getParsers().then(async function() {
    const result = await runSensor(JSON.parse(processSpecText), parserName, sensorType, gateType, timeoutSec);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch(function(err) {
    process.stderr.write('Error: ' + err.message + '\n');
    process.exit(1);
  });
}
