#!/usr/bin/env node
/**
 * assumption-engine.js — Self-Evolving Harness: Assumption Engine for deep-work v5.0
 *
 * Validates whether deep-work's enforcement assumptions are still load-bearing
 * by analyzing session history against a machine-readable assumption registry.
 *
 * Core functions (all pure — read files, return data):
 * - readRegistry()           — Load assumptions.json
 * - readHistory()            — Load harness-sessions.jsonl
 * - rebuildFromReceipts()    — Regenerate JSONL from receipt files
 * - wilsonScore()            — Lower bound of Wilson confidence interval
 * - calculateConfidence()    — Model-aware confidence with Wilson scoring
 * - detectStaleness()        — Flag assumptions not tested in N sessions
 * - detectNewModel()         — Cold start guard for new model families
 * - evaluateSignals()        — Map evidence signals to session data (per-slice)
 * - generateReport()         — Human-readable assumption health report
 * - generateTimeline()       — ASCII trend chart of confidence over time
 * - exportBadge()            — shields.io JSON badge for README
 *
 * Follows phase-guard-core.js conventions:
 * - Pure functions with JSDoc
 * - stdin/stdout JSON when run as CLI
 * - module.exports for testing
 *
 * Error handling:
 * - ENOENT → fallback defaults (empty registry/history)
 * - Malformed JSON → skip line + warn via warnings array
 * - Schema version mismatch → forward-compat (read what we can)
 * - Division by zero → guard in wilsonScore and confidence
 * - Orphan assumption IDs → skip silently
 * - Session dedupe → check session_id before append
 */

const fs = require('fs');
const path = require('path');

// ─── Constants ──────────────────────────────────────────────

const SCHEMA_VERSION = '1.0';

const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.7,
  MEDIUM: 0.4,
};

const DEFAULT_STALENESS_THRESHOLD = 10;

// ─── Registry ───────────────────────────────────────────────

/**
 * Reads the assumption registry from disk.
 * @param {string} registryPath - Path to assumptions.json
 * @returns {{ assumptions: object[], schema_version: string, warnings: string[] }}
 */
function readRegistry(registryPath) {
  const warnings = [];
  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed.schema_version !== SCHEMA_VERSION) {
      warnings.push(
        `Registry schema_version "${parsed.schema_version}" differs from engine "${SCHEMA_VERSION}". ` +
        `Proceeding with forward-compat.`
      );
    }

    if (!Array.isArray(parsed.assumptions)) {
      warnings.push('Registry "assumptions" field is not an array. Using empty.');
      return { assumptions: [], schema_version: parsed.schema_version || SCHEMA_VERSION, warnings };
    }

    return {
      assumptions: parsed.assumptions,
      schema_version: parsed.schema_version || SCHEMA_VERSION,
      warnings,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { assumptions: [], schema_version: SCHEMA_VERSION, warnings: ['Registry file not found, using empty defaults.'] };
    }
    warnings.push(`Failed to read registry: ${err.message}`);
    return { assumptions: [], schema_version: SCHEMA_VERSION, warnings };
  }
}

// ─── History ────────────────────────────────────────────────

/**
 * Reads session history from a JSONL file.
 * Skips malformed lines and deduplicates by session_id.
 * @param {string} historyPath - Path to harness-sessions.jsonl
 * @returns {{ sessions: object[], warnings: string[] }}
 */
function readHistory(historyPath) {
  const warnings = [];
  try {
    const raw = fs.readFileSync(historyPath, 'utf8');
    const lines = raw.split('\n').filter(line => line.trim().length > 0);
    const sessions = [];
    const seenIds = new Set();

    for (let i = 0; i < lines.length; i++) {
      try {
        const session = JSON.parse(lines[i]);
        if (session.session_id && seenIds.has(session.session_id)) {
          warnings.push(`Duplicate session_id "${session.session_id}" at line ${i + 1}, skipping.`);
          continue;
        }
        if (session.session_id) {
          seenIds.add(session.session_id);
        }
        sessions.push(session);
      } catch (parseErr) {
        warnings.push(`Malformed JSON at line ${i + 1}, skipping.`);
      }
    }

    return { sessions, warnings };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessions: [], warnings: ['History file not found, using empty.'] };
    }
    warnings.push(`Failed to read history: ${err.message}`);
    return { sessions: [], warnings };
  }
}

/**
 * Checks if a session_id already exists in the history.
 * @param {object[]} sessions - Existing sessions
 * @param {string} sessionId - ID to check
 * @returns {boolean}
 */
function isSessionDuplicate(sessions, sessionId) {
  if (!sessionId) return false;
  return sessions.some(s => s.session_id === sessionId);
}

// ─── Rebuild from Receipts ──────────────────────────────────

/**
 * Rebuilds session history by scanning receipt directories.
 * @param {string} workDir - Project work directory
 * @param {string[]} [receiptDirs] - Optional list of receipt directories to scan
 * @returns {{ sessions: object[], warnings: string[] }}
 */
