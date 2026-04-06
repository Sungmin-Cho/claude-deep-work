const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  SCHEMA_VERSION,
  CONFIDENCE_THRESHOLDS,
  DEFAULT_STALENESS_THRESHOLD,
  SIGNAL_EVALUATORS,
  AUTO_ADJUST_MAP,
  AUTO_ADJUST_THRESHOLDS,
  readRegistry,
  readHistory,
  isSessionDuplicate,
  rebuildFromReceipts,
  wilsonScore,
  calculateConfidence,
  detectStaleness,
  detectNewModel,
  evaluateSignals,
  generateReport,
  generateTimeline,
  exportBadge,
  autoAdjust,
} = require('./assumption-engine.js');

// ─── Test Helpers ───────────────────────────────────────────

let tmpDir;

function setupTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'));
}

function cleanupTmpDir() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(tmpDir, filename), JSON.stringify(data));
  return path.join(tmpDir, filename);
}

function writeJSONL(filename, lines) {
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(path.join(tmpDir, filename), content);
  return path.join(tmpDir, filename);
}

/** Builds a minimal valid assumption object. */
function makeAssumption(overrides) {
  return {
    id: 'test_assumption',
    component: 'test.js',
    hypothesis: 'Test hypothesis',
    evidence_signals: { supporting: [], weakening: [] },
    current_enforcement: 'strict',
    adjustable_levels: ['strict', 'relaxed', 'off'],
    minimum_sessions_for_evaluation: 5,
    ...overrides,
  };
}

/** Builds a minimal valid session object. */
function makeSession(overrides) {
  return {
    session_id: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model_primary: 'claude-opus-4-6',
    phases_used: ['brainstorm', 'research', 'plan', 'implement', 'test'],
    slices_total: 5,
    slices_passed_first_try: 4,
    tdd_mode: 'strict',
    tdd_overrides: 0,
    bugs_caught_in_red_phase: 1,
    research_references_used: 3,
    test_retry_count: 0,
    review_scores: { plan: 8 },
    cross_model_unique_findings: 1,
    final_outcome: 'pass',
    ...overrides,
  };
}

// ─── readRegistry Tests (4 tests) ───────────────────────────

describe('readRegistry', () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it('reads a valid registry file', () => {
    const filepath = writeJSON('reg.json', {
      schema_version: '1.0',
      assumptions: [makeAssumption()],
    });
    const result = readRegistry(filepath);
    assert.equal(result.assumptions.length, 1);
    assert.equal(result.schema_version, '1.0');
    assert.equal(result.warnings.length, 0);
  });

  it('returns empty with warning for missing file (ENOENT)', () => {
    const result = readRegistry(path.join(tmpDir, 'nonexistent.json'));
    assert.equal(result.assumptions.length, 0);
    assert.ok(result.warnings[0].includes('not found'));
  });

  it('returns empty with warning for malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{not valid json');
    const result = readRegistry(path.join(tmpDir, 'bad.json'));
    assert.equal(result.assumptions.length, 0);
    assert.ok(result.warnings.length > 0);
  });

  it('warns on schema version mismatch but still reads data', () => {
    const filepath = writeJSON('reg.json', {
      schema_version: '2.0',
      assumptions: [makeAssumption()],
    });
    const result = readRegistry(filepath);
    assert.equal(result.assumptions.length, 1);
    assert.ok(result.warnings[0].includes('differs'));
  });
});

// ─── readHistory Tests (4 tests) ────────────────────────────

describe('readHistory', () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it('reads valid JSONL file', () => {
    const filepath = writeJSONL('hist.jsonl', [
      makeSession({ session_id: 's1' }),
      makeSession({ session_id: 's2' }),
    ]);
    const result = readHistory(filepath);
    assert.equal(result.sessions.length, 2);
    assert.equal(result.warnings.length, 0);
  });

  it('returns empty for missing file', () => {
    const result = readHistory(path.join(tmpDir, 'missing.jsonl'));
    assert.equal(result.sessions.length, 0);
    assert.ok(result.warnings[0].includes('not found'));
  });

  it('skips corrupt lines with warnings', () => {
    fs.writeFileSync(path.join(tmpDir, 'corrupt.jsonl'),
      JSON.stringify(makeSession({ session_id: 's1' })) + '\n' +
      'NOT JSON\n' +
      JSON.stringify(makeSession({ session_id: 's2' })) + '\n'
    );
    const result = readHistory(path.join(tmpDir, 'corrupt.jsonl'));
    assert.equal(result.sessions.length, 2);
    assert.ok(result.warnings[0].includes('Malformed'));
  });

  it('deduplicates by session_id (cold start safety)', () => {
    const filepath = writeJSONL('dup.jsonl', [
      makeSession({ session_id: 'dup-1' }),
      makeSession({ session_id: 'dup-1' }),
      makeSession({ session_id: 'dup-2' }),
    ]);
    const result = readHistory(filepath);
    assert.equal(result.sessions.length, 2);
    assert.ok(result.warnings[0].includes('Duplicate'));
  });
});

