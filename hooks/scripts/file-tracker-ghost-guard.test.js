// Regression tests for the Windows/Git Bash "ghost .claude folder" bug.
//
// Root cause (v<=6.9.0): file-tracker.sh cached the tool input via
//   mkdir -p "$(dirname "$PROJECT_ROOT/.claude/.hook-tool-input.$PPID")"
// BEFORE any session/state check, on every PostToolUse in any directory.
// When $PROJECT_ROOT was tainted (a CRLF `\r` or backslash-separated $PWD
// on Windows Git Bash, or a multi-line value from the old `|| echo "$PWD"`
// double-emit), that mkdir materialized a bogus directory tree such as
//   pop-studio-suite <CR>/d/NHN/PopStudio/POP-GIT/pop-studio-suite/.claude/
//
// Fixes: (1) sanitize_project_path() strips CR/backslashes/trailing space at
// the single point PROJECT_ROOT is derived; (2) file-tracker.sh only writes
// the cache when $PROJECT_ROOT/.claude already exists (never mkdir a fresh
// tree). These tests pin both.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'file-tracker.sh');
const UTILS = path.resolve(__dirname, 'utils.sh');

describe('sanitize_project_path (utils.sh)', () => {
  function sanitize(input) {
    // Source utils.sh, call the helper with the raw arg, print result.
    const body = `source "${UTILS}"; sanitize_project_path "$1"`;
    return execFileSync('bash', ['-c', body, 'bash', input], { encoding: 'utf8' });
  }

  it('strips a trailing CR (Windows CRLF artifact)', () => {
    const out = sanitize('/d/NHN/PopStudio/POP-GIT/pop-studio-suite\r');
    assert.equal(out, '/d/NHN/PopStudio/POP-GIT/pop-studio-suite');
    assert.ok(!out.includes('\r'), 'no CR should survive');
  });

  it('strips CR that lands mid-path (e.g. before a segment)', () => {
    const out = sanitize('/d/proj\r/sub');
    assert.equal(out, '/d/proj/sub');
  });

  it('folds backslashes to forward slashes', () => {
    const out = sanitize('D:\\NHN\\PopStudio\\pop-studio-suite');
    assert.equal(out, 'D:/NHN/PopStudio/pop-studio-suite');
  });

  it('trims trailing whitespace (the "space folder" symptom)', () => {
    const out = sanitize('/d/proj/pop-studio-suite   ');
    assert.equal(out, '/d/proj/pop-studio-suite');
  });

  it('is a no-op for a clean POSIX path', () => {
    const out = sanitize('/home/user/project');
    assert.equal(out, '/home/user/project');
  });
});

describe('find_project_root (utils.sh) never emits a multi-line value', () => {
  it('emits exactly one line even when no .claude ancestor exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-noroot-'));
    try {
      // Run from a dir with no .claude anywhere up the tree branch we control.
      // find_project_root returns exit 1 on the not-found path (by design);
      // capture stdout regardless — the invariant under test is single-line.
      const body = `source "${UTILS}"; find_project_root || true`;
      const out = execFileSync('bash', ['-c', body], { cwd: tmp, encoding: 'utf8' });
      const lines = out.split('\n').filter(Boolean);
      assert.equal(lines.length, 1, `expected 1 line, got ${lines.length}: ${JSON.stringify(out)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('file-tracker.sh ghost-folder guard', () => {
  let tmpDir;

  beforeEach(() => {
    // Deliberately NO .claude — simulate a PostToolUse fired outside any
    // deep-work session (the amplifier path that created ghost trees).
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ghost-'));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not create a .claude tree when run outside a session', () => {
    execFileSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: path.join(tmpDir, 'src.js') }),
      cwd: tmpDir,
      env: { ...process.env, CLAUDE_TOOL_USE_TOOL_NAME: 'Write' },
      encoding: 'utf8',
      timeout: 5000,
    });

    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.claude')),
      'file-tracker must not materialize a .claude directory when none exists'
    );
    // Nothing at all should have been written into the bare working dir.
    assert.deepEqual(
      fs.readdirSync(tmpDir),
      [],
      'no cache/ghost artifacts should be created outside a session'
    );
  });

  it('still caches the tool input when .claude already exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });

    execFileSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: path.join(tmpDir, 'src.js') }),
      cwd: tmpDir,
      env: { ...process.env, CLAUDE_TOOL_USE_TOOL_NAME: 'Write' },
      encoding: 'utf8',
      timeout: 5000,
    });

    const cached = fs
      .readdirSync(path.join(tmpDir, '.claude'))
      .filter((n) => n.startsWith('.hook-tool-input.'));
    assert.ok(cached.length >= 1, 'expected a cached tool-input file inside existing .claude');
  });
});
