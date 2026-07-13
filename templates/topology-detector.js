'use strict';

const path = require('node:path');
const {
  detectTopology,
  loadRegistry,
  loadCustomTopologies,
  mergeTopologies,
  matchTopology,
} = require('../runtime/health-runtime.js');

module.exports = {detectTopology, loadRegistry, loadCustomTopologies, mergeTopologies, matchTopology};

if (require.main === module) {
  const projectRoot = process.argv[2] || process.cwd();
  const registryPath = path.join(__dirname, 'topology-registry.json');
  process.stdout.write(`${JSON.stringify(detectTopology(projectRoot, registryPath), null, 2)}\n`);
}