function rebuildFromReceipts(workDir, receiptDirs) {
  const warnings = [];
  const sessions = [];

  if (!workDir) {
    return { sessions, warnings: ['No work directory provided.'] };
  }

  // Default: scan workDir/receipts/
  const dirs = receiptDirs || [];
  if (dirs.length === 0) {
    const defaultReceiptDir = path.join(workDir, 'receipts');
    if (fs.existsSync(defaultReceiptDir)) {
      dirs.push(defaultReceiptDir);
    } else {
      return { sessions, warnings: ['No receipt directories found.'] };
    }
  }

  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, file), 'utf8');
          const receipt = JSON.parse(raw);
          // Extract session-level data from receipt
          if (receipt && receipt.slice_id) {
            sessions.push({
              session_id: receipt.session_id || `rebuilt-${file}`,
              source: 'receipt_rebuild',
              slice_id: receipt.slice_id,
              status: receipt.status,
              tdd_state: receipt.tdd_state,
              harness_metadata: receipt.harness_metadata || {},
            });
          }
        } catch (parseErr) {
          warnings.push(`Failed to parse receipt ${file}: ${parseErr.message}`);
        }
      }
    } catch (readErr) {
      warnings.push(`Failed to read directory ${dir}: ${readErr.message}`);
    }
  }

  return { sessions, warnings };
}

// ─── Wilson Score ────────────────────────────────────────────

/**
 * Computes the lower bound of the Wilson score confidence interval.
 * Used instead of a simple ratio to account for sample size.
 *
 * With small samples, Wilson score is conservative (lower bound).
 * With large samples, it converges toward the raw ratio.
 *
 * @param {number} positive - Number of supporting signals
 * @param {number} total - Total signals (supporting + weakening)
 * @param {number} [z=1.96] - Z-score for confidence level (1.96 = 95%)
 * @returns {number} Lower bound of confidence interval [0, 1]
 */
function wilsonScore(positive, total, z) {
  if (typeof z === 'undefined') z = 1.96;

  // Guard: division by zero or no data
  if (total === 0) return 0;
  if (positive < 0) positive = 0;
  if (positive > total) positive = total;

  const phat = positive / total;
  const z2 = z * z;

  const numerator = phat + z2 / (2 * total) -
    z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  const denominator = 1 + z2 / total;

  const score = numerator / denominator;
  return Math.max(0, Math.min(1, score));
}

// ─── Confidence Calculation ─────────────────────────────────

/**
 * Calculates confidence for an assumption, optionally split by model.
 * @param {object} assumption - Assumption from registry
 * @param {object[]} sessions - Session history entries
 * @param {object} [options] - { splitByModel: boolean }
 * @returns {{ overall: { score: number, category: string, supporting: number, weakening: number, neutral: number, total: number }, byModel?: object, insufficient: boolean }}
 */
function calculateConfidence(assumption, sessions, options) {
  const opts = options || {};
  const minSessions = assumption.minimum_sessions_for_evaluation || 5;

  // Evaluate signals for all sessions
  const evaluated = sessions.map(s => evaluateSignals(assumption, s));

  const overall = _computeConfidenceFromEvaluated(evaluated, minSessions);

  const result = { overall, insufficient: overall.total < minSessions };

  // Model-aware split
  if (opts.splitByModel) {
    const byModel = {};
    const modelGroups = {};
    for (let i = 0; i < sessions.length; i++) {
      const model = sessions[i].model_primary || 'unknown';
      if (!modelGroups[model]) modelGroups[model] = [];
      modelGroups[model].push(evaluated[i]);
    }
    for (const [model, evals] of Object.entries(modelGroups)) {
      byModel[model] = _computeConfidenceFromEvaluated(evals, minSessions);
    }
    result.byModel = byModel;
  }

  return result;
}

/**
 * Internal: compute confidence from an array of evaluated signal results.
 * @param {object[]} evaluated - Array of { supporting, weakening, neutral }
 * @param {number} minSessions - Minimum sessions for evaluation
 * @returns {{ score: number, category: string, supporting: number, weakening: number, neutral: number, total: number }}
 */
function _computeConfidenceFromEvaluated(evaluated, minSessions) {
  let supporting = 0;
  let weakening = 0;
  let neutral = 0;

  for (const e of evaluated) {
    supporting += e.supporting;
    weakening += e.weakening;
    neutral += e.neutral;
  }

  const total = evaluated.length;
  const signalTotal = supporting + weakening;
  const score = wilsonScore(supporting, signalTotal);

  let category;
  if (total < minSessions) {
    category = 'INSUFFICIENT';
  } else if (score >= CONFIDENCE_THRESHOLDS.HIGH) {
    category = 'HIGH';
  } else if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) {
    category = 'MEDIUM';
  } else {
    category = 'LOW';
  }

  return { score, category, supporting, weakening, neutral, total };
}

// ─── Staleness Detection ────────────────────────────────────

/**
 * Detects whether an assumption is stale (not recently tested).
 * @param {object} assumption - Assumption from registry
 * @param {object[]} sessions - Session history entries
 * @param {number} [threshold] - Number of sessions without signal before stale
 * @returns {{ stale: boolean, sessionsSinceLastSignal: number, threshold: number }}
 */
function detectStaleness(assumption, sessions, threshold) {
  const thresh = threshold ||
    assumption.staleness_threshold ||
    DEFAULT_STALENESS_THRESHOLD;

  if (sessions.length === 0) {
    return { stale: false, sessionsSinceLastSignal: 0, threshold: thresh, reason: 'no_history' };
  }

  // Walk sessions from newest to oldest to find last signal
  let sessionsSinceLastSignal = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const result = evaluateSignals(assumption, sessions[i]);
    if (result.supporting > 0 || result.weakening > 0) {
      break;
    }
    sessionsSinceLastSignal++;
  }

  // If we went through all sessions without finding a signal
  if (sessionsSinceLastSignal === sessions.length) {
    return { stale: true, sessionsSinceLastSignal, threshold: thresh, reason: 'no_signals_ever' };
  }

  return {
    stale: sessionsSinceLastSignal >= thresh,
    sessionsSinceLastSignal,
    threshold: thresh,
  };
}

