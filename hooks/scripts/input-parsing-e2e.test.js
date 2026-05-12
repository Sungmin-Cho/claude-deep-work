const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { scrubHostEnv } = require('./test-helpers/run-phase-guard');

// §9.2 W-R2.2 (M5.5.X): host-env scrub via shared helper to prevent a
// leaked DEEP_WORK_SESSION_ID / DEEP_WORK_ROOT from a developer shell
// redirecting state-file lookup away from tmpDir.

const HOOKS = path.resolve(__dirname);

describe('e2e: file_path with escaped quotes does not break hooks', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-e2e-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('phase-guard.sh: escaped-quote path is parsed correctly (no spurious block)', () => {
    const sid = 's-esc1';
    // current_phase=research means Write outside worktree normally blocks; but
    // this test sets worktree disabled + phase=idle to isolate the parsing check:
    // if parsing works, no file_path-based block logic fires; if parsing is broken
    // (grep truncates at \"), the fallback behavior may differ.
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(statePath, '---\ncurrent_phase: idle\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);

    const filePath = path.join(tmpDir, 'a "b" c.txt');
    const env = {
      ...scrubHostEnv(),
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };
    const result = spawnSync('bash', [path.join(HOOKS, 'phase-guard.sh')], {
      input: JSON.stringify({ file_path: filePath }),
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });

    // idle phase → always exit 0 (allow). No block reason.
    assert.equal(result.status, 0, `unexpected non-zero exit: ${result.stdout} ${result.stderr}`);
    assert.equal(result.stdout.trim(), '');
  });

  it('phase-guard.sh: block message is valid JSON even when path contains quotes', () => {
    const sid = 's-esc2';
    // Setup: current_phase=research (non-implement) + a file_path with quotes
    // should block AND produce a parseable JSON block message.
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(statePath, '---\ncurrent_phase: research\nwork_dir: .deep-work/test\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);

    const filePath = path.join(tmpDir, 'src with "quotes".js');
    const env = {
      ...scrubHostEnv(),
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };
    const result = spawnSync('bash', [path.join(HOOKS, 'phase-guard.sh')], {
      input: JSON.stringify({ file_path: filePath }),
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });

    assert.equal(result.status, 2, `expected block (exit 2), got ${result.status}: ${result.stdout} ${result.stderr}`);
    // stdout must be a valid JSON object
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout.trim()); }, `block message not valid JSON:\n${result.stdout}`);
    assert.equal(parsed.decision, 'block');
    // The file path (unescaped) must appear in the reason
    assert.ok(parsed.reason.includes(filePath), `reason should contain the file path unchanged, got:\n${parsed.reason}`);
  });

  it('file-tracker.sh: escaped-quote path is recorded in receipt verbatim', () => {
    const sid = 's-esc3';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(
      statePath,
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/wd\nactive_slice: SLICE-001\n---\n'
    );
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);

    const filePath = path.join(tmpDir, 'edge "quoted".py');
    const env = {
      ...scrubHostEnv(),
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };
    execFileSync('bash', [path.join(HOOKS, 'file-tracker.sh')], {
      input: JSON.stringify({ file_path: filePath }),
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });

    const receiptPath = path.join(tmpDir, '.deep-work', 'wd', 'receipts', 'SLICE-001.json');
    assert.ok(fs.existsSync(receiptPath), `receipt not created at ${receiptPath}`);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(
      receipt.changes.files_modified.includes(filePath),
      `receipt should contain the full escaped-quote path. Got:\n${JSON.stringify(receipt.changes.files_modified)}`
    );
  });

  it('phase-transition.sh: escaped-quote path in unrelated write does not crash', () => {
    // phase-transition only acts on .claude/deep-work.{sid}.md writes; a
    // regular file with quotes in its name must be a quick no-op exit 0.
    const env = { ...scrubHostEnv(), CLAUDE_TOOL_USE_INPUT: JSON.stringify({ file_path: '/tmp/x "q" y.txt' }) };
    const result = spawnSync('bash', [path.join(HOOKS, 'phase-transition.sh')], {
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });
});

describe('e2e: phase-transition.sh handles fork worktree paths', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-fork-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('fork path containing deep-work. twice: session_id is the innermost segment', () => {
    const childSid = 's-fork-child';
    const nestedDir = path.join(tmpDir, '.deep-work', 'sessions', 'deep-work.s-parent', 'sub', '.claude');
    fs.mkdirSync(nestedDir, { recursive: true });
    const statePath = path.join(nestedDir, `deep-work.${childSid}.md`);
    fs.writeFileSync(statePath, '---\ncurrent_phase: plan\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), childSid);

    const env = { ...scrubHostEnv(), CLAUDE_TOOL_USE_INPUT: JSON.stringify({ file_path: statePath }) };
    const result = spawnSync('bash', [path.join(HOOKS, 'phase-transition.sh')], {
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    // The cache file must be named correctly — no slashes inside SESSION_ID
    const entries = fs.readdirSync(path.join(tmpDir, '.claude'));
    const cacheFiles = entries.filter(e => e.startsWith('.phase-cache-'));
    assert.equal(cacheFiles.length, 1, `expected 1 cache file, got: ${JSON.stringify(cacheFiles)}`);
    assert.equal(cacheFiles[0], `.phase-cache-${childSid}`);
  });
});
