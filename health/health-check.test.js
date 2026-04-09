'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readBaseline, writeBaseline, isBaselineValid } = require('./health-baseline.js');

describe('health-baseline', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns null when baseline file does not exist', () => {
    assert.equal(readBaseline(path.join(tmpDir, '.deep-work')), null);
  });

  it('reads and parses existing baseline', () => {
    const dir = path.join(tmpDir, '.deep-work');
    fs.mkdirSync(dir, { recursive: true });
    const data = { updated_at: '2026-04-09T14:30:00Z', commit: 'abc', branch: 'main', coverage: { line: 85 }, dead_exports: 3, fitness_violations: 1 };
    fs.writeFileSync(path.join(dir, 'health-baseline.json'), JSON.stringify(data));
    assert.deepEqual(readBaseline(dir), data);
  });

  it('writes baseline with commit and branch', () => {
    const dir = path.join(tmpDir, '.deep-work');
    fs.mkdirSync(dir, { recursive: true });
    writeBaseline(dir, { coverage: { line: 90 } }, 'def', 'feat/x');
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'health-baseline.json'), 'utf-8'));
    assert.equal(written.commit, 'def');
    assert.equal(written.branch, 'feat/x');
    assert.equal(typeof written.updated_at, 'string');
  });

  it('invalidates when branch differs', () => {
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'a', branch: 'main' }, 'a', 'other'), false);
  });

  it('invalidates when older than 7 days', () => {
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    assert.equal(isBaselineValid({ updated_at: old, commit: 'a', branch: 'main' }, 'a', 'main'), false);
  });

  it('validates when branch and age match', () => {
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'a', branch: 'main' }, 'a', 'main'), true);
  });

  it('invalidates when commit is not ancestor (rebase/force-push)', () => {
    const notAncestor = () => false;
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'old', branch: 'main' }, 'new', 'main', { isAncestor: notAncestor }), false);
  });

  it('validates when commit is ancestor', () => {
    const yesAncestor = () => true;
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'old', branch: 'main' }, 'new', 'main', { isAncestor: yesAncestor }), true);
  });

  it('skips ancestor check when commit is null (non-git project)', () => {
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: null, branch: null }, null, null), true);
  });

  it('handles null baseline', () => {
    assert.equal(isBaselineValid(null, 'a', 'main'), false);
  });
});
