'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('./session-metrics-runtime.js');
const observed = (score) => ({status:'observed', score});
const na = {status:'not-applicable', reason:'compiled gate not applicable'};

test('metric v2 applies percentages once and never rewards zero retries', () => {
  const input = {test:observed(80), trace:observed(60), sensors:observed(100), mutation:observed(40)};
  assert.equal(metrics.calculateSessionMetrics(input).quality_score, 70);
  assert.equal(metrics.calculateSessionMetrics({...input, retry_count:0}).quality_score, 70);
  assert.equal(metrics.calculateSessionMetrics({...input, retry_count:9}).quality_score, 70);
  assert.equal(metrics.calculateSessionMetrics({...input, sensors:na, mutation:na}).quality_score, 70);
});
test('missing applicable observations stay unknown and only proven optional N/A redistributes', () => {
  const input = {test:observed(80), trace:observed(60), sensors:na, mutation:na};
  assert.equal(metrics.calculateSessionMetrics({...input, trace:undefined}).quality_score, null);
  assert.equal(metrics.calculateSessionMetrics({...input, sensors:undefined}).quality_score, null);
  assert.equal(metrics.calculateSessionMetrics({...input, sensors:{status:'not-applicable'}}).quality_score, null);
  assert.equal(metrics.calculateSessionMetrics({...input, test:na}).quality_score, null);
  for (const score of ['80', NaN, -1, 101]) {
    assert.throws(() => metrics.calculateSessionMetrics({...input, test:observed(score)}), /metric-score/);
  }
});
test('trace reconciles all slice, requirement and evidence IDs without trusting checked boxes', () => {
  const input = {expected:['slice:SLICE-001', 'requirement:REQ-001', 'evidence:EVID-001'],
    observed:['slice:SLICE-001', 'slice:SLICE-001', 'evidence:EVID-001'], source_refs:['a'.repeat(64)]};
  const trace = metrics.reconcileTrace(input);
  assert.equal(trace.score, 200/3);
  assert.deepEqual(trace.missing, ['requirement:REQ-001']);
  assert.equal(metrics.reconcileTrace({...input, source_refs:[]}).status, 'unknown');
  assert.throws(() => metrics.reconcileTrace({...input, observed:['foreign-id']}), /metric-trace-foreign/);
});
test('goal acceptance stays separate from score and missing IDs never become complete', () => {
  const result = metrics.calculateSessionMetrics({test:observed(100),trace:observed(100),sensors:na,mutation:na,
    goal_acceptance:{required_ids:['REQ-001','REQ-002'],accepted_ids:['REQ-001']}});
  assert.equal(result.quality_score,100);
  assert.equal(result.goal_acceptance.complete,false);
  assert.deepEqual(result.goal_acceptance.accepted_ids,['REQ-001']);
});
