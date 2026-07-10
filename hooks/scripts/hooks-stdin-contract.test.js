const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { scrubHostEnv } = require('./test-helpers/run-phase-guard');

// v6.9.4 (deep-review D-2): env 우선 → stdin wrapper fallback 로직을 utils.sh
// 공유 헬퍼(resolve_hook_tool_context)로 추출하고 file-tracker.sh /
// phase-transition.sh가 wrapper 계약을 지원하는지 검증한다.
//
// 계약 (docs/handoff/2026-07-10-phase-guard-toolname-stdin-fallback.md):
//   - env(CLAUDE_TOOL_USE_TOOL_NAME/CLAUDE_TOOL_NAME) 설정 시 payload 무교체 (R1-1)
//   - env 미설정 시에만 stdin payload의 tool_name을 읽고 중첩 tool_input을 unwrap
//   - malformed JSON은 fail-open (이름 빈 문자열 + 입력 원본 유지 — D-1에서
//     stdin 계약 1차 승격 시 fail-closed로 전환 예정)

const UTILS = path.resolve(__dirname, 'utils.sh');
const FILE_TRACKER = path.resolve(__dirname, 'file-tracker.sh');
const PHASE_TRANSITION = path.resolve(__dirname, 'phase-transition.sh');

// utils.sh를 source한 뒤 헬퍼를 호출하고 결과 전역 2개를 US(0x1f) 구분자로 출력.
function runHelper(rawInput, extraEnv = {}) {
  const result = spawnSync(
    'bash',
    ['-c', 'source "$1"; resolve_hook_tool_context "$2"; printf "%s\\x1f%s" "$HOOK_TOOL_NAME" "$HOOK_TOOL_INPUT"', '_', UTILS, rawInput],
    { encoding: 'utf8', env: scrubHostEnv(extraEnv), timeout: 8000 }
  );
  assert.equal(result.status, 0, `helper spawn failed: ${result.stderr}`);
  const sep = result.stdout.indexOf('\x1f');
  assert.ok(sep !== -1, `missing separator in helper output: ${result.stdout}`);
  return { name: result.stdout.slice(0, sep), input: result.stdout.slice(sep + 1) };
}

describe('utils.sh resolve_hook_tool_context (shared helper)', () => {
  it('env 미설정 + wrapper: tool_name 복원 + tool_input unwrap', () => {
    const wrapper = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'a/b.ts', content: 'x' },
    });
    const r = runHelper(wrapper);
    assert.equal(r.name, 'Write');
    assert.deepEqual(JSON.parse(r.input), { file_path: 'a/b.ts', content: 'x' });
  });

  it('env 설정: wrapper 형태여도 payload 무교체 (R1-1 회귀 방지)', () => {
    const wrapper = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'a/b.ts' },
    });
    const r = runHelper(wrapper, { CLAUDE_TOOL_USE_TOOL_NAME: 'Edit' });
    assert.equal(r.name, 'Edit', 'env가 payload의 tool_name을 이겨야 한다');
    assert.equal(r.input, wrapper, 'env 설정 시 절대 unwrap하지 않는다');
  });

  it('env 미설정 + flat payload: 이름 빈 문자열, 입력 원본 유지', () => {
    const flat = JSON.stringify({ file_path: 'a/b.ts', content: 'x' });
    const r = runHelper(flat);
    assert.equal(r.name, '');
    assert.equal(r.input, flat);
  });

  it('env 미설정 + malformed JSON: fail-open (이름 빈 문자열 + 입력 원본)', () => {
    const r = runHelper('{not json');
    assert.equal(r.name, '');
    assert.equal(r.input, '{not json');
  });

  it('env 미설정 + wrapper(tool_input이 객체가 아님): 이름만 복원, 입력 원본 유지', () => {
    const wrapper = JSON.stringify({ tool_name: 'Bash', tool_input: 'true' });
    const r = runHelper(wrapper);
    assert.equal(r.name, 'Bash');
    assert.equal(r.input, wrapper);
  });

  it('payload에 제어 문자가 있어도 US 구분자와 충돌하지 않는다', () => {
    const wrapper = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'a.ts', content: 'x\x1fy' },
    });
    const r = runHelper(wrapper);
    assert.equal(r.name, 'Write');
    assert.equal(JSON.parse(r.input).content, 'x\x1fy');
  });
});

// ─── file-tracker.sh / phase-transition.sh 통합 ─────────────────────────

function writeStateFile(tmpDir, sid, fields) {
  const yaml = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  const filePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
  fs.writeFileSync(filePath, `---\n${yaml}\n---\n`);
  return filePath;
}

function writePointerFile(tmpDir, sid) {
  fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
}