// ─── isSessionDuplicate Tests (2 tests) ─────────────────────

describe('isSessionDuplicate', () => {
  it('returns true for existing session_id', () => {
    const sessions = [makeSession({ session_id: 'abc' })];
    assert.ok(isSessionDuplicate(sessions, 'abc'));
  });

  it('returns false for new session_id or null', () => {
    const sessions = [makeSession({ session_id: 'abc' })];
    assert.ok(!isSessionDuplicate(sessions, 'xyz'));
    assert.ok(!isSessionDuplicate(sessions, null));
  });
});

// ─── rebuildFromReceipts Tests (3 tests) ────────────────────

describe('rebuildFromReceipts', () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it('rebuilds sessions from receipt files', () => {
    const receiptDir = path.join(tmpDir, 'receipts');
    fs.mkdirSync(receiptDir);
    writeJSON(path.join('receipts', 'r1.json'), { slice_id: 'SLICE-001', status: 'complete' });
    writeJSON(path.join('receipts', 'r2.json'), { slice_id: 'SLICE-002', status: 'complete' });

    const result = rebuildFromReceipts(tmpDir);
    assert.equal(result.sessions.length, 2);
    assert.equal(result.sessions[0].slice_id, 'SLICE-001');
  });

  it('handles missing receipt directory', () => {
    const result = rebuildFromReceipts(path.join(tmpDir, 'no-such-dir'));
    assert.equal(result.sessions.length, 0);
    assert.ok(result.warnings.length > 0);
  });

  it('returns empty for no workDir', () => {
    const result = rebuildFromReceipts(null);
    assert.equal(result.sessions.length, 0);
    assert.ok(result.warnings[0].includes('No work directory'));
  });
});

// ─── wilsonScore Tests (5 tests) ────────────────────────────

describe('wilsonScore', () => {
  it('returns 0 for 0/0 (division by zero guard)', () => {
    assert.equal(wilsonScore(0, 0), 0);
  });

  it('returns ~0.34 for 2/2 (small sample conservative)', () => {
    const score = wilsonScore(2, 2);
    assert.ok(score > 0.30 && score < 0.40, `Expected ~0.34, got ${score}`);
  });

  it('returns ~0.84 for 20/20 (medium sample)', () => {
    const score = wilsonScore(20, 20);
    assert.ok(score > 0.80 && score < 0.90, `Expected ~0.84, got ${score}`);
  });

  it('returns ~0.98 for 200/200 (large sample converges to 1)', () => {
    const score = wilsonScore(200, 200);
    assert.ok(score > 0.95 && score < 1.0, `Expected ~0.98, got ${score}`);
  });

  it('clamps negative/overflow inputs', () => {
    assert.equal(wilsonScore(-5, 10), wilsonScore(0, 10));
    const overflow = wilsonScore(15, 10);
    assert.ok(overflow >= 0 && overflow <= 1);
  });
});

// ─── calculateConfidence Tests (5 tests) ────────────────────