// ─── New Model Detection ────────────────────────────────────

/**
 * Detects whether the current model is new (no history).
 * @param {string} currentModel - Current model_primary identifier
 * @param {object[]} sessions - Session history entries
 * @returns {{ isNew: boolean, sessionsWithModel: number, totalSessions: number }}
 */
function detectNewModel(currentModel, sessions) {
  if (!currentModel || sessions.length === 0) {
    return { isNew: true, sessionsWithModel: 0, totalSessions: sessions.length };
  }

  const sessionsWithModel = sessions.filter(s => s.model_primary === currentModel).length;
  return {
    isNew: sessionsWithModel === 0,
    sessionsWithModel,
    totalSessions: sessions.length,
  };
}

// ─── Signal Evaluation ──────────────────────────────────────

/**
 * Signal evaluation map: maps signal labels to { scope, fn } objects.
 * - scope: 'session' — evaluate once against the session object
 * - scope: 'slice'   — evaluate per slice, aggregate with any-true
 * Each fn takes (data, session) and returns a boolean or null.
 * Unmapped signals are silently ignored.
 *
 * Legacy compatibility: bare functions are treated as { scope: 'session', fn }.
 */
const SIGNAL_EVALUATORS = {
  // Phase Guard signals
  'test_pass_rate_with_guard > test_pass_rate_without': {
    scope: 'session',
    fn: (session) => {
      if (!session.slices_total) return null;
      return session.slices_passed_first_try / session.slices_total > 0.8;
    },
  },
  'high_override_rate': {
    scope: 'session',
    fn: (session) => {
      if (!session.slices_total) return null;
      return (session.tdd_overrides || 0) / session.slices_total > 0.5;
    },
  },
  'zero_rework_after_override': {
    scope: 'session',
    fn: (session) => {
      if (session.tdd_overrides === undefined || session.tdd_overrides === 0) return null;
      return (session.test_retry_count || 0) === 0;
    },
  },
  'model_passes_all_tests_first_try': {
    scope: 'session',
    fn: (session) => {
      if (!session.slices_total) return null;
      return session.slices_passed_first_try === session.slices_total;
    },
  },

  // TDD signals — slice-scoped (per-slice bugs data)
  'bugs_caught_in_red_phase > 0': {
    scope: 'slice',
    fn: (slice, _session) => {
      return (slice.bugs_caught_in_red_phase || 0) > 0;
    },
  },
  'rework_count_strict < rework_count_relaxed': {
    scope: 'session',
    fn: (session) => {
      // Can only evaluate if mode is strict and we have rework data
      if (session.tdd_mode !== 'strict') return null;
      return (session.test_retry_count || 0) === 0;
    },
  },
  'override_rate > 50%': {
    scope: 'session',
    fn: (session) => {
      if (!session.slices_total) return null;
      return (session.tdd_overrides || 0) / session.slices_total > 0.5;
    },
  },
  'zero_bugs_caught_in_red': {
    scope: 'slice',
    fn: (slice, _session) => {
      return (slice.bugs_caught_in_red_phase || 0) === 0;
    },
  },
  'relaxed_mode_same_quality': {
    scope: 'session',
    fn: (session) => {
      if (session.tdd_mode !== 'relaxed') return null;
      return session.final_outcome === 'pass';
    },
  },

  // Research signals
  'plan_review_score_with_research > plan_review_score_without': {
    scope: 'session',
    fn: (session) => {
      if (!session.review_scores || !session.phases_used) return null;
      const hasResearch = session.phases_used.includes('research');
      if (!hasResearch) return null;
      return (session.review_scores.plan || 0) >= 7;
    },
  },
  'research_findings_not_referenced_in_plan': {
    scope: 'session',
    fn: (session) => {
      if (!session.phases_used) return null;
      const hasResearch = session.phases_used.includes('research');
      if (!hasResearch) return null;
      return (session.research_references_used || 0) === 0;
    },
  },
  'plan_score_high_despite_shallow_research': {
    scope: 'session',
    fn: (session) => {
      if (!session.review_scores || !session.phases_used) return null;
      const hasResearch = session.phases_used.includes('research');
      if (hasResearch) return null; // Only for sessions without research
      return (session.review_scores.plan || 0) >= 7;
    },
  },

  // Cross-model review signals
  'cross_model_found_unique_issues > 0': {
    scope: 'session',
    fn: (session) => {
      return (session.cross_model_unique_findings || 0) > 0;
    },
  },
  'plan_revision_after_cross_review': {
    scope: 'session',
    fn: (session) => {
      // Approximation: cross model findings led to action
      return (session.cross_model_unique_findings || 0) > 0;
    },
  },
  'cross_model_agrees_with_claude_always': {
    scope: 'session',
    fn: (session) => {
      return (session.cross_model_unique_findings || 0) === 0;
    },
  },
  'zero_actionable_findings': {
    scope: 'session',
    fn: (session) => {
      return (session.cross_model_unique_findings || 0) === 0;
    },
  },

  // Receipt signals
  'receipt_data_contradicts_model_claim': {
    scope: 'session',
    fn: (session) => {
      // Can only be detected from detailed receipt analysis
      const meta = session.harness_metadata || {};
      return meta.receipt_contradictions ? meta.receipt_contradictions > 0 : null;
    },
  },
  'test_phase_catches_receipt_gap': {
    scope: 'session',
    fn: (session) => {
      const meta = session.harness_metadata || {};
      return meta.receipt_gaps_caught ? meta.receipt_gaps_caught > 0 : null;
    },
  },
  'receipts_always_match_model_claims': {
    scope: 'session',
    fn: (session) => {
      const meta = session.harness_metadata || {};
      if (meta.receipt_contradictions === undefined) return null;
      return meta.receipt_contradictions === 0;
    },
  },
  'receipt_data_never_referenced_in_test_phase': {
    scope: 'session',
    fn: (session) => {
      const meta = session.harness_metadata || {};
      return meta.receipts_referenced_in_test === false;
    },
  },

  // Evaluator model signals (v5.1)
  'evaluator_found_real_issues': {
    scope: 'session',
    fn: (session) => {
      if (!session.review_scores) return null;
      return (session.review_scores.plan_revisions_from_review || 0) > 0;
    },
  },
  'no_missed_issues_in_test_phase': {
    scope: 'session',
    fn: (session) => {
      return (session.test_retry_count || 0) === 0;
    },
  },
  'evaluator_zero_findings_consistently': {
    scope: 'session',
    fn: (session) => {
      if (!session.review_scores) return null;
      return (session.review_scores.plan || 10) >= 9 &&
        (session.review_scores.plan_revisions_from_review || 0) === 0;
    },
  },
  'missed_issues_caught_in_test': {
    scope: 'session',
    fn: (session) => {
      if (!session.review_scores) return null;
      return (session.test_retry_count || 0) > 0 &&
        (session.review_scores.plan || 0) >= 7;
    },
  },
};

