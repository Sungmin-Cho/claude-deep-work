#!/usr/bin/env node
/**
 * receipt-migration.js — Migrate receipt JSON files to schema v1.0
 *
 * Usage: node receipt-migration.js <receipts_dir>
 *
 * Scans a directory for SLICE-*.json files and migrates them from
 * v0 (no schema_version) to v1.0 by adding default values for new fields.
 * Corrupted files are skipped with a warning; originals are backed up.
 *
 * Exit codes:
 *   0 = success (all files migrated or already current)
 *   1 = error (invalid arguments)
 */

const fs = require('fs');
const path = require('path');

const CURRENT_SCHEMA = '1.0';

const V1_DEFAULTS = {
  schema_version: CURRENT_SCHEMA,
  goal: '',
  tdd_mode: 'strict',
  model_used: 'unknown',
  model_auto_selected: false,
  model_override_reason: null,
  estimated_cost: null,
  worktree_branch: '',
  git_before: '',
  git_after: '',
};

function migrateReceipt(receipt) {
  if (receipt.schema_version === CURRENT_SCHEMA) {
    return { migrated: false, receipt };
  }

  const migrated = { ...V1_DEFAULTS, ...receipt, schema_version: CURRENT_SCHEMA };
  return { migrated: true, receipt: migrated };
}

function processFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { status: 'error', error: `Cannot read: ${err.message}` };
  }

  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch (err) {
    // Backup corrupted file
    const backupPath = filePath + '.bak';
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (_) { /* ignore backup failure */ }
    return { status: 'corrupt', error: `JSON parse error: ${err.message}`, backup: backupPath };
  }

  const result = migrateReceipt(receipt);
  if (!result.migrated) {
    return { status: 'current' };
  }

  try {
    // Atomic write: write to temp file, then rename (prevents corruption on crash)
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(result.receipt, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    return { status: 'error', error: `Cannot write: ${err.message}` };
  }

  return { status: 'migrated' };
}

function main() {
  const receiptsDir = process.argv[2];
  if (!receiptsDir) {
    console.error('Usage: node receipt-migration.js <receipts_dir>');
    process.exit(1);
  }

  if (!fs.existsSync(receiptsDir)) {
    console.log(JSON.stringify({ total: 0, migrated: 0, current: 0, errors: 0, corrupt: 0 }));
    return;
  }

  const files = fs.readdirSync(receiptsDir).filter(f => /^SLICE-\d+\.json$/.test(f));
  const stats = { total: files.length, migrated: 0, current: 0, errors: 0, corrupt: 0, details: [] };

  for (const file of files) {
    const filePath = path.join(receiptsDir, file);
    const result = processFile(filePath);
    stats[result.status] = (stats[result.status] || 0) + 1;
    if (result.status !== 'current') {
      stats.details.push({ file, ...result });
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = { migrateReceipt, processFile, CURRENT_SCHEMA, V1_DEFAULTS };
}

// Run if called directly
if (require.main === module) {
  main();
}
