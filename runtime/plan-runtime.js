'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalizePortableProjectPathV1, issueProjectStateCapability, atomicWriteFile,
  revalidatePathCapability } = require('./platform.js');
const { beginOperation, recordOperationStage, completeOperation, canonicalJson } =
  require('./operation-journal.js');

const CLASS_FIELD = Object.freeze({
  'failing-test':'failing_test', production:'production', refactor:'refactor',
});

function fail(code, message) {
  const error = new Error(`[${code}] ${message || code}`);
  error.code = code;
  throw error;
}

function byteSort(values) {
  return [...values].sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)));
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function validatePaths(values, label) {
  if (!Array.isArray(values)) fail('plan-scope', `${label} must be an array`);
  const seen = new Set();
  const windows = new Set();
  for (const value of values) {
    let canonical;
    try { canonical = canonicalizePortableProjectPathV1(value); }
    catch (error) { if (!error.code) error.code = 'portable-path-v1'; throw error; }
    if (seen.has(canonical.path) || windows.has(canonical.windowsKey)) {
      fail('plan-scope-collision', `${label} contains an exact or Windows-key collision`);
    }
    seen.add(canonical.path); windows.add(canonical.windowsKey);
  }
  return byteSort(values);
}

function validatePlanScopeV1(input) {
  if (!input || input.schema_version !== 1 || !Array.isArray(input.slices) || !input.slices.length) {
    fail('plan-scope-schema', 'plan scope must contain version-1 slices');
  }
  const sliceIds = new Set();
  const slices = input.slices.map((slice) => {
    if (!slice || !/^SLICE-\d{3}$/.test(slice.id || '') || slice.scope_schema_version !== 1 ||
        !slice.write_scope || typeof slice.write_scope !== 'object') fail('plan-scope-schema');
    if (sliceIds.has(slice.id)) fail('plan-scope-duplicate-slice');
    sliceIds.add(slice.id);
    const files = validatePaths(slice.files, `${slice.id}.files`);
    const failing = validatePaths(slice.write_scope.failing_test, 'failing_test');
    const production = validatePaths(slice.write_scope.production, 'production');
    const refactor = validatePaths(slice.write_scope.refactor || [], 'refactor');
    if (!failing.length || !production.length) fail('plan-scope-empty-class');
    const fileSet = new Set(files);
    if ([...failing,...production,...refactor].some((entry) => !fileSet.has(entry))) {
      fail('plan-scope-membership');
    }
    if (failing.some((entry) => production.includes(entry))) fail('plan-scope-disjoint');
    const union = new Set([...failing,...production,...refactor]);
    if (union.size !== files.length || files.some((entry) => !union.has(entry))) {
      fail('plan-scope-coverage');
    }
    return {...slice, files, write_scope:{failing_test:failing,production,refactor}};
  });
  return {...input,slices};
}

function canonicalizePlanScopeV1(input) {
  const plan = validatePlanScopeV1(input);
  const canonical = {...plan, slices:[...plan.slices].sort((a,b) =>
    Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)))};
  return {...canonical, sha256:sha256(canonicalJson(canonical))};
}

