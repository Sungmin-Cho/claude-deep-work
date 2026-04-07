const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { migrateReceipt, processFile, CURRENT_SCHEMA, V1_DEFAULTS } = require('./receipt-migration.js');

// ─── migrateReceipt Tests ────────────────────────────────────

describe('migrateReceipt', () => {
  it('v0 receipt (no schema_version) migrates to v1.0', () => {
    const v0 = { slice_id: 'SLICE-001', status: 'complete', tdd_state: 'GREEN' };
    const result = migrateReceipt(v0);
    assert.ok(result.migrated);
    assert.equal(result.receipt.schema_version, CURRENT_SCHEMA);
    assert.equal(result.receipt.slice_id, 'SLICE-001');
    assert.equal(result.receipt.model_used, 'unknown');
    assert.equal(result.receipt.estimated_cost, null);
  });

  it('v1.0 receipt is not migrated', () => {
    const v1 = { schema_version: '1.0', slice_id: 'SLICE-002', status: 'complete' };
    const result = migrateReceipt(v1);
    assert.ok(!result.migrated);
  });

  it('preserves existing fields during migration', () => {
    const v0 = { slice_id: 'SLICE-003', tdd_state: 'SPIKE', model_used: 'haiku' };
    const result = migrateReceipt(v0);
    assert.ok(result.migrated);
    assert.equal(result.receipt.tdd_state, 'SPIKE');
    assert.equal(result.receipt.model_used, 'haiku');
  });

  it('adds all V1_DEFAULTS for missing fields', () => {
    const v0 = { slice_id: 'SLICE-004' };
    const result = migrateReceipt(v0);
    for (const [key, val] of Object.entries(V1_DEFAULTS)) {
      if (key === 'schema_version') continue;
      assert.equal(result.receipt[key], val, `Missing default for ${key}`);
    }
  });
});

// ─── processFile Tests ───────────────────────────────────────

describe('processFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-migration-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates v0 file and writes to disk', () => {
    const filePath = path.join(tmpDir, 'SLICE-001.json');
    fs.writeFileSync(filePath, JSON.stringify({ slice_id: 'SLICE-001', status: 'complete' }));
    const result = processFile(filePath);
    assert.equal(result.status, 'migrated');
    const updated = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(updated.schema_version, CURRENT_SCHEMA);
  });

  it('skips current v1.0 file', () => {
    const filePath = path.join(tmpDir, 'SLICE-002.json');
    fs.writeFileSync(filePath, JSON.stringify({ schema_version: '1.0', slice_id: 'SLICE-002' }));
    const result = processFile(filePath);
    assert.equal(result.status, 'current');
  });

  it('handles corrupted JSON with backup', () => {
    const filePath = path.join(tmpDir, 'SLICE-003.json');
    fs.writeFileSync(filePath, '{ corrupted json!!!');
    const result = processFile(filePath);
    assert.equal(result.status, 'corrupt');
    assert.ok(fs.existsSync(filePath + '.bak'));
  });

  it('handles non-existent file', () => {
    const filePath = path.join(tmpDir, 'SLICE-999.json');
    const result = processFile(filePath);
    assert.equal(result.status, 'error');
  });
});
