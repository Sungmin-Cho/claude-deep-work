// scripts/recommender-input.test.js
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeInput, MAX_TASK_BYTES, MAX_COMMITS, MAX_DIRS } = require('./recommender-input.js');

test('task_description 2KB cap + [truncated] marker', () => {
  const longTask = 'x'.repeat(5000);
  const out = sanitizeInput({ task_description: longTask, recent_commits: [], top_level_dirs: [] });
  assert.ok(Buffer.byteLength(out.task_description, 'utf8') <= MAX_TASK_BYTES + '[truncated]'.length);
  assert.match(out.task_description, /\[truncated\]$/);
});

test('UTF-8 multi-byte 경계 보정 — mojibake 부재', () => {
  const koreanTask = '한글텍스트입니다'.repeat(500); // ~9000 bytes
  const out = sanitizeInput({ task_description: koreanTask, recent_commits: [], top_level_dirs: [] });
  // U+FFFD (replacement char)가 들어있으면 multi-byte 경계에서 잘린 것
  assert.ok(!out.task_description.includes('�'), 'replacement char (U+FFFD) 부재');
  assert.match(out.task_description, /\[truncated\]$/);
});

test('recent_commits 5개 cap (workspace_meta 안)', () => {
  const commits = Array.from({length: 10}, (_, i) => `subject ${i}`);
  const out = sanitizeInput({ task_description: 'x', recent_commits: commits, top_level_dirs: [] });
  assert.strictEqual(out.workspace_meta.recent_commits.length, MAX_COMMITS);
});

test('top_level_dirs 10개 cap + 30자 truncate + 비정상 경로 제외 (workspace_meta 안)', () => {
  const dirs = ['src', '../etc', '/abs/path', 'a'.repeat(50), ...Array.from({length: 15}, (_, i) => `d${i}`)];
  const out = sanitizeInput({ task_description: 'x', recent_commits: [], top_level_dirs: dirs });
  assert.ok(out.workspace_meta.top_level_dirs.length <= MAX_DIRS);
  assert.ok(out.workspace_meta.top_level_dirs.every(d => d.length <= 30));
  assert.ok(!out.workspace_meta.top_level_dirs.includes('../etc'));
  assert.ok(!out.workspace_meta.top_level_dirs.includes('/abs/path'));
});

test('git_status caller-provided', () => {
  const out = sanitizeInput({ task_description: 'x', recent_commits: [], top_level_dirs: [], git_status: 'dirty' });
  assert.strictEqual(out.workspace_meta.git_status, 'dirty');
});

test('top_level_dirs 빈 문자열 제거 — empty string filtered out', () => {
  const out = sanitizeInput({ task_description: 'x', recent_commits: [], top_level_dirs: ['src', '', null, 'tests'] });
  assert.deepStrictEqual(out.workspace_meta.top_level_dirs, ['src', 'tests']);
});

test('CLI entrypoint — stdin → stdout JSON', () => {
  const { spawnSync } = require('node:child_process');
  const input = JSON.stringify({ task_description: 'fix auth bug', recent_commits: ['initial commit'], top_level_dirs: ['src','tests'] });
  const result = spawnSync(process.execPath, [require.resolve('./recommender-input.js')], { input, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.task_description, 'fix auth bug');
  assert.strictEqual(out.workspace_meta.recent_commits.length, 1);
});
