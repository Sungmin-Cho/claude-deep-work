'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { issueProjectStateCapability, atomicWriteFile,
  revalidatePathCapability, captureWorktreeManifest } = require('./platform.js');
const { parseFrontmatter, updateFrontmatterText } = require('./frontmatter.js');
const {beginOperation,recordOperationStage,completeOperation,resumeOperation,canonicalJson,sha256}=require('./operation-journal.js');
const {deriveScopedWriteAuthority,publishDelegationScope,canonicalizePlanScopeV1,
  validateAssignment}=require('./plan-runtime.js');

const MODELS = new Set(['haiku','sonnet','opus','main','auto']);

function fail(code,message) { const error = new Error(`[${code}] ${message || code}`); error.code=code; throw error; }

async function mutateState(stateCapability, reducer, { rawGuard = null } = {}) {
  revalidatePathCapability(stateCapability,'slice-state');const transaction=require('./transaction-runtime.js');
  return transaction.withRankedLocks([{rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}],() => {
    const text = fs.readFileSync(stateCapability.path,'utf8');
    if (typeof rawGuard === 'function' && rawGuard(text)) return {};
    const parsed = parseFrontmatter(text);
    const patch = reducer(structuredClone(parsed.fields));
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('state-reducer');
    atomicWriteFile(stateCapability,updateFrontmatterText(text,patch));
    return parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  });
}

function requireSlice(plan,sliceId,{unchecked=false}={}) {
  if (!/^SLICE-\d{3}$/.test(sliceId || '')) fail('slice-identity');
  const slice = plan && Array.isArray(plan.slices) && plan.slices.find((entry) => entry.id === sliceId);
  if (!slice) fail('slice-missing');
  if (unchecked && slice.checked) fail('slice-already-complete');
  return slice;
}

function activateSlice({stateCapability,plan,sliceId}) {
  requireSlice(plan,sliceId,{unchecked:true});
  return mutateState(stateCapability,() => ({active_slice:sliceId,tdd_state:'PENDING'}));
}

function enterSliceSpike({stateCapability,plan,sliceId}) {
  requireSlice(plan,sliceId,{unchecked:true});
  return mutateState(stateCapability,() => ({active_slice:sliceId,tdd_state:'SPIKE'}));
}

function setSliceModel({stateCapability,sliceId,model}) {
  if (!/^SLICE-\d{3}$/.test(sliceId || '') || !MODELS.has(model)) fail('slice-model');
  return mutateState(stateCapability,(fields) => {
    let current = {};
    if (typeof fields.model_overrides_json === 'string' && fields.model_overrides_json) {
      try { current=JSON.parse(fields.model_overrides_json); } catch { fail('slice-model-state'); }
    }
    return {model_overrides_json:JSON.stringify({...current,[sliceId]:model})};
  });
}

function setExecutionOverride({stateCapability,value}) {
  if (![null,'inline','delegate'].includes(value)) fail('execution-override');
  return mutateState(stateCapability,(fields) => fields.execution_override === value
    ? {} : {execution_override:value});
}

function validOid(value){return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value||'');}
function takeoverReceiptLock(stateCapability,receiptsDirCapability){
  if(!receiptsDirCapability||receiptsDirCapability.kind!=='receipts-directory'||
      receiptsDirCapability.role!=='receipts-directory')fail('takeover-receipts-capability');
  revalidatePathCapability(receiptsDirCapability.sessionCapability,'takeover-session-dir');
  const stat=fs.lstatSync(receiptsDirCapability.path);
  if(!stat.isDirectory()||stat.isSymbolicLink())fail('takeover-receipts-directory');
  return issueProjectStateCapability(receiptsDirCapability.projectRoot,
    path.join(receiptsDirCapability.projectRoot,'.claude',
      `${path.basename(stateCapability.path,'.md')}.takeover-receipts.lock`),
    {allowMissingLeaf:true,role:'lock'});
}

