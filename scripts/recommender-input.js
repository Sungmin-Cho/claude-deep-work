// scripts/recommender-input.js
'use strict';

const {
  buildRecommenderInput: sanitizeInput,
  truncateBytes,
  MAX_TASK_BYTES,
  MAX_COMMITS,
  MAX_DIRS,
} = require('../runtime/recommender-runtime.js');

module.exports = { sanitizeInput, truncateBytes, MAX_TASK_BYTES, MAX_COMMITS, MAX_DIRS };

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      process.stdout.write(`${JSON.stringify(sanitizeInput(JSON.parse(input)))}\n`);
    } catch (error) {
      process.stderr.write(`recommender-input parse error: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}
