const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPhaseGuard, parseGuardOutput } = require('./test-helpers/run-phase-guard');

// e2e: harness가 tool_name/tool_input을 env(CLAUDE_TOOL_USE_TOOL_NAME) 대신
// stdin JSON 최상위 키로 전달하는 경우의 fallback 파싱.
//
// 계약 (docs/handoff/2026-07-10-phase-guard-toolname-stdin-fallback.md):
//   - env 미설정 시 stdin payload의 `tool_name`을 읽고, 중첩 `tool_input`을 unwrap
//   - env가 설정된 기존 하네스(flat payload)는 동작 불변 (회귀 없음)
//   - TDD 강제 로직 자체는 불변 — production 파일 차단(#3)이 그 증거
//
// runPhaseGuard의 toolName 옵션을 생략하면 env가 설정되지 않으므로
// (scrubHostEnv가 호스트 leak도 제거), stdin-only 하네스 계약이 재현된다.

function writeImplementState(tmpDir, sid) {
  fs.writeFileSync(
    path.join(tmpDir, '.claude', `deep-work.${sid}.md`),
    '---\ncurrent_phase: implement\nwork_dir: .deep-work/wd\nactive_slice: SLICE-001\ntdd_mode: strict\ntdd_state: PENDING\n---\n'
  );
  fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
}

describe('e2e: stdin JSON tool_name/tool_input fallback (env unset)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-stdin-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('#1 Bash 조회 명령은 허용된다 (implement/PENDING에서도)', () => {
    const sid = 's-stdin1';
    writeImplementState(tmpDir, sid);

    const result = runPhaseGuard({
      cwd: tmpDir,
      env: { DEEP_WORK_SESSION_ID: sid },
      toolInput: { tool_name: 'Bash', tool_input: { command: 'true' } },
    });

    assert.equal(result.status, 0, `expected allow (exit 0), got ${result.status}: ${result.stdout} ${result.stderr}`);
    const parsed = parseGuardOutput(result.stdout);
    assert.ok(!parsed || parsed.decision !== 'block', `unexpected block:\n${result.stdout}`);
  });

  it('#2 테스트 파일 Write는 허용된다', () => {
    const sid = 's-stdin2';
    writeImplementState(tmpDir, sid);

    const result = runPhaseGuard({
      cwd: tmpDir,
      env: { DEEP_WORK_SESSION_ID: sid },
      toolInput: { tool_name: 'Write', tool_input: { file_path: 'tests/unit/test_x.py', content: 'x' } },
    });

    assert.equal(result.status, 0, `expected allow (exit 0), got ${result.status}: ${result.stdout} ${result.stderr}`);
  });

  it('#3 production 파일 Write는 여전히 차단된다 (TDD 강제 로직 보존 증거)', () => {
    const sid = 's-stdin3';
    writeImplementState(tmpDir, sid);

    const result = runPhaseGuard({
      cwd: tmpDir,
      env: { DEEP_WORK_SESSION_ID: sid },
      toolInput: { tool_name: 'Write', tool_input: { file_path: 'src/pkg/mod.py', content: 'x' } },
    });

    assert.equal(result.status, 2, `expected block (exit 2), got ${result.status}: ${result.stdout} ${result.stderr}`);
    const parsed = parseGuardOutput(result.stdout);
    assert.ok(parsed, `block message not valid JSON:\n${result.stdout}`);
    assert.equal(parsed.decision, 'block');
    // 빈 file_path로 오분류된 차단이 아니라, 실제 파일 경로를 인지한 차단이어야 한다.
    assert.ok(parsed.reason.includes('src/pkg/mod.py'), `reason should contain the file path, got:\n${parsed.reason}`);
  });

  it('#4 exempt(.md) 파일 Edit는 허용된다', () => {
    const sid = 's-stdin4';
    writeImplementState(tmpDir, sid);

    const result = runPhaseGuard({
      cwd: tmpDir,
      env: { DEEP_WORK_SESSION_ID: sid },
      toolInput: {
        tool_name: 'Edit',
        tool_input: { file_path: `.claude/deep-work.${sid}.md`, old_string: 'a', new_string: 'b' },
      },
    });

    assert.equal(result.status, 0, `expected allow (exit 0), got ${result.status}: ${result.stdout} ${result.stderr}`);
  });
});

describe('e2e: env가 설정된 기존 하네스는 회귀 없음', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-stdin-env-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('env 설정 + flat payload(구 형식): production Write 차단 유지', () => {
    const sid = 's-env1';
    writeImplementState(tmpDir, sid);

    const result = runPhaseGuard({
      cwd: tmpDir,
      env: { DEEP_WORK_SESSION_ID: sid },
      toolName: 'Write',
      toolInput: { file_path: 'src/pkg/mod.py', content: 'x' },
    });

    assert.equal(result.status, 2, `expected block (exit 2), got ${result.status}: ${result.stdout} ${result.stderr}`);
    const parsed = parseGuardOutput(result.stdout);
    assert.equal(parsed && parsed.decision, 'block');
    assert.ok(parsed.reason.includes('src/pkg/mod.py'), `reason should contain the file path, got:\n${parsed.reason}`);
  });

  it('env 설정 + wrapper payload(신 형식 하이브리드): tool_input이 unwrap되어 파일 경로를 인지한다', () => {
    const sid = 's-env2';
    writeImplementState(tmpDir, sid);

    const result = runPhaseGuard({
      cwd: tmpDir,
      env: { DEEP_WORK_SESSION_ID: sid },
      toolName: 'Write',
      toolInput: { tool_name: 'Write', tool_input: { file_path: 'src/pkg/mod.py', content: 'x' } },
    });

    assert.equal(result.status, 2, `expected block (exit 2), got ${result.status}: ${result.stdout} ${result.stderr}`);
    const parsed = parseGuardOutput(result.stdout);
    assert.equal(parsed && parsed.decision, 'block');
    assert.ok(parsed.reason.includes('src/pkg/mod.py'), `reason should contain the unwrapped file path, got:\n${parsed.reason}`);
  });
});
