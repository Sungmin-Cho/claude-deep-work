'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalDigest } = require('../runtime/risk-runtime.js');

const CLI = path.join(__dirname, 'risk-profile-cli.js');

function run(args, inputObj, env = {}) {
  const out = execFileSync(process.execPath, [CLI, ...args], {
    input: inputObj === undefined ? '' : JSON.stringify(inputObj),
    env: { ...process.env, ...env }, encoding: 'utf8',
  });
  return JSON.parse(out);
}

function makeWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'risk-cli-'));
}

test('provisional — risk+policy 출력과 artifact 기록', () => {
  const workDir = makeWorkDir();
  const out = run(['--stage', 'provisional', '--root', path.join(__dirname, '..'), '--work-dir', workDir],
    { task_text: '결제 idempotency 조건 변경',
      tiers: { research: 'standard', implement: 'standard', test: 'light' }, pinned: {} });
  assert.strictEqual(out.stage, 'provisional');
  assert.ok(out.risk_profile.class);
  assert.match(out.risk_profile.decided_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(out.policy_snapshot.profile);
  assert.strictEqual(out.policy_snapshot.based_on, 'provisional');
  const artifact = path.join(workDir, 'risk-inputs', 'provisional.json');
  assert.strictEqual(out.input_ref.path, artifact);
  const effective = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  assert.ok(effective.signals); // 유효 입력 = 수신 입력 + 자체 수집 signals (스펙 §4.6)
  assert.strictEqual(typeof effective.signals.has_tests, 'boolean');
  // artifact 독립 재해싱 — 기록된 유효 입력에서 재계산한 digest가 CLI가 부착한
  // input_ref.digest·risk_profile.input_digest 양쪽과 동일해야 재현 계약(§4.6, P1 fix)이 성립한다.
  const rehash = canonicalDigest(effective);
  assert.strictEqual(rehash, out.input_ref.digest);
  assert.strictEqual(rehash, out.risk_profile.input_digest);
});

test('slice — risk-only 출력 (policy 없음) + slice별 고유 artifact', () => {
  const workDir = makeWorkDir();
  const out = run(['--stage', 'slice', '--root', path.join(__dirname, '..'), '--work-dir', workDir],
    { task_text: '동일 요청 재시도 시 중복 생성되지 않는다', slice_id: 'SLICE-003',
      evidence: { changed_paths: ['runtime/lease.js'] } });
  assert.strictEqual(out.stage, 'slice');
  assert.strictEqual(out.slice_id, 'SLICE-003');
  assert.strictEqual(out.policy_snapshot, undefined); // 스펙 §4.6 stage별 계약
  assert.ok(out.input_ref.path.endsWith(path.join('risk-inputs', 'slice-SLICE-003.json')));
});

test('authoritative — evidence + prior_profile → transition', () => {
  const workDir = makeWorkDir();
  const out = run(['--stage', 'authoritative', '--root', path.join(__dirname, '..'), '--work-dir', workDir],
    { task_text: 'lease 상태 머신', prior_profile: { class: 'low' },
      evidence: { changed_paths: ['runtime/lease.js'], keywords: ['lease', 'retry'],
        side_effects: [], evidence_refs: ['research.md#RF-012'] },
      tiers: { research: 'standard', implement: 'standard', test: 'light' }, pinned: {} });
  assert.strictEqual(out.risk_profile.stage, 'authoritative');
  if (out.risk_profile.class !== 'low') assert.strictEqual(out.risk_profile.transition.from, 'low');
});

test('결정론 — 같은 입력 2회 → 동일 input_digest (§8.2-3)', () => {
  const workDir1 = makeWorkDir(); const workDir2 = makeWorkDir();
  const input = { task_text: 'auth 권한 검사', tiers: {}, pinned: {} };
  const a = run(['--stage', 'provisional', '--root', path.join(__dirname, '..'), '--work-dir', workDir1], input);
  const b = run(['--stage', 'provisional', '--root', path.join(__dirname, '..'), '--work-dir', workDir2], input);
  assert.strictEqual(a.risk_profile.input_digest, b.risk_profile.input_digest);
  // digest 일원화 — CLI 1곳(canonicalDigest(effective))에서 계산해 양쪽에 부착 (P1 fix)
  assert.strictEqual(a.risk_profile.input_digest, a.input_ref.digest);
  assert.strictEqual(b.risk_profile.input_digest, b.input_ref.digest);
  assert.deepStrictEqual(a.risk_profile.dimensions, b.risk_profile.dimensions);
});

test('fail-safe — 손상 입력에도 exit 0 + fallback JSON (스펙 §7)', () => {
  const out = execFileSync(process.execPath,
    [CLI, '--stage', 'provisional', '--root', '/nonexistent-root-xyz', '--work-dir', '/nonexistent-wd-xyz'],
    { input: 'NOT JSON', encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.risk_profile, null);
  assert.ok(parsed.error);
});

test('fail-safe — 모듈 손상 시뮬레이션 (test-only hook)', () => {
  const out = execFileSync(process.execPath, [CLI, '--stage', 'provisional'],
    { input: '{}', encoding: 'utf8', env: { ...process.env, DEEP_WORK_RISK_CLI_TEST_THROW: '1' } });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.risk_profile, null);
  assert.match(parsed.error, /test-throw/);
});
