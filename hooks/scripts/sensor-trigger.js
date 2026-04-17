#!/usr/bin/env node
// sensor-trigger.js — PostToolUse hook
// Detects GREEN state in implement phase, sets sensor_pending flag
// Must complete within 3 seconds. Always exits 0.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function findProjectRoot(startDir) {
  let dir = startDir || process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.claude'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function readField(content, field) {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

// mkdir-based advisory lock, matches utils.sh::_acquire_lock semantics.
// Fail-closed on timeout; never force-removes.
function acquireLock(lockPath, retries = 20, sleepMs = 50) {
  const sleepSync = (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* busy-wait */ }
  };
  for (let i = 0; i < retries; i++) {
    try { fs.mkdirSync(lockPath); return true; } catch (_) { /* contended */ }
    sleepSync(sleepMs);
  }
  return false;
}
function releaseLock(lockPath) {
  try { fs.rmdirSync(lockPath); } catch (_) { /* ignore */ }
}

function logError(root, msg) {
  try {
    const logPath = path.join(root, '.claude', 'deep-work-guard-errors.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} sensor-trigger: ${msg}\n`);
  } catch (_) { /* swallow — logging must never crash */ }
}

function main() {
  let root = null;
  try {
    const sessionId = process.env.DEEP_WORK_SESSION_ID;
    if (!sessionId) return;

    root = findProjectRoot();
    if (!root) return;

    const stateFile = path.join(root, '.claude', `deep-work.${sessionId}.md`);
    if (!fs.existsSync(stateFile)) return;

    // Serialize read-modify-write with file-tracker.sh's state updates.
    const lockPath = `${stateFile}.lock`;
    if (!acquireLock(lockPath, 20, 50)) {
      logError(root, 'lock timeout for ' + stateFile);
      return;
    }
    try {
      const content = fs.readFileSync(stateFile, 'utf-8');
      const phase = readField(content, 'current_phase');
      const tddState = readField(content, 'tdd_state');
      const sensorPending = readField(content, 'sensor_pending');

      if (phase !== 'implement' || tddState !== 'GREEN' || sensorPending === 'true') return;

      // Write sensor_pending: true
      let updated;
      if (/^sensor_pending:/m.test(content)) {
        updated = content.replace(/^sensor_pending:.*/m, 'sensor_pending: true');
      } else {
        // Insert before closing --- of frontmatter
        const parts = content.split('---');
        if (parts.length >= 3) {
          parts[1] = parts[1].trimEnd() + '\nsensor_pending: true\n';
          updated = parts.join('---');
        } else {
          return; // Can't find frontmatter
        }
      }
      fs.writeFileSync(stateFile, updated);
    } finally {
      releaseLock(lockPath);
    }
  } catch (err) {
    // PostToolUse is informational — never fail — but do log.
    if (root) logError(root, err.message || String(err));
  }
}

main();
