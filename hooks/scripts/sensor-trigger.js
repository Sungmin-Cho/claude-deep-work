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

function main() {
  try {
    const sessionId = process.env.DEEP_WORK_SESSION_ID;
    if (!sessionId) return;

    const root = findProjectRoot();
    if (!root) return;

    const stateFile = path.join(root, '.claude', `deep-work.${sessionId}.md`);
    if (!fs.existsSync(stateFile)) return;

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
  } catch {
    // Never fail — PostToolUse is informational
  }
}

main();
