'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateVerificationSpec, migrateKnownVerificationSpec, runVerification } =
  require('./verification-runtime.js');

const worker = path.resolve(__dirname, '..', 'tests', 'fixtures', 'verification-process-worker.js');
const base = {schema_version:1, executable:{kind:'node',value:'node'}, args:[worker,'pass'],
  cwd_role:'active-worktree', timeout_ms:5_000, max_output_bytes:4096};

test('verification specs are exact structured argv only', () => {
  assert.deepEqual(validateVerificationSpec(base), base);
  assert.throws(() => validateVerificationSpec({command:'npm test'}), /structured-verification/);
  assert.throws(() => validateVerificationSpec({...base, executable:{kind:'absolute-native',
    value:'tool.cmd'}}), /verification-executable/);
  assert.throws(() => migrateKnownVerificationSpec('custom && cleanup'),
    /manual-structured-verification-migration-required/);
});

test('must-pass and must-fail evidence bind complete output digests', async () => {
  const pass = await runVerification({spec:base, expectedOutcome:'must-pass', cwd:process.cwd()});
  assert.equal(pass.accepted, true);
  assert.match(pass.outputDigest, /^[0-9a-f]{64}$/);
  const redSpec = {...base, args:[worker,'fail','expected 42'], red_failure_literal:'expected 42'};
  const red = await runVerification({spec:redSpec, expectedOutcome:'must-fail', cwd:process.cwd()});
  assert.equal(red.accepted, true);
  await assert.rejects(() => runVerification({spec:{...redSpec,red_failure_literal:'wrong'},
    expectedOutcome:'must-fail', cwd:process.cwd()}), /red-evidence-mismatch/);
});
