'use strict';

const {
  scanDependencyVuln,
  parseNpmAudit,
} = require('../../runtime/health-runtime.js');

module.exports = {scanDependencyVuln, parseNpmAudit};