function readTakeoverAuthority({stateCapability,planCapability,plan,receiptsDirCapability,
  clusterId,delegationSnapshot,requireComplete}){
  if(!/^C[1-9]\d*$/.test(clusterId||''))fail('takeover-cluster-invalid');
  if(!validOid(delegationSnapshot))fail('takeover-snapshot-invalid');
  const transaction=require('./transaction-runtime.js');
  transaction.revalidateSessionFile(planCapability);
  let lockedPlan;try{lockedPlan=JSON.parse(transaction.readSessionFile(planCapability));}
  catch(error){if(error instanceof SyntaxError)fail('takeover-plan-json');throw error;}
  const canonical=canonicalizePlanScopeV1(lockedPlan);
  const supplied=canonicalizePlanScopeV1(plan);
  if(canonical.sha256!==supplied.sha256)fail('takeover-plan-changed');
  revalidatePathCapability(stateCapability,'takeover-state');
  const text=fs.readFileSync(stateCapability.path,'utf8');const fields=parseFrontmatter(text).fields;
  if(fields.current_phase!=='implement')fail('takeover-phase');
  if(fields.delegation_snapshot!==delegationSnapshot)fail('takeover-snapshot-mismatch');
  if(!/^op-[0-9a-f]{32,64}$/.test(fields.delegation_operation_id||'')||
      !/^[0-9a-f]{64}$/.test(fields.delegation_sha256||''))fail('takeover-delegation-state');
  const scalar=fields.active_cluster_takeover;
  if(scalar!==undefined&&scalar!==null&&!(typeof scalar==='string'&&/^C[1-9]\d*$/.test(scalar))) {
    fail('takeover-state-scalar');
  }
  const workDir=path.join(stateCapability.projectRoot,...String(fields.work_dir||'').split('/'));
  const expectedDir=path.resolve(workDir,'receipts');
  if(receiptsDirCapability.path!==expectedDir)fail('takeover-receipts-route');
  const sessionCapability=issueProjectStateCapability(stateCapability.projectRoot,workDir,
    {role:'session-work-dir',sessionStateCapability:stateCapability});
  const scopeCapability=transaction.issueSessionFileCapability({sessionCapability,
    candidate:path.join(workDir,'delegation-scope.json'),allowedBasenames:['delegation-scope.json'],
    role:'delegation-scope'});
  const scopeBytes=transaction.readSessionFile(scopeCapability);let scope;
  try{scope=JSON.parse(scopeBytes);}catch{fail('takeover-delegation-json');}
  if(!scope||Object.keys(scope).sort().join(',')!=='clusters,plan_sha256,schema_version'||
      scope.schema_version!==1||scope.plan_sha256!==canonical.sha256)fail('takeover-delegation-plan');
  const assignment=validateAssignment(canonical,{schema_version:1,clusters:scope.clusters});
  const expectedScope=canonicalJson({schema_version:1,plan_sha256:canonical.sha256,
    clusters:assignment.clusters});
  if(!scopeBytes.equals(Buffer.from(expectedScope))||sha256(scopeBytes)!==fields.delegation_sha256) {
    fail('takeover-delegation-digest');
  }
  const cluster=assignment.clusters.find((entry)=>entry.id===clusterId);
  if(!cluster)fail('takeover-cluster-missing');
  const planIds=new Set(canonical.slices.map((entry)=>entry.id));const rows=[];const seen=new Set();
  for(const name of fs.readdirSync(receiptsDirCapability.path).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){
    if(!name.endsWith('.json'))continue;const target=path.join(receiptsDirCapability.path,name);const stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1_048_576)fail('takeover-receipt-file');
    let envelope;try{envelope=JSON.parse(fs.readFileSync(target,'utf8'));}catch{fail('takeover-receipt-json');}
    const receipt=envelope&&envelope.payload&&typeof envelope.payload==='object'?envelope.payload:envelope;
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||!/^SLICE-\d{3}$/.test(receipt.slice_id||'')||
        name!==`${receipt.slice_id}.json`||!planIds.has(receipt.slice_id)||seen.has(receipt.slice_id)) {
      fail('takeover-receipt-identity');
    }
    seen.add(receipt.slice_id);if(!cluster.slices.includes(receipt.slice_id))continue;
    if(receipt.cluster_id!==clusterId||!validOid(receipt.git_before_slice)||
        receipt.status==='complete'&&!validOid(receipt.git_after_slice))fail('takeover-receipt-identity');
    rows.push({sliceId:receipt.slice_id,status:receipt.status,before:receipt.git_before_slice,
      after:receipt.git_after_slice||null,sha256:sha256(fs.readFileSync(target))});
  }
  rows.sort((a,b)=>Buffer.compare(Buffer.from(a.sliceId),Buffer.from(b.sliceId)));
  for(let index=0;index<rows.length;index++){
    if(rows[index].sliceId!==cluster.slices[index])fail('takeover-receipt-ambiguous');
    const expectedBefore=index===0?delegationSnapshot:rows[index-1].after;
    if(!expectedBefore||rows[index].before!==expectedBefore)fail('takeover-receipt-chain');
  }
  const complete=rows.length===cluster.slices.length&&rows.every((row)=>row.status==='complete');
  if(requireComplete&&!complete||!requireComplete&&complete)fail('takeover-receipt-incomplete');
  return {text,fields,canonical,cluster,rows,receiptSha256:sha256(canonicalJson(rows))};
}

async function mutateClusterTakeover({stateCapability,planCapability,plan,receiptsDirCapability,
  clusterId,delegationSnapshot,clear=false,seam}={}){
  const transaction=require('./transaction-runtime.js');
  return transaction.withRankedLocks([
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)},
    {rank:transaction.RANKS.receipt,capability:takeoverReceiptLock(stateCapability,receiptsDirCapability)},
  ],()=>{
    const authority=readTakeoverAuthority({stateCapability,planCapability,plan,receiptsDirCapability,
      clusterId,delegationSnapshot,requireComplete:clear});
    const current=authority.fields.active_cluster_takeover??null;
    if(!clear&&current!==null&&current!==clusterId)fail('takeover-cluster-conflict');
    if(clear&&current!==null&&current!==clusterId)fail('takeover-cluster-conflict');
    const next=clear?null:clusterId;const status=current===next?(clear?'already-clear':'already-set'):(clear?'cleared':'set');
    if(current!==next){if(seam)seam('before-atomic-replace',{clusterId,delegationSnapshot,
        receiptSha256:authority.receiptSha256,next});
      atomicWriteFile(stateCapability,updateFrontmatterText(authority.text,{active_cluster_takeover:next}));
      if(seam)seam('after-atomic-replace',{clusterId,delegationSnapshot,
        receiptSha256:authority.receiptSha256,next});}
    const fields=parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
    return {...fields,status,clusterId,delegationSnapshot,planSha256:authority.canonical.sha256,
      receiptSha256:authority.receiptSha256};
  });
}

function setClusterTakeover(options){return mutateClusterTakeover(options);}
function clearClusterTakeover(options){return mutateClusterTakeover({...options,clear:true});}

function migrateModelRouting({stateCapability}) {
  return mutateState(stateCapability,(fields) => {
    if (typeof fields.model_routing_meta_json === 'string' || fields.model_routing_meta !== undefined) return {};
    if (typeof fields.model_routing_json !== 'string') return {};
    let routing;
    try { routing=JSON.parse(fields.model_routing_json); } catch { return {}; }
    if (!routing || typeof routing !== 'object' || Array.isArray(routing)) return {};
    const replaced=[];
    for (const key of ['research','implement','test']) if (routing[key] === 'main') {
      routing[key]='sonnet'; replaced.push(key);
    }
    return replaced.length ? {model_routing_json:JSON.stringify(routing)} : {};
  }, { rawGuard: (text) => /^(?:model_routing_meta|model_routing_meta_json):/m.test(text) });
}

