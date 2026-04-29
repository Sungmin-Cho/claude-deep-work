// scripts/parse-deep-work-flags.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseFlags } = require('./parse-deep-work-flags.js');

test('--recommender allowlist — sonnet 통과', () => {
  const r = parseFlags(['--recommender=sonnet', 'task body']);
  assert.strictEqual(r.recommender, 'sonnet');
  assert.deepStrictEqual(r.warnings, []);
});

test('--recommender 거부 + sonnet fallback + 경고', () => {
  const r = parseFlags(['--recommender=invalid', 'task']);
  assert.strictEqual(r.recommender, 'sonnet');
  assert.match(r.warnings.join('\n'), /invalid.*recommender.*sonnet으로 fallback/);
});

test('--no-ask + --recommender=opus 모순 — recommender 무시', () => {
  const r = parseFlags(['--no-ask', '--recommender=opus', 'task']);
  assert.strictEqual(r.no_ask, true);
  assert.strictEqual(r.recommender, null); // ignored
  assert.match(r.warnings.join('\n'), /--no-ask 활성.*recommender.*호출되지 않음/);
});

test('--profile=X --no-ask 호환 — 둘 다 적용', () => {
  const r = parseFlags(['--profile=solo-strict', '--no-ask', 'task']);
  assert.strictEqual(r.profile, 'solo-strict');
  assert.strictEqual(r.no_ask, true);
});

test('task 본문 — 플래그 제거 후 남은 인자', () => {
  const r = parseFlags(['--profile=x', 'fix the auth bug', 'in', 'login.ts']);
  assert.strictEqual(r.task, 'fix the auth bug in login.ts');
});

test('--recommender=../../etc/passwd 거부', () => {
  const r = parseFlags(['--recommender=../../etc/passwd', 'task']);
  assert.strictEqual(r.recommender, 'sonnet');
});

test('--no-recommender + --recommender=opus 모순 — recommender 무효화', () => {
  const r = parseFlags(['--no-recommender', '--recommender=opus', 'task']);
  assert.strictEqual(r.no_recommender, true);
  assert.strictEqual(r.recommender, null); // cleared by no-recommender precedence
});

test('--exec=inline 플래그 보존 (v6.4.0 호환)', () => {
  const r = parseFlags(['--exec=inline', 'fix bug']);
  assert.strictEqual(r.exec_mode, 'inline');
  assert.strictEqual(r.task, 'fix bug'); // task에 섞이지 않음
});

test('--exec=delegate 플래그 보존', () => {
  const r = parseFlags(['--exec=delegate', '--no-ask', 'task']);
  assert.strictEqual(r.exec_mode, 'delegate');
  assert.strictEqual(r.no_ask, true);
});

test('--exec 잘못된 값 거부 + 경고', () => {
  const r = parseFlags(['--exec=yolo', 'task']);
  assert.strictEqual(r.exec_mode, null);
  assert.match(r.warnings.join('\n'), /허용되지 않는 exec/);
});

test('--exec= 빈 값 거부 + 경고', () => {
  const r = parseFlags(['--exec=', 'task']);
  assert.strictEqual(r.exec_mode, null);
  assert.ok(r.warnings.length > 0);
});

test('--profile= 빈 값 거부 + 경고', () => {
  const r = parseFlags(['--profile=', 'task']);
  assert.strictEqual(r.profile, null);
  assert.ok(r.warnings.some(w => w.includes('빈 값')));
});

test('--profile=../../../etc 잘못된 이름 거부', () => {
  const r = parseFlags(['--profile=../../../etc', 'task']);
  assert.strictEqual(r.profile, null);
  assert.ok(r.warnings.length > 0);
});

test('-- separator skip (CLI usage 호환)', () => {
  const r = parseFlags(['--', '--no-ask', '--profile=solo-strict', 'fix', 'auth']);
  assert.strictEqual(r.no_ask, true);
  assert.strictEqual(r.profile, 'solo-strict');
  assert.strictEqual(r.task, 'fix auth');
});

test('recommender 미지정 + no-options 없음 → 기본 sonnet', () => {
  const r = parseFlags(['some task']);
  assert.strictEqual(r.recommender, 'sonnet');
});

test('--no-recommender 단독 → recommender null', () => {
  const r = parseFlags(['--no-recommender', 'task']);
  assert.strictEqual(r.no_recommender, true);
  assert.strictEqual(r.recommender, null);
});

test('--no-ask 단독 → recommender null (no-ask blocks default)', () => {
  const r = parseFlags(['--no-ask', 'task']);
  assert.strictEqual(r.no_ask, true);
  assert.strictEqual(r.recommender, null);
});

test('--recommender=haiku 통과', () => {
  const r = parseFlags(['--recommender=haiku', 'task']);
  assert.strictEqual(r.recommender, 'haiku');
  assert.deepStrictEqual(r.warnings, []);
});

test('--recommender=opus 통과', () => {
  const r = parseFlags(['--recommender=opus', 'task']);
  assert.strictEqual(r.recommender, 'opus');
  assert.deepStrictEqual(r.warnings, []);
});

test('CLI entrypoint — node parse-deep-work-flags.js -- ...', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [require.resolve('./parse-deep-work-flags.js'), '--', '--no-ask', '--profile=solo-strict', 'fix', 'auth'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout.trim());
  assert.strictEqual(out.no_ask, true);
  assert.strictEqual(out.profile, 'solo-strict');
  assert.strictEqual(out.task, 'fix auth');
});
