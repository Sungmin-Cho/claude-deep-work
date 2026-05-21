const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const researchSkillPath = path.join(repoRoot, 'skills', 'deep-research', 'SKILL.md');
const integrateSkillPath = path.join(repoRoot, 'skills', 'deep-integrate', 'SKILL.md');
const handoffDocPath = path.join(repoRoot, 'docs', 'deep-memory-integration-handoff.md');

// Crockford-base32 ULID regex (deep-memory memory_id), I/L/O/U excluded.
// Mirrors the regex documented in skills/deep-research/SKILL.md Deep-Memory Brief Context §4.
const MEMORY_ID_RE = /\bmem-[0-9A-HJKMNP-TV-Z]{26}\b/g;

test('handoff doc exists and covers the 5 consumer items', () => {
  assert.equal(fs.existsSync(handoffDocPath), true, 'docs/deep-memory-integration-handoff.md must exist');
  const body = fs.readFileSync(handoffDocPath, 'utf8');
  // Each item section is referenced in the table at §1 and detailed downstream.
  assert.match(body, /Item map \(spec §14\.2\)/);
  assert.match(body, /Item 2 \+ 4 — Phase 1 Research recall \+ provenance/);
  assert.match(body, /Item 3 — Phase 5 Integrate recommends `\/deep-memory-harvest`/);
  assert.match(body, /Item 5 — `\/deep-memory feedback <id> <accepted\|rejected>` \(DEFERRED\)/);
  assert.match(body, /Item 6 — Tests/);
});

test('deep-research SKILL.md declares Deep-Memory Brief Context (item 2)', () => {
  const body = fs.readFileSync(researchSkillPath, 'utf8');
  assert.match(body, /Deep-Memory Brief Context/);
  assert.match(body, /\.deep-memory\/latest-brief\.md/);
  // Privacy invariant: never auto-invoke /deep-memory-brief
  assert.match(body, /자동 호출 금지/);
  // Stale guard (14 days)
  assert.match(body, /14일/);
  // Provenance regex must be documented (mirrors MEMORY_ID_RE above)
  assert.match(body, /mem-\[0-9A-HJKMNP-TV-Z\]\{26\}/);
  // Cross-project Memory section heading must be declared
  assert.match(body, /## Cross-project Memory/);
});

test('deep-research SKILL.md state update lists cross_project_memory field (item 4)', () => {
  const body = fs.readFileSync(researchSkillPath, 'utf8');
  // The 4 sub-fields documented in the handoff doc §2.2 must all be present in the State 업데이트 section.
  assert.match(body, /cross_project_memory/);
  assert.match(body, /brief_path/);
  assert.match(body, /brief_mtime/);
  assert.match(body, /brief_stale/);
  assert.match(body, /cited_memory_ids/);
});

test('deep-integrate SKILL.md proposes /deep-memory-harvest (item 3)', () => {
  const body = fs.readFileSync(integrateSkillPath, 'utf8');
  // LLM prompt extension (Section 3-2) references deep-memory and gates on files_changed > 0
  assert.match(body, /\/deep-memory-harvest/);
  assert.match(body, /deep-memory.*plugins\.installed/);
  assert.match(body, /files_changed > 0/);
  // B-fallback list (Section 3-4) names the harvest candidate explicitly
  assert.match(body, /B-fallback/);
  assert.match(body, /\/deep-memory-harvest \(session\.changes\.files_changed > 0/);
});

test('graceful path — Research skill body documents the absent-brief suggestion line', () => {
  // When .deep-memory/latest-brief.md does NOT exist, the skill body must contain the
  // exact suggestion wording — this binds the implementation contract to the spec.
  // The handoff doc §2.1 step 3 and skill §1 step 1 wording must stay in sync.
  const body = fs.readFileSync(researchSkillPath, 'utf8');
  assert.match(
    body,
    /Run `\/deep-memory-brief \\"<task>\\"` first if you want cross-project recall/,
    'skill body must contain the exact suggestion wording for the absent-brief case'
  );
  const handoff = fs.readFileSync(handoffDocPath, 'utf8');
  assert.match(
    handoff,
    /Run `\/deep-memory-brief \\"<task>\\"` first if you want cross-project recall/,
    'handoff doc must mirror the same wording so the two stay in sync'
  );
});

test('cited path — memory_id regex extracts ULIDs from a planted fixture brief', () => {
  // Plant a brief with two memory_id tokens in a tempdir and verify the documented
  // regex extracts exactly those two — this validates the provenance pipeline contract.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-memory-fixture-'));
  try {
    const briefDir = path.join(tmpDir, '.deep-memory');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefPath = path.join(briefDir, 'latest-brief.md');
    // Two valid Crockford-base32 ULIDs (26 chars, no I/L/O/U), no overlap with each other.
    const id1 = 'mem-01HXY0123456789ABCDEFGHJKM';
    const id2 = 'mem-01HXZNPQRSTVWXYZ0123456789';
    const briefBody = [
      '# Deep-Memory Brief — sample task',
      '',
      '_2 memories retrieved_',
      '',
      `## 1. constraint — \`${id1}\` (score 0.870)`,
      '',
      '**Claim:** sample claim 1',
      '',
      `## 2. pattern — \`${id2}\` (score 0.640)`,
      '',
      '**Claim:** sample claim 2',
      '',
    ].join('\n');
    fs.writeFileSync(briefPath, briefBody);

    const planted = fs.readFileSync(briefPath, 'utf8');
    const ids = (planted.match(MEMORY_ID_RE) || []).slice();
    assert.deepEqual(ids, [id1, id2], 'provenance regex must extract exactly the planted IDs in document order');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('memory_id regex rejects invalid Crockford characters (I/L/O/U)', () => {
  // Forbidden chars: I, L, O, U. Each invalid token below differs from the same-length
  // valid ULID only by containing one forbidden character — the regex must reject all four.
  const invalid = [
    'mem-I1HXY0123456789ABCDEFGHJKM7',  // contains I
    'mem-L1HXY0123456789ABCDEFGHJKM7',  // contains L
    'mem-O1HXY0123456789ABCDEFGHJKM7',  // contains O
    'mem-U1HXY0123456789ABCDEFGHJKM7',  // contains U
  ];
  for (const token of invalid) {
    // Reset lastIndex since MEMORY_ID_RE is a /g regex (stateful across .test calls).
    MEMORY_ID_RE.lastIndex = 0;
    assert.equal(MEMORY_ID_RE.test(token), false, `regex must reject ${token}`);
  }
});