async function setDelegationSnapshot({stateCapability,planCapability,plan,assignment,snapshot,seam,_locksHeld=false}={}){
  if(!validOid(snapshot))fail('delegation-snapshot');
  if(!_locksHeld){const transaction=require('./transaction-runtime.js');const sessionId=transaction.sessionIdFromState(stateCapability);const root=
      stateCapability.projectRoot;const target=path.join(planCapability.sessionCapability.path,'delegation-scope.json');return transaction.withRankedLocks([
        {rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,path.join(root,'.claude',
          `deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
        {rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,path.join(root,'.claude',
          `deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
        {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)},
        {rank:transaction.RANKS.target,capability:issueProjectStateCapability(root,path.join(root,'.claude',
          `deep-work.target.${crypto.createHash('sha256').update(path.relative(root,target)).digest('hex')}.lock`),
          {allowMissingLeaf:true,role:'lock'})}],()=>setDelegationSnapshot({stateCapability,planCapability,plan,assignment,snapshot,seam,
            _locksHeld:true}));}
  const published=await publishDelegationScope({stateCapability,planCapability,plan,assignment,
    snapshot,deferCompletion:true,seam});
  const text=fs.readFileSync(stateCapability.path,'utf8');const fields=parseFrontmatter(text).fields;
  if(fields.current_phase!=='implement')fail('delegation-phase');
    if(fields.delegation_snapshot!==undefined&&fields.delegation_snapshot!==null&&fields.delegation_snapshot!==snapshot)
      fail('delegation-snapshot-conflict');
  const patch={delegation_operation_id:published.operationId,delegation_sha256:published.sha256,delegation_snapshot:snapshot};
  const expected=updateFrontmatterText(text,patch);if(sha256(text)!==sha256(expected)){seam?.('before-state-write',
      {operationId:published.operationId,patch});atomicWriteFile(stateCapability,expected);seam?.('after-state-write-before-stage',
      {operationId:published.operationId,patch});}
  await recordOperationStage(published.operation,'state-written',{owned:{statePath:stateCapability.path,
    snapshot,sha256:published.sha256}});
  await completeOperation(published.operation,{status:'completed',sha256:published.sha256,snapshot,
    statePath:stateCapability.path});
  const {operation,...result}=published;return {state:parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields,...result};
}

function clearDelegationSnapshot({stateCapability,snapshot}={}){
  if(!validOid(snapshot))fail('delegation-snapshot');
  return mutateState(stateCapability,(fields)=>{
    if(fields.current_phase!=='implement')fail('delegation-phase');
    if(fields.delegation_snapshot!==snapshot)fail('delegation-snapshot-mismatch');
    return {delegation_operation_id:null,delegation_sha256:null,delegation_snapshot:null};
  });
}

function manifestCapabilities(stateCapability){const root=stateCapability.projectRoot;
  return {projectCapability:issueProjectStateCapability(root,root,{role:'project-root'}),
    gitCapability:issueProjectStateCapability(root,path.join(root,'.git'),{role:'git-root'})};}
function changedPaths(before,after){const a=new Map(before.entries.map((row)=>[row.path,row]));
  const b=new Map(after.entries.map((row)=>[row.path,row]));const out=[];
  for(const key of new Set([...a.keys(),...b.keys()]))if(canonicalJson(a.get(key)||null)!==canonicalJson(b.get(key)||null))out.push(key);
  return out.sort((x,y)=>Buffer.compare(Buffer.from(x),Buffer.from(y)));}

function scopedWriteRankLocks(stateCapability){const transaction=require('./transaction-runtime.js');const sessionId=
    transaction.sessionIdFromState(stateCapability);const root=stateCapability.projectRoot;return[
    {rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)},
    {rank:transaction.RANKS.target,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.scoped-write-target.lock`),{allowMissingLeaf:true,role:'lock'})}];}
function scopedWriteRuntimeExclusions(stateCapability,operationId,receiptCapability){const transaction=require('./transaction-runtime.js');const sessionId=
    transaction.sessionIdFromState(stateCapability),root=stateCapability.projectRoot;const ranked=scopedWriteRankLocks(stateCapability)
      .map((row)=>row.capability);const claims=ranked.map((capability)=>issueProjectStateCapability(root,`${capability.path}.claims`,
        {allowMissingLeaf:true,role:'lock'}));return[...ranked,...claims,issueProjectStateCapability(root,path.join(root,'.claude',
        `deep-work.${sessionId}.op.delegation-scope-publish.${operationId}.json`),{allowMissingLeaf:true,role:'state'}),
      issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${sessionId}.completed-operations.json`),
        {allowMissingLeaf:true,role:'state'}),receiptCapability];}
function lockedScopedPlan(planCapability,plan){const transaction=require('./transaction-runtime.js');transaction.revalidateSessionFile(planCapability);
  let current;try{current=JSON.parse(transaction.readSessionFile(planCapability));}catch{fail('scoped-write-plan-json');}
  const currentCanonical=canonicalizePlanScopeV1(current),provided=canonicalizePlanScopeV1(plan);
  if(currentCanonical.sha256!==provided.sha256)fail('scoped-write-plan-changed');return current;}
function persistedScopedAssignment({stateCapability,planCapability,fields,clusterId}){if(!fields.delegation_operation_id&&!fields.delegation_sha256){
    if(clusterId!==undefined&&clusterId!==null)fail('scoped-write-cluster');return{assignment:null,delegationOperationId:null,
      delegationSha256:null};}if(!/^op-[0-9a-f]{32,64}$/.test(fields.delegation_operation_id||'')||
      !/^[0-9a-f]{64}$/.test(fields.delegation_sha256||'')||!/^C[1-9]\d*$/.test(clusterId||''))fail('scoped-write-delegation');
  const transaction=require('./transaction-runtime.js');const cap=transaction.issueSessionFileCapability({sessionCapability:planCapability.sessionCapability,
    candidate:path.join(planCapability.sessionCapability.path,'delegation-scope.json'),allowedBasenames:['delegation-scope.json'],
    role:'delegation-scope'});const bytes=transaction.readSessionFile(cap);if(sha256(bytes)!==fields.delegation_sha256)
    fail('scoped-write-delegation-digest');let assignment;try{assignment=JSON.parse(bytes);}catch{fail('scoped-write-delegation-json');}
  return{assignment,delegationOperationId:fields.delegation_operation_id,delegationSha256:fields.delegation_sha256};}
