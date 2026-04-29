'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatOptions, capabilityToDisabled } = require('./format-ask-options.js');

test('추천 != default — 추천 첫 옵션 + default 두 번째', () => {
  const opts = formatOptions({
    item: 'tdd_mode',
    recommendation: { value: 'spike', reason: 'PoC 키워드 감지' },
    default_value: 'strict',
    enum_values: ['strict', 'coaching', 'relaxed', 'spike']
  });
  assert.strictEqual(opts[0].label, 'spike (추천) — PoC 키워드 감지');
  assert.strictEqual(opts[1].label, 'strict (default)');
});

test('추천 == default — "(추천 = default)" 라벨', () => {
  const opts = formatOptions({
    item: 'tdd_mode',
    recommendation: { value: 'strict', reason: '표준 흐름' },
    default_value: 'strict',
    enum_values: ['strict', 'coaching', 'relaxed', 'spike']
  });
  assert.match(opts[0].label, /strict \(추천 = default\) — 표준 흐름/);
});

test('추천 실패 — "(default)" 라벨 + header 보강', () => {
  const opts = formatOptions({
    item: 'tdd_mode',
    recommendation: null,
    default_value: 'strict',
    enum_values: ['strict', 'coaching', 'relaxed', 'spike']
  });
  assert.strictEqual(opts[0].label, 'strict (default)');
});

test('capability false — 비활성 옵션 제외', () => {
  const opts = formatOptions({
    item: 'team_mode',
    recommendation: { value: 'solo', reason: '단일 모듈' },
    default_value: 'solo',
    enum_values: ['solo', 'team'],
    disabled_values: ['team']
  });
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0].value, 'solo');
});

test('default_value가 disabled에 있을 때 → allowed 첫 값을 새 default로', () => {
  // 비-git 환경: worktree, new-branch 모두 disabled, current-branch만 가능
  const opts = formatOptions({
    item: 'git',
    recommendation: null,
    default_value: 'new-branch', // disabled
    enum_values: ['worktree', 'new-branch', 'current-branch'],
    disabled_values: ['worktree', 'new-branch']
  });
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0].value, 'current-branch');
  assert.match(opts[0].label, /\(default\)/);
});

test('모든 enum이 disabled — throw (진행 불가)', () => {
  assert.throws(() => formatOptions({
    item: 'git',
    recommendation: null,
    default_value: 'new-branch',
    enum_values: ['worktree', 'new-branch', 'current-branch'],
    disabled_values: ['worktree', 'new-branch', 'current-branch']
  }), /모든 enum 값이 disabled/);
});

test('capabilityToDisabled — git_worktree=false → ["worktree"]', () => {
  assert.deepStrictEqual(
    capabilityToDisabled({ git_worktree: false, team_mode_available: true }, 'git'),
    ['worktree']
  );
  assert.deepStrictEqual(
    capabilityToDisabled({ git_worktree: false, team_mode_available: false }, 'team_mode'),
    ['team']
  );
});

test('capabilityToDisabled — is_git=false → ["worktree", "new-branch"]', () => {
  assert.deepStrictEqual(
    capabilityToDisabled({ git_worktree: false, team_mode_available: true, is_git: false }, 'git'),
    ['worktree', 'new-branch']
  );
});
