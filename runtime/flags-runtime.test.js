'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeepWorkFlags } = require('./flags-runtime.js');

test('flags parse an argument array without reparsing command text', () => {
  assert.deepEqual(parseDeepWorkFlags(['--tdd=strict','--team=solo','task with spaces']), {
    tdd:'strict',team:'solo',positionals:['task with spaces'],execution:null,
  });
  assert.throws(() => parseDeepWorkFlags('--tdd=strict task'), /argument-array/);
  assert.throws(() => parseDeepWorkFlags(['--tdd=strict','--tdd=spike']), /duplicate-flag/);
  assert.throws(() => parseDeepWorkFlags(['--unknown=x']), /unknown-flag/);
});
