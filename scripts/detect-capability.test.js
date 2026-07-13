'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { detectCapability } = require('./detect-capability.js');

test('deterministic script adapters point inward to cycle-free runtime modules', () => {
  const contracts = new Map([
    ['detect-capability.js', 'recommender-runtime'],
    ['recommender-input.js', 'recommender-runtime'],
    ['recommender-parser.js', 'recommender-runtime'],
    ['format-ask-options.js', 'recommender-runtime'],
    ['parse-deep-work-flags.js', 'flags-runtime'],
    ['migrate-profile-v2-to-v3.js', 'profile-runtime'],
    ['load-v3-profile.js', 'profile-runtime'],
  ]);
  for (const [file, runtime] of contracts) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source, new RegExp(`require\\(['"]\\.\\.\\/runtime\\/${runtime}\\.js['"]\\)`), file);
  }
  for (const runtime of ['recommender-runtime', 'flags-runtime', 'profile-runtime']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'runtime', `${runtime}.js`), 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\.\/scripts\//, runtime);
  }
});

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
