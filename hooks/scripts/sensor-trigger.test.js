#!/usr/bin/env node
// sensor-trigger.test.js — Tests for sensor-trigger.js PostToolUse hook
// Uses node:test + node:assert/strict

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ─── Test helpers ─────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sensor-test-'));
}

function makeStateFile(dir, sessionId, fields = {}) {
  const claudeDir = path.join(dir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  const defaults = {
    current_phase: 'implement',
    tdd_state: 'GREEN',
    active_slice: 'SLICE-001',
  };
  const merged = { ...defaults, ...fields };

  const frontmatter = Object.entries(merged)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const content = `---\n${frontmatter}\n---\n\n# Task Notes\n`;
  const stateFile = path.join(claudeDir, `deep-work.${sessionId}.md`);
  fs.writeFileSync(stateFile, content);
  return stateFile;
}

function readField(content, field) {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

// ─── Import main logic (extracted for testability) ────────────

// We test the logic inline by calling the script functions directly.
// The script is structured so main() uses findProjectRoot() and reads env.
// For testability, we duplicate the core logic here and test it.

function findProjectRootFrom(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.claude'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function runSensorTriggerLogic(stateFile) {
  // This mirrors the logic in sensor-trigger.js main()
  if (!fs.existsSync(stateFile)) return { changed: false, reason: 'no_file' };

  const content = fs.readFileSync(stateFile, 'utf-8');
  const phase = readField(content, 'current_phase');
  const tddState = readField(content, 'tdd_state');
  const sensorPending = readField(content, 'sensor_pending');

  if (phase !== 'implement' || tddState !== 'GREEN' || sensorPending === 'true') {
    return { changed: false, reason: 'guard', phase, tddState, sensorPending };
  }

  // Write sensor_pending: true
  let updated;
  if (/^sensor_pending:/m.test(content)) {
    updated = content.replace(/^sensor_pending:.*/m, 'sensor_pending: true');
  } else {
    const parts = content.split('---');
    if (parts.length >= 3) {
      parts[1] = parts[1].trimEnd() + '\nsensor_pending: true\n';
      updated = parts.join('---');
    } else {
      return { changed: false, reason: 'no_frontmatter' };
    }
  }
  fs.writeFileSync(stateFile, updated);
  return { changed: true };
}

// ─── Tests ───────────────────────────────────────────────────

describe('sensor-trigger: implement + GREEN → sensor_pending=true', () => {
  it('sets sensor_pending to true when phase=implement and tdd_state=GREEN', () => {
    const tmpDir = makeTempDir();
    try {
      const sessionId = 's-test0001';
      const stateFile = makeStateFile(tmpDir, sessionId, {
        current_phase: 'implement',
        tdd_state: 'GREEN',
      });

      const result = runSensorTriggerLogic(stateFile);
      assert.equal(result.changed, true, 'Expected state file to be modified');

      const after = fs.readFileSync(stateFile, 'utf-8');
      const pending = readField(after, 'sensor_pending');
      assert.equal(pending, 'true', `Expected sensor_pending=true, got: ${pending}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('sensor-trigger: non-implement phase → no change', () => {
  it('does not set sensor_pending when phase=research', () => {
    const tmpDir = makeTempDir();
    try {
      const sessionId = 's-test0002';
      const stateFile = makeStateFile(tmpDir, sessionId, {
        current_phase: 'research',
        tdd_state: 'GREEN',
      });

      const contentBefore = fs.readFileSync(stateFile, 'utf-8');
      const result = runSensorTriggerLogic(stateFile);
      assert.equal(result.changed, false, 'Expected no change for research phase');

      const contentAfter = fs.readFileSync(stateFile, 'utf-8');
      assert.equal(contentBefore, contentAfter, 'File should not be modified');

      const pending = readField(contentAfter, 'sensor_pending');
      assert.equal(pending, '', `Expected sensor_pending to be empty, got: ${pending}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('sensor-trigger: tdd_state not GREEN → no change', () => {
  it('does not set sensor_pending when tdd_state=RED', () => {
    const tmpDir = makeTempDir();
    try {
      const sessionId = 's-test0003';
      const stateFile = makeStateFile(tmpDir, sessionId, {
        current_phase: 'implement',
        tdd_state: 'RED',
      });

      const contentBefore = fs.readFileSync(stateFile, 'utf-8');
      const result = runSensorTriggerLogic(stateFile);
      assert.equal(result.changed, false, 'Expected no change for RED state');

      const contentAfter = fs.readFileSync(stateFile, 'utf-8');
      assert.equal(contentBefore, contentAfter, 'File should not be modified');

      const pending = readField(contentAfter, 'sensor_pending');
      assert.equal(pending, '', `Expected sensor_pending to be empty, got: ${pending}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('sensor-trigger: sensor_pending already true → no duplicate write', () => {
  it('does not overwrite when sensor_pending is already true', () => {
    const tmpDir = makeTempDir();
    try {
      const sessionId = 's-test0004';
      const stateFile = makeStateFile(tmpDir, sessionId, {
        current_phase: 'implement',
        tdd_state: 'GREEN',
        sensor_pending: 'true',
      });

      const contentBefore = fs.readFileSync(stateFile, 'utf-8');
      const result = runSensorTriggerLogic(stateFile);
      assert.equal(result.changed, false, 'Expected no change when sensor_pending already true');

      const contentAfter = fs.readFileSync(stateFile, 'utf-8');
      assert.equal(contentBefore, contentAfter, 'File should not be modified when already pending');

      // Ensure there is not a duplicate sensor_pending line
      const matches = contentAfter.match(/^sensor_pending:/mg);
      assert.equal(
        matches?.length ?? 0,
        1,
        `Expected exactly 1 sensor_pending line, got: ${matches?.length ?? 0}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
