'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  validate,
  ULID_RE,
  SEMVER_RE,
  RFC3339_RE,
} = require('../scripts/validate-envelope-emit.js');
const {
  generateUlid,
  wrapEnvelope,
  isEnvelope,
  isValidEnvelope,
  unwrapEnvelope,
  loadProducerVersion,
} = require('../hooks/scripts/envelope.js');

const FIXTURES = path.join(__dirname, 'fixtures');

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-env-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('envelope.js — generateUlid', () => {
  it('produces a 26-char Crockford Base32 string', () => {
    for (let i = 0; i < 50; i++) {
      const u = generateUlid();
      assert.equal(u.length, 26, `expected 26 chars, got ${u.length}: ${u}`);
      assert.match(u, ULID_RE, `not a valid ULID: ${u}`);
    }
  });

  it('is lex-monotonic across timestamps (MSB-first)', () => {
    const earlier = generateUlid(1700000000000);
    const later = generateUlid(1800000000000);
    assert.ok(earlier < later, `expected ${earlier} < ${later}`);
  });
});

describe('envelope.js — wrapEnvelope identity', () => {
  it('rejects unknown artifactKind', () => {
    assert.throws(
      () => wrapEnvelope({ artifactKind: 'evolve-insights', payload: { schema_version: '1.0' } }),
      /artifactKind must be one of session-receipt, slice-receipt/,
    );
  });

  it('rejects null payload', () => {
    assert.throws(
      () => wrapEnvelope({ artifactKind: 'slice-receipt', payload: null }),
      /payload must be a non-null, non-array object/,
    );
  });

  it('rejects array payload (handoff §4 corrupt-payload defense)', () => {
    assert.throws(
      () => wrapEnvelope({ artifactKind: 'slice-receipt', payload: [{ a: 1 }] }),
      /payload must be a non-null, non-array object/,
    );
  });

  it('emits identity-matched envelope (artifact_kind === schema.name)', () => {
    const env = wrapEnvelope({
      artifactKind: 'slice-receipt',
      payload: { schema_version: '1.0', slice_id: 'SLICE-001' },
      git: { head: 'abc1234', branch: 'main', dirty: false },
    });
    assert.equal(env.envelope.producer, 'deep-work');
    assert.equal(env.envelope.artifact_kind, 'slice-receipt');
    assert.equal(env.envelope.schema.name, 'slice-receipt');
    assert.match(env.envelope.run_id, ULID_RE);
    assert.match(env.envelope.producer_version, SEMVER_RE);
    assert.match(env.envelope.generated_at, RFC3339_RE);
  });

  it('preserves caller-provided parent_run_id (cross-plugin chain)', () => {
    const parent = generateUlid();
    const env = wrapEnvelope({
      artifactKind: 'session-receipt',
      payload: { schema_version: '1.0' },
      parentRunId: parent,
      git: { head: 'abc1234', branch: 'main', dirty: false },
    });
    assert.equal(env.envelope.parent_run_id, parent);
  });
});

describe('envelope.js — unwrapEnvelope guards', () => {
  function buildEnvelope(overrides) {
    const e = {
      $schema: 'https://example/envelope.schema.json',
      schema_version: '1.0',
      envelope: {
        producer: 'deep-work',
        producer_version: '6.5.0',
        artifact_kind: 'slice-receipt',
        run_id: '01JTKGZQ7NABCDEFGHJKMNPQRS',
        generated_at: '2026-05-07T10:15:42.123Z',
        schema: { name: 'slice-receipt', version: '1.0' },
        git: { head: 'abc1234', branch: 'main', dirty: false },
        provenance: { source_artifacts: [], tool_versions: { node: 'v20.11.0' } },
      },
      payload: { schema_version: '1.0', slice_id: 'SLICE-001' },
    };
    return Object.assign(e, overrides || {});
  }

  it('passes legacy (non-envelope) input through unchanged', () => {
    const legacy = { schema_version: '1.0', slice_id: 'SLICE-001' };
    const out = unwrapEnvelope(legacy, 'slice-receipt');
    assert.strictEqual(out, legacy);
  });

  it('returns payload for matching identity', () => {
    const env = buildEnvelope();
    const payload = unwrapEnvelope(env, 'slice-receipt');
    assert.equal(payload.slice_id, 'SLICE-001');
  });

  it('returns null on producer mismatch', () => {
    const env = buildEnvelope();
    env.envelope.producer = 'deep-evolve';
    assert.strictEqual(unwrapEnvelope(env, 'slice-receipt'), null);
  });

  it('returns null on artifact_kind mismatch', () => {
    const env = buildEnvelope();
    assert.strictEqual(unwrapEnvelope(env, 'session-receipt'), null);
  });

  it('returns null on schema.name vs artifact_kind drift (round-4 lesson)', () => {
    const env = buildEnvelope();
    env.envelope.schema.name = 'session-receipt';
    assert.strictEqual(unwrapEnvelope(env, 'slice-receipt'), null);
  });

  it('returns null when payload is null/array (corrupt-payload defense)', () => {
    const env = buildEnvelope();
    env.payload = null;
    assert.strictEqual(unwrapEnvelope(env, 'slice-receipt'), null);

    const env2 = buildEnvelope();
    env2.payload = ['oops'];
    assert.strictEqual(unwrapEnvelope(env2, 'slice-receipt'), null);
  });
});