async function beginScopedWrite({stateCapability,plan,planCapability,sliceId,writeClass,assignment,
  clusterId,expectedScopeSha256,runtimeExclusions=[],seam,_locksHeld=false}={}){
  if(runtimeExclusions.length||assignment!==undefined)fail('scoped-write-exclusion-authority');const transaction=require('./transaction-runtime.js');
  if(!_locksHeld)return transaction.withRankedLocks(scopedWriteRankLocks(stateCapability),()=>beginScopedWrite({stateCapability,plan,
    planCapability,sliceId,writeClass,clusterId,expectedScopeSha256,seam,_locksHeld:true}));const lockedPlan=lockedScopedPlan(planCapability,plan);
  const fields=parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;if(fields.current_phase!=='implement'||
      fields.active_slice!==sliceId)fail('scoped-write-state');const expectedTdd={'failing-test':'PENDING',production:'RED_VERIFIED',
    refactor:'SENSOR_CLEAN'}[writeClass];if(!expectedTdd||fields.tdd_state!==expectedTdd)fail('scoped-write-tdd-state');
  if(writeClass==='refactor'&&fields.fresh_sensor_required)fail('scoped-write-fresh-sensor');const persisted=persistedScopedAssignment({
    stateCapability,planCapability,fields,clusterId});const authority=deriveScopedWriteAuthority({plan:lockedPlan,sliceId,writeClass,
    assignment:persisted.assignment,clusterId,delegationOperationId:persisted.delegationOperationId,
    delegationSha256:persisted.delegationSha256,expectedSha256:expectedScopeSha256});const projectCapability=manifestCapabilities(stateCapability)
    .projectCapability;const operation=await beginOperation({projectCapability,sessionId:transaction.sessionIdFromState(stateCapability),
      kind:'delegation-scope-publish',preconditions:{action:'scoped-write',sliceId,writeClass,authoritySha256:authority.sha256,
        planSha256:authority.plan_sha256,tddPreState:fields.tdd_state}});const operationId=operation.operationId;const receiptPath=path.join(
          stateCapability.projectRoot,'.claude',`deep-work.${transaction.sessionIdFromState(stateCapability)}.scoped-write.${operationId}.json`);
  const receiptCapability=issueProjectStateCapability(stateCapability.projectRoot,receiptPath,{allowMissingLeaf:true,role:'state'});
  const derivedExclusions=scopedWriteRuntimeExclusions(stateCapability,operationId,receiptCapability);let receipt=null;
  if(fs.existsSync(receiptPath)){try{receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));}
    catch{fail('scoped-write-receipt-json');}}
  if(!receipt){const caps=manifestCapabilities(stateCapability);seam?.('before-manifest',{sliceId,writeClass});const manifest=
      captureWorktreeManifest({...caps,runtimeExclusions:derivedExclusions});seam?.('after-manifest',{sliceId,writeClass,
        manifestSha256:manifest.sha256});receipt={version:1,operationId,sliceId,writeClass,authority,preManifest:manifest,
        planSha256:authority.plan_sha256,statePath:stateCapability.path,tddPreState:fields.tdd_state,
        runtimeExclusions:derivedExclusions.map((capability)=>capability.path),status:'begun'};seam?.('before-receipt-write',{operationId});
    atomicWriteFile(receiptCapability,canonicalJson(receipt));seam?.('after-receipt-write-before-stage',{operationId});}
  if(receipt.operationId!==operationId||receipt.sliceId!==sliceId||receipt.writeClass!==writeClass||receipt.status!=='begun'||
      receipt.authority?.sha256!==authority.sha256||receipt.preManifest?.sha256===undefined)fail('scoped-write-identity');
  await recordOperationStage(operation,'scoped-write-begun',{owned:{receiptPath,receiptSha256:sha256(canonicalJson(receipt)),
    preManifestSha256:receipt.preManifest.sha256,authoritySha256:authority.sha256}});return {operationId,scopeSha256:authority.sha256,
    preManifestSha256:receipt.preManifest.sha256,receiptCapability,authority};
}

