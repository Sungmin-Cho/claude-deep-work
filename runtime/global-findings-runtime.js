'use strict';

const fs = require('node:fs');
const path = require('node:path');
const journal = require('./operation-journal.js');
const transaction = require('./transaction-runtime.js');

function fail(code) { throw Object.assign(new Error(`[${code}]`), {code}); }
function unknown() { return {projection:{status:'unknown',points:[]},warnings:['finding-ref-invalid']}; }

// A missing legacy index is harmless only when no old obligation was ever
// persisted. A current global review cannot hide an old missing/corrupt ref.
function legacyFindingsRequired({stateCapability,fields,workDir}) {
  if (Object.hasOwn(fields,'governed_finding_refs_json')) return true;
  const sessionId = transaction.sessionIdFromState(stateCapability);
  if (journal.listCompletedOperations({projectCapability:transaction.projectCapabilityFor(stateCapability),
    sessionId,kind:'finding-publish'}).length) return true;
  const prefix = `deep-work.${sessionId}.op.finding-publish.`;
  if (fs.readdirSync(path.join(stateCapability.projectRoot,'.claude'))
    .some(name => name.startsWith(prefix) && name.endsWith('.json'))) return true;
  const reviews = path.join(workDir,'reviews');
  if (fs.existsSync(reviews)) {
    const stat = fs.lstatSync(reviews);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(reviews).length) return true;
  }
  return false;
}

function projectExecutions(executions) {
  const points = new Map();
  for (const execution of executions) {
    const operationId = execution.review_operation_id;
    if (!/^op-[a-f0-9]{64}$/.test(operationId || '')) fail('global-finding-producer');
    const findings = execution.observation.response.findings || [];
    const ids = new Set(), open = [], resolved = [];
    for (let index = 0; index < findings.length; index++) {
      const finding = findings[index];
      // Missing source IDs receive a stable locator, not a fabricated finding
      // disposition. Original details and severity remain in the bound output.
      const id = typeof finding.id === 'string' && finding.id ? finding.id : `observation-${index + 1}`;
      if (ids.has(id)) fail('global-finding-duplicate');
      ids.add(id);
      if (finding.status === 'resolved') resolved.push(id);
      else open.push(id);
    }
    const point = {point:`global-final:${operationId}`,round:1,
      open_ids:open.sort(),resolved_ids:resolved.sort(),unknown_ids:[]};
    const existing = points.get(operationId);
    if (existing && journal.canonicalJson(existing) !== journal.canonicalJson(point)) fail('global-finding-conflict');
    points.set(operationId,point);
  }
  const rows = [...points.values()].sort((a,b) => a.point.localeCompare(b.point));
  if (!rows.length) fail('global-finding-required');
  return {status:rows.some(point => point.open_ids.length) ? 'open' : 'complete',points:rows};
}

function mergeFindingProjections({legacy,legacyRequired,global}) {
  if (!global || global.status === 'unknown' || legacyRequired && legacy.projection.status === 'unknown')
    return {projection:{status:'unknown',points:legacyRequired ? legacy.projection.points : []},
      warnings:[...new Set([...(legacyRequired ? legacy.warnings : []),'finding-ref-invalid'])]};
  const points = [...(legacyRequired ? legacy.projection.points : []),...global.points]
    .sort((a,b) => a.point.localeCompare(b.point) || a.round - b.round);
  return {projection:{status:points.some(point => point.unknown_ids.length) ? 'unknown' :
    points.some(point => point.open_ids.length) ? 'open' : 'complete',points},
    warnings:legacyRequired ? [...legacy.warnings] : []};
}

function loadV3FindingProjection({stateCapability,plan,fields,workDir,verificationPlan,legacy}) {
  if (plan?.schema_version !== 3) return legacy;
  try {
    const required = legacyFindingsRequired({stateCapability,fields,workDir});
    const review = typeof fields.review_execution_json === 'string' ? JSON.parse(fields.review_execution_json) : fields.review_execution_json;
    const pkg = require('./evidence-runtime.js').loadCommittedPackage(workDir,review?.evidence,verificationPlan);
    if (!pkg) return mergeFindingProjections({legacy,legacyRequired:required,global:null});
    const gates = verificationPlan.gates.filter(gate => gate.adapter === 'review' && gate.disposition === 'required');
    if (!gates.length) return mergeFindingProjections({legacy,legacyRequired:required,global:null});
    const globalReview = require('./global-review-runtime.js');
    const executions = [];
    for (const gate of gates) {
      const records = pkg.records.filter(record => record.gate_id === gate.id && record.kind === 'review');
      if (!records.length) fail('global-finding-required');
      for (const record of records) {
        globalReview.authenticateGlobalReviewEvidence(record,{artifactRoot:workDir,verificationPlan});
        executions.push(...globalReview.authenticateSet({stateCapability,binding:record.review_binding,
          refs:record.review_execution_refs}));
      }
    }
    return mergeFindingProjections({legacy,legacyRequired:required,global:projectExecutions(executions)});
  } catch { return {projection:{status:'unknown',points:legacy?.projection?.points||[]},warnings:[...new Set([...(legacy?.warnings||[]),'finding-ref-invalid'])]}; }
}

module.exports = {loadV3FindingProjection,legacyFindingsRequired,projectExecutions,mergeFindingProjections};
