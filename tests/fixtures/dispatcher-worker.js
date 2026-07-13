'use strict';

const { dispatch } = require('../../scripts/deep-work-runtime.js');

dispatch(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => { process.stderr.write(error.stack || error.message); process.exitCode = 1; });