async function acceptScopedWrite({stateCapability,plan,planCapability,sliceId,operationId,preManifestSha256,
  runtimeExclusions=[],seam,_locksHeld=false}={}){
  if(runtimeExclusions.length)fail('scoped-write-exclusion-authority');if(!/^op-[0-9a-f]{32,64}$/.test(operationId||''))
    fail('scoped-write-operation');const transaction=require('./transaction-runtime.js');if(!_locksHeld)return transaction.withRankedLocks(
      scopedWriteRankLocks(stateCapability),()=>acceptScopedWrite({stateCapability,plan,planCapability,sliceId,operationId,
        preManifestSha256,seam,_locksHeld:true}));const lockedPlan=lockedScopedPlan(planCapability,plan);const sessionId=
    transaction.sessionIdFromState(stateCapability);const projectCapability=manifestCapabilities(stateCapability).projectCapability;
  let pending=await resumeOperation({projectCapability,operationId,sessionId,kind:'delegation-scope-publish'});const receiptPath=path.join(
    stateCapability.projectRoot,'.claude',`deep-work.${sessionId}.scoped-write.${operationId}.json`);const cap=
    issueProjectStateCapability(stateCapability.projectRoot,receiptPath,{role:'state'});revalidatePathCapability(cap,'scoped-write-receipt');
  let receipt;try{receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));}catch{fail('scoped-write-receipt-json');}
  if(receipt.sliceId!==sliceId||receipt.preManifest.sha256!==preManifestSha256||receipt.planSha256!==
      canonicalizePlanScopeV1(lockedPlan).sha256||pending.result&&pending.result.receiptSha256!==receipt.receiptSha256)
    fail('scoped-write-identity');if(pending.stage==='completed-ledger'){if(receipt.status!=='accepted'||
      !/^[0-9a-f]{64}$/.test(receipt.receiptSha256||''))fail('scoped-write-identity');return receipt;}
  if(pending.preconditions?.action!=='scoped-write'||pending.preconditions?.sliceId!==sliceId||
      pending.preconditions?.authoritySha256!==receipt.authority.sha256)fail('scoped-write-identity');let accepted=receipt;
  if(receipt.status==='begun'){const stateBefore=parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
    if(stateBefore.current_phase!=='implement'||stateBefore.active_slice!==sliceId||stateBefore.tdd_state!==receipt.tddPreState)
      fail('scoped-write-state');const caps=manifestCapabilities(stateCapability);seam?.('before-post-manifest',{operationId});
    const derivedExclusions=scopedWriteRuntimeExclusions(stateCapability,operationId,cap);const post=
      captureWorktreeManifest({...caps,runtimeExclusions:derivedExclusions});const changed=
      changedPaths(receipt.preManifest,post);const allowed=new Set(receipt.authority.authorized_paths);for(const candidate of changed)
      if(!allowed.has(candidate)&&!derivedExclusions.some((ex)=>path.relative(stateCapability.projectRoot,ex.path).split(path.sep).join('/')===candidate))
        fail('scoped-write-out-of-scope',candidate);const receiptSha256=sha256(canonicalJson({operationId,
        postManifestSha256:post.sha256,changedPaths:changed,planSha256:receipt.planSha256,sliceId,writeClass:receipt.writeClass}));
    accepted={...receipt,status:'accepted',postManifest:post,changedPaths:changed,receiptSha256};seam?.('before-accepted-receipt-write',
      {operationId,receiptSha256});atomicWriteFile(cap,canonicalJson(accepted));seam?.('after-receipt-write',{operationId,receiptSha256});}
  else if(receipt.status!=='accepted'||!/^[0-9a-f]{64}$/.test(receipt.receiptSha256||''))fail('scoped-write-identity');
  await recordOperationStage({projectCapability,operationId,sessionId,kind:'delegation-scope-publish'},'scoped-write-accepted',
    {owned:{receiptPath,receiptSha256:accepted.receiptSha256,postManifestSha256:accepted.postManifest.sha256}});const patch={
      accepted_write_operation_id:operationId,accepted_write_receipt_sha256:accepted.receiptSha256,
      accepted_write_class:accepted.writeClass};if(accepted.writeClass==='refactor'){patch.tdd_state='REFACTOR_PENDING';
    patch.fresh_sensor_required=true;patch.sensor_cycle_operation_id=null;patch.sensor_results_sha256=null;patch.refactor_cycle=JSON.stringify({
      schema_version:1,sliceId,planSha256:accepted.planSha256,writeOperationId:operationId,writeReceiptSha256:accepted.receiptSha256,
      verificationOperationId:null,verificationResultSha256:null,sensorCycleOperationId:null});}
  const stateText=fs.readFileSync(stateCapability.path,'utf8'),fields=parseFrontmatter(stateText).fields;if(fields.current_phase!=='implement'||
      fields.active_slice!==sliceId)fail('scoped-write-state');let already=fields.accepted_write_operation_id===operationId&&
      fields.accepted_write_receipt_sha256===accepted.receiptSha256&&fields.accepted_write_class===accepted.writeClass;
  if(accepted.writeClass==='refactor'&&fields.tdd_state==='REFACTOR_PENDING'){let cycle;try{cycle=JSON.parse(fields.refactor_cycle);}
    catch{fail('scoped-write-state');}already=already&&cycle.writeOperationId===operationId&&
      cycle.writeReceiptSha256===accepted.receiptSha256&&cycle.planSha256===accepted.planSha256;}
  else if(fields.tdd_state!==accepted.tddPreState)fail('scoped-write-state');if(!already){seam?.('before-state-write',{operationId,patch});
    atomicWriteFile(stateCapability,updateFrontmatterText(stateText,patch));seam?.('after-state-write',{operationId,patch});}
  await recordOperationStage({projectCapability,operationId,sessionId,kind:'delegation-scope-publish'},'state-written',
    {owned:{statePath:stateCapability.path,operationId,receiptSha256:accepted.receiptSha256}});const operationReceipt=
    await completeOperation({projectCapability,operationId,sessionId,kind:'delegation-scope-publish'},{status:'accepted',
      receiptSha256:accepted.receiptSha256,postManifestSha256:accepted.postManifest.sha256,sliceId,writeClass:accepted.writeClass});
  return{...accepted,operationReceipt};
}

function initialResetReceipt(receipt,sliceId){if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||receipt.slice_id!==sliceId)
  fail('slice-reset-receipt');const next={};for(const key of ['schema_version','session_id','plan_sha256','cluster_id','goal','tdd_mode',
    'model_used','model_auto_selected','model_override_reason','estimated_cost','worktree_branch','git_before','git_after','git_before_slice'])
    if(Object.hasOwn(receipt,key))next[key]=structuredClone(receipt[key]);next.slice_id=sliceId;next.status='in_progress';next.tdd_state='PENDING';
  next.tdd={};next.changes={files_modified:[],lines_added:0,lines_removed:0};next.verification={};next.spec_compliance={};
  next.code_review={};next.debug=null;if(Object.hasOwn(receipt,'timestamp'))next.timestamp=receipt.timestamp;return next;}
