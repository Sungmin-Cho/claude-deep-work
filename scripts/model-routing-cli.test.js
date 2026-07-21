'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const CLI = path.join(__dirname, 'model-routing-cli.js');

function run(args) {
  const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('정상 경로: repo 루트에서 claude 런타임 결정 JSON', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--task', '기능 추가', '--runtime', 'claude']);
  assert.ok(r.model_routing.implement);
  assert.ok(r.meta.tiers.implement);
  assert.notStrictEqual(r.model_routing.implement, 'standard'); // tier명 유출 금지
});

test('pinned 전달', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--task', 't', '--runtime', 'claude',
    '--pinned', 'implement=deep']);
  assert.strictEqual(r.model_routing.implement, 'opus');
});

test('없는 root여도 exit 0 + fallback JSON (fail-safe)', () => {
  const r = run(['--root', '/nonexistent-xyz', '--task', 't', '--runtime', 'claude']);
  assert.ok(r.model_routing); // 신호 null → medium 수렴으로 정상 결정
});

test('pinned 형식 오류 항목은 경고 + 무시 (전체 거부 아님)', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--task', 't', '--runtime', 'claude',
    '--pinned', 'implement=deep,bogus']);
  assert.strictEqual(r.model_routing.implement, 'opus');
  assert.ok(r.warnings.some((w) => /bogus/.test(w)));
});

test('fallback 경로: DEEP_WORK_MR_CLI_TEST_THROW=1이면 exit 0 + all-main fallback JSON', () => {
  const out = execFileSync(process.execPath, [CLI, '--root', path.join(__dirname, '..'), '--task', 't',
    '--runtime', 'claude'],
    { encoding: 'utf8', env: { ...process.env, DEEP_WORK_MR_CLI_TEST_THROW: '1' } });
  // (a) exit code 0 — execFileSync가 던지지 않고 여기까지 도달함으로써 확인됨
  // (b) stdout이 유효 JSON 한 줄
  const lines = out.split('\n').filter((l) => l.length > 0);
  assert.strictEqual(lines.length, 1);
  const r = JSON.parse(lines[0]);
  // (c) model_routing의 전 phase가 'main'
  for (const p of ['brainstorm', 'research', 'plan', 'implement', 'test']) {
    assert.strictEqual(r.model_routing[p], 'main');
  }
  assert.ok(r.meta && r.meta.tiers);
  for (const p of ['brainstorm', 'research', 'plan', 'implement', 'test']) {
    assert.strictEqual(r.meta.tiers[p], 'main');
  }
  // (d) warnings에 cli-error: test-throw 포함
  assert.ok(r.warnings.some((w) => w === 'cli-error: test-throw'));
});

test('bad-json 경로: DEEP_WORK_MR_CLI_TEST_BAD_JSON=1이면 exit 0 + JSON.stringify throw → fallback JSON', () => {
  const out = execFileSync(process.execPath, [CLI, '--root', path.join(__dirname, '..'), '--task', 't',
    '--runtime', 'claude'],
    { encoding: 'utf8', env: { ...process.env, DEEP_WORK_MR_CLI_TEST_BAD_JSON: '1' } });
  // (a) exit code 0 — execFileSync가 던지지 않고 여기까지 도달함으로써 확인됨
  // (b) stdout이 유효 JSON 한 줄
  const lines = out.split('\n').filter((l) => l.length > 0);
  assert.strictEqual(lines.length, 1);
  const r = JSON.parse(lines[0]);
  // (c) model_routing의 전 phase가 'main'
  for (const p of ['brainstorm', 'research', 'plan', 'implement', 'test']) {
    assert.strictEqual(r.model_routing[p], 'main');
  }
  assert.ok(r.meta && r.meta.tiers);
  for (const p of ['brainstorm', 'research', 'plan', 'implement', 'test']) {
    assert.strictEqual(r.meta.tiers[p], 'main');
  }
  // (d) warnings에 cli-error: 포함 (circular reference로 인한 메시지)
  assert.ok(r.warnings.some((w) => /cli-error:/.test(w)));
});

test('risk-class/policy-mode/floor-baseline을 runtime으로 전달한다', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--runtime', 'claude', '--risk-class', 'high',
    '--policy-mode', 'adaptive', '--floor-baseline', '{"test":"deep"}']);
  assert.equal(r.meta.policy.risk_class, 'high');
  assert.equal(r.meta.policy.floors_effective.test, 'deep');
});

test('잘못된 floor-baseline과 risk-class는 경고 후 fail-open한다', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--runtime', 'claude', '--risk-class', 'bogus',
    '--floor-baseline', '{broken']);
  assert.ok(r.warnings.some((warning) => /risk-class/.test(warning)));
  assert.ok(r.warnings.some((warning) => /floor-baseline/.test(warning)));
  assert.ok(!Object.hasOwn(r.meta, 'policy'));
});
