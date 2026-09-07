'use strict';

// Pure arithmetic over observations. Callers publishing authoritative receipts
// must obtain these observations through the governed context/evidence readers.
// This module never turns a JSON observation into execution authority.
const WEIGHTS = Object.freeze({test:35, trace:35, sensors:15, mutation:15});
const DIGEST = /^[a-f0-9]{64}$/;
function fail(code) { const error = new Error(`[${code}]`); error.code = code; throw error; }
function uniqueIds(values) {
  if (!Array.isArray(values) || values.length > 10000 || values.some((v) =>
    typeof v !== 'string' || !v || v.length > 256)) fail('metric-ids');
  return [...new Set(values)].sort();
}
function observation(value, name) {
  if (!value || value.status === 'unknown') return {status:'unknown', score:null};
  if (value.status === 'not-applicable') {
    if (!['sensors','mutation'].includes(name) || typeof value.reason !== 'string' || !value.reason.trim())
      return {status:'unknown', score:null};
    return {status:'not-applicable', score:null, reason:value.reason};
  }
  if (value.status !== 'observed' || typeof value.score !== 'number' || !Number.isFinite(value.score) ||
    value.score < 0 || value.score > 100) fail('metric-score');
  return {status:'observed', score:value.score};
}
function reconcileTrace({expected, observed, source_refs} = {}) {
  const required = uniqueIds(expected || []), received = uniqueIds(observed || []);
  const allowed = new Set(required);
  if (received.some((id) => !allowed.has(id))) fail('metric-trace-foreign');
  const receivedSet = new Set(received), missing = required.filter((id) => !receivedSet.has(id));
  if (!required.length || !Array.isArray(source_refs) || !source_refs.length ||
    source_refs.some((ref) => !DIGEST.test(ref))) return {status:'unknown', score:null, missing};
  return {status:'observed', score:received.length * 100 / required.length,
    required_ids:required, observed_ids:received, missing, source_refs:[...new Set(source_refs)].sort()};
}
function goalAcceptance(value) {
  if (!value) return {required_ids:[], accepted_ids:[], complete:false};
  const required = uniqueIds(value.required_ids), accepted = uniqueIds(value.accepted_ids);
  if (accepted.some((id) => !required.includes(id))) fail('metric-goal-foreign');
  return {required_ids:required, accepted_ids:accepted,
    complete:required.length > 0 && required.length === accepted.length};
}
function calculateSessionMetrics(input = {}) {
  let numerator = 0, denominator = 0;
  const breakdown = {}, unknown = [];
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const row = observation(input[name], name);
    breakdown[name] = {...row, weight};
    if (row.status === 'not-applicable') continue;
    denominator += weight;
    if (row.status === 'unknown') unknown.push(name);
    else numerator += row.score * weight;
  }
  const retry = input.retry_count;
  if (retry !== undefined && (!Number.isSafeInteger(retry) || retry < 0)) fail('metric-retry');
  return {metric_version:2,
    quality_score:unknown.length || denominator === 0 ? null : Math.round(numerator / denominator),
    quality_breakdown:breakdown,
    quality_diagnostics:{retry_count:retry ?? null, unknown_components:unknown},
    goal_acceptance:goalAcceptance(input.goal_acceptance)};
}

module.exports = {WEIGHTS, reconcileTrace, goalAcceptance, calculateSessionMetrics};