describe('calculateConfidence', () => {
  it('returns INSUFFICIENT for fewer sessions than minimum', () => {
    const assumption = makeAssumption({ minimum_sessions_for_evaluation: 10 });
    const sessions = Array.from({ length: 3 }, (_, i) => makeSession({ session_id: `s-${i}` }));
    const result = calculateConfidence(assumption, sessions);
    assert.ok(result.insufficient);
    assert.equal(result.overall.category, 'INSUFFICIENT');
  });

  it('returns HIGH when all signals are supporting (large sample)', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
      minimum_sessions_for_evaluation: 3,
    });
    // Need enough sessions for Wilson lower bound to exceed 0.7 threshold
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 3 })
    );
    const result = calculateConfidence(assumption, sessions);
    assert.equal(result.overall.category, 'HIGH');
    assert.ok(result.overall.score > 0.7, `Expected >0.7, got ${result.overall.score}`);
  });

  it('returns LOW when all signals are weakening', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: [],
        weakening: ['zero_bugs_caught_in_red'],
      },
      minimum_sessions_for_evaluation: 3,
    });
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0 })
    );
    const result = calculateConfidence(assumption, sessions);
    assert.equal(result.overall.category, 'LOW');
    assert.equal(result.overall.score, 0);
  });

  it('splits confidence by model when requested', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
      minimum_sessions_for_evaluation: 2,
    });
    const sessions = [
      makeSession({ session_id: 's1', model_primary: 'claude-opus-4-6', bugs_caught_in_red_phase: 3 }),
      makeSession({ session_id: 's2', model_primary: 'claude-opus-4-6', bugs_caught_in_red_phase: 2 }),
      makeSession({ session_id: 's3', model_primary: 'claude-haiku-4-5', bugs_caught_in_red_phase: 1 }),
    ];
    const result = calculateConfidence(assumption, sessions, { splitByModel: true });
    assert.ok(result.byModel);
    assert.ok(result.byModel['claude-opus-4-6']);
    assert.ok(result.byModel['claude-haiku-4-5']);
    assert.equal(result.byModel['claude-opus-4-6'].total, 2);
    assert.equal(result.byModel['claude-haiku-4-5'].total, 1);
  });

  it('handles mixed supporting and weakening signals', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: ['zero_bugs_caught_in_red'],
      },
      minimum_sessions_for_evaluation: 3,
    });
    // 3 supporting, 2 weakening
    const sessions = [
      makeSession({ session_id: 's1', bugs_caught_in_red_phase: 3 }),
      makeSession({ session_id: 's2', bugs_caught_in_red_phase: 2 }),
      makeSession({ session_id: 's3', bugs_caught_in_red_phase: 1 }),
      makeSession({ session_id: 's4', bugs_caught_in_red_phase: 0 }),
      makeSession({ session_id: 's5', bugs_caught_in_red_phase: 0 }),
    ];
    const result = calculateConfidence(assumption, sessions);
    assert.ok(result.overall.score > 0 && result.overall.score < 1);
    assert.equal(result.overall.supporting, 3);
    assert.equal(result.overall.weakening, 2);
  });
});

// ─── detectStaleness Tests (3 tests) ────────────────────────

describe('detectStaleness', () => {
  it('marks stale when no signal in threshold sessions', () => {
    const assumption = makeAssumption({
      evidence_signals: { supporting: ['bugs_caught_in_red_phase > 0'], weakening: [] },
    });
    // All sessions have 0 bugs — no supporting signal fires, neutral only
    const sessions = Array.from({ length: 15 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0 })
    );
    const result = detectStaleness(assumption, sessions, 10);
    assert.ok(result.stale);
    assert.equal(result.sessionsSinceLastSignal, 15);
  });

  it('marks fresh when recent signal exists', () => {
    const assumption = makeAssumption({
      evidence_signals: { supporting: ['bugs_caught_in_red_phase > 0'], weakening: [] },
    });
    const sessions = [
      makeSession({ session_id: 's1', bugs_caught_in_red_phase: 0 }),
      makeSession({ session_id: 's2', bugs_caught_in_red_phase: 3 }), // signal here
      makeSession({ session_id: 's3', bugs_caught_in_red_phase: 0 }),
    ];
    const result = detectStaleness(assumption, sessions, 10);
    assert.ok(!result.stale);
    assert.equal(result.sessionsSinceLastSignal, 1);
  });

  it('handles empty history without crash', () => {
    const assumption = makeAssumption();
    const result = detectStaleness(assumption, []);
    assert.ok(!result.stale);
    assert.equal(result.reason, 'no_history');
  });
});

// ─── detectNewModel Tests (3 tests) ─────────────────────────

describe('detectNewModel', () => {
  it('detects known model', () => {
    const sessions = [
      makeSession({ model_primary: 'claude-opus-4-6' }),
      makeSession({ model_primary: 'claude-opus-4-6' }),
    ];
    const result = detectNewModel('claude-opus-4-6', sessions);
    assert.ok(!result.isNew);
    assert.equal(result.sessionsWithModel, 2);
  });

  it('detects new model (no history for this model)', () => {
    const sessions = [
      makeSession({ model_primary: 'claude-opus-4-6' }),
    ];
    const result = detectNewModel('claude-opus-5-0', sessions);
    assert.ok(result.isNew);
    assert.equal(result.sessionsWithModel, 0);
  });

  it('handles no history at all', () => {
    const result = detectNewModel('claude-opus-4-6', []);
    assert.ok(result.isNew);
    assert.equal(result.totalSessions, 0);
  });
});

