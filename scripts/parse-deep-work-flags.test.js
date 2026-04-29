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

// ── I1: --tdd= allowlist validation ──
test('--tdd=strict 통과', () => {
  const r = parseFlags(['--tdd=strict', 'task']);
  assert.strictEqual(r.tdd_mode, 'strict');
  assert.deepStrictEqual(r.warnings, []);
});

test('--tdd=relaxed 통과', () => {
  const r = parseFlags(['--tdd=relaxed', 'task']);
  assert.strictEqual(r.tdd_mode, 'relaxed');
  assert.deepStrictEqual(r.warnings, []);
});

test('--tdd=coaching 통과', () => {
  const r = parseFlags(['--tdd=coaching', 'task']);
  assert.strictEqual(r.tdd_mode, 'coaching');
  assert.deepStrictEqual(r.warnings, []);
});

test('--tdd=spike 통과', () => {
  const r = parseFlags(['--tdd=spike', 'task']);
  assert.strictEqual(r.tdd_mode, 'spike');
  assert.deepStrictEqual(r.warnings, []);
});

test('--tdd=garbage 거부 + 경고', () => {
  const r = parseFlags(['--tdd=garbage', 'task']);
  assert.strictEqual(r.tdd_mode, null);
  assert.ok(r.warnings.some(w => w.includes('허용되지 않는 tdd 모드')));
  assert.ok(r.warnings.some(w => w.includes('garbage')));
});

test('--tdd= 빈 값 거부 + 경고', () => {
  const r = parseFlags(['--tdd=', 'task']);
  assert.strictEqual(r.tdd_mode, null);
  assert.ok(r.warnings.some(w => w.includes('--tdd=') && w.includes('빈 값')));
});

// ── I2: --resume-from= allowlist validation ──
test('--resume-from=research 통과', () => {
  const r = parseFlags(['--resume-from=research', 'task']);
  assert.strictEqual(r.resume_from, 'research');
  assert.deepStrictEqual(r.warnings, []);
});

test('--resume-from=plan 통과', () => {
  const r = parseFlags(['--resume-from=plan', 'task']);
  assert.strictEqual(r.resume_from, 'plan');
  assert.deepStrictEqual(r.warnings, []);
});

test('--resume-from=implement 통과', () => {
  const r = parseFlags(['--resume-from=implement', 'task']);
  assert.strictEqual(r.resume_from, 'implement');
  assert.deepStrictEqual(r.warnings, []);
});

test('--resume-from=test 통과', () => {
  const r = parseFlags(['--resume-from=test', 'task']);
  assert.strictEqual(r.resume_from, 'test');
  assert.deepStrictEqual(r.warnings, []);
});

test('--resume-from=brainstorm 통과 (v6.3.1 F1 Exit Gate 호환)', () => {
  const r = parseFlags(['--resume-from=brainstorm', 'task']);
  assert.strictEqual(r.resume_from, 'brainstorm');
  assert.deepStrictEqual(r.warnings, []);
});

test('--resume-from=invalid 거부 + 경고', () => {
  const r = parseFlags(['--resume-from=invalid', 'task']);
  assert.strictEqual(r.resume_from, null);
  assert.ok(r.warnings.some(w => w.includes('허용되지 않는 resume phase')));
});

test('--resume-from= 빈 값 거부 + 경고', () => {
  const r = parseFlags(['--resume-from=', 'task']);
  assert.strictEqual(r.resume_from, null);
  assert.ok(r.warnings.some(w => w.includes('--resume-from=') && w.includes('빈 값')));
});

// ── C1: 신규 플래그 --session= --worktree= --cross-model --force-rerun ──
test('--session=abc-123 통과 (alphanumeric/dash)', () => {
  const r = parseFlags(['--session=abc-123', 'task']);
  assert.strictEqual(r.session, 'abc-123');
  assert.deepStrictEqual(r.warnings, []);
});

test('--session=my.session.1 통과 (dot 포함)', () => {
  const r = parseFlags(['--session=my.session.1', 'task']);
  assert.strictEqual(r.session, 'my.session.1');
  assert.deepStrictEqual(r.warnings, []);
});

test('--session=bad;injection 거부 + 경고', () => {
  const r = parseFlags(['--session=bad;injection', 'task']);
  assert.strictEqual(r.session, null);
  assert.ok(r.warnings.some(w => w.includes('잘못된 session ID')));
});

test('--session= 빈 값 거부 + 경고', () => {
  const r = parseFlags(['--session=', 'task']);
  assert.strictEqual(r.session, null);
  assert.ok(r.warnings.some(w => w.includes('--session=') && w.includes('빈 값')));
});

test('--worktree=/path/to/tree 통과', () => {
  const r = parseFlags(['--worktree=/path/to/tree', 'task']);
  assert.strictEqual(r.worktree, '/path/to/tree');
  assert.deepStrictEqual(r.warnings, []);
});

test('--worktree=../relative/path 통과 (상대 경로 허용)', () => {
  const r = parseFlags(['--worktree=../relative/path', 'task']);
  assert.strictEqual(r.worktree, '../relative/path');
  assert.deepStrictEqual(r.warnings, []);
});

test('--worktree=/path;rm -rf 거부 + 경고 (shell injection)', () => {
  const r = parseFlags(['--worktree=/path;rm -rf', 'task']);
  assert.strictEqual(r.worktree, null);
  assert.ok(r.warnings.some(w => w.includes('잘못된 worktree 경로')));
});

test('--worktree= 빈 값 거부 + 경고', () => {
  const r = parseFlags(['--worktree=', 'task']);
  assert.strictEqual(r.worktree, null);
  assert.ok(r.warnings.some(w => w.includes('--worktree=') && w.includes('빈 값')));
});

test('--cross-model 플래그 인식', () => {
  const r = parseFlags(['--cross-model', 'task']);
  assert.strictEqual(r.cross_model, true);
  assert.strictEqual(r.no_cross_model, false);
  assert.deepStrictEqual(r.warnings, []);
});

test('--no-cross-model 플래그 인식', () => {
  const r = parseFlags(['--no-cross-model', 'task']);
  assert.strictEqual(r.no_cross_model, true);
  assert.strictEqual(r.cross_model, false);
  assert.deepStrictEqual(r.warnings, []);
});

test('--force-rerun 플래그 인식', () => {
  const r = parseFlags(['--force-rerun', 'task']);
  assert.strictEqual(r.force_rerun, true);
  assert.deepStrictEqual(r.warnings, []);
});

test('--session + --worktree + --force-rerun 조합 통과', () => {
  const r = parseFlags(['--session=sess-1', '--worktree=/tmp/wt', '--force-rerun', 'fix bug']);
  assert.strictEqual(r.session, 'sess-1');
  assert.strictEqual(r.worktree, '/tmp/wt');
  assert.strictEqual(r.force_rerun, true);
  assert.strictEqual(r.task, 'fix bug');
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