/**
 * Resolves a SIGNAL_EVALUATORS entry to a normalized { scope, fn } object.
 * Supports both legacy bare functions and new { scope, fn } format.
 * @param {string} signal - Signal label key
 * @returns {{ scope: string, fn: Function }|null}
 */
function _resolveEvaluator(signal) {
  const entry = SIGNAL_EVALUATORS[signal];
  if (!entry) return null;
  if (typeof entry === 'function') return { scope: 'session', fn: entry };
  return entry;
}

// ─── Quality Cohort Helpers (v5.3) ─────────────────────────

/**
 * Partitions sessions into active/inactive cohorts for a given assumption.
 * Uses the assumption_snapshot field from each session record.
 * Active = enforcement is the default/strongest level; Inactive = weakened/off/skipped.
 * @param {string} assumptionId - The assumption ID
 * @param {object[]} sessions - Session history entries
 * @returns {{ active: object[], inactive: object[] }}
 */
function partitionByAssumption(assumptionId, sessions) {
  const active = [];
  const inactive = [];

  for (const session of sessions) {
    if (!session.assumption_snapshot || session.quality_score == null) continue;
    const level = session.assumption_snapshot[assumptionId];
    if (!level) continue;

    // Determine if this level counts as "active" (full enforcement) or "inactive" (weakened)
    const inactiveLevels = ['off', 'relaxed', 'optional', 'skipped', 'spike'];
    if (inactiveLevels.includes(level)) {
      inactive.push(session);
    } else {
      active.push(session);
    }
  }

  return { active, inactive };
}

function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── Signal Evaluation ─────────────────────────────────────

/**
 * Evaluates evidence signals for an assumption against a single session.
 *
 * Scope-aware evaluation:
 * - Session-scoped signals: evaluate once against the session object.
 * - Slice-scoped signals: evaluate per slice using session.slices || [session],
 *   aggregate with any-true (count at most 1 per signal).
 *
 * @param {object} assumption - Assumption from registry
 * @param {object} session - Single session from history
 * @returns {{ supporting: number, weakening: number, neutral: number, details: object[] }}
 */
function evaluateSignals(assumption, session) {
  if (!assumption || !assumption.evidence_signals) {
    return { supporting: 0, weakening: 0, neutral: 1, details: [] };
  }

  const details = [];
  let supporting = 0;
  let weakening = 0;

  const slices = session.slices || [session];

  /**
   * Evaluate a single signal against the session/slices based on its scope.
   * @param {string} signal - Signal label
   * @param {string} type - 'supporting' or 'weakening'
   */
  function evalSignal(signal, type) {
    const resolved = _resolveEvaluator(signal);
    if (!resolved) return; // Unmapped signal — skip silently

    if (resolved.scope === 'slice') {
      // Slice-scoped: evaluate per slice, any-true aggregation (count at most 1)
      let anyTrue = false;
      for (const slice of slices) {
        const result = resolved.fn(slice, session);
        if (result === true) {
          anyTrue = true;
          details.push({ signal, type, value: true, slice_id: slice.slice_id });
          break; // any-true: stop at first true
        } else if (result === false) {
          details.push({ signal, type, value: false, slice_id: slice.slice_id });
        }
        // result === null means not applicable
      }
      if (anyTrue) {
        if (type === 'supporting') supporting++;
        else weakening++;
      }
    } else {
      // Session-scoped: evaluate once against the session object
      const result = resolved.fn(session);
      if (result === true) {
        if (type === 'supporting') supporting++;
        else weakening++;
        details.push({ signal, type, value: true });
      } else if (result === false) {
        details.push({ signal, type, value: false });
      }
      // result === null means not applicable for this session
    }
  }

  // Evaluate supporting signals
  for (const signal of (assumption.evidence_signals.supporting || [])) {
    evalSignal(signal, 'supporting');
  }

  // Evaluate weakening signals
  for (const signal of (assumption.evidence_signals.weakening || [])) {
    evalSignal(signal, 'weakening');
  }

  const neutral = (supporting === 0 && weakening === 0) ? 1 : 0;

  return { supporting, weakening, neutral, details };
}