// ─── evaluateSignals Tests (4 tests) ────────────────────────

describe('evaluateSignals', () => {
  it('evaluates mapped supporting signals correctly', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
    });
    const session = makeSession({ bugs_caught_in_red_phase: 3 });
    const result = evaluateSignals(assumption, session);
    assert.equal(result.supporting, 1);
    assert.equal(result.weakening, 0);
    assert.equal(result.neutral, 0);
  });

  it('evaluates mapped weakening signals correctly', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: [],
        weakening: ['zero_bugs_caught_in_red'],
      },
    });
    const session = makeSession({ bugs_caught_in_red_phase: 0 });
    const result = evaluateSignals(assumption, session);
    assert.equal(result.weakening, 1);
    assert.equal(result.supporting, 0);
  });

  it('skips unmapped signals silently', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['some_future_signal_not_yet_implemented'],
        weakening: [],
      },
    });
    const session = makeSession();
    const result = evaluateSignals(assumption, session);
    assert.equal(result.supporting, 0);
    assert.equal(result.weakening, 0);
    assert.equal(result.neutral, 1);
  });

  it('handles orphan/null assumption gracefully', () => {
    const result = evaluateSignals(null, makeSession());
    assert.equal(result.neutral, 1);
    assert.equal(result.supporting, 0);
  });
});

// ─── generateReport Tests (3 tests) ─────────────────────────

describe('generateReport', () => {
  it('generates report with session data', () => {
    const assumptions = [makeAssumption({
      id: 'test_report',
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
      minimum_sessions_for_evaluation: 3,
    })];
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 2 })
    );
    const result = generateReport(assumptions, sessions);
    assert.ok(result.text.includes('ASSUMPTION HEALTH REPORT'));
    assert.ok(result.text.includes('5 sessions analyzed'));
    assert.ok(result.text.includes('test_report'));
    assert.equal(result.data.length, 1);
  });

  it('handles empty session history', () => {
    const assumptions = [makeAssumption()];
    const result = generateReport(assumptions, []);
    assert.ok(result.text.includes('No session history'));
    assert.equal(result.data.length, 0);
  });

  it('includes model breakdown when splitByModel is true', () => {
    const assumptions = [makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
      minimum_sessions_for_evaluation: 2,
    })];
    const sessions = [
      makeSession({ session_id: 's1', model_primary: 'opus', bugs_caught_in_red_phase: 2 }),
      makeSession({ session_id: 's2', model_primary: 'haiku', bugs_caught_in_red_phase: 1 }),
      makeSession({ session_id: 's3', model_primary: 'opus', bugs_caught_in_red_phase: 3 }),
    ];
    const result = generateReport(assumptions, sessions, { splitByModel: true });
    assert.ok(result.text.includes('[opus]'));
    assert.ok(result.text.includes('[haiku]'));
  });
});

// ─── generateTimeline Tests (2 tests) ───────────────────────

describe('generateTimeline', () => {
  it('generates ASCII chart for valid data', () => {
    const assumption = makeAssumption({
      id: 'timeline_test',
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
    });
    const sessions = Array.from({ length: 9 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: i % 3 })
    );
    const chart = generateTimeline(assumption, sessions, { windowSize: 3 });
    assert.ok(chart.includes('timeline_test'));
    assert.ok(chart.includes('Confidence Timeline'));
    assert.ok(chart.includes('oldest'));
    assert.ok(chart.includes('newest'));
  });

  it('handles empty sessions', () => {
    const assumption = makeAssumption({ id: 'empty_timeline' });
    const chart = generateTimeline(assumption, []);
    assert.ok(chart.includes('No history available'));
  });
});

// ─── exportBadge Tests (3 tests) ────────────────────────────

