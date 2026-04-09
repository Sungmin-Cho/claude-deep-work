/**
 * .NET (dotnet build / dotnet-format) output parser.
 *
 * Thin wrapper over generic-line.js for the standard colon-separated format.
 * Also handles the dotnet build parenthesis format:
 *   file(line,col): error CSXXXX: message [project.csproj]
 *
 * The parenthesis lines are pre-converted to the generic-line colon format
 * before delegation:
 *   file:line:col: error CSXXXX: message
 */

const { parseGenericLine } = require('./generic-line.js');

// Matches: file(line,col): severity CSXXXX: message
const DOTNET_PAREN_RE = /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)\s+(\S+):\s*(.+?)(?:\s+\[.+\])?$/gm;

/**
 * Convert dotnet parenthesis format lines to colon format for generic-line.
 * @param {string} rawOutput
 * @returns {string}
 */
function normalizeOutput(rawOutput) {
  return rawOutput.replace(DOTNET_PAREN_RE, (_, file, line, col, sev, code, msg) => {
    return `${file}:${line}:${col}: ${sev}: ${code}: ${msg}`;
  });
}

/**
 * Parse raw dotnet build output and return a standard sensor result.
 *
 * @param {string} rawOutput  - Raw stdout from `dotnet build`
 * @param {string} [sensorType='typecheck'] - "typecheck" | "lint"
 * @returns {object} Standard sensor result
 */
function parseDotnet(rawOutput, sensorType = 'typecheck') {
  const normalized = normalizeOutput(rawOutput ?? '');
  const base = parseGenericLine(normalized, sensorType, 'required');
  return { ...base, sensor: 'dotnet' };
}

module.exports = { parseDotnet };