describe('envelope.js — isEnvelope detection', () => {
  it('returns false for legacy receipt with numeric schema_version', () => {
    assert.equal(isEnvelope({ schema_version: 1, slice_id: 'SLICE-001' }), false);
  });

  it('returns false for receipt with schema_version string but no envelope/payload', () => {
    assert.equal(isEnvelope({ schema_version: '1.0', slice_id: 'SLICE-001' }), false);
  });

  it('returns true (loose detection) when schema_version === "1.0" + envelope + payload all present', () => {
    assert.equal(
      isEnvelope({ schema_version: '1.0', envelope: {}, payload: {} }),
      true,
    );
  });

  it('returns true even when payload is null/falsy/array (loose detection only — unwrapEnvelope rejects)', () => {
    assert.equal(isEnvelope({ schema_version: '1.0', envelope: {}, payload: null }), true);
    assert.equal(isEnvelope({ schema_version: '1.0', envelope: {}, payload: false }), true);
    assert.equal(isEnvelope({ schema_version: '1.0', envelope: {}, payload: [] }), true);
  });
});

describe('envelope.js — isValidEnvelope (strict W4 gate)', () => {
  it('returns true only when payload is a non-null/non-array plain object', () => {
    assert.equal(
      isValidEnvelope({ schema_version: '1.0', envelope: {}, payload: { a: 1 } }),
      true,
    );
  });

  it('rejects payload null', () => {
    assert.equal(
      isValidEnvelope({ schema_version: '1.0', envelope: {}, payload: null }),
      false,
    );
  });

  it('rejects payload false / array / primitive (corrupt-payload defense)', () => {
    assert.equal(isValidEnvelope({ schema_version: '1.0', envelope: {}, payload: false }), false);
    assert.equal(isValidEnvelope({ schema_version: '1.0', envelope: {}, payload: 0 }), false);
    assert.equal(isValidEnvelope({ schema_version: '1.0', envelope: {}, payload: 'x' }), false);
    assert.equal(isValidEnvelope({ schema_version: '1.0', envelope: {}, payload: [1] }), false);
  });

  it('rejects non-envelope (legacy receipts)', () => {
    assert.equal(isValidEnvelope({ schema_version: '1.0', slice_id: 'SLICE-001' }), false);
  });
});

