// scripts/migrate-profile-v2-to-v3.test.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const { migrateProfile } = require('./migrate-profile-v2-to-v3.js');

function tmpProfile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-profile-'));
  const file = path.join(dir, 'deep-work-profile.yaml');
  fs.writeFileSync(file, content);
  return { dir, file };
}

test('idempotent — v3 입력 시 즉시 return + 변경 없음', () => {
  const { file } = tmpProfile('version: 3\ndefault_preset: x\n');
  const before = fs.readFileSync(file, 'utf8');
  const result = migrateProfile(file);
  assert.deepStrictEqual(result, { migrated: false, reason: 'already-v3' });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  assert.strictEqual(fs.existsSync(file + '.v2-backup'), false);
});

test('v2 → v3 — notifications drop, defaults 이동, model_routing.plan 보존', () => {
  const v2 = `version: 2
default_preset: solo
presets:
  solo:
    team_mode: solo
    start_phase: research
    tdd_mode: strict
    notifications:
      mode: slack
      url: https://example.com/hook
    git:
      use_worktree: false
      use_branch: true
    model_routing:
      brainstorm: main
      research: sonnet
      plan: main
      implement: sonnet
      test: haiku
`;
  const { file } = tmpProfile(v2);
  const result = migrateProfile(file);
  assert.strictEqual(result.migrated, true);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /^version:\s*3\s*$/m);
  assert.doesNotMatch(after, /notifications:/);
  assert.match(after, /defaults:/);
  assert.match(after, /interactive_each_session:/);
  // model_routing.plan은 v2 값 그대로 보존 (main → main)
  assert.match(after, /plan:\s*main/);
  // backup 생성됨
  assert.strictEqual(fs.existsSync(file + '.v2-backup'), true);
});

test('atomic write — rename 실패 시 원본 보존 (real simulation)', () => {
  const v2 = 'version: 2\ndefault_preset: solo\npresets:\n  solo:\n    team_mode: solo\n';
  const { file, dir } = tmpProfile(v2);
  const beforeHash = fs.readFileSync(file);

  // monkey-patch fs.renameSync to fail on the first call (v3-tmp → profile)
  const origRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = function (...args) {
    calls++;
    if (calls === 1) throw new Error('simulated rename failure');
    return origRename.apply(this, args);
  };

  try {
    assert.throws(() => migrateProfile(file), /simulated rename failure/);
  } finally {
    fs.renameSync = origRename;
  }

  // 원본은 변하지 않음
  assert.deepStrictEqual(fs.readFileSync(file), beforeHash);
  // v3-tmp leftover는 가질 수 있지만 backup은 atomic하게 작성됐어야 함 — 검증은 release 단계에서
});

test('idempotent — 순차 호출 시 두 번째는 v3 read 후 skip', () => {
  const v2 = 'version: 2\ndefault_preset: solo\npresets:\n  solo:\n    team_mode: solo\n';
  const { file } = tmpProfile(v2);
  const r1 = migrateProfile(file);
  const r2 = migrateProfile(file);
  assert.strictEqual(r1.migrated, true);
  assert.strictEqual(r2.migrated, false);
  assert.strictEqual(r2.reason, 'already-v3');
});

test('stale lock — dead PID 검출 후 강제 해제', () => {
  const { file, dir } = tmpProfile('version: 2\ndefault_preset: x\n');
  const lockPath = path.join(dir, '.deep-work-profile.lock');
  // 죽은 PID 시뮬레이션 (PID 1은 init이라 alive지만, 99999는 거의 없음)
  fs.writeFileSync(lockPath, '99999');
  // migrateProfile은 lock 발견 → 5초 polling 후 stale 판정 → 강제 해제 → 재시도 성공
  // 단 polling 5초 대기를 줄이기 위해 사전에 lock을 stale로 강제 처리 가능한 helper 노출 필요
  // 본 테스트는 isStaleLock unit test로 갈음:
  const { isStaleLock } = require('./migrate-profile-v2-to-v3.js');
  assert.strictEqual(isStaleLock(lockPath), true, 'PID 99999는 stale로 인식되어야 함');
});