function runHook(script, { cwd, input = '', env = {} }) {
  return spawnSync('bash', [script], {
    input,
    cwd,
    env: scrubHostEnv(env),
    encoding: 'utf8',
    timeout: 10000,
  });
}

function readCache(tmpDir) {
  const files = fs
    .readdirSync(path.join(tmpDir, '.claude'))
    .filter((f) => f.startsWith('.hook-tool-input.') && !f.includes('.tmp.'));
  assert.equal(files.length, 1, `expected exactly one cache file, got: ${files}`);
  return fs.readFileSync(path.join(tmpDir, '.claude', files[0]), 'utf8');
}

describe('file-tracker.sh: env 미설정 wrapper 계약', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-stdin-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('wrapper stdin → 캐시에는 unwrap된 flat tool_input이 담긴다', () => {
    const sid = 's-ft1';
    const stateFile = writeStateFile(tmpDir, sid, { current_phase: 'plan', team_mode: 'solo' });
    writePointerFile(tmpDir, sid);

    const result = runHook(FILE_TRACKER, {
      cwd: tmpDir,
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: stateFile, content: 'x' },
      }),
    });
    assert.equal(result.status, 0, `file-tracker failed: ${result.stderr}`);

    const cached = JSON.parse(readCache(tmpDir));
    assert.equal(cached.file_path, stateFile, '캐시는 flat tool_input이어야 한다');
    assert.ok(!('tool_input' in cached), '캐시에 wrapper 키가 남으면 안 된다');
  });

  it('env 설정 + flat stdin(기존 하네스): 캐시 원본 유지 (회귀 없음)', () => {
    const sid = 's-ft2';
    const stateFile = writeStateFile(tmpDir, sid, { current_phase: 'plan', team_mode: 'solo' });
    writePointerFile(tmpDir, sid);

    const flat = JSON.stringify({ file_path: stateFile, content: 'x' });
    const result = runHook(FILE_TRACKER, {
      cwd: tmpDir,
      input: flat,
      env: { CLAUDE_TOOL_USE_TOOL_NAME: 'Write' },
    });
    assert.equal(result.status, 0, `file-tracker failed: ${result.stderr}`);
    assert.equal(readCache(tmpDir), flat);
  });
});

describe('e2e: PreToolUse→PostToolUse env-unset 체인 (D-2 통합 계약)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-stdin-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('wrapper stdin: file-tracker 캐시 → phase-transition 주입까지 동작한다', () => {
    const sid = 's-chain1';
    const stateFile = writeStateFile(tmpDir, sid, {
      current_phase: 'plan',
      worktree_enabled: 'true',
      worktree_path: '"/tmp/wt/chain"',
      team_mode: 'team',
    });
    writePointerFile(tmpDir, sid);

    // PostToolUse hook 배열 순서 재현: file-tracker가 stdin(wrapper)을 소비·캐시하고,
    // phase-transition은 빈 stdin + env 미설정으로 캐시에서 입력을 읽는다.
    const ft = runHook(FILE_TRACKER, {
      cwd: tmpDir,
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: stateFile, content: 'x' },
      }),
    });
    assert.equal(ft.status, 0, `file-tracker failed: ${ft.stderr}`);

    const pt = runHook(PHASE_TRANSITION, { cwd: tmpDir, input: '' });
    assert.equal(pt.status, 0, `phase-transition failed: ${pt.stderr}`);
    assert.ok(pt.stdout.includes('Phase Transition'),
      `wrapper 하네스에서 phase 전환 주입이 누락되면 안 된다:\n${pt.stdout}`);
    assert.ok(pt.stdout.includes('worktree_path'), pt.stdout);
    assert.ok(pt.stdout.includes('team_mode: team'), pt.stdout);
  });

  it('defense-in-depth: env로 wrapper가 직접 오는 경우도 phase-transition이 unwrap한다', () => {
    const sid = 's-chain2';
    const stateFile = writeStateFile(tmpDir, sid, {
      current_phase: 'implement',
      tdd_mode: 'strict',
      team_mode: 'solo',
    });
    writePointerFile(tmpDir, sid);

    // tool-name env 미설정 + CLAUDE_TOOL_INPUT이 wrapper 형태인 비정형 하네스.
    const pt = runHook(PHASE_TRANSITION, {
      cwd: tmpDir,
      input: '',
      env: {
        CLAUDE_TOOL_INPUT: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: stateFile, content: 'x' },
        }),
      },
    });
    assert.equal(pt.status, 0, `phase-transition failed: ${pt.stderr}`);
    assert.ok(pt.stdout.includes('Phase Transition'), pt.stdout);
    assert.ok(pt.stdout.includes('tdd_mode: strict'), pt.stdout);
  });
});
