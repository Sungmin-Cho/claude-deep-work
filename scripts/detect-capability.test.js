'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectCapability } = require('./detect-capability.js');

test('비-git repo → git_worktree=false', () => {
  const cap = detectCapability({ is_git: false });
  assert.strictEqual(cap.git_worktree, false);
});

test('git repo + worktree 지원 → git_worktree=true', () => {
  const cap = detectCapability({ is_git: true, worktree_supported: true });
  assert.strictEqual(cap.git_worktree, true);
});

test('Agent Teams env 미설정 → team_mode_available=false', () => {
  const cap = detectCapability({ is_git: true, team_env_set: false });
  assert.strictEqual(cap.team_mode_available, false);
});