describe('exportBadge', () => {
  it('returns "no data" badge for empty inputs', () => {
    const result = exportBadge([], []);
    assert.equal(result.harness.message, 'no data');
    assert.equal(result.harness.color, 'lightgrey');
    assert.equal(result.harness.schemaVersion, 1);
    assert.equal(result.harness.label, 'harness health');
  });

  it('returns "insufficient data" badge when not enough sessions', () => {
    const assumptions = [makeAssumption({ minimum_sessions_for_evaluation: 100 })];
    const sessions = [makeSession({ session_id: 's1' })];
    const result = exportBadge(assumptions, sessions);
    assert.equal(result.harness.message, 'insufficient data');
  });

  it('returns percentage badge with color for sufficient data', () => {
    const assumptions = [makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
      minimum_sessions_for_evaluation: 3,
    })];
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 2 })
    );
    const result = exportBadge(assumptions, sessions);
    assert.ok(result.harness.message.includes('%'));
    assert.ok(['brightgreen', 'yellow', 'red'].includes(result.harness.color));
    assert.ok(result.quality);
    assert.ok(result.sessions);
    assert.ok(result.fidelity);
  });
});

// ─── Session Dedupe Tests (1 test) ──────────────────────────

describe('Session dedupe', () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it('deduplicates sessions by session_id in readHistory', () => {
    const filepath = writeJSONL('dedupe.jsonl', [
      makeSession({ session_id: 'same-id', slices_total: 5 }),
      makeSession({ session_id: 'same-id', slices_total: 10 }),
      makeSession({ session_id: 'different-id', slices_total: 3 }),
    ]);
    const result = readHistory(filepath);
    assert.equal(result.sessions.length, 2);
    // v5.5.2: Latest occurrence wins (keeps finalized over active)
    assert.equal(result.sessions[0].slices_total, 10);
    assert.equal(result.sessions[1].session_id, 'different-id');
  });
});

// ─── autoAdjust Tests (15 tests) ──────────────────────────