// ─── Report Generation ──────────────────────────────────────

/**
 * Generates a human-readable assumption health report.
 * @param {object[]} assumptions - Array of assumptions from registry
 * @param {object[]} sessions - Session history entries
 * @param {object} [options] - { splitByModel: boolean, verbose: boolean }
 * @returns {{ text: string, data: object[] }}
 */
function generateReport(assumptions, sessions, options) {
  const opts = options || {};
  const data = [];
  const lines = [];

  lines.push(`ASSUMPTION HEALTH REPORT (${sessions.length} sessions analyzed)`);
  lines.push('='.repeat(56));
  lines.push('');

  if (sessions.length === 0) {
    lines.push('No session history available. Run deep-work sessions to collect data.');
    return { text: lines.join('\n'), data };
  }

  const proposedChanges = [];

  for (let i = 0; i < assumptions.length; i++) {
    const assumption = assumptions[i];
    const confidence = calculateConfidence(assumption, sessions, { splitByModel: opts.splitByModel });
    const staleness = detectStaleness(assumption, sessions);

    const entry = {
      id: assumption.id,
      hypothesis: assumption.hypothesis,
      confidence,
      staleness,
      current_enforcement: assumption.current_enforcement,
      adjustable_levels: assumption.adjustable_levels,
    };

    let verdict, reason;
    if (confidence.insufficient) {
      verdict = 'INSUFFICIENT DATA';
      reason = `Need ${assumption.minimum_sessions_for_evaluation} sessions, have ${confidence.overall.total}`;
    } else if (staleness.stale) {
      verdict = 'STALE';
      reason = `No signal in last ${staleness.sessionsSinceLastSignal} sessions (threshold: ${staleness.threshold})`;
    } else if (confidence.overall.category === 'HIGH') {
      verdict = 'KEEP';
      reason = `at current level (${assumption.current_enforcement})`;
    } else if (confidence.overall.category === 'MEDIUM') {
      verdict = 'CONSIDER';
      const levels = assumption.adjustable_levels || [];
      const currentIdx = levels.indexOf(assumption.current_enforcement);
      const nextLevel = currentIdx >= 0 && currentIdx < levels.length - 1
        ? levels[currentIdx + 1]
        : null;
      if (nextLevel) {
        reason = `loosening to "${nextLevel}"`;
        proposedChanges.push({
          id: assumption.id,
          from: assumption.current_enforcement,
          to: nextLevel,
        });
      } else {
        reason = 'reviewing enforcement level';
      }
    } else {
      verdict = 'RECOMMEND';
      const levels = assumption.adjustable_levels || [];
      const currentIdx = levels.indexOf(assumption.current_enforcement);
      const nextLevel = currentIdx >= 0 && currentIdx < levels.length - 1
        ? levels[currentIdx + 1]
        : null;
      if (nextLevel) {
        reason = `loosening to "${nextLevel}"`;
        proposedChanges.push({
          id: assumption.id,
          from: assumption.current_enforcement,
          to: nextLevel,
        });
      } else {
        reason = 'reviewing enforcement level';
      }
    }

    entry.verdict = verdict;
    entry.reason = reason;
    data.push(entry);

    const o = confidence.overall;
    lines.push(`${i + 1}. ${assumption.id}`);
    lines.push(`   Hypothesis: ${assumption.hypothesis}`);
    lines.push(`   Evidence:   ${o.supporting} supporting / ${o.weakening} weakening / ${o.neutral} neutral`);
    lines.push(`   Confidence: ${o.category} (${o.score.toFixed(2)})`);
    lines.push(`   Verdict:    ${verdict} ${reason}`);

    if (staleness.stale) {
      lines.push(`   WARNING:    Stale — no signal in ${staleness.sessionsSinceLastSignal} sessions`);
    }

    // Quality Impact (v5.3)
    const cohorts = partitionByAssumption(assumption.id, sessions);
    if (cohorts.active.length >= 3 && cohorts.inactive.length >= 3) {
      const activeAvg = average(cohorts.active.map(s => s.quality_score).filter(q => q != null));
      const inactiveAvg = average(cohorts.inactive.map(s => s.quality_score).filter(q => q != null));
      const delta = Math.round(activeAvg - inactiveAvg);
      const sign = delta >= 0 ? '+' : '';
      lines.push(`   Quality Impact: ${sign}${delta}pts`);
      lines.push(`   Active: ${cohorts.active.length} sessions (avg ${Math.round(activeAvg)}) vs Inactive: ${cohorts.inactive.length} sessions (avg ${Math.round(inactiveAvg)})`);
    } else {
      const totalNeeded = 3;
      const activeGap = Math.max(0, totalNeeded - cohorts.active.length);
      const inactiveGap = Math.max(0, totalNeeded - cohorts.inactive.length);
      let gapMsg = 'collecting data';
      if (activeGap > 0) gapMsg += ` — need ${activeGap} more active sessions`;
      if (inactiveGap > 0) gapMsg += ` — need ${inactiveGap} more inactive sessions`;
      lines.push(`   Quality Impact: ${gapMsg}`);
    }

    // Model-aware breakdown
    if (opts.splitByModel && confidence.byModel) {
      for (const [model, mc] of Object.entries(confidence.byModel)) {
        lines.push(`   [${model}]: ${mc.category} (${mc.score.toFixed(2)}) — ${mc.supporting}S/${mc.weakening}W/${mc.total} sessions`);
      }
    }

    lines.push('');
  }

  // Proposed changes section
  if (proposedChanges.length > 0) {
    lines.push('PROPOSED CONFIG CHANGES (for manual application):');
    for (const change of proposedChanges) {
      lines.push(`  ${change.id}: ${change.from} -> ${change.to}`);
    }
    lines.push('');
    lines.push('To apply: update enforcement in /deep-work session init or .claude/deep-work.local.md');
    lines.push('(Auto-application is a Phase 2 feature — MVP is report-only)');
  } else {
    lines.push('No changes recommended at this time.');
  }

  return { text: lines.join('\n'), data };
}

