'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateRegistry, migrateRegistryV1, runSensor, phase3SensorKinds } =
  require('./sensor-runtime.js');

test('sensor registry v2 is bounded and never parses custom commands', () => {
  const v1 = {$schema:'sensor-registry-v1',ecosystems:{typescript:{lint:{command:'npx eslint --format json .',parser:'eslint'}}}};
  const migrated = migrateRegistryV1(v1);
  assert.equal(migrated.$schema, 'sensor-registry-v2');
  assert.equal(validateRegistry(migrated).ok, true);
  assert.throws(() => migrateRegistryV1({$schema:'sensor-registry-v1',ecosystems:{x:{lint:{command:'echo bad'}}}}),
    /manual-structured-migration-required/);
});

test('sensors accept only structured process specs and preserve Phase 3 order', async () => {
  const fixture = path.resolve(__dirname, '..', 'tests', 'fixtures', 'verification-process-worker.js');
  const result = await runSensor({kind:'lint', processSpec:{kind:'native-executable',
    executable:process.execPath,args:[fixture,'pass']}, parser:'generic-line', budgetMs:2_000,
    projectRoot:process.cwd()});
  assert.equal(result.status, 'pass');
  await assert.rejects(() => runSensor({kind:'lint',processSpec:'npm test',parser:'generic-line',
    budgetMs:1000,projectRoot:process.cwd()}), /sensor-process-spec/);
  assert.deepEqual(phase3SensorKinds([{kind:'review-check'},{kind:'typecheck'},{kind:'lint'}]),
    ['lint','typecheck','review-check']);
});