async function resetSlice({stateCapability,planCapability,plan,receiptsDirCapability,sliceId,seam,_locksHeld=false}={}){
  requireSlice(plan,sliceId);const transaction=require('./transaction-runtime.js');const sessionId=transaction.sessionIdFromState(stateCapability);
  const projectCapability=manifestCapabilities(stateCapability).projectCapability;const receiptPath=path.join(receiptsDirCapability.path,`${sliceId}.json`);
  if(!_locksHeld){if(!receiptsDirCapability||receiptsDirCapability.kind!=='receipts-directory'||
      receiptsDirCapability.sessionCapability?.path!==planCapability.sessionCapability?.path)fail('slice-reset-receipts');
    const root=stateCapability.projectRoot;const locks=[{rank:transaction.RANKS.repository,capability:issueProjectStateCapability(root,
      path.join(root,'.claude','deep-work.git.lock'),{allowMissingLeaf:true,role:'lock'})},{rank:transaction.RANKS.session,
      capability:issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),
        {allowMissingLeaf:true,role:'lock'})},{rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,
      path.join(root,'.claude',`deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
      {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}];const targets=[planCapability.path,receiptPath]
      .map((target)=>issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.target.${crypto.createHash('sha256')
        .update(path.relative(root,target)).digest('hex')}.lock`),{allowMissingLeaf:true,role:'lock'}))
      .sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))).map((capability)=>({rank:transaction.RANKS.target,capability}));
    return transaction.withRankedLocks([...locks,...targets],()=>resetSlice({stateCapability,planCapability,plan,receiptsDirCapability,
      sliceId,seam,_locksHeld:true}));}
  transaction.revalidateSessionFile(planCapability);const receiptCapability=transaction.issueSessionFileCapability({
    sessionCapability:receiptsDirCapability.sessionCapability,candidate:receiptPath,allowedBasenames:[`${sliceId}.json`],role:'slice-receipt'});
  const operation=await beginOperation({projectCapability,sessionId,kind:'slice-reset',slice:sliceId,preconditions:{sliceId}});
  let pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'slice-reset'});let prepared=
    pending.stages?.find((row)=>row.stage==='stores-prepared')?.details?.owned;let stateText=fs.readFileSync(stateCapability.path,'utf8');
  let planBytes=transaction.readSessionFile(planCapability),receiptBytes=transaction.readSessionFile(receiptCapability);let currentPlan;
  try{currentPlan=JSON.parse(planBytes);}catch{fail('slice-reset-plan-json');}if(canonicalJson(currentPlan)!==canonicalJson(plan))
    fail('slice-reset-plan-changed');
  if(!prepared){const currentState=parseFrontmatter(stateText).fields;if(currentState.current_phase!=='implement')fail('slice-reset-phase');
    const target=requireSlice(currentPlan,sliceId);let currentReceipt;try{currentReceipt=JSON.parse(receiptBytes);}catch{fail('slice-reset-receipt-json');}
    const nextPlan=structuredClone(currentPlan);requireSlice(nextPlan,sliceId).checked=false;const nextPlanBytes=Buffer.from(canonicalJson(nextPlan));
    const nextReceiptBytes=Buffer.from(canonicalJson(initialResetReceipt(currentReceipt,sliceId)));const nextStateText=updateFrontmatterText(stateText,
      {active_slice:sliceId,tdd_state:'PENDING'});prepared={sliceId,preTddState:currentState.tdd_state,statePath:stateCapability.path,
      planPath:planCapability.path,receiptPath:receiptCapability.path,stateBeforeSha256:sha256(stateText),stateAfterSha256:sha256(nextStateText),
      planBeforeSha256:sha256(planBytes),planAfterSha256:sha256(nextPlanBytes),receiptBeforeSha256:sha256(receiptBytes),
      receiptAfterSha256:sha256(nextReceiptBytes),planWasChecked:Boolean(target.checked)};await recordOperationStage(operation,'stores-prepared',
      {owned:prepared});}
  if(prepared.sliceId!==sliceId||prepared.statePath!==stateCapability.path||prepared.planPath!==planCapability.path||
      prepared.receiptPath!==receiptCapability.path)fail('slice-reset-store-identity');const classify=(bytes,before,after)=>{
    const digest=sha256(bytes);return digest===before?'before':digest===after?'after':fail('slice-reset-store-diverged');};
  let stateStatus=classify(stateText,prepared.stateBeforeSha256,prepared.stateAfterSha256),planStatus=classify(planBytes,
    prepared.planBeforeSha256,prepared.planAfterSha256),receiptStatus=classify(receiptBytes,prepared.receiptBeforeSha256,
      prepared.receiptAfterSha256);pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'slice-reset'});
  if(!pending.stages?.some((row)=>row.stage==='stash-published')){let stash={required:false};if(prepared.preTddState==='SPIKE'){
      const stashOperationId=`op-${sha256(canonicalJson({kind:'slice-reset-stash',parentOperationId:operation.operationId}))}`;
      stash=await require('./git-runtime.js').stashPublishUnderHeldLocks({projectCapability,sessionId,purpose:'slice-reset',
        includeUntracked:true,operationId:stashOperationId,seam:(name,context)=>seam?.(`stash-${name}`,context)});}
    await recordOperationStage(operation,'stash-published',{owned:{required:prepared.preTddState==='SPIKE',operationId:stash.operationId||null,
      result:stash.result||null,stashObjectId:stash.stashObjectId||null}});}
  if(planStatus==='before'){const next=JSON.parse(planBytes);requireSlice(next,sliceId).checked=false;const bytes=Buffer.from(canonicalJson(next));
    if(sha256(bytes)!==prepared.planAfterSha256)fail('slice-reset-plan-replay');seam?.('before-plan-write',{operationId:operation.operationId});
    transaction.atomicWriteSessionFile(planCapability,bytes);seam?.('after-plan-write-before-stage',{operationId:operation.operationId});}
  await recordOperationStage(operation,'plan-written',{owned:{path:planCapability.path,sha256:prepared.planAfterSha256}});
  if(receiptStatus==='before'){let current;try{current=JSON.parse(receiptBytes);}catch{fail('slice-reset-receipt-json');}
    const bytes=Buffer.from(canonicalJson(initialResetReceipt(current,sliceId)));if(sha256(bytes)!==prepared.receiptAfterSha256)
      fail('slice-reset-receipt-replay');seam?.('before-receipt-write',{operationId:operation.operationId});
    transaction.atomicWriteSessionFile(receiptCapability,bytes);seam?.('after-receipt-write-before-stage',{operationId:operation.operationId});}
  await recordOperationStage(operation,'receipt-written',{owned:{path:receiptCapability.path,sha256:prepared.receiptAfterSha256}});
  if(stateStatus==='before'){const next=updateFrontmatterText(stateText,{active_slice:sliceId,tdd_state:'PENDING'});
    if(sha256(next)!==prepared.stateAfterSha256)fail('slice-reset-state-replay');seam?.('before-state-write',{operationId:operation.operationId});
    atomicWriteFile(stateCapability,next);seam?.('after-state-write-before-stage',{operationId:operation.operationId});}
  await recordOperationStage(operation,'state-written',{owned:{path:stateCapability.path,sha256:prepared.stateAfterSha256}});
  stateText=fs.readFileSync(stateCapability.path,'utf8');planBytes=transaction.readSessionFile(planCapability);
  receiptBytes=transaction.readSessionFile(receiptCapability);if(sha256(stateText)!==prepared.stateAfterSha256||
      sha256(planBytes)!==prepared.planAfterSha256||sha256(receiptBytes)!==prepared.receiptAfterSha256)fail('slice-reset-postcondition');
  const result={status:'reset',sliceId,stashRequired:prepared.preTddState==='SPIKE',planSha256:prepared.planAfterSha256,
    receiptSha256:prepared.receiptAfterSha256,stateSha256:prepared.stateAfterSha256};const operationReceipt=await completeOperation(operation,result);
  return{...result,operationId:operation.operationId,operationReceipt};
}