// ─── Timeline ───────────────────────────────────────────────

/**
 * Generates an ASCII trend chart showing confidence evolution over time.
 * Groups sessions into windows and shows confidence per window.
 * @param {object} assumption - Single assumption from registry
 * @param {object[]} sessions - Session history entries (ordered by time)
 * @param {object} [options] - { windowSize: number, width: number, height: number }
 * @returns {string} ASCII chart
 */
function generateTimeline(assumption, sessions, options) {
  const opts = options || {};
  const windowSize = opts.windowSize || 3;
  const width = opts.width || 40;
  const height = opts.height || 10;

  if (sessions.length === 0) {
    return `[${assumption.id}] No history available.`;
  }

  // Build confidence scores per window
  const scores = [];
  for (let i = 0; i < sessions.length; i += windowSize) {
    const window = sessions.slice(i, i + windowSize);
    const evaluated = window.map(s => evaluateSignals(assumption, s));
    let sup = 0, weak = 0;
    for (const e of evaluated) {
      sup += e.supporting;
      weak += e.weakening;
    }
    const total = sup + weak;
    scores.push(total > 0 ? wilsonScore(sup, total) : 0);
  }

  if (scores.length === 0) {
    return `[${assumption.id}] No data windows.`;
  }

  // Render ASCII chart
  const lines = [];
  lines.push(`[${assumption.id}] Confidence Timeline`);
  lines.push(`${'─'.repeat(width + 6)}`);

  for (let row = height; row >= 0; row--) {
    const threshold = row / height;
    let label;
    if (row === height) label = '1.0';
    else if (row === Math.round(height * CONFIDENCE_THRESHOLDS.HIGH)) label = '0.7';
    else if (row === Math.round(height * CONFIDENCE_THRESHOLDS.MEDIUM)) label = '0.4';
    else if (row === 0) label = '0.0';
    else label = '   ';

    let rowStr = label.padStart(3) + ' |';
    const barWidth = Math.min(scores.length, width);
    for (let col = 0; col < barWidth; col++) {
      const scoreRow = Math.round(scores[col] * height);
      if (scoreRow >= row && row > 0) {
        rowStr += '\u2588'; // full block
      } else if (row === Math.round(height * CONFIDENCE_THRESHOLDS.HIGH)) {
        rowStr += '-';
      } else if (row === Math.round(height * CONFIDENCE_THRESHOLDS.MEDIUM)) {
        rowStr += '-';
      } else {
        rowStr += ' ';
      }
    }
    lines.push(rowStr);
  }

  lines.push('    +' + '─'.repeat(Math.min(scores.length, width)));
  lines.push('     ' + 'oldest'.padEnd(Math.min(scores.length, width) - 6) + 'newest');

  return lines.join('\n');
}

// ─── Quality Timeline (v5.3) ───────────────────────────────

/**
 * Generates an ASCII trend chart showing quality score evolution over sessions.
 * @param {object[]} sessions - Session history entries (ordered by time)
 * @param {object} [options] - { width: number, height: number }
 * @returns {string} ASCII chart + summary stats
 */
