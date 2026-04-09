/**
 * Stryker mutation testing report parser.
 *
 * Works for both stryker (JS) and stryker-net (C#) — same report format.
 *
 * Stryker report JSON shape:
 *   {files: {[filePath]: {source?: string, mutants: [{id, mutatorName, replacement, status,
 *     location: {start: {line, column}}}]}}}
 *
 * Status values: Killed, Survived, NoCoverage, Timeout
 *
 * Score = killed / (killed + survived) * 100
 *   - NoCoverage mutants are EXCLUDED from the denominator
 *
 * possibly_equivalent tagging applies to entries in survived_details:
 *   - NoCoverage mutants (status === 'NoCoverage')
 *   - StringLiteral mutants whose source line contains console/log/debug/warn/error/print
 */

const CONSOLE_RE = /console|\.log|debug|warn|error|print/i;

/**
 * Determine if a mutant should be tagged 'possibly_equivalent'.
 *
 * @param {object} mutant    - The mutant object
 * @param {string} [source]  - The full source text of the file (optional)
 * @returns {boolean}
 */
function isPossiblyEquivalent(mutant, source) {
  if (mutant.status === 'NoCoverage') return true;
  if (mutant.mutatorName === 'StringLiteral' && source) {
    const lines = source.split('\n');
    // location.start.line is 1-based
    const lineIndex = (mutant.location?.start?.line ?? 1) - 1;
    const sourceLine = lines[lineIndex] ?? '';
    if (CONSOLE_RE.test(sourceLine)) return true;
  }
  return false;
}

/**
 * Parse a Stryker JSON report and return a mutation-specific result object.
 *
 * @param {string} rawOutput - Raw contents of the stryker JSON report
 * @returns {object} Mutation result
 */
function parseStryker(rawOutput) {
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (err) {
    return {
      total_mutants: 0,
      killed: 0,
      survived: 0,
      no_coverage: 0,
      equivalent: 0,
      timeout: 0,
      score: 0,
      survived_details: [],
    };
  }

  let totalMutants = 0;
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let equivalent = 0;
  let timeout = 0;
  const survivedDetails = [];

  const files = parsed.files ?? {};

  for (const [filePath, fileData] of Object.entries(files)) {
    const source = fileData.source ?? null;
    const mutants = fileData.mutants ?? [];

    for (const mutant of mutants) {
      totalMutants++;
      const status = mutant.status;

      if (status === 'Killed') {
        killed++;
      } else if (status === 'Survived') {
        survived++;
        const tag = isPossiblyEquivalent(mutant, source) ? 'possibly_equivalent' : '';
        survivedDetails.push({
          file: filePath,
          line: mutant.location?.start?.line ?? null,
          mutator: mutant.mutatorName ?? '',
          replacement: mutant.replacement ?? '',
          id: mutant.id ?? '',
          tag,
        });
      } else if (status === 'NoCoverage') {
        noCoverage++;
      } else if (status === 'Timeout') {
        timeout++;
      }
    }
  }

  // Score = killed / (killed + survived) * 100; NoCoverage excluded from denominator
  const denominator = killed + survived;
  const score = denominator === 0 ? 0 : Math.round((killed / denominator) * 1000) / 10;

  return {
    total_mutants: totalMutants,
    killed,
    survived,
    no_coverage: noCoverage,
    equivalent,
    timeout,
    score,
    survived_details: survivedDetails,
  };
}

module.exports = { parseStryker };
