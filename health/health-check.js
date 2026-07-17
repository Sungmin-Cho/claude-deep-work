'use strict';

const {
  runHealthCheck,
  loadFitnessFile,
  parseCliArgs,
} = require('../runtime/health-runtime.js');

module.exports = {runHealthCheck, loadFitnessFile, parseCliArgs};

if (require.main === module) {
  const {projectRoot, options} = parseCliArgs(process.argv.slice(2));
  runHealthCheck(projectRoot, options)
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