function generateQualityTimeline(sessions, options) {
  const opts = options || {};
  const width = opts.width || 40;
  const height = opts.height || 8;

  // Filter to finalized sessions with quality_score
  const scored = sessions.filter(s => s.quality_score != null && s.status === 'finalized');

  if (scored.length < 2) {
    return 'Quality trend requires at least 2 completed sessions with quality scores.';
  }

  const scores = scored.map(s => s.quality_score);
  const maxScore = 100;

  // Render ASCII chart
  const lines = [];
  lines.push('Quality Trend (last ' + scored.length + ' sessions)');
  lines.push('═'.repeat(width + 6));

  for (let row = height; row >= 0; row--) {
    const threshold = (row / height) * maxScore;
    let label;
    if (row === height) label = '100';
    else if (row === 0) label = '  0';
    else if (row === Math.round(height * 0.8)) label = ' 80';
    else if (row === Math.round(height * 0.6)) label = ' 60';
    else label = '   ';

    let rowStr = label + '|';
    const barWidth = Math.min(scored.length, width);
    for (let col = 0; col < barWidth; col++) {
      const scoreRow = Math.round((scores[col] / maxScore) * height);
      if (scoreRow >= row && row > 0) {
        rowStr += '*';
      } else {
        rowStr += ' ';
      }
    }
    lines.push(rowStr);
  }

  lines.push('   +' + '─'.repeat(Math.min(scored.length, width)));

  // Summary stats
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const bestIdx = scores.indexOf(best);
  const worstIdx = scores.indexOf(worst);

  // Trend: compare last 3 avg vs first 3 avg
  let trendStr = '';
  if (scores.length >= 4) {
    const recentAvg = average(scores.slice(-3));
    const earlyAvg = average(scores.slice(0, 3));
    const delta = Math.round(recentAvg - earlyAvg);
    trendStr = delta >= 0 ? `↑ (+${delta})` : `↓ (${delta})`;
  }

  lines.push('');
  lines.push(`Average: ${avg}/100  ${trendStr ? 'Trend: ' + trendStr : ''}`);
  lines.push(`Best: #${bestIdx + 1} (${best})  Worst: #${worstIdx + 1} (${worst})`);

  return lines.join('\n');
}

// ─── Badge Export ───────────────────────────────────────────

/**
 * Exports a shields.io compatible JSON badge.
 * @param {object[]} assumptions - Array of assumptions from registry
 * @param {object[]} sessions - Session history entries
 * @returns {object} shields.io endpoint badge JSON
 */
function exportBadge(assumptions, sessions) {
  if (assumptions.length === 0 || sessions.length === 0) {
    return {
      schemaVersion: 1,
      label: 'harness health',
      message: 'no data',
      color: 'lightgrey',
    };
  }

  let totalScore = 0;
  let evaluated = 0;

  for (const assumption of assumptions) {
    const confidence = calculateConfidence(assumption, sessions);
    if (!confidence.insufficient) {
      totalScore += confidence.overall.score;
      evaluated++;
    }
  }

  if (evaluated === 0) {
    return {
      schemaVersion: 1,
      label: 'harness health',
      message: 'insufficient data',
      color: 'lightgrey',
    };
  }

  const avgScore = totalScore / evaluated;
  const pct = Math.round(avgScore * 100);

  let color;
  if (avgScore >= CONFIDENCE_THRESHOLDS.HIGH) {
    color = 'brightgreen';
  } else if (avgScore >= CONFIDENCE_THRESHOLDS.MEDIUM) {
    color = 'yellow';
  } else {
    color = 'red';
  }

  return {
    schemaVersion: 1,
    label: 'harness health',
    message: `${pct}%`,
    color,
  };
}

// ─── Auto-Adjust (v5.1) ───────────────────────────────────────

/**
 * Mapping from assumption IDs to config fields and their adjustment levels.
 * Levels are ordered from strictest to most relaxed.
 * Floor is the last allowed level (auto-adjust will not go below it).
 */
const AUTO_ADJUST_MAP = {
  tdd_required_before_implement: {
    field: 'tdd_mode',
    levels: ['strict', 'coaching', 'relaxed', 'off'],
    floor: 'coaching',
    default: 'strict',
  },
  receipt_collection_ensures_evidence: {
    field: 'receipt_depth',
    levels: ['full', 'minimal'],
    floor: 'minimal',
    default: 'full',
  },
  evaluator_model_quality: {
    field: 'evaluator_model',
    levels: ['opus', 'sonnet', 'haiku'],
    floor: 'haiku',
    default: 'sonnet',
  },
};

const AUTO_ADJUST_THRESHOLDS = {
  HIGH: 0.7,
  MEDIUM: 0.3,
};

/**
 * Computes auto-adjustments based on session history and current config.
 * Pure function — reads no files, returns data only.
 *
 * @param {object[]} sessions - Session history entries
 * @param {object} currentConfig - Current config { tdd_mode, receipt_depth, evaluator_model, ... }
 * @param {object} [options] - {
 *   minSessions: number (cold start threshold, default 5),
 *   defaults: object (default config values for tightening comparison),
 *   userOverrides: object (session-level user flags that suppress adjustments),
 *   splitByModel: boolean,
 *   currentModel: string,
 *   tighteningMinSessions: number (min sessions at current level before tightening, default 3),
 *   registryPath: string (path to assumptions.json),
 * }
 * @returns {{
 *   adjustments: Array<{ field: string, from: string, to: string, score: number, reason: string, direction: 'relax'|'tighten', suppressed?: boolean }>,
 *   coldStart: boolean,
 *   notification: string,
 * }}
 */