function validateAssignment(plan, assignment) {
  if (!exactKeys(assignment, ['schema_version','clusters']) || assignment.schema_version !== 1 ||
      !Array.isArray(assignment.clusters) || !assignment.clusters.length) fail('delegation-scope-schema');
  const planIds = new Set(plan.slices.map((slice) => slice.id));
  const delegated = new Set();
  const clusters = assignment.clusters.map((cluster) => {
    if (!exactKeys(cluster,['id','slices']) || !/^C[1-9]\d*$/.test(cluster.id || '') ||
        !Array.isArray(cluster.slices) || !cluster.slices.length) fail('delegation-scope-cluster');
    const slices = byteSort(cluster.slices);
    if (canonicalJson(slices) !== canonicalJson(cluster.slices)) fail('delegation-scope-order');
    if (new Set(slices).size !== slices.length || slices.some((id) => !planIds.has(id))) {
      fail('delegation-scope-partition');
    }
    for (const id of slices) {
      if (delegated.has(id)) fail('delegation-scope-partition');
      delegated.add(id);
    }
    return {id:cluster.id,slices};
  }).sort((a,b) => Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
  if (delegated.size !== planIds.size || [...planIds].some((id) => !delegated.has(id))) {
    fail('delegation-scope-partition');
  }
  return {schema_version:1,clusters};
}

async function publishDelegationScope({stateCapability, planCapability, plan, assignment, snapshot,
  deferCompletion=false,seam}) {
  if (stateCapability) revalidatePathCapability(stateCapability, 'delegation-state');
  if (planCapability) {if(planCapability.kind==='session-file-capability')require('./transaction-runtime.js').revalidateSessionFile(planCapability);
    else revalidatePathCapability(planCapability, 'delegation-plan');}
  const checked = canonicalizePlanScopeV1(plan || JSON.parse(fs.readFileSync(planCapability.path,'utf8')));
  const canonicalAssignment = validateAssignment(checked, assignment);
  const bytes = canonicalJson({schema_version:1,plan_sha256:checked.sha256,
    clusters:canonicalAssignment.clusters});
  const root = stateCapability.projectRoot;
  const fields = require('./frontmatter.js').parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  const workDir = path.join(root,...String(fields.work_dir).split('/'));
  const target = path.join(workDir,'delegation-scope.json');
  const projectCapability = issueProjectStateCapability(root,root,{role:'project-root'});
  if(snapshot!==undefined&&!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(snapshot||''))fail('delegation-snapshot');
  const operation = await beginOperation({projectCapability,sessionId:fields.session_id,
    kind:'delegation-scope-publish',preconditions:{planSha256:checked.sha256,...(snapshot?{snapshot}:{})}});
  fs.mkdirSync(workDir,{recursive:true});
  const transaction=require('./transaction-runtime.js');const stateCap=stateCapability;
  const sessionCapability=issueProjectStateCapability(root,workDir,{role:'session-work-dir',sessionStateCapability:stateCap});
  const output=transaction.issueSessionFileCapability({sessionCapability,candidate:target,
    allowedBasenames:['delegation-scope.json'],allowMissingLeaf:true,role:'delegation-scope'});
  const exact=fs.existsSync(output.path)&&transaction.readSessionFile(output).equals(Buffer.from(bytes));
  if(!exact){seam?.('before-delegation-write',{operationId:operation.operationId,path:target,sha256:sha256(bytes)});
    transaction.atomicWriteSessionFile(output,bytes);seam?.('after-delegation-write-before-stage',
      {operationId:operation.operationId,path:target,sha256:sha256(bytes)});}
  await recordOperationStage(operation,'delegation-written',{owned:{sha256:sha256(bytes)}});
  if(!deferCompletion)await completeOperation(operation,{status:'completed',sha256:sha256(bytes)});
  return {assignment:canonicalAssignment,planSha256:checked.sha256,sha256:sha256(bytes),
    operationId:operation.operationId,path:target,...(deferCompletion?{operation}:{})};
}

function deriveScopedWriteAuthority({plan, sliceId, writeClass, assignment, clusterId,
  delegationOperationId = null, delegationSha256 = null, expectedSha256} = {}) {
  const canonical = canonicalizePlanScopeV1(plan);
  const slice = canonical.slices.find((entry) => entry.id === sliceId);
  if (!slice) fail('plan-scope-slice');
  const field = CLASS_FIELD[writeClass];
  if (!field) fail('plan-scope-class');
  let assignedUnion = slice.files;
  let selectedCluster = null;
  if (assignment) {
    const checked = validateAssignment(canonical, assignment.assignment || assignment);
    selectedCluster = checked.clusters.find((cluster) => cluster.id === clusterId);
    if (!selectedCluster || !selectedCluster.slices.includes(sliceId)) fail('delegation-scope-cluster');
    assignedUnion = byteSort([...new Set(selectedCluster.slices.flatMap((id) =>
      canonical.slices.find((item) => item.id === id).files))]);
  }
  const classPaths = slice.write_scope[field];
  const assignedSet = new Set(assignedUnion);
  const authority = {schema_version:1,plan_sha256:canonical.sha256,
    delegation_operation_id:delegationOperationId,
    delegation_sha256:delegationSha256,
    cluster_id:selectedCluster ? selectedCluster.id : null,
    slice_id:sliceId,write_class:writeClass,class_paths:classPaths,
    assigned_union:assignedUnion,authorized_paths:classPaths.filter((entry) => assignedSet.has(entry))};
  const digest = sha256(canonicalJson(authority));
  if (expectedSha256 && expectedSha256 !== digest) fail('write-scope-digest');
  return {...authority,sha256:digest};
}

module.exports = {
  CLASS_FIELD,
  validatePlanScopeV1,
  canonicalizePlanScopeV1,
  validateAssignment,
  publishDelegationScope,
  deriveScopedWriteAuthority,
};
