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
  // artifact 독립 재해싱 — self-embedded digest 필드 자신을 preimage에서 제외한다.
  const { input_digest: embeddedDigest, ...preimage } = effective;
  const rehash = canonicalDigest(preimage);
  assert.strictEqual(embeddedDigest, rehash);
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

// ── Task 3 리뷰 반영 (W1/I1/I2): 경로 주입 차단 + fail-open 분기 커버리지
test('W1 — slice_id 경로 주입은 fallback으로 거부 (파일 미기록)', () => {
  const workDir = makeWorkDir();
  const out = run(['--stage', 'slice', '--root', path.join(__dirname, '..'), '--work-dir', workDir],
    { task_text: 'x', slice_id: '../../../PWNED' });
  assert.strictEqual(out.risk_profile, null);
  assert.match(out.error, /slice_id/);
  assert.ok(!fs.existsSync(path.join(workDir, 'PWNED.json')));
  assert.ok(!fs.existsSync(path.join(workDir, '..', 'PWNED.json')));
  const inputsDir = path.join(workDir, 'risk-inputs');
  assert.ok(!fs.existsSync(inputsDir) || fs.readdirSync(inputsDir).length === 0);
});

test('I1 — 비객체 JSON 입력(숫자)은 빈 입력으로 fail-open 처리', () => {
  const workDir = makeWorkDir();
  const out = JSON.parse(execFileSync(process.execPath,
    [CLI, '--stage', 'provisional', '--root', path.join(__dirname, '..'), '--work-dir', workDir],
    { input: '42', encoding: 'utf8' }));
  assert.ok(out.risk_profile);
  assert.strictEqual(out.risk_profile.class, 'low'); // 신호 전무 → 안전 기본값
});

test('I2 — artifact 쓰기 실패 시 fail-open 경고 + input_ref null (risk는 정상 산출)', () => {
  const bogusWorkDir = path.join(makeWorkDir(), 'not-a-dir');
  fs.writeFileSync(bogusWorkDir, 'file blocks mkdir'); // work-dir 경로가 파일 → mkdir ENOTDIR
  const out = run(['--stage', 'provisional', '--root', path.join(__dirname, '..'), '--work-dir', bogusWorkDir],
    { task_text: 'auth 권한 검사' });
  assert.strictEqual(out.input_ref, null);
  assert.ok(out.warnings.some((w) => /artifact 기록 실패/.test(w)));
  assert.ok(out.risk_profile.class);
});

test('I2 — authoritative 출력은 based_on=authoritative를 부착', () => {
  const workDir = makeWorkDir();
  const out = run(['--stage', 'authoritative', '--root', path.join(__dirname, '..'), '--work-dir', workDir],
    { task_text: 'x', evidence: { changed_paths: [], keywords: [], side_effects: [], evidence_refs: [] } });
  assert.strictEqual(out.policy_snapshot.based_on, 'authoritative');
  assert.strictEqual(out.policy_snapshot.compiled_at, out.risk_profile.decided_at);
});

test('--risk-only — non-slice stage에서도 policy 컴파일을 생략하고 self-embedded artifact를 쓴다', () => {
  const workDir = makeWorkDir();
  const out = run(['--stage', 'provisional', '--risk-only', '--root', path.join(__dirname, '..'),
    '--work-dir', workDir], { task_text: 'adaptive routing' });
  assert.ok(out.risk_profile);
  assert.strictEqual(out.policy_snapshot, undefined);
  const artifact = JSON.parse(fs.readFileSync(out.input_ref.path, 'utf8'));
  const { input_digest: embeddedDigest, ...preimage } = artifact;
  assert.strictEqual(embeddedDigest, canonicalDigest(preimage));
  assert.strictEqual(embeddedDigest, out.input_ref.digest);
});

