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

test('memory_id regex rejects invalid Crockford characters (I/L/O/U) — R1-Y1', () => {
  // R1-Y1: each token must be EXACTLY 26 chars after `mem-` so the {26} quantifier
  // is satisfied on length — that way the character class is the sole rejection axis.
  // Earlier 27-char tokens conflated length with character-class rejection.
  // Strategy: 25 valid Crockford chars + 1 forbidden char at the tail.
  const baseValid25 = '01HXY0123456789ABCDEFGHJK';  // 25 chars, all valid Crockford
  const invalid = [
    `mem-${baseValid25}I`,  // 26 chars, forbidden I at tail
    `mem-${baseValid25}L`,  // 26 chars, forbidden L at tail
    `mem-${baseValid25}O`,  // 26 chars, forbidden O at tail
    `mem-${baseValid25}U`,  // 26 chars, forbidden U at tail
  ];
  for (const token of invalid) {
    // Length sanity — guards the test against accidental drift back to length-confounded form.
    assert.equal(token.length - 'mem-'.length, 26, `${token} body must be 26 chars (R1-Y1 invariant)`);
    // Reset lastIndex since MEMORY_ID_RE is a /g regex (stateful across .test calls).
    MEMORY_ID_RE.lastIndex = 0;
    assert.equal(MEMORY_ID_RE.test(token), false, `regex must reject ${token} purely by character class`);
  }
});

// R1-Y3 (a): stale warning wording is part of the spec contract (handoff §2.1 step 4 / SKILL step 2).
// If either side drifts the wording, the test breaks first.
test('stale warning wording stays in sync between SKILL and handoff doc — R1-Y3a', () => {
  const STALE_WARNING_RE = /brief is stale — re-run \/deep-memory-brief/;
  const research = fs.readFileSync(researchSkillPath, 'utf8');
  const handoff = fs.readFileSync(handoffDocPath, 'utf8');
  assert.match(research, STALE_WARNING_RE, 'SKILL.md must carry the exact stale warning string');
  assert.match(handoff, STALE_WARNING_RE, 'handoff doc must mirror the same stale warning string');
});

// R1-Y3 (b): heading-shift +2 rule from SKILL step 3 / handoff §2.1 step 2.
// Without this assertion, a refactor could re-set the brief's heading hierarchy preservation
// rule (e.g. switch to +1) and the only signal would be at runtime, not in CI.
test('heading-shift +2 rule documented in SKILL and handoff — R1-Y3b', () => {
  const research = fs.readFileSync(researchSkillPath, 'utf8');
  // SKILL: `# Deep-Memory Brief — ...` → `### Deep-Memory Brief — ...`
  assert.match(research, /# Deep-Memory Brief — \.\.\.` → `### Deep-Memory Brief — \.\.\./,
    'SKILL must document the H1 → H3 shift for the brief title');
  // SKILL: `## <idx>. <type> — ...` → `#### <idx>. ...`
  assert.match(research, /## <idx>\. <type> — \.\.\.` → `#### <idx>\. \.\.\./,
    'SKILL must document the H2 → H4 shift for per-memory headings');
  const handoff = fs.readFileSync(handoffDocPath, 'utf8');
  // Handoff doc: same rule, English wording — "two `#` levels"
  assert.match(handoff, /two `#` levels/,
    'handoff doc must explain the heading shift in the same +2 terms');
});

