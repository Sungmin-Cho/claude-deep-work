'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { ULID_RE } = require('../scripts/validate-envelope-emit.js');
const {
  expandSourceArtifactsGlob,
  tryReadEnvelopeRunId,
} = require('../hooks/scripts/wrap-receipt-envelope.js');
const { wrapEnvelope, generateUlid, isEnvelope } = require('../hooks/scripts/envelope.js');

const WRAP_CLI = path.resolve(
  __dirname,
  '..',
  'hooks',
  'scripts',
  'wrap-receipt-envelope.js',
);
const VALIDATE_CLI = path.resolve(
  __dirname,
  '..',
  'scripts',
  'validate-envelope-emit.js',
);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dw-chain-'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function runWrap(args) {
  return execFileSync('node', [WRAP_CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runValidate(file) {
  return execFileSync('node', [VALIDATE_CLI, file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('envelope-chain — slice receipts wrapped via wrap-receipt-envelope.js', () => {
  it('emits a valid envelope and survives the validator', () => {
    const dir = tmpDir();
    const payload = path.join(dir, 'payload.json');
    const out = path.join(dir, 'SLICE-001.json');
    writeJson(payload, { schema_version: '1.0', slice_id: 'SLICE-001', status: 'complete' });

    runWrap([
      '--artifact-kind', 'slice-receipt',
      '--payload-file', payload,
      '--output', out,
    ]);

    runValidate(out);

    const obj = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(obj.envelope.producer, 'deep-work');
    assert.equal(obj.envelope.artifact_kind, 'slice-receipt');
    assert.equal(obj.envelope.schema.name, 'slice-receipt');
    assert.match(obj.envelope.run_id, ULID_RE);
    assert.equal(obj.payload.slice_id, 'SLICE-001');
  });
});

describe('envelope-chain — session-receipt parent_run_id matches consumed evolve-insights', () => {
  it('cross-plugin chain: session-receipt.envelope.parent_run_id === evolve-insights.envelope.run_id', () => {
    const dir = tmpDir();

    // Stand up a fake evolve-insights envelope (as another plugin would emit it).
    const evolveRunId = generateUlid();
    const evolveEnvelope = {
      $schema: 'https://example/envelope.schema.json',
      schema_version: '1.0',
      envelope: {
        producer: 'deep-evolve',
        producer_version: '3.1.1',
        artifact_kind: 'evolve-insights',
        run_id: evolveRunId,
        generated_at: new Date().toISOString(),
        schema: { name: 'evolve-insights', version: '1.0' },
        git: { head: 'aaa1111', branch: 'main', dirty: false },
        provenance: { source_artifacts: [], tool_versions: { node: process.version } },
      },
      payload: { schema_version: '1.0', insights_for_deep_work: [] },
    };
    const evolvePath = path.join(dir, 'evolve-insights.json');
    writeJson(evolvePath, evolveEnvelope);
    assert.equal(isEnvelope(evolveEnvelope), true);
    assert.equal(tryReadEnvelopeRunId(evolvePath), evolveRunId);

    // Slice receipts (intra-plugin chain — session aggregates these).
    const sliceDir = path.join(dir, 'receipts');
    fs.mkdirSync(sliceDir);
    const sliceIds = [];
    for (let i = 1; i <= 3; i++) {
      const num = String(i).padStart(3, '0');
      const sPayload = path.join(dir, `slice-payload-${num}.json`);
      const sOut = path.join(sliceDir, `SLICE-${num}.json`);
      writeJson(sPayload, { schema_version: '1.0', slice_id: `SLICE-${num}`, status: 'complete' });
      runWrap([
        '--artifact-kind', 'slice-receipt',
        '--payload-file', sPayload,
        '--output', sOut,
      ]);
      const sObj = JSON.parse(fs.readFileSync(sOut, 'utf8'));
      sliceIds.push({ run_id: sObj.envelope.run_id, path: sOut });
    }

    // Session-receipt: parent_run_id from evolve, source_artifacts aggregating slices + evolve.
    const sessionPayload = path.join(dir, 'session-payload.json');
    const sessionOut = path.join(dir, 'session-receipt.json');
    writeJson(sessionPayload, {
      schema_version: '1.0',
      canonical: false,
      derived_from: 'receipts/SLICE-*.json',
      session_id: 'dw-test',
      slices: { total: 3, completed: 3, spike: 0 },
    });
    runWrap([
      '--artifact-kind', 'session-receipt',
      '--payload-file', sessionPayload,
      '--output', sessionOut,
      '--source-evolve-insights', evolvePath,
      '--source-artifacts-glob', path.join(sliceDir, 'SLICE-*.json'),
    ]);

    runValidate(sessionOut);

    const session = JSON.parse(fs.readFileSync(sessionOut, 'utf8'));

    // Cross-plugin chain assertion (handoff §3.3).
    assert.equal(
      session.envelope.parent_run_id,
      evolveRunId,
      'session-receipt.parent_run_id must equal consumed evolve-insights.run_id',
    );

    // source_artifacts must include evolve + all 3 slice run_ids.
    const recordedRunIds = (session.envelope.provenance.source_artifacts || [])
      .map((sa) => sa.run_id)
      .filter(Boolean)
      .sort();
    const expected = [evolveRunId, ...sliceIds.map((s) => s.run_id)].sort();
    assert.deepEqual(recordedRunIds, expected, 'source_artifacts run_ids do not match expected chain');
  });

  it('honors explicit --parent-run-id over auto-detect', () => {
    const dir = tmpDir();
    const explicit = generateUlid();
    const sessionPayload = path.join(dir, 'session-payload.json');
    const sessionOut = path.join(dir, 'session-receipt.json');
    writeJson(sessionPayload, { schema_version: '1.0', canonical: false });
    runWrap([
      '--artifact-kind', 'session-receipt',
      '--payload-file', sessionPayload,
      '--output', sessionOut,
      '--parent-run-id', explicit,
    ]);
    const session = JSON.parse(fs.readFileSync(sessionOut, 'utf8'));
    assert.equal(session.envelope.parent_run_id, explicit);
  });
});

describe('envelope-chain — expandSourceArtifactsGlob', () => {
  it('matches SLICE-*.json files in lex order', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'SLICE-002.json'), '{}');
    fs.writeFileSync(path.join(dir, 'SLICE-001.json'), '{}');
    fs.writeFileSync(path.join(dir, 'SLICE-003.json'), '{}');
    fs.writeFileSync(path.join(dir, 'unrelated.json'), '{}');
    const matches = expandSourceArtifactsGlob(path.join(dir, 'SLICE-*.json'), process.cwd());
    assert.equal(matches.length, 3);
    assert.ok(matches[0].endsWith('SLICE-001.json'));
    assert.ok(matches[2].endsWith('SLICE-003.json'));
  });

  it('returns empty array for non-existent directory', () => {
    const matches = expandSourceArtifactsGlob('/non-existent-dir-xyz/foo-*.json', process.cwd());
    assert.deepEqual(matches, []);
  });
});

describe('envelope-chain — wrapEnvelope intra-plugin chain via lib', () => {
  it('builds session-receipt envelope with slice run_ids in source_artifacts', () => {
    const sliceA = generateUlid();
    const sliceB = generateUlid();
    const evolve = generateUlid();
    const env = wrapEnvelope({
      artifactKind: 'session-receipt',
      payload: { schema_version: '1.0', slices: { total: 2 } },
      parentRunId: evolve,
      sourceArtifacts: [
        { path: 'evolve-insights.json', run_id: evolve },
        { path: 'receipts/SLICE-001.json', run_id: sliceA },
        { path: 'receipts/SLICE-002.json', run_id: sliceB },
      ],
      git: { head: 'abc1234', branch: 'main', dirty: false },
    });
    assert.equal(env.envelope.parent_run_id, evolve);
    const ids = env.envelope.provenance.source_artifacts.map((sa) => sa.run_id);
    assert.deepEqual(ids, [evolve, sliceA, sliceB]);
  });
});
