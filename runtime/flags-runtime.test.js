'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeepWorkFlags, parseFlags } = require('./flags-runtime.js');

test('flags parse an argument array without reparsing command text', () => {
  assert.deepEqual(parseDeepWorkFlags(['--tdd=strict','--team=solo','task with spaces']), {
    tdd:'strict',team:'solo',positionals:['task with spaces'],execution:null,
  });
  assert.throws(() => parseDeepWorkFlags('--tdd=strict task'), /argument-array/);
  assert.throws(() => parseDeepWorkFlags(['--tdd=strict','--tdd=spike']), /duplicate-flag/);
  assert.throws(() => parseDeepWorkFlags(['--unknown=x']), /unknown-flag/);
});

test('--model-routing 유효 항목 통과', () => {
  const f = parseFlags(['--model-routing=implement=deep,test=light', 'task']);
  assert.strictEqual(f.model_routing, 'implement=deep,test=light');
  assert.deepStrictEqual(f.warnings, []);
});

test('--model-routing concrete 어휘 허용 (런타임 매칭은 엔진 몫)', () => {
  const f = parseFlags(['--model-routing=implement=opus']);
  assert.strictEqual(f.model_routing, 'implement=opus');
});

test('--model-routing 무효 항목은 항목 단위 경고+제외, 유효 항목 유지', () => {
  const f = parseFlags(['--model-routing=implement=deep,test=gpt99']);
  assert.strictEqual(f.model_routing, 'implement=deep');
  assert.ok(f.warnings.some((w) => /gpt99/.test(w)));
});

test('--model-routing 전 항목 무효 → null + 경고', () => {
  const f = parseFlags(['--model-routing=bogus']);
  assert.strictEqual(f.model_routing, null);
  assert.ok(f.warnings.length >= 1);
});