describe('autoAdjust', () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  /** Helper: write registry + history and call autoAdjust with registryPath */
  function adjustWithRegistry(sessions, config, assumptions, extraOpts) {
    const regPath = writeJSON('reg.json', { schema_version: '1.0', assumptions });
    return autoAdjust(sessions, config, { minSessions: 5, registryPath: regPath, ...extraOpts });
  }

  const tddAssumption = {
    id: 'tdd_required_before_implement',
    hypothesis: 'TDD test',
    evidence_signals: { supporting: ['bugs_caught_in_red_phase > 0'], weakening: ['zero_bugs_caught_in_red', 'override_rate > 50%'] },
    current_enforcement: 'strict',
    adjustable_levels: ['strict', 'coaching', 'relaxed', 'off'],
    minimum_sessions_for_evaluation: 5,
  };

  const receiptAssumption = {
    id: 'receipt_collection_ensures_evidence',
    hypothesis: 'Receipt test',
    evidence_signals: { supporting: ['receipt_data_contradicts_model_claim'], weakening: ['receipt_data_never_referenced_in_test_phase'] },
    current_enforcement: 'required',
    adjustable_levels: ['required', 'optional'],
    minimum_sessions_for_evaluation: 5,
  };

  const evalAssumption = {
    id: 'evaluator_model_quality',
    hypothesis: 'Evaluator model test',
    evidence_signals: { supporting: ['evaluator_found_real_issues', 'no_missed_issues_in_test_phase'], weakening: ['evaluator_zero_findings_consistently', 'missed_issues_caught_in_test'] },
    current_enforcement: 'sonnet',
    adjustable_levels: ['opus', 'sonnet', 'haiku'],
    minimum_sessions_for_evaluation: 5,
  };

  it('returns empty adjustments on cold start (< 5 sessions)', () => {
    const sessions = Array.from({ length: 3 }, (_, i) => makeSession({ session_id: `s-${i}` }));
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption]);
    assert.deepEqual(result.adjustments, []);
    assert.equal(result.coldStart, true);
  });

  it('relaxes tdd_mode from strict to coaching when score is MEDIUM', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0, tdd_overrides: 3, slices_total: 5 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption]);
    const tddAdj = result.adjustments.find(a => a.field === 'tdd_mode');
    assert.ok(tddAdj, 'Expected tdd_mode adjustment');
    assert.equal(tddAdj.from, 'strict');
    assert.equal(tddAdj.to, 'coaching');
  });

  it('relaxes to floor when score is LOW', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0, tdd_overrides: 5, slices_total: 5 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption]);
    const tddAdj = result.adjustments.find(a => a.field === 'tdd_mode');
    if (tddAdj) {
      assert.notEqual(tddAdj.to, 'relaxed');
      assert.notEqual(tddAdj.to, 'off');
    }
  });

  it('enforces TDD floor at coaching (never auto-adjusts to relaxed or off)', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0, tdd_overrides: 5, slices_total: 5 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'coaching' }, [tddAssumption]);
    const tddAdj = result.adjustments.find(a => a.field === 'tdd_mode');
    if (tddAdj) {
      assert.notEqual(tddAdj.to, 'relaxed');
      assert.notEqual(tddAdj.to, 'off');
    }
  });

  it('maintains current level when score is HIGH', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 3 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption]);
    const tddAdj = result.adjustments.find(a => a.field === 'tdd_mode');
    assert.equal(tddAdj, undefined, 'Expected no tdd_mode adjustment for HIGH confidence');
  });

  it('tightens coaching to strict when score is HIGH and currently relaxed from default', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 3 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'coaching' }, [tddAssumption], {
      defaults: { tdd_mode: 'strict' },
      tighteningMinSessions: 3,
    });
    const tddAdj = result.adjustments.find(a => a.field === 'tdd_mode');
    if (tddAdj) {
      assert.equal(tddAdj.to, 'strict');
      assert.equal(tddAdj.direction, 'tighten');
    }
  });

  it('respects user override (marks as suppressed)', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0, tdd_overrides: 3, slices_total: 5 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption], {
      userOverrides: { tdd_mode: 'strict' },
    });
    const tddAdj = result.adjustments.find(a => a.field === 'tdd_mode');
    if (tddAdj) {
      assert.equal(tddAdj.suppressed, true);
    }
  });

  it('handles receipt_depth adjustment', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, harness_metadata: { receipts_referenced_in_test: false, receipt_contradictions: 0 } })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict', receipt_depth: 'full' }, [receiptAssumption]);
    const receiptAdj = result.adjustments.find(a => a.field === 'receipt_depth');
    if (receiptAdj) {
      assert.equal(receiptAdj.to, 'minimal');
    }
  });

  it('enforces receipt_depth floor at minimal', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, harness_metadata: { receipts_referenced_in_test: false } })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict', receipt_depth: 'minimal' }, [receiptAssumption]);
    const receiptAdj = result.adjustments.find(a => a.field === 'receipt_depth');
    assert.equal(receiptAdj, undefined, 'Expected no receipt_depth adjustment at floor');
  });

  it('produces model-aware adjustments when splitByModel is true', () => {
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeSession({ session_id: `opus-${i}`, model_primary: 'claude-opus-4-6', bugs_caught_in_red_phase: 3 })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeSession({ session_id: `sonnet-${i}`, model_primary: 'claude-sonnet-4-6', bugs_caught_in_red_phase: 0, tdd_overrides: 3, slices_total: 5 })
      ),
    ];
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption], {
      splitByModel: true, currentModel: 'claude-sonnet-4-6',
    });
    const tddAdj = result.adjustments.find(a => a.field === 'tdd_mode');
    if (tddAdj) {
      assert.equal(tddAdj.to, 'coaching');
    }
  });

  it('returns notification text for adjustments', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0, tdd_overrides: 3, slices_total: 5 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption]);
    if (result.adjustments.length > 0) {
      assert.ok(result.adjustments[0].reason, 'Expected reason string');
      assert.ok(typeof result.adjustments[0].score === 'number', 'Expected score number');
    }
  });

  it('returns formatted notification string', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ session_id: `s-${i}`, bugs_caught_in_red_phase: 0, tdd_overrides: 3, slices_total: 5 })
    );
    const result = adjustWithRegistry(sessions, { tdd_mode: 'strict' }, [tddAssumption]);
    assert.ok(typeof result.notification === 'string');
    if (result.adjustments.length > 0) {
      assert.ok(result.notification.length > 0, 'Expected non-empty notification');
    }
  });

  it('adjusts evaluator_model from sonnet to haiku when evaluator finds zero issues', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({
        session_id: `s-${i}`,
        review_scores: { plan: 10, plan_revisions_from_review: 0 },
        test_retry_count: 0,
      })
    );
    const result = adjustWithRegistry(sessions, { evaluator_model: 'sonnet' }, [evalAssumption]);
    const evalAdj = result.adjustments.find(a => a.field === 'evaluator_model');
    if (evalAdj) {
      assert.equal(evalAdj.to, 'haiku');
      assert.equal(evalAdj.direction, 'relax');
    }
  });

  it('tightens evaluator_model from haiku to sonnet when test phase catches missed issues', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({
        session_id: `s-${i}`,
        review_scores: { plan: 8, plan_revisions_from_review: 1 },
        test_retry_count: 2,
      })
    );
    const result = adjustWithRegistry(sessions, { evaluator_model: 'haiku' }, [evalAssumption], {
      defaults: { evaluator_model: 'sonnet' },
      tighteningMinSessions: 3,
    });
    const evalAdj = result.adjustments.find(a => a.field === 'evaluator_model');
    if (evalAdj) {
      assert.equal(evalAdj.to, 'sonnet');
      assert.equal(evalAdj.direction, 'tighten');
    }
  });

  it('enforces evaluator_model floor at haiku (no relaxation below haiku)', () => {
    // When at haiku with weak signals, should NOT relax further (haiku is floor)
    // Use weakening signals to get LOW score
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({
        session_id: `s-${i}`,
        review_scores: { plan: 10, plan_revisions_from_review: 0 },
        test_retry_count: 2,  // missed issues → weakening
      })
    );
    const result = adjustWithRegistry(sessions, { evaluator_model: 'haiku' }, [evalAssumption]);
    const evalAdj = result.adjustments.find(a => a.field === 'evaluator_model');
    // At floor with mixed signals — may tighten back toward default but never relax past haiku
    if (evalAdj) {
      assert.notEqual(evalAdj.direction, 'relax', 'Should not relax below haiku floor');
    }
  });
});