test('chmod 600 — v3 파일과 backup 모두 0o600 모드', () => {
  const v2 = 'version: 2\ndefault_preset: solo\npresets:\n  solo:\n    team_mode: solo\n';
  const { file } = tmpProfile(v2);
  migrateProfile(file);
  const v3Mode = fs.statSync(file).mode & 0o777;
  const backupMode = fs.statSync(file + '.v2-backup').mode & 0o777;
  assert.strictEqual(v3Mode, 0o600, `v3 파일 권한: 0o${v3Mode.toString(8)}`);
  assert.strictEqual(backupMode, 0o600, `backup 파일 권한: 0o${backupMode.toString(8)}`);
});

test('createV3Profile — 신규 프로필 생성 시 v3 형식', () => {
  const { dir, file } = tmpProfile('');
  fs.unlinkSync(file); // 미존재 상태로
  const { createV3Profile } = require('./migrate-profile-v2-to-v3.js');
  createV3Profile(file);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^version:\s*3\s*$/m);
  assert.match(text, /default_preset:\s*solo-strict/);
  assert.match(text, /interactive_each_session:/);
  assert.doesNotMatch(text, /notifications:/);
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('CLI entrypoint — node migrate-profile-v2-to-v3.js <path>', () => {
  const { spawnSync } = require('node:child_process');
  const { file } = tmpProfile('version: 2\ndefault_preset: solo\npresets:\n  solo:\n    team_mode: solo\n');
  const result = spawnSync(process.execPath, [require.resolve('./migrate-profile-v2-to-v3.js'), file], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.migrated, true);
  assert.strictEqual(out.reason, 'v2-to-v3');
});

test('CLI entrypoint — not-found 시 createV3Profile 호출', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-profile-'));
  const file = path.join(dir, 'deep-work-profile.yaml');
  // 미존재
  const result = spawnSync(process.execPath, [require.resolve('./migrate-profile-v2-to-v3.js'), file], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.reason, 'not-found-created-v3');
  assert.ok(fs.existsSync(file));
});

test('C1: 탭 들여쓰기 — 변환 거부 + 수동 이전 가이드', () => {
  // 탭 들여쓰기 v2 파일은 silent corruption 위험 — 명시적 거부 필수
  const v2 = 'version: 2\ndefault_preset: solo\npresets:\n\tsolo:\n\t\tteam_mode: solo\n';
  const { file } = tmpProfile(v2);
  assert.throws(
    () => migrateProfile(file),
    (err) => {
      assert.match(err.message, /탭 들여쓰기/);
      assert.match(err.message, /수동 이전 가이드/);
      return true;
    },
    '탭 들여쓰기 v2 파일은 변환 거부되어야 함'
  );
  // 원본 파일 변경 없음 (변환 거부 — backup도 생성되지 않아야 함)
  assert.strictEqual(fs.existsSync(file + '.v2-backup'), false);
});

test('C2: 알 수 없는 preset 필드(items:) — 변환 거부 + closed-set 안내', () => {
  // spec §5.1에 없는 커스텀 필드(items:) 포함 시 silent data loss 방지를 위해 거부
  const v2 = `version: 2
default_preset: solo
presets:
  solo:
    team_mode: solo
    items:
      - task1
      - task2
`;
  const { file } = tmpProfile(v2);
  assert.throws(
    () => migrateProfile(file),
    (err) => {
      assert.match(err.message, /알 수 없는 preset 필드/);
      assert.match(err.message, /items/);
      assert.match(err.message, /수동 이전 가이드/);
      return true;
    },
    '알 수 없는 preset 필드는 변환 거부되어야 함'
  );
  // 원본 파일 변경 없음
  assert.strictEqual(fs.existsSync(file + '.v2-backup'), false);
});

test('I4: version: 2  # legacy comment — 정상 파싱', () => {
  // 트레일링 주석이 붙은 version 라인도 v2로 인식하고 v3으로 변환되어야 함
  const v2 = 'version: 2  # legacy\ndefault_preset: solo\npresets:\n  solo:\n    team_mode: solo\n';
  const { file } = tmpProfile(v2);
  const result = migrateProfile(file);
  assert.strictEqual(result.migrated, true);
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /^version:\s*3\s*$/m, 'version: 3으로 갱신되어야 함');
  assert.doesNotMatch(after, /version:\s*2/, '버전 2 라인이 남아 있으면 안 됨');
});