describe('envelope.js — loadProducerVersion', () => {
  it('reads from plugin module path, not caller cwd (literal-cwd-resolve)', () => {
    const origCwd = process.cwd();
    try {
      // Switch to /tmp (a non-plugin directory) — loadProducerVersion must
      // still find plugin.json relative to its own __dirname.
      process.chdir(os.tmpdir());
      const v = loadProducerVersion();
      assert.match(v, SEMVER_RE);
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('validate-envelope-emit.js — fixtures', () => {
  it('passes sample-slice-receipt.json', () => {
    const r = validate(path.join(FIXTURES, 'sample-slice-receipt.json'));
    assert.deepEqual(r.errors, [], 'unexpected validation errors');
    assert.equal(r.ok, true);
  });

  it('passes sample-session-receipt.json', () => {
    const r = validate(path.join(FIXTURES, 'sample-session-receipt.json'));
    assert.deepEqual(r.errors, [], 'unexpected validation errors');
    assert.equal(r.ok, true);
  });
});

describe('validate-envelope-emit.js — strict additionalProperties (handoff §4 strict mirror)', () => {
  function buildValid() {
    return JSON.parse(
      fs.readFileSync(path.join(FIXTURES, 'sample-slice-receipt.json'), 'utf8'),
    );
  }

  function expectFailure(obj, regex) {
    const f = tmpFile('case.json', JSON.stringify(obj));
    const r = validate(f);
    assert.equal(r.ok, false, 'expected validation failure but got ok');
    const matched = r.errors.some((e) => regex.test(e));
    assert.ok(matched, `errors did not include ${regex}: ${r.errors.join('; ')}`);
  }

  it('rejects unknown root key (no x- prefix)', () => {
    const o = buildValid();
    o.foo = 'bar';
    expectFailure(o, /root: unknown key "foo"/);
  });

  it('accepts x-* root extension (forward-compat)', () => {
    const o = buildValid();
    o['x-custom'] = { hi: 1 };
    const f = tmpFile('case.json', JSON.stringify(o));
    const r = validate(f);
    assert.deepEqual(r.errors, []);
  });

  it('rejects unknown envelope key', () => {
    const o = buildValid();
    o.envelope.unknown_thing = 'oops';
    expectFailure(o, /envelope: unknown key "unknown_thing"/);
  });

  it('rejects unknown git key', () => {
    const o = buildValid();
    o.envelope.git.extra = 1;
    expectFailure(o, /envelope\.git: unknown key "extra"/);
  });

  it('rejects unknown schema key', () => {
    const o = buildValid();
    o.envelope.schema.tier = 'beta';
    expectFailure(o, /envelope\.schema: unknown key "tier"/);
  });

  it('rejects unknown provenance key', () => {
    const o = buildValid();
    o.envelope.provenance.notes = 'hi';
    expectFailure(o, /envelope\.provenance: unknown key "notes"/);
  });

  it('rejects unknown source_artifacts[i] key', () => {
    const o = buildValid();
    o.envelope.provenance.source_artifacts.push({ path: 'a.json', size: 100 });
    expectFailure(o, /envelope\.provenance\.source_artifacts\[0\]: unknown key "size"/);
  });

  it('rejects array tool_versions container (typeof gotcha guard)', () => {
    const o = buildValid();
    o.envelope.provenance.tool_versions = ['v20'];
    expectFailure(o, /tool_versions: must be object/);
  });

  it('rejects array value inside tool_versions (per-value guard)', () => {
    const o = buildValid();
    o.envelope.provenance.tool_versions.node = ['v20'];
    expectFailure(o, /tool_versions\["node"\]: must be string or object/);
  });

  it('rejects schema.name ≠ artifact_kind drift (identity check)', () => {
    const o = buildValid();
    o.envelope.schema.name = 'session-receipt';
    expectFailure(o, /envelope\.schema\.name.*must equal envelope\.artifact_kind/);
  });

  it('rejects bad ULID (Crockford alphabet violation: I/L/O/U)', () => {
    const o = buildValid();
    o.envelope.run_id = '01JTKGZQ7NABCDEFGHJKMNPQRI'; // ends in "I" — not allowed
    expectFailure(o, /envelope\.run_id: must be 26-char Crockford Base32 ULID/);
  });

  it('rejects ULID with leading-zero on first chunk and 27 chars', () => {
    const o = buildValid();
    o.envelope.run_id = '01JTKGZQ7NABCDEFGHJKMNPQRSX';
    expectFailure(o, /envelope\.run_id: must be 26-char Crockford Base32 ULID/);
  });

  it('rejects bad SemVer (leading zero)', () => {
    const o = buildValid();
    o.envelope.producer_version = '01.0.0';
    expectFailure(o, /producer_version: must be SemVer 2\.0\.0/);
  });

  it('rejects non-RFC3339 timestamp', () => {
    const o = buildValid();
    o.envelope.generated_at = '2026/05/07 10:00:00';
    expectFailure(o, /envelope\.generated_at: must be RFC 3339/);
  });

  it('rejects bad git.head (uppercase hex / non-hex / wrong length)', () => {
    const o = buildValid();
    o.envelope.git.head = 'XYZ1234';
    expectFailure(o, /envelope\.git\.head: must match/);

    const o2 = buildValid();
    o2.envelope.git.head = 'abc'; // 3 chars (need 7)
    expectFailure(o2, /envelope\.git\.head: must match/);
  });

  it('rejects bad git.dirty value', () => {
    const o = buildValid();
    o.envelope.git.dirty = 'maybe';
    expectFailure(o, /envelope\.git\.dirty: must be boolean or "unknown"/);
  });

  it('rejects wrong producer (plugin identity)', () => {
    const o = buildValid();
    o.envelope.producer = 'deep-evolve';
    expectFailure(o, /envelope\.producer: must be "deep-work"/);
  });

  it('rejects unknown artifact_kind', () => {
    const o = buildValid();
    o.envelope.artifact_kind = 'scratch-pad';
    o.envelope.schema.name = 'scratch-pad';
    expectFailure(o, /envelope\.artifact_kind: must be one of session-receipt, slice-receipt/);
  });

  it('rejects payload as array', () => {
    const o = buildValid();
    o.payload = [1, 2, 3];
    expectFailure(o, /payload: must be a non-null, non-array object/);
  });

  it('rejects payload as null', () => {
    const o = buildValid();
    o.payload = null;
    expectFailure(o, /payload: must be a non-null, non-array object/);
  });

  it('rejects payload missing schema_version', () => {
    const o = buildValid();
    o.payload = { slice_id: 'SLICE-001' };
    expectFailure(o, /payload\.schema_version: must be "1\.0"/);
  });

  it('rejects bad parent_run_id format', () => {
    const o = buildValid();
    o.envelope.parent_run_id = 'not-a-ulid';
    expectFailure(o, /envelope\.parent_run_id: if present, must be 26-char ULID/);
  });

  it('rejects missing required envelope key', () => {
    const o = buildValid();
    delete o.envelope.run_id;
    expectFailure(o, /envelope: missing required key "run_id"/);
  });

  it('rejects missing root payload key', () => {
    const o = buildValid();
    delete o.payload;
    expectFailure(o, /root: missing required key "payload"/);
  });

  it('rejects bad schema.version pattern', () => {
    const o = buildValid();
    o.envelope.schema.version = '1';
    expectFailure(o, /envelope\.schema\.version: must match/);
  });
});
