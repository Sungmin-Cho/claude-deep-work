/**
 * clang-tidy output parser.
 *
 * Thin wrapper over generic-line.js.
 * Sets sensor name to 'clang-tidy' and type to 'lint'.
 *
 * clang-tidy output format:
 *   file:line:col: warning: message [check-name]
 *   file:line:col: error: message [check-name]
 */

import { parseGenericLine } from './generic-line.js';

/**
 * Parse raw clang-tidy output and return a standard sensor result.
 *
 * @param {string} rawOutput - Raw stdout from `clang-tidy`
 * @returns {object} Standard sensor result
 */
export function parseClang(rawOutput) {
  const base = parseGenericLine(rawOutput, 'lint', 'required');
  return { ...base, sensor: 'clang-tidy' };
}
