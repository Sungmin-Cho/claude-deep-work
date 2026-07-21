'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PROFILE_BY_CLASS, EFFORT_CATALOG } = require('./policy-runtime.js');
const { CLASS_ORDER } = require('./risk-runtime.js');

const ARTIFACT_KINDS = Object.freeze(['document', 'slice-diff', 'cross-slice', 'session-final']);
const REVIEW_MATRIX = Object.freeze({
  low: Object.freeze({ document: 'structural', 'slice-diff': 'stage1', 'cross-slice': 'single-standard', 'session-final': 'single-standard' }),
  medium: Object.freeze({ document: 'structural-semantic', 'slice-diff': 'stage1-stage2-advisory', 'cross-slice': 'single-deep', 'session-final': 'single-deep' }),
  high: Object.freeze({ document: 'structural-blind-dual', 'slice-diff': 'dual-blocking', 'cross-slice': 'blind-dual', 'session-final': 'blind-dual' }),
  critical: Object.freeze({ document: 'structural-blind-dual-human', 'slice-diff': 'dual-blocking-human', 'cross-slice': 'blind-dual-human', 'session-final': 'blind-dual-human' }),
});
const DEGRADED_MATRIX = Object.freeze({
  low: Object.freeze({ partial: 'degraded-proceed', total: 'degraded-proceed' }),
  medium: Object.freeze({ partial: 'needs-human', total: 'needs-human' }),
  high: Object.freeze({ partial: 'pause', total: 'pause' }),
  critical: Object.freeze({ partial: 'pause', total: 'pause' }),
});
const CODEX_REASONING_EFFORT_MAP = Object.freeze({
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
});

function mapCodexReasoningEffort(effort, model) {
  if (!Object.hasOwn(CODEX_REASONING_EFFORT_MAP, effort)) return null;
  const maxSupported = effort === 'max' && typeof model === 'string' && /^gpt-5\.6(?:[-.]|$)/i.test(model);
  const effortClamped = effort === 'max' && !maxSupported;
  return {
    requested: effort,
    mapped: effortClamped ? 'xhigh' : CODEX_REASONING_EFFORT_MAP[effort],
    effort_clamped: effortClamped,
  };
}

function staticEffortMetadata(channel, effort) {
  if (channel === 'subagent') return { effort, effort_applied: false, effort_channel: 'unsupported-host' };
  if (channel === 'gemini-cli') return { effort, effort_applied: false, effort_channel: 'unsupported-channel' };
  return { effort, effort_applied: false, effort_channel: 'runtime-required' };
}

function validRisk(value) {
  return CLASS_ORDER.includes(value);
}

function maxRisk(a, b) {
  if (!validRisk(a)) return b;
  if (!validRisk(b)) return a;
  return CLASS_ORDER[Math.max(CLASS_ORDER.indexOf(a), CLASS_ORDER.indexOf(b))];
}

function roleEffort(profile, role) {
  const efforts = EFFORT_CATALOG[profile];
  if (role === 'semantic') return efforts.semantic_reviewer || efforts.reviewer || efforts.author;
  if (role === 'executability') return efforts.executability_reviewer || efforts.reviewer || efforts.implementer;
  return efforts.reviewer || efforts.semantic_reviewer || efforts.author;
}

function executabilityChannel(artifactKind, channels) {
  if (channels.codex_cli) return 'codex-cli';
  if (artifactKind === 'document' && channels.gemini_cli) return 'gemini-cli';
  return 'subagent';
}

function makeReviewer({ role, tier, required, profile, artifactKind, channels, evaluatorModelOverride }) {
  const channel = role === 'executability' ? executabilityChannel(artifactKind, channels) : 'subagent';
  const reviewer = { role, channel, tier, effort: roleEffort(profile, role), required };
  if (channel === 'subagent' || channel === 'gemini-cli') Object.assign(reviewer, staticEffortMetadata(channel, reviewer.effort));
  if (typeof evaluatorModelOverride === 'string' && evaluatorModelOverride) reviewer.model = evaluatorModelOverride;
  return reviewer;
}

function baseDescriptors(riskClass, artifactKind) {
  const high = riskClass === 'high' || riskClass === 'critical';
  if (artifactKind === 'document') {
    const descriptors = [{ role: 'structural', tier: 'standard', required: true }];
    if (riskClass !== 'low') descriptors.push({ role: 'semantic', tier: high ? 'deep' : 'standard', required: true });
    if (high) descriptors.push({ role: 'executability', tier: 'deep', required: true });
    return descriptors;
  }
  if (artifactKind === 'slice-diff') {
    const descriptors = [{ role: 'semantic', tier: high ? 'deep' : 'standard', required: true }];
    if (riskClass === 'medium') descriptors.push({ role: 'executability', tier: 'standard', required: false });
    if (high) descriptors.push({ role: 'executability', tier: 'deep', required: true });
    return descriptors;
  }
  if (riskClass === 'low') return [{ role: 'semantic', tier: 'standard', required: true }];
  if (riskClass === 'medium') return [{ role: 'semantic', tier: 'deep', required: true }];
  return [
    { role: 'semantic', tier: 'deep', required: true },
    { role: 'executability', tier: 'deep', required: true },
  ];
}

