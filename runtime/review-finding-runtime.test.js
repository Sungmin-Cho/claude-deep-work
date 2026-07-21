'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  REVIEW_POINTS,
  isReviewPoint,
  normalizeSeverity,
  normalizeFinding,
  validateFinding,
  dedupeFindings,
  verdictFromFindings,
  findingsPath,
  writeFindings,
  readFindings,
} = require('./review-finding-runtime.js');

function tempWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'review-findings-'));
}

function rawFinding(overrides = {}) {
  return {
    id: 'REV-SEMANTIC-001',
    severity: 'major',
    confidence: 0.9,
    review_role: 'semantic',
    channel: 'subagent',
    model: 'claude-sonnet-4-5',
    effort: 'high',
    artifact: 'docs/plan.md',
    location: 'L42',
    violated_contract: 'retry is bounded',
    evidence: ['docs/plan.md:42'],
    failure_scenario: 'retry loops forever',
    verification: 'run bounded retry fixture',
    status: 'open',
    disposition_reason: null,
    round: 1,
    blind: true,
    ...overrides,
  };
}

test('point vocabulary is closed and accepts slice-SLICE-NNN only', () => {
  assert.deepEqual(REVIEW_POINTS, ['research', 'plan', 'slice-SLICE-NNN', 'cross-slice', 'final']);
  for (const point of ['research', 'plan', 'slice-SLICE-001', 'cross-slice', 'final']) {
    assert.equal(isReviewPoint(point), true, point);
  }
  for (const point of ['slice-001', 'slice-SLICE-1', 'design', '../final']) {
    assert.equal(isReviewPoint(point), false, point);
  }
});

test('normalizeSeverity pins every normative source mapping', () => {
  const matrix = [
    ['review-gate-adversarial', 'critical', 'blocker'],
    ['review-gate-adversarial', 'major', 'major'],
    ['review-gate-adversarial', 'minor', 'minor'],
    ['phase-review-gate-opus', 'high', 'blocker'],
    ['phase-review-gate-opus', 'medium', 'major'],
    ['phase-review-gate-opus', 'low', 'minor'],
    ['binary-disagreement', 'disagreement', 'major'],
    ['slice-stage2', 'Critical', 'blocker'],
    ['slice-stage2', 'major', 'major'],
    ['slice-stage2', 'minor', 'minor'],
  ];
  for (const [scheme, input, expected] of matrix) {
    assert.equal(normalizeSeverity(scheme, input), expected, `${scheme}:${input}`);
  }
  assert.equal(normalizeSeverity('structural-score', 4), null);
  assert.equal(normalizeSeverity('unknown', 'critical'), null);
});

test('normalizeFinding emits the v1 canonical schema and rejects invalid shapes', () => {
  const finding = normalizeFinding(rawFinding({ severity: 'high' }), { sourceScheme: 'phase-review-gate-opus' });
  assert.equal(finding.severity, 'blocker');
  assert.equal(validateFinding(finding), true);
  assert.equal(normalizeFinding(rawFinding({ confidence: 2 }), { sourceScheme: 'review-gate-adversarial' }), null);
  assert.equal(validateFinding({ ...finding, channel: 'email' }), false);
});

test('unqualified blocker is demoted to major with an explicit demoted record', () => {
  const finding = normalizeFinding(rawFinding({ severity: 'critical', failure_scenario: null }),
    { sourceScheme: 'review-gate-adversarial' });
  assert.equal(finding.severity, 'major');
  assert.deepEqual(finding.demoted, {
    from: 'blocker',
    to: 'major',
    reason: 'blocker-qualification-missing:failure_scenario',
  });
  assert.equal(validateFinding(finding), true);
});

test('dedupeFindings merges only exact structural keys and is order-deterministic', () => {
  const duplicate = rawFinding({ id: 'REV-SEMANTIC-002', evidence: ['b'], confidence: 0.8 });
  const first = rawFinding({ evidence: ['a'] });
  const differentLocation = rawFinding({ id: 'REV-SEMANTIC-003', location: 'L43' });
  const a = dedupeFindings([duplicate, differentLocation, first]);
  const b = dedupeFindings([first, duplicate, differentLocation]);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.deepEqual(a.find((finding) => finding.location === 'L42').evidence, ['a', 'b']);
});

test('verdictFromFindings blocks only unresolved qualified blockers and reports demotions', () => {
  const blocker = normalizeFinding(rawFinding({ severity: 'critical' }),
    { sourceScheme: 'review-gate-adversarial' });
  const demoted = normalizeFinding(rawFinding({ id: 'REV-SEMANTIC-002', severity: 'critical', location: 'L44', verification: null }),
    { sourceScheme: 'review-gate-adversarial' });
  const blocked = verdictFromFindings([blocker, demoted], { gate: { blocker_blocks: true } });
  assert.equal(blocked.verdict, 'BLOCK');
  assert.deepEqual(blocked.open_blockers.map((finding) => finding.id), ['REV-SEMANTIC-001']);
  assert.deepEqual(blocked.demoted.map((finding) => finding.id), ['REV-SEMANTIC-002']);
  assert.equal(verdictFromFindings([{ ...blocker, status: 'fixed' }],
    { gate: { blocker_blocks: true } }).verdict, 'PASS');
});

test('writeFindings uses the canonical path and atomic round-trip without temp residue', () => {
  const workDir = tempWorkDir();
  const finding = normalizeFinding(rawFinding(), { sourceScheme: 'review-gate-adversarial' });
  const written = writeFindings({ workDir, point: 'slice-SLICE-007', round: 2, findings: [finding] });
  const expected = path.join(workDir, 'reviews', 'slice-SLICE-007-round2-findings.json');
  assert.equal(findingsPath(workDir, 'slice-SLICE-007', 2), expected);
  assert.equal(written.path, expected);
  assert.deepEqual(readFindings({ workDir, point: 'slice-SLICE-007', round: 2 }), {
    findings: [finding], warnings: [], source: 'canonical', path: expected,
  });
  assert.deepEqual(fs.readdirSync(path.dirname(expected)).filter((name) => name.includes('.tmp-')), []);
});

test('readFindings fails open with empty findings and warning on corrupt canonical data', () => {
  const workDir = tempWorkDir();
  const target = findingsPath(workDir, 'final', 1);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{broken');
  const result = readFindings({ workDir, point: 'final', round: 1 });
  assert.deepEqual(result.findings, []);
  assert.equal(result.source, 'canonical');
  assert.ok(result.warnings.some((warning) => warning.includes('손상')));
});

test('readFindings legacy fallback prefers phase-cross-review then adversarial and marks source', () => {
  const workDir = tempWorkDir();
  const preferred = path.join(workDir, 'research-cross-review.json');
  const secondary = path.join(workDir, 'adversarial-review.json');
  fs.writeFileSync(preferred, JSON.stringify({ findings: [{ id: 'preferred' }] }));
  fs.writeFileSync(secondary, JSON.stringify({ findings: [{ id: 'secondary' }] }));
  let result = readFindings({ workDir, point: 'research', round: 1, phase: 'research' });
  assert.equal(result.source, 'legacy');
  assert.equal(result.path, preferred);
  assert.equal(result.findings[0].id, 'preferred');
  fs.unlinkSync(preferred);
  result = readFindings({ workDir, point: 'research', round: 1, phase: 'research' });
  assert.equal(result.source, 'legacy');
  assert.equal(result.path, secondary);
  assert.equal(result.findings[0].id, 'secondary');
});