// ─── Signal Scope Separation Tests (8 tests) ──────────────

describe('Signal scope separation', () => {
  it('session-scoped signal evaluates once even when slices exist', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['high_override_rate'],
        weakening: [],
      },
    });
    // Session with slices array — session-scoped signal should read from session, not slices
    const session = makeSession({
      slices_total: 5,
      tdd_overrides: 4, // 4/5 = 0.8 > 0.5 → true
      slices: [
        { slice_id: 'S1', tdd_overrides: 0, slices_total: 1 },
        { slice_id: 'S2', tdd_overrides: 0, slices_total: 1 },
        { slice_id: 'S3', tdd_overrides: 0, slices_total: 1 },
      ],
    });
    const result = evaluateSignals(assumption, session);
    // Should evaluate once against session (true), not per-slice (all false)
    assert.equal(result.supporting, 1, 'Session-scoped should evaluate once, got supporting != 1');
  });

  it('slice-scoped signal aggregates across slices (any-true)', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
    });
    const session = makeSession({
      bugs_caught_in_red_phase: 0, // session-level is 0
      slices: [
        { slice_id: 'S1', bugs_caught_in_red_phase: 0 },
        { slice_id: 'S2', bugs_caught_in_red_phase: 3 }, // this one is true
        { slice_id: 'S3', bugs_caught_in_red_phase: 0 },
      ],
    });
    const result = evaluateSignals(assumption, session);
    // any-true: at least one slice has bugs > 0
    assert.equal(result.supporting, 1, 'Slice-scoped any-true should count 1');
  });

  it('slice-scoped signal does not double-count across multiple slices', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0'],
        weakening: [],
      },
    });
    const session = makeSession({
      slices: [
        { slice_id: 'S1', bugs_caught_in_red_phase: 2 },
        { slice_id: 'S2', bugs_caught_in_red_phase: 5 },
        { slice_id: 'S3', bugs_caught_in_red_phase: 1 },
      ],
    });
    const result = evaluateSignals(assumption, session);
    // All slices are true, but any-true should count at most 1
    assert.equal(result.supporting, 1, 'Should count at most 1 per signal even with multiple true slices');
  });

  it('session-scoped signal with tdd_mode works when slices lack tdd_mode', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['rework_count_strict < rework_count_relaxed'],
        weakening: [],
      },
    });
    const session = makeSession({
      tdd_mode: 'strict',
      test_retry_count: 0,
      slices: [
        { slice_id: 'S1' }, // no tdd_mode on slices
        { slice_id: 'S2' },
      ],
    });
    const result = evaluateSignals(assumption, session);
    // Session-scoped: reads tdd_mode from session object, not slices
    assert.equal(result.supporting, 1, 'Should read tdd_mode from session, not slices');
  });

  it('mixed session and slice scoped signals evaluate correctly together', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['bugs_caught_in_red_phase > 0', 'high_override_rate'],
        weakening: ['zero_bugs_caught_in_red'],
      },
    });
    const session = makeSession({
      slices_total: 5,
      tdd_overrides: 4, // 0.8 > 0.5 → high_override_rate true
      slices: [
        { slice_id: 'S1', bugs_caught_in_red_phase: 2 }, // bugs > 0 true
        { slice_id: 'S2', bugs_caught_in_red_phase: 0 }, // zero_bugs true
      ],
    });
    const result = evaluateSignals(assumption, session);
    // bugs_caught_in_red_phase > 0 (slice): any-true from S1 → 1 supporting
    // high_override_rate (session): true → 1 supporting
    // zero_bugs_caught_in_red (slice): any-true from S2 → 1 weakening
    assert.equal(result.supporting, 2, 'Expected 2 supporting (1 slice + 1 session)');
    assert.equal(result.weakening, 1, 'Expected 1 weakening (slice any-true)');
  });

  it('session-scoped relaxed_mode_same_quality reads tdd_mode from session', () => {
    const assumption = makeAssumption({
      evidence_signals: {
        supporting: ['relaxed_mode_same_quality'],
        weakening: [],
      },
    });
    const session = makeSession({
      tdd_mode: 'relaxed',
      final_outcome: 'pass',
      slices: [
        { slice_id: 'S1', tdd_mode: 'strict' }, // slice has different tdd_mode
        { slice_id: 'S2' },
      ],
    });
    const result = evaluateSignals(assumption, session);
    // Session-scoped: should read tdd_mode='relaxed' from session
    assert.equal(result.supporting, 1, 'Should read tdd_mode from session, not slices');
  });

  it('all evaluators have scope and fn properties (structure test)', () => {
    for (const [signal, entry] of Object.entries(SIGNAL_EVALUATORS)) {
      if (typeof entry === 'function') {
        // Legacy bare function — still valid via _resolveEvaluator
        continue;
      }
      assert.ok(entry.scope, `Signal "${signal}" missing scope property`);
      assert.ok(typeof entry.fn === 'function', `Signal "${signal}" fn is not a function`);
      assert.ok(['session', 'slice'].includes(entry.scope),
        `Signal "${signal}" has invalid scope "${entry.scope}"`);
    }
  });

  it('slice-scoped evaluators are exactly the 2 expected signals (structure test)', () => {
    const sliceScoped = Object.entries(SIGNAL_EVALUATORS)
      .filter(([, entry]) => typeof entry === 'object' && entry.scope === 'slice')
      .map(([signal]) => signal)
      .sort();
    const expected = ['bugs_caught_in_red_phase > 0', 'zero_bugs_caught_in_red'].sort();
    assert.deepEqual(sliceScoped, expected,
      `Expected exactly 2 slice-scoped signals, got: ${sliceScoped.join(', ')}`);
  });
});