function applyModeOverride(descriptors, artifactKind, mode) {
  const next = descriptors.map((item) => ({ ...item }));
  if (mode === 'single') {
    if (artifactKind === 'document') return next.filter((item) => item.role !== 'executability');
    const semantic = next.find((item) => item.role === 'semantic') || next[0];
    return semantic ? [{ ...semantic, required: true }] : [];
  }
  if (mode === 'dual') {
    if (!next.some((item) => item.role === 'semantic')) next.push({ role: 'semantic', tier: 'deep', required: true });
    if (!next.some((item) => item.role === 'executability')) next.push({ role: 'executability', tier: 'deep', required: true });
    return next.map((item) => item.role === 'executability' ? { ...item, required: true } : item);
  }
  return next;
}

function compileInternal(options, forceDefault = false) {
  const artifactKind = options.artifactKind;
  if (!ARTIFACT_KINDS.includes(artifactKind)) throw new Error(`invalid artifactKind: ${artifactKind}`);
  const policyMode = options.policyMode === 'shadow' ? 'shadow' : 'adaptive';
  const hasRisk = validRisk(options.riskClass);
  let riskClass = !forceDefault && policyMode === 'adaptive' && hasRisk ? options.riskClass : 'medium';
  let source = !forceDefault && policyMode === 'adaptive' && hasRisk ? 'risk' : 'default';
  if (artifactKind === 'slice-diff' && source === 'risk' && validRisk(options.sliceRiskClass)) {
    riskClass = maxRisk(riskClass, options.sliceRiskClass);
  }
  const profile = PROFILE_BY_CLASS[riskClass];
  const channels = options.availableChannels || { subagent: options.runtime === 'claude', codex_cli: false,
    gemini_cli: false, deep_review: false };
  let descriptors = baseDescriptors(riskClass, artifactKind);
  const defaultMode = riskClass === 'high' || riskClass === 'critical' ? 'dual' : 'single';
  const override = options.reviewModeOverride === 'single' || options.reviewModeOverride === 'dual'
    ? options.reviewModeOverride : null;
  const mode = override || defaultMode;
  if (override) descriptors = applyModeOverride(descriptors, artifactKind, override);
  const reviewers = descriptors.map((descriptor) => makeReviewer({ ...descriptor, profile, artifactKind,
    channels, evaluatorModelOverride: options.evaluatorModelOverride }));
  const unavailable = reviewers.filter((reviewer) => reviewer.channel === 'subagent' && channels.subagent === false)
    .map((reviewer) => reviewer.role);
  return {
    artifact_kind: artifactKind,
    phase: options.phase ?? null,
    risk_class: riskClass,
    profile,
    mode,
    reviewers,
    rounds_max: 2,
    blind_first_round: true,
    degraded: { policy: DEGRADED_MATRIX[riskClass], unavailable_roles: unavailable },
    gate: { blocker_blocks: true, needs_evidence: ['blocker'],
      human_ack_required: riskClass === 'critical', external_change_lock: riskClass === 'critical' },
    source,
    policy_mode: policyMode,
    review_mode_override: override,
    runtime: options.runtime ?? 'unknown',
    tdd_mode: options.tddMode ?? null,
  };
}

function compilationPause(options, error) {
  const riskClass = options.riskClass;
  return {
    artifact_kind: ARTIFACT_KINDS.includes(options.artifactKind) ? options.artifactKind : null,
    phase: options.phase ?? null,
    risk_class: riskClass,
    profile: PROFILE_BY_CLASS[riskClass],
    mode: null,
    reviewers: [],
    rounds_max: 2,
    blind_first_round: true,
    degraded: { policy: DEGRADED_MATRIX[riskClass], unavailable_roles: [] },
    gate: { blocker_blocks: true, needs_evidence: ['blocker'],
      human_ack_required: riskClass === 'critical', external_change_lock: riskClass === 'critical' },
    source: 'risk',
    compilation_error: true,
    execution_decision: 'pause',
    degraded_events: [{ type: 'review-plan-compilation-failed', message: error.message }],
  };
}

function compileReviewPlan(options = {}) {
  try {
    return compileInternal(options);
  } catch (error) {
    if (options.riskClass === 'high' || options.riskClass === 'critical') return compilationPause(options, error);
    const safeArtifact = ARTIFACT_KINDS.includes(options.artifactKind) ? options.artifactKind : 'document';
    const fallback = compileInternal({ ...options, artifactKind: safeArtifact,
      availableChannels: { subagent: options.runtime === 'claude', codex_cli: false,
        gemini_cli: false, deep_review: false } }, true);
    fallback.compilation_error = true;
    fallback.degraded_events = [{ type: 'review-plan-compilation-failed', message: error.message }];
    return fallback;
  }
}

