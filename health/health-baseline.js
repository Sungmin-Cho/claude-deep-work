'use strict';

const {
  readBaseline,
  writeBaseline,
  isBaselineValid,
  gitIsAncestor,
  BASELINE_FILE,
} = require('../runtime/health-runtime.js');

module.exports = {readBaseline, writeBaseline, isBaselineValid, gitIsAncestor, BASELINE_FILE};