// R1-Y3 (c): empty / 0-byte brief edge case. Per SKILL step 4 — "빈 배열도 유효 (인용 자체가 빈 brief일 수 있음)".
// Verifies the regex extracts [] from a 0-byte brief so the provenance pipeline doesn't false-fire.
test('empty brief produces empty cited_memory_ids — R1-Y3c', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-memory-empty-brief-'));
  try {
    const briefDir = path.join(tmpDir, '.deep-memory');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefPath = path.join(briefDir, 'latest-brief.md');
    fs.writeFileSync(briefPath, '');  // 0-byte brief

    const planted = fs.readFileSync(briefPath, 'utf8');
    assert.equal(planted.length, 0, 'fixture must be 0 bytes (R1-Y3c invariant)');
    MEMORY_ID_RE.lastIndex = 0;
    const ids = planted.match(MEMORY_ID_RE) || [];
    assert.deepEqual(ids, [], 'empty brief must yield an empty cited_memory_ids array');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// R2-N2: non-empty brief with no valid `mem-<ULID>` tokens — e.g. deep-memory's "No memories
// yet" render, or a brief whose `mem-` prefixes are partial/malformed. Distinct from R1-Y3c
// (0-byte) because the body has content; the regex just finds no full matches. Closes the
// coverage gap flagged in round-2 review (R2-N2) and proves the regex requires the FULL
// 26-char body, not just the prefix.
test('non-empty brief without valid ULIDs yields empty cited_memory_ids — R2-N2', () => {
  const noMatchBrief = [
    '# Deep-Memory Brief — sample task',
    '',
    'No memories yet — run `/deep-memory-harvest` first or broaden the task wording.',
    '',
    // Partial / malformed `mem-` prefixes — these MUST NOT match (regex requires 26-char body):
    'Stray prefix: mem-short (only 5 chars)',
    'Wrong shape: mem-01HXY0123456789ABCDEFGHJK (only 25 chars — one short of {26})',
    'Inline mention of `mem-` without a ULID body.',
  ].join('\n');
  assert.ok(noMatchBrief.length > 0, 'fixture must have content (R2-N2 invariant)');
  // Sanity: fixture contains literal `mem-` prefixes to prove the regex doesn't match on prefix alone.
  assert.ok(noMatchBrief.includes('mem-short'), 'fixture must contain a too-short mem- prefix');
  assert.ok(noMatchBrief.includes('mem-01HXY0123456789ABCDEFGHJK '), 'fixture must contain a 25-char (off-by-one) mem- body');
  MEMORY_ID_RE.lastIndex = 0;
  const ids = noMatchBrief.match(MEMORY_ID_RE) || [];
  assert.deepEqual(ids, [], 'no-ULID brief must yield empty cited_memory_ids — partial or off-by-one "mem-" prefixes must not match');
});

// R1-Y2 contract assertion: absent-brief path must NOT write `## Cross-project Memory` to research.md.
// Locks the SKILL body wording that defines this privacy boundary.
test('absent brief stays out of research.md — R1-Y2 contract', () => {
  const research = fs.readFileSync(researchSkillPath, 'utf8');
  // SKILL step 1 must declare "부재 시 research.md에 아무것도 쓰지 않는다" (or equivalent)
  // — paired with "runtime Research context 에는 한 줄 안내만 emit".
  assert.match(research, /부재 시.*research\.md.*에 아무것도 쓰지 않는다/,
    'SKILL must declare research.md gets nothing when brief is absent');
  assert.match(research, /runtime Research context.*한 줄 안내/,
    'SKILL must declare absent-brief suggestion is runtime-only');
  const handoff = fs.readFileSync(handoffDocPath, 'utf8');
  assert.match(handoff, /research artifact stays deep-memory-agnostic/,
    'handoff doc must mirror the agnostic-artifact contract');
  assert.match(handoff, /runtime Research context only/,
    'handoff doc must declare the runtime-only emission rule');
  // R2-N1: the Research Quality Checklist must NOT mention "부재 안내" — that pre-R1-Y2 phrasing
  // would tell an LLM running self-review to write an absence note into research.md, re-opening
  // the leak this contract is meant to close. Step 1 wording and checklist wording must agree.
  assert.doesNotMatch(research, /또는 부재 안내/,
    'SKILL self-review checklist must not carry the pre-R1-Y2 "또는 부재 안내" wording (re-introduces the leak)');
});