function ackSatisfied(ack) {
  return Boolean(ack && ack.required === true && typeof ack.at === 'string' && ack.at
    && ack.actor === 'human');
}

function evaluateReviewExecution(plan = {}, reviewerResults = []) {
  const results = Array.isArray(reviewerResults) ? reviewerResults : [];
  const requiredPlan = Array.isArray(plan.reviewers) ? plan.reviewers.filter((reviewer) => reviewer.required) : [];
  const failures = [];
  for (const reviewer of requiredPlan) {
    const result = results.find((candidate) => candidate.role === reviewer.role
      && (!candidate.channel || candidate.channel === reviewer.channel));
    if (!result || result.status !== 'completed') failures.push({ role: reviewer.role,
      channel: reviewer.channel, status: result?.status || 'skipped', report_ref: result?.report_ref || null });
  }
  for (const result of results) {
    if (result.required && result.status !== 'completed'
      && !failures.some((failure) => failure.role === result.role && failure.channel === result.channel)) {
      failures.push({ role: result.role, channel: result.channel, status: result.status,
        report_ref: result.report_ref || null });
    }
  }
  const critical = plan.risk_class === 'critical';
  const humanGate = { required: critical, satisfied: critical ? ackSatisfied(plan.human_ack) : true };
  let decision = 'proceed';
  const reasons = [];
  if (failures.length) {
    decision = DEGRADED_MATRIX[plan.risk_class]?.partial || 'needs-human';
    reasons.push(`required reviewer failure: ${failures.map((failure) => `${failure.role}:${failure.status}`).join(', ')}`);
  } else if (critical && !humanGate.satisfied) {
    decision = 'needs-human';
    reasons.push('critical human acknowledgment required');
  }
  const degradedEvents = decision === 'proceed' ? [] : [{ type: failures.length
    ? 'required-reviewer-failure' : 'human-ack-required', decision, failures }];
  return { decision, degraded_events: degradedEvents, human_gate: humanGate, reasons };
}

function finishGateAllowed(reviewExecutionJson) {
  const state = reviewExecutionJson && typeof reviewExecutionJson === 'object' ? reviewExecutionJson : {};
  const points = state.points && typeof state.points === 'object' ? state.points : {};
  const missingAcks = Object.entries(points)
    .filter(([, point]) => point?.human_ack?.required === true && !ackSatisfied(point.human_ack))
    .map(([point]) => point).sort((a, b) => a.localeCompare(b, 'en'));
  const externalChangeLock = state.external_change_lock === true;
  return { allowed: !externalChangeLock && missingAcks.length === 0,
    blocking: { external_change_lock: externalChangeLock, missing_acks: missingAcks } };
}

function defaultProbe(binary, env) {
  const result = spawnSync(binary, ['--version'], { env, stdio: 'ignore', shell: false });
  return result.status === 0;
}

function containsDeepReviewManifest(root, fsApi) {
  if (!root || !fsApi.existsSync(root)) return false;
  let first;
  try { first = fsApi.readdirSync(root, { withFileTypes: true }); } catch { return false; }
  for (const entry of first) {
    if (!entry.isDirectory()) continue;
    const direct = path.join(root, entry.name, 'deep-review', '.claude-plugin', 'plugin.json');
    const packageDirect = path.join(root, entry.name, '.claude-plugin', 'plugin.json');
    if (entry.name === 'deep-review' && fsApi.existsSync(packageDirect)) return true;
    if (fsApi.existsSync(direct)) return true;
  }
  return false;
}

function detectReviewChannels({ runtime, env = process.env, probe = defaultProbe, fsApi = fs } = {}) {
  const safeEnv = env && typeof env === 'object' ? env : {};
  const home = typeof safeEnv.HOME === 'string' ? safeEnv.HOME : null;
  const deepReview = home ? [path.join(home, '.claude', 'plugins', 'cache'),
    path.join(home, '.claude', 'plugins')].some((root) => containsDeepReviewManifest(root, fsApi)) : false;
  return {
    subagent: runtime === 'claude',
    codex_cli: Boolean(probe('codex', safeEnv)),
    gemini_cli: Boolean(probe('gemini', safeEnv)),
    deep_review: deepReview,
  };
}

module.exports = {
  ARTIFACT_KINDS,
  REVIEW_MATRIX,
  DEGRADED_MATRIX,
  CODEX_REASONING_EFFORT_MAP,
  mapCodexReasoningEffort,
  staticEffortMetadata,
  compileReviewPlan,
  evaluateReviewExecution,
  finishGateAllowed,
  detectReviewChannels,
};