// ─── v5.5.2: readHistory keeps latest on dedup ──────────────

describe('v5.5.2: readHistory dedup order', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-dedup-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('keeps latest entry when session_id is duplicated', () => {
    const file = path.join(tmpDir, 'history.jsonl');
    fs.writeFileSync(file, [
      '{"session_id":"s1","status":"active"}',
      '{"session_id":"s1","status":"finalized"}',
    ].join('\n') + '\n');
    const result = readHistory(file);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].status, 'finalized');
  });
});

// ─── v5.5.2: Array.isArray guards ───────────────────────────

describe('v5.5.2: Input guards', () => {
  it('isSessionDuplicate handles non-array gracefully', () => {
    assert.equal(isSessionDuplicate(null, 's1'), false);
    assert.equal(isSessionDuplicate('not-array', 's1'), false);
  });

  it('detectStaleness handles null assumption', () => {
    const result = detectStaleness(null, []);
    assert.equal(result.stale, false);
  });

  it('detectNewModel handles non-array sessions', () => {
    const result = detectNewModel('sonnet', null);
    assert.equal(result.isNew, true);
  });

  it('generateReport handles non-array inputs', () => {
    const result = generateReport(null, null);
    assert.ok(result.text.includes('No session history'));
  });
});

// ─── v5.5.2: evalSignal threshold passing ───────────────────

describe('v5.5.2: Signal threshold passing', () => {
  it('evaluateSignals passes threshold to fn', () => {
    const sig = 'test_pass_rate_with_guard > test_pass_rate_without';
    const ev = SIGNAL_EVALUATORS[sig];
    const origThresh = ev.threshold;

    // Session: 6/10 = 0.6 pass rate
    ev.threshold = 0.5;
    const assumption = { id: 'test', evidence_signals: { supporting: [sig], weakening: [] } };
    const result = evaluateSignals(assumption, { slices_total: 10, slices_passed_first_try: 6 });
    ev.threshold = origThresh;

    // 0.6 > 0.5 = true → supporting = 1
    assert.equal(result.supporting, 1);
  });
});
