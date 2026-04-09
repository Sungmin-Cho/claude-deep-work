'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const BASELINE_FILE = 'health-baseline.json';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readBaseline(baselineDir) {
  try { return JSON.parse(fs.readFileSync(path.join(baselineDir, BASELINE_FILE), 'utf-8')); }
  catch { return null; }
}

function writeBaseline(baselineDir, data, commit, branch) {
  fs.mkdirSync(baselineDir, { recursive: true });
  const baseline = { updated_at: new Date().toISOString(), commit, branch, ...data };
  fs.writeFileSync(path.join(baselineDir, BASELINE_FILE), JSON.stringify(baseline, null, 2));
  return baseline;
}

function isBaselineValid(baseline, currentCommit, currentBranch, options = {}) {
  if (!baseline) return false;
  // non-git project: commit/branch null → age-only check
  if (baseline.commit === null && currentCommit === null) {
    return Date.now() - new Date(baseline.updated_at).getTime() <= MAX_AGE_MS;
  }
  if (baseline.branch !== currentBranch) return false;
  if (Date.now() - new Date(baseline.updated_at).getTime() > MAX_AGE_MS) return false;
  // ancestor check: rebase/force-push detection
  if (options.isAncestor && baseline.commit && currentCommit) {
    if (!options.isAncestor(baseline.commit, currentCommit)) return false;
  }
  return true;
}

function gitIsAncestor(ancestorCommit, descendantCommit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestorCommit, descendantCommit], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

module.exports = { readBaseline, writeBaseline, isBaselineValid, gitIsAncestor, BASELINE_FILE };
