'use strict';
const fs = require('node:fs');
// Kept for API compatibility; none of these fields are rewritten anymore.
const FIELDS_TO_MIGRATE = ['research', 'implement', 'test'];
function migrateStateFile(filePath) {
  if (!fs.existsSync(filePath)) return {replaced:[], warnings:[]};
  const source = fs.readFileSync(filePath, 'utf8');
  if (/^(?:model_routing_meta|model_routing_meta_json):/m.test(source))
    return {replaced:[], warnings:[], skipped:'model-routing-meta-present'};
  const block = source.match(/^model_routing:\s*(?:#.*)?\n((?:[ \t]+[^\n]*\n|\n)*)/m)?.[1] || '';
  const warnings = [...block.matchAll(/^\s+(research|implement|test):\s*["']?(main-[A-Za-z0-9._-]+)/gm)]
    .map(([,field,value]) => `unknown model_routing.${field} value "${value}" — preserved as-is`);
  // main means the explicitly selected current host/session. Legacy files do
  // not contain enough authority to reinterpret that choice as delegation.
  return {replaced:[], warnings, skipped:'explicit-main-preserved'};
}
module.exports = {migrateStateFile, FIELDS_TO_MIGRATE};
if (require.main === module) {
  if (!process.argv[2]) { console.error('Usage: migrate-model-routing.js <state-file>'); process.exit(2); }
  const result = migrateStateFile(process.argv[2]);
  for (const warning of result.warnings) console.error(warning);
}