function autoAdjust(sessions, currentConfig, options) {
  const opts = options || {};
  const minSessions = opts.minSessions || 5;
  const defaults = opts.defaults || { tdd_mode: 'strict', receipt_depth: 'full', evaluator_model: 'sonnet' };
  const userOverrides = opts.userOverrides || {};
  const tighteningMinSessions = opts.tighteningMinSessions || 3;

  if (sessions.length < minSessions) {
    return { adjustments: [], coldStart: true, notification: '' };
  }

  let assumptions = [];
  if (opts.registryPath) {
    const reg = readRegistry(opts.registryPath);
    assumptions = reg.assumptions;
  }

  const adjustments = [];

  for (const [assumptionId, mapping] of Object.entries(AUTO_ADJUST_MAP)) {
    const { field, levels, floor, default: defaultLevel } = mapping;
    const currentLevel = currentConfig[field] || defaultLevel;
    const currentIdx = levels.indexOf(currentLevel);
    const floorIdx = levels.indexOf(floor);

    if (currentIdx < 0) continue;

    const assumption = assumptions.find(a => a.id === assumptionId);
    if (!assumption) continue;

    let confidence;
    if (opts.splitByModel && opts.currentModel) {
      const modelSessions = sessions.filter(s => s.model_primary === opts.currentModel);
      if (modelSessions.length < minSessions) {
        confidence = calculateConfidence(assumption, sessions);
      } else {
        confidence = calculateConfidence(assumption, modelSessions);
      }
    } else {
      confidence = calculateConfidence(assumption, sessions);
    }

    const score = confidence.overall.score;
    if (confidence.insufficient) continue;

    const isSuppressed = field in userOverrides;

    let to = null;
    let direction = null;
    let reason = '';

    if (score >= AUTO_ADJUST_THRESHOLDS.HIGH) {
      const defaultIdx = levels.indexOf(defaultLevel);
      if (currentIdx > defaultIdx && sessions.length >= tighteningMinSessions) {
        const tightenIdx = Math.max(currentIdx - 1, defaultIdx);
        to = levels[tightenIdx];
        direction = 'tighten';
        reason = `score ${score.toFixed(2)} (HIGH) — evidence supports tightening back toward default`;
      }
    } else if (score >= AUTO_ADJUST_THRESHOLDS.MEDIUM) {
      const relaxIdx = Math.min(currentIdx + 1, floorIdx);
      if (relaxIdx !== currentIdx) {
        to = levels[relaxIdx];
        direction = 'relax';
        reason = `score ${score.toFixed(2)} (MEDIUM) — evidence weakening, relaxing one step`;
      }
    } else {
      if (currentIdx < floorIdx) {
        to = floor;
        direction = 'relax';
        reason = `score ${score.toFixed(2)} (LOW) — relaxing to floor`;
      }
    }

    if (to && to !== currentLevel) {
      adjustments.push({
        field,
        from: currentLevel,
        to,
        score,
        reason,
        direction,
        ...(isSuppressed ? { suppressed: true } : {}),
      });
    }
  }

  const activeAdjustments = adjustments.filter(a => !a.suppressed);
  let notification = '';
  if (activeAdjustments.length > 0) {
    const lines = activeAdjustments.map(a =>
      `  - ${a.field}: ${a.from} → ${a.to} (score ${a.score.toFixed(2)}, ${a.reason})`
    );
    notification = `Assumption Engine auto-adjustment:\n${lines.join('\n')}\n  Floors guaranteed. Run /deep-assumptions for details.`;
  }

  return { adjustments, coldStart: false, notification };
}

// ─── CLI Entry ──────────────────────────────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const parsed = JSON.parse(input);
      const { action, registryPath, historyPath, workDir, model, options } = parsed;

      let result;
      switch (action) {
        case 'report': {
          const registry = readRegistry(registryPath);
          const history = readHistory(historyPath);
          const report = generateReport(registry.assumptions, history.sessions, options);
          result = { ...report, warnings: [...registry.warnings, ...history.warnings] };
          break;
        }
        case 'timeline': {
          const registry = readRegistry(registryPath);
          const history = readHistory(historyPath);
          const timelines = {};
          for (const a of registry.assumptions) {
            timelines[a.id] = generateTimeline(a, history.sessions, options);
          }
          result = { timelines, warnings: [...registry.warnings, ...history.warnings] };
          break;
        }
        case 'badge': {
          const registry = readRegistry(registryPath);
          const history = readHistory(historyPath);
          result = exportBadge(registry.assumptions, history.sessions);
          break;
        }
        case 'detect-model': {
          const history = readHistory(historyPath);
          result = detectNewModel(model, history.sessions);
          break;
        }
        case 'rebuild': {
          result = rebuildFromReceipts(workDir, options && options.receiptDirs);
          break;
        }
        case 'auto-adjust': {
          const registry = readRegistry(registryPath);
          const history = readHistory(historyPath);
          const config = parsed.config || {};
          const adjustOptions = {
            ...(options || {}),
            registryPath,
          };
          result = autoAdjust(history.sessions, config, adjustOptions);
          result.warnings = [...registry.warnings, ...history.warnings];
          break;
        }
        case 'quality-timeline': {
          const history = readHistory(input.historyPath);
          result = { text: generateQualityTimeline(history.sessions, input.options), warnings: history.warnings };
          break;
        }
        default:
          result = { error: `Unknown action: ${action}` };
      }

      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    } catch (err) {
      process.stderr.write(`assumption-engine error: ${err.message}\n`);
      process.stdout.write(JSON.stringify({ error: err.message }));
      process.exit(0);
    }
  });
}

// ─── Exports (for testing) ──────────────────────────────────

module.exports = {
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
  generateQualityTimeline,
  partitionByAssumption,
  average,
  exportBadge,
  autoAdjust,
};