test('--reuse-input digest 일치 — artifact의 signals만 재사용하고 fresh routing 입력을 보존한다', () => {
  const sourceDir = makeWorkDir();
  const reusePath = path.join(sourceDir, 'reuse.json');
  const signals = { tracked_files: 7, source_files: 5, test_files: 2, languages: ['js'],
    estimated_loc: 120, has_tests: true, errors: [] };
  const preimage = { task_text: 'old task must not leak', signals };
  fs.writeFileSync(reusePath, JSON.stringify({ ...preimage, input_digest: canonicalDigest(preimage) }));
  const workDir = makeWorkDir();
  const freshRouting = { research: 'sonnet', implement: 'opus', test: 'haiku' };
  const out = run(['--stage', 'provisional', '--reuse-input', reusePath, '--root', '/missing-reuse-root',
    '--work-dir', workDir], { task_text: 'fresh task', model_routing: freshRouting,
    tiers: { research: 'standard', implement: 'deep', test: 'light' }, pinned: {} });
  const artifact = JSON.parse(fs.readFileSync(out.input_ref.path, 'utf8'));
  assert.deepStrictEqual(artifact.signals, signals);
  assert.strictEqual(artifact.task_text, 'fresh task');
  assert.deepStrictEqual(out.policy_snapshot.role_routing.actual_routing, freshRouting);
  assert.ok(!out.warnings.some((warning) => /reuse-input/.test(warning)));
});

test('--reuse-input digest 불일치 — signals 재수집 + warning으로 fail-open한다', () => {
  const sourceDir = makeWorkDir();
  const reusePath = path.join(sourceDir, 'tampered.json');
  fs.writeFileSync(reusePath, JSON.stringify({ signals: { tracked_files: 999999 }, input_digest: 'tampered' }));
  const workDir = makeWorkDir();
  const out = run(['--stage', 'provisional', '--risk-only', '--reuse-input', reusePath,
    '--root', path.join(__dirname, '..'), '--work-dir', workDir], { task_text: 'fresh' });
  const artifact = JSON.parse(fs.readFileSync(out.input_ref.path, 'utf8'));
  assert.notStrictEqual(artifact.signals.tracked_files, 999999);
  assert.ok(out.warnings.some((warning) => /reuse-input.*digest/.test(warning)));
});

test('policy 컴파일 routing 입력 결측은 공집합 위양성 대신 구조화 error를 emit한다', () => {
  const out = run(['--stage', 'provisional', '--root', path.join(__dirname, '..')],
    { task_text: 'missing routing' });
  const error = out.errors.find((entry) => entry.code === 'routing-input-missing');
  assert.ok(error);
  assert.deepStrictEqual(error.missing, ['model_routing', 'tiers', 'pinned']);
  assert.ok(out.policy_snapshot);
});

for (const fixture of [
  { name: 'engine-auto.md', mode: 'scalar', implement: 'sonnet', tier: 'standard', pinned: {} },
  { name: 'pinned.md', mode: 'scalar', implement: 'opus', tier: 'deep', pinned: { implement: 'deep' } },
  { name: 'legacy-nested.md', mode: 'legacy-scan', implement: 'sonnet', tier: 'standard', pinned: {} },
]) {
  test(`--state-file ${fixture.name} — routing 정확성 + extraction mode`, () => {
    const stateFile = path.join(__dirname, '..', 'tests', 'fixtures', 'state-model-routing', fixture.name);
    const out = run(['--stage', 'authoritative', '--state-file', stateFile,
      '--root', path.join(__dirname, '..')], { task_text: 'state extraction' });
    assert.strictEqual(out.extraction_mode, fixture.mode);
    assert.strictEqual(out.policy_snapshot.role_routing.actual_routing.implement, fixture.implement);
    assert.strictEqual(out.policy_snapshot.routing_diff.find((row) => row.phase === 'implement').actual_tier,
      fixture.tier);
    assert.deepStrictEqual(out.routing_state.pinned, fixture.pinned);
    assert.deepStrictEqual(out.errors, []);
  });
}

test('손상 state는 stdout 구조화 errors로 fail-open하며 원본을 mutate하지 않는다', () => {
  const dir = makeWorkDir();
  const stateFile = path.join(dir, 'state.md');
  const original = '---\nsession_id: broken\nmodel_routing_json: "{bad json"\nmodel_routing_meta_json: "{}"\n---\nbody\n';
  fs.writeFileSync(stateFile, original);
  const out = run(['--stage', 'authoritative', '--state-file', stateFile,
    '--root', path.join(__dirname, '..')], { task_text: 'broken state' });
  assert.ok(out.risk_profile);
  assert.ok(out.errors.some((entry) => entry.code === 'routing-state-extraction'));
  assert.ok(out.errors.some((entry) => entry.code === 'routing-input-missing'));
  assert.strictEqual(fs.readFileSync(stateFile, 'utf8'), original);
});