async function completeSlice({stateCapability,planCapability,plan,receiptsDirCapability,sliceId,
  receiptPayload,receiptTemp,seam,_locksHeld=false}={}){
  if(!_locksHeld){const transaction=require('./transaction-runtime.js');const sessionId=transaction.sessionIdFromState(stateCapability);const root=
      stateCapability.projectRoot;const operationLock=issueProjectStateCapability(root,path.join(root,'.claude',
        `deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'});const journalLock=issueProjectStateCapability(root,
        path.join(root,'.claude',`deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'});const targetPaths=[
        planCapability.path,path.join(receiptsDirCapability.path,`${sliceId}.json`),path.join(root,'.claude',
          `deep-work.${sessionId}.slice-complete-result`),...(receiptTemp?[path.join(receiptTemp.sessionCapability.path,'.tmp',
            receiptTemp.sourceOperationId,'receipt-payload.tmp.consumer.json')]:[])].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
    const targets=targetPaths.map((target)=>issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.target.${
      crypto.createHash('sha256').update(path.relative(root,target)).digest('hex')}.lock`),{allowMissingLeaf:true,role:'lock'}))
      .sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))).map((capability)=>({rank:transaction.RANKS.target,capability}));
    return transaction.withRankedLocks([{rank:transaction.RANKS.session,capability:operationLock},
      {rank:transaction.RANKS.journal,capability:journalLock},{rank:transaction.RANKS.state,
        capability:transaction.stateLock(stateCapability)},...targets],()=>completeSlice({stateCapability,planCapability,plan,
          receiptsDirCapability,sliceId,receiptPayload,receiptTemp,seam,_locksHeld:true}));}
  const slice=requireSlice(plan,sliceId);const fields=parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  assertProductionCompletionMode(plan,fields);
  const adopting=slice.checked&&fields.active_slice===null&&fields.tdd_state==='PENDING';
  if(!adopting&&(fields.active_slice!==sliceId||!['SENSOR_CLEAN','SPIKE'].includes(fields.tdd_state)||
      fields.tdd_state==='SPIKE'&&fields.tdd_override!==sliceId))fail('slice-completion-evidence');
  if(!adopting&&fields.tdd_state==='SENSOR_CLEAN'&&fields.refactor_cycle){let cycle;
    try{cycle=JSON.parse(fields.refactor_cycle);}catch{fail('slice-completion-evidence');}
    if(fields.fresh_sensor_required||!/^op-[0-9a-f]{32,64}$/.test(fields.sensor_cycle_operation_id||'')||
        !/^[0-9a-f]{64}$/.test(fields.sensor_results_sha256||'')||
        cycle.sensorCycleOperationId!==fields.sensor_cycle_operation_id||cycle.sliceId!==sliceId)fail('slice-completion-evidence');
    const sensorReceipt=await require('./operation-journal.js').resumeOperation({projectCapability:manifestCapabilities(stateCapability).projectCapability,
      operationId:fields.sensor_cycle_operation_id,sessionId:path.basename(stateCapability.path).slice('deep-work.'.length,-3),
      kind:'sensor-cycle-accept'});
    if(sensorReceipt.stage!=='completed-ledger'||sensorReceipt.result?.status!=='completed'||
        sensorReceipt.result.statePath!==stateCapability.path)fail('slice-completion-evidence');}
  const sessionId=path.basename(stateCapability.path).slice('deep-work.'.length,-3);
  const projectCapability=manifestCapabilities(stateCapability).projectCapability;
  const basePlan=structuredClone(plan);const baseSlice=basePlan.slices.find((row)=>row.id===sliceId);baseSlice.checked=false;
  const operation=await beginOperation({projectCapability,sessionId,kind:'implement-slice-complete',slice:sliceId,
    preconditions:{planSha256:sha256(canonicalJson(basePlan)),sourceOperationId:receiptTemp?.sourceOperationId||null,
      receiptSha256:receiptPayload?sha256(canonicalJson(receiptPayload)):null}});
  let sourceDigest=null;let activeSession=null;if(receiptTemp){const workPath=path.join(stateCapability.projectRoot,
      ...String(fields.work_dir||'').split('/'));activeSession=issueProjectStateCapability(stateCapability.projectRoot,workPath,
      {role:'session-work-dir',sessionStateCapability:stateCapability});if(receiptTemp.sessionCapability?.path!==activeSession.path)
      fail('slice-receipts-capability');const artifact=require('./artifact-runtime.js');let pending=await require('./operation-journal.js').resumeOperation({
        projectCapability,operationId:operation.operationId,sessionId,kind:'implement-slice-complete'});let prepared=pending.stages?.find(
        (row)=>row.stage==='temp-prepared')?.details?.owned;if(!prepared){const value=await artifact.prepareOwnedTempForOperation({
          sessionCapability:activeSession,sourceOperationId:receiptTemp.sourceOperationId,purpose:'receipt-payload'});prepared={
          sourceOperationId:receiptTemp.sourceOperationId,sha256:value.sha256,bytesBase64:value.bytes.toString('base64')};
        await recordOperationStage(operation,'temp-prepared',{owned:prepared});}if(prepared.sourceOperationId!==receiptTemp.sourceOperationId||
        !/^[0-9a-f]{64}$/.test(prepared.sha256||'')||typeof prepared.bytesBase64!=='string')fail('slice-temp-prepared');const bytes=
        Buffer.from(prepared.bytesBase64,'base64');if(bytes.toString('base64')!==prepared.bytesBase64||sha256(bytes)!==prepared.sha256)
        fail('slice-temp-prepared');pending=await require('./operation-journal.js').resumeOperation({projectCapability,
          operationId:operation.operationId,sessionId,kind:'implement-slice-complete'});if(!pending.stages?.some(
          (row)=>row.stage==='temp-consumed')){await artifact.consumeOwnedTempForOperation({sessionCapability:activeSession,
            sourceOperationId:receiptTemp.sourceOperationId,purpose:'receipt-payload',consumerOperationId:operation.operationId,
            expectedDigest:prepared.sha256,adoptWithoutRead:true});await recordOperationStage(operation,'temp-consumed',{owned:{
            sourceOperationId:receiptTemp.sourceOperationId,sha256:prepared.sha256}});}try{receiptPayload=JSON.parse(bytes);}catch{
        fail('slice-receipt');}sourceDigest=prepared.sha256;}
  if(!receiptPayload||typeof receiptPayload!=='object'||receiptPayload.slice_id!==sliceId)fail('slice-receipt');
  const published=receiptTemp?require('./artifact-runtime.js').publishFinalizedReceipt({sessionCapability:activeSession,
    operation,kind:'implement-slice-complete',sourceTempDigest:sourceDigest,payload:receiptPayload,slice:sliceId}):null;
  if(published){if(seam)seam('before-result-publish',{operationId:operation.operationId,path:published.path});
    await recordOperationStage(operation,'result-published',{owned:{path:published.path,sha256:published.sha256}});
    if(seam)seam('after-result-publish',{operationId:operation.operationId,path:published.path});}
  if(!receiptsDirCapability||receiptsDirCapability.kind!=='receipts-directory'||
      receiptsDirCapability.sessionCapability.path!==activeSession?.path)fail('slice-receipts-capability');
  const receiptName=`${sliceId}.json`;const receiptPath=path.join(receiptsDirCapability.path,receiptName);
  const receiptCapability=require('./transaction-runtime.js').issueSessionFileCapability({sessionCapability:activeSession,
    candidate:receiptPath,allowedBasenames:[receiptName],allowMissingLeaf:true,role:'slice-receipt'});
  const receiptBytes=Buffer.from(canonicalJson(receiptPayload));if(fs.existsSync(receiptPath)){
    if(Buffer.compare(fs.readFileSync(receiptPath),receiptBytes)!==0)fail('slice-receipt-adoption');
  }else{if(seam)seam('before-receipt-write',{operationId:operation.operationId,path:receiptPath});
    require('./transaction-runtime.js').atomicWriteSessionFile(receiptCapability,receiptBytes);
    if(seam)seam('after-receipt-write',{operationId:operation.operationId,path:receiptPath});}
  await recordOperationStage(operation,'receipt-written',{owned:{path:receiptPath,sha256:sha256(receiptBytes),sliceId}});
  slice.checked=true;if(seam)seam('before-plan-write',{operationId:operation.operationId,sliceId});
  require('./transaction-runtime.js').atomicWriteSessionFile(planCapability,canonicalJson(plan));
  if(seam)seam('after-plan-write',{operationId:operation.operationId,sliceId});
  await recordOperationStage(operation,'plan-written',{owned:{sliceId,planSha256:sha256(canonicalJson(plan))}});
  if(!adopting){if(seam)seam('before-state-write',{operationId:operation.operationId,sliceId});
    const stateText=fs.readFileSync(stateCapability.path,'utf8');const current=parseFrontmatter(stateText).fields;
    atomicWriteFile(stateCapability,updateFrontmatterText(stateText,{active_slice:null,tdd_state:'PENDING',tdd_override:null,
      tdd_override_reason_sha256:null,implement_completed_at:plan.slices.every((row)=>row.checked)
        ?current.implement_completed_at||new Date().toISOString():undefined}));
    if(seam)seam('after-state-write',{operationId:operation.operationId,sliceId});}
  await recordOperationStage(operation,'state-written',{owned:{sliceId}});
  const ledger=await completeOperation(operation,{status:'complete',sliceId,receiptSha256:sha256(canonicalJson(receiptPayload)),
    sourceTempDigest:sourceDigest,finalizedBytesDigest:published?.sha256||null});return{status:'complete',sliceId,
    operationId:operation.operationId,producerReceipt:published?.producerReceipt,resultCapability:published?.resultCapability,
    resultPath:published?.path,resultSha256:published?.sha256,operationReceipt:ledger};
}

function assertProductionCompletionMode(plan,fields){
  if(plan?.contract_binding?.mode==='strict-spec'&&fields?.tdd_state==='SPIKE')fail('spike-production-forbidden');
  return true;
}

module.exports = {activateSlice,enterSliceSpike,setSliceModel,setExecutionOverride,
  setClusterTakeover,clearClusterTakeover,migrateModelRouting,mutateState,setDelegationSnapshot,
  clearDelegationSnapshot,
  beginScopedWrite,acceptScopedWrite,resetSlice,completeSlice,assertProductionCompletionMode};
