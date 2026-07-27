'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');
const journal=require('./operation-journal.js');
const frontmatter=require('./frontmatter.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);error.code=code;throw error;}
function canonical(value){return journal.canonicalJson(value);}
function semanticDigest(domain,value,omitted){
  const copy=structuredClone(value);if(omitted)delete copy[omitted];
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(`${domain}\0`),Buffer.from(canonical(copy))])).digest('hex');
}
function operationId(domain,value){return `op-${semanticDigest(domain,value)}`;}
function sessionId(stateCapability){return transaction.sessionIdFromState(stateCapability);}
function project(stateCapability){return transaction.projectCapabilityFor(stateCapability);}
function byteSort(values){return [...new Set(values)].sort((a,b)=>
  Buffer.compare(Buffer.from(a),Buffer.from(b)));}
function writeExclusive(file,value,code){
  const bytes=Buffer.from(canonical(value));fs.mkdirSync(path.dirname(file),{recursive:true});
  let fd;try{fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|
    fs.constants.O_WRONLY,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
  catch(error){if(error.code!=='EEXIST'||!fs.readFileSync(file).equals(bytes))fail(code);}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  if(!fs.readFileSync(file).equals(bytes))fail(code);
  return journal.sha256(bytes);
}
function readCanonical(file,code){
  let stat,bytes;try{stat=fs.lstatSync(file);bytes=fs.readFileSync(file);}catch{fail(code);}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)fail(code);
  let value;try{value=JSON.parse(bytes);}catch{fail(code);}
  if(!bytes.equals(Buffer.from(canonical(value))))fail(code);
  return{value,sha256:journal.sha256(bytes)};
}
function stateRiskClass(fields){
  if(['low','medium','high','critical'].includes(fields.risk_class))return fields.risk_class;
  for(const key of ['verification_plan_json','policy_snapshot_json','risk_profile_json']){
    if(typeof fields[key]!=='string')continue;
    try{const value=JSON.parse(fields[key]),risk=value.risk_class||value.class;
      if(['low','medium','high','critical'].includes(risk))return risk;}catch{}
  }
  fail('replan-risk-class');
}
function parseArray(value,code){if(value===undefined||value===null||value==='')return[];
  try{const parsed=typeof value==='string'?JSON.parse(value):value;
    if(!Array.isArray(parsed))fail(code);return parsed;}catch(error){
    if(error.code===code)throw error;fail(code);}}
function digestExcluding(value,key){
  const copy=structuredClone(value);delete copy[key];return journal.sha256(canonical(copy));
}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonical(Object.keys(value).sort())===canonical([...keys].sort());}
const DISCOVERY_IDENTIFIER=Object.freeze({
  'public-contract':'requirement_id','invariant':'invariant_id',
  'failure-state':'failure_mode_id','external-side-effect':'failure_mode_id',
  'unplanned-mock':'invariant_id','persistent-state-transition':'invariant_id',
  'spike-promotion':'requirement_id',
});
const RISK_CLASSES=Object.freeze(['low','medium','high','critical']);
function riskClass(value){
  const candidate=value?.class||value?.risk_class;
  if(!RISK_CLASSES.includes(candidate))fail('replan-risk-observation');
  return candidate;
}
function validateDiscoveryObservation(value,{stateCapability,plan}={}){
  const keys=['schema_version','reason','scope','slice_id','requirement_id',
    'invariant_id','failure_mode_id','source_path','source_sha256','detail_code'];
  const required=DISCOVERY_IDENTIFIER[value?.reason],identifierKeys=[
    'requirement_id','invariant_id','failure_mode_id'];
  if(!exactKeys(value,keys)||value.schema_version!==1||!required||
      !['slice','session'].includes(value.scope)||
      (value.scope==='slice'?!/^SLICE-\d{3}$/.test(value.slice_id||''):
        value.slice_id!==null)||
      identifierKeys.some((key)=>key===required?
        typeof value[key]!=='string'||!value[key]:value[key]!==null)||
      typeof value.detail_code!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.detail_code)||
      typeof value.source_path!=='string'||!value.source_path||
      path.isAbsolute(value.source_path)||value.source_path.split('/').includes('..')||
      !DIGEST.test(value.source_sha256||''))
    fail('replan-discovery');
  if(value.scope==='slice'&&!plan.slices?.some((row)=>row.id===value.slice_id))
    fail('replan-discovery');
  const source=path.resolve(stateCapability.projectRoot,...value.source_path.split('/'));
  if(!platform.isPathInside(stateCapability.projectRoot,source))fail('replan-discovery');
  let stat,bytes;try{stat=fs.lstatSync(source);bytes=fs.readFileSync(source);}catch{
    fail('replan-discovery');}
  if(!stat.isFile()||stat.isSymbolicLink()||journal.sha256(bytes)!==value.source_sha256)
    fail('replan-discovery');
  return structuredClone(value);
}
async function publishOwnedDiscovery({stateCapability,plan,observation}={}){
  const sid=sessionId(stateCapability);
  if(!DIGEST.test(plan?.plan_authority_sha256||''))fail('replan-discovery-plan');
  const checked=validateDiscoveryObservation(observation,{stateCapability,plan});
  const observationDigest=semanticDigest('owned-discovery',checked);
  const preconditions={session_id:sid,plan_authority_sha256:
    plan.plan_authority_sha256,observation_digest:observationDigest};
  const id=operationId('replan-discovery-publication-v1',preconditions);
  const existing=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:id,sessionId:sid,kind:'replan-discovery-publish'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(existing?.stage==='completed-ledger'){
    const relative=existing.result?.observation_path;
    const raw=readCanonical(path.join(stateCapability.projectRoot,
      ...String(relative||'').split('/')),'replan-discovery-replay');
    if(raw.sha256!==existing.result.observation_artifact_sha256||
        semanticDigest('owned-discovery',validateDiscoveryObservation(raw.value,{
          stateCapability,plan}))!==observationDigest)
      fail('replan-discovery-replay');
    return{...existing.result,operation_id:id,operation_receipt:existing,adopted:true};
  }
  const operation=await journal.beginOperation({projectCapability:project(stateCapability),
    sessionId:sid,kind:'replan-discovery-publish',operationId:id,
    preconditions});
  await journal.recordOperationStage(operation,'authority-authenticated',{owned:{
    planAuthoritySha256:plan.plan_authority_sha256,observationDigest}});
  const relative=`.deep-work/${sid}/replans/discovery-${observationDigest}.json`;
  const artifactSha256=writeExclusive(path.join(stateCapability.projectRoot,
    ...relative.split('/')),checked,'replan-discovery-publish');
  await journal.recordOperationStage(operation,'observation-published',{owned:{
    observationPath:relative,observationDigest,observationArtifactSha256:artifactSha256}});
  const receipt=await journal.completeOperation(operation,{session_id:sid,
    plan_authority_sha256:plan.plan_authority_sha256,observation_path:relative,
    observation_digest:observationDigest,observation_artifact_sha256:artifactSha256});
  return{...receipt.result,operation_id:id,operation_receipt:receipt,adopted:false};
}
function validateRiskObservation(value){
  if(!exactKeys(value,['schema_version','prior_risk_profile_sha256',
      'next_risk_profile_sha256','from_risk','to_risk'])||
      value.schema_version!==1||
      !DIGEST.test(value.prior_risk_profile_sha256||'')||
      !DIGEST.test(value.next_risk_profile_sha256||'')||
      value.prior_risk_profile_sha256===value.next_risk_profile_sha256||
      !RISK_CLASSES.includes(value.from_risk)||
      !RISK_CLASSES.includes(value.to_risk)||
      RISK_CLASSES.indexOf(value.to_risk)<=RISK_CLASSES.indexOf(value.from_risk))
    fail('replan-risk-observation');
  return structuredClone(value);
}
async function publishRiskObservation({stateCapability,plan,nextRiskProfile}={}){
  const sid=sessionId(stateCapability),fields=frontmatter.parseFrontmatter(
    fs.readFileSync(stateCapability.path,'utf8')).fields;
  const priorSha256=plan?.contract_binding?.risk_profile_sha256,
    next=structuredClone(nextRiskProfile),nextSha256=journal.sha256(canonical(next));
  if(!DIGEST.test(priorSha256||''))fail('replan-risk-authority');
  let fromRisk;
  if(fields.risk_profile_sha256===priorSha256){
    const prior=parseStoredObject(fields.risk_profile_json,'replan-risk-observation');
    if(journal.sha256(canonical(prior))!==priorSha256)fail('replan-risk-authority');
    fromRisk=riskClass(prior);
  }else{
    const transition=parseStoredObject(fields.risk_transition_json,
      'replan-risk-authority');
    if(fields.risk_profile_sha256!==nextSha256||
        journal.sha256(canonical(parseStoredObject(fields.risk_profile_json,
          'replan-risk-authority')))!==nextSha256||
        transition.reason!=='risk-class-increase'||transition.to!==riskClass(next)||
        !RISK_CLASSES.includes(transition.from))
      fail('replan-risk-authority');
    fromRisk=transition.from;
  }
  const observation=validateRiskObservation({schema_version:1,
    prior_risk_profile_sha256:priorSha256,next_risk_profile_sha256:nextSha256,
    from_risk:fromRisk,to_risk:riskClass(next)});
  const observationDigest=semanticDigest('risk-profile',observation);
  const preconditions={session_id:sid,plan_authority_sha256:
    plan.plan_authority_sha256,observation_digest:observationDigest};
  const id=operationId('risk-observation-publication-v1',preconditions);
  const existing=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:id,sessionId:sid,kind:'risk-observation-publish'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(existing?.stage==='completed-ledger'){
    const terminal=existing.result,observationRaw=readCanonical(path.join(
      stateCapability.projectRoot,...terminal.observation_path.split('/')),
    'replan-risk-replay'),profileRaw=readCanonical(path.join(
      stateCapability.projectRoot,...terminal.next_risk_profile_path.split('/')),
    'replan-risk-replay');
    if(observationRaw.sha256!==terminal.observation_artifact_sha256||
        profileRaw.sha256!==observation.next_risk_profile_sha256||
        canonical(validateRiskObservation(observationRaw.value))!==
          canonical(observation)||canonical(profileRaw.value)!==canonical(next))
      fail('replan-risk-replay');
    return{...terminal,operation_id:id,operation_receipt:existing,adopted:true};
  }
  const operation=await journal.beginOperation({projectCapability:project(stateCapability),
    sessionId:sid,kind:'risk-observation-publish',operationId:id,preconditions});
  await journal.recordOperationStage(operation,'authority-authenticated',{owned:{
    planAuthoritySha256:plan.plan_authority_sha256,
    priorRiskProfileSha256:priorSha256}});
  const base=`.deep-work/${sid}/replans`,observationPath=
    `${base}/risk-observation-${observationDigest}.json`,
    profilePath=`${base}/risk-profile-${nextSha256}.json`;
  const observationArtifactSha256=writeExclusive(path.join(
    stateCapability.projectRoot,...observationPath.split('/')),observation,
  'replan-risk-publish');
  writeExclusive(path.join(stateCapability.projectRoot,...profilePath.split('/')),
    next,'replan-risk-publish');
  await journal.recordOperationStage(operation,'observation-published',{owned:{
    observationPath,observationDigest,observationArtifactSha256,
    nextRiskProfilePath:profilePath,nextRiskProfileSha256:nextSha256}});
  const receipt=await journal.completeOperation(operation,{session_id:sid,
    plan_authority_sha256:plan.plan_authority_sha256,
    observation_path:observationPath,observation_digest:observationDigest,
    observation_artifact_sha256:observationArtifactSha256,
    next_risk_profile_path:profilePath,next_risk_profile_sha256:nextSha256});
  return{...receipt.result,operation_id:id,operation_receipt:receipt,adopted:false};
}
async function dispatchRiskIncreaseReplan({stateCapability,plan,sliceId,
  producerOperationId,seam}={}){
  const sid=sessionId(stateCapability),producer=await journal.resumeOperation({
    projectCapability:project(stateCapability),operationId:producerOperationId,
    sessionId:sid,kind:'risk-observation-publish'}),terminal=producer.result;
  if(producer.stage!=='completed-ledger'||!exactKeys(terminal,
      ['session_id','plan_authority_sha256','observation_path',
        'observation_digest','observation_artifact_sha256',
        'next_risk_profile_path','next_risk_profile_sha256'])||
      terminal.session_id!==sid||
      terminal.plan_authority_sha256!==plan.plan_authority_sha256)
    fail('replan-risk-producer');
  const observationRaw=readCanonical(path.join(stateCapability.projectRoot,
    ...terminal.observation_path.split('/')),'replan-risk-producer');
  const observation=validateRiskObservation(observationRaw.value);
  const profileRaw=readCanonical(path.join(stateCapability.projectRoot,
    ...terminal.next_risk_profile_path.split('/')),'replan-risk-producer');
  if(observationRaw.sha256!==terminal.observation_artifact_sha256||
      semanticDigest('risk-profile',observation)!==terminal.observation_digest||
      profileRaw.sha256!==terminal.next_risk_profile_sha256||
      profileRaw.sha256!==observation.next_risk_profile_sha256||
      riskClass(profileRaw.value)!==observation.to_risk)
    fail('replan-risk-producer');
  const prepared=prepareReplanAuthority({stateCapability,plan,sliceId,
    reason:'risk-class-increase',producerOperationId,
    observationKind:'risk-profile',observation,
    fromRisk:observation.from_risk,toRisk:observation.to_risk});
  prepared.statePatch={risk_class:observation.to_risk,
    risk_profile_json:canonical(profileRaw.value).trimEnd(),
    risk_profile_sha256:observation.next_risk_profile_sha256,
    risk_transition_json:canonical({from:observation.from_risk,
      to:observation.to_risk,reason:'risk-class-increase'}).trimEnd()};
  return recordPreparedReplan({stateCapability,plan,sliceId,prepared,seam});
}
async function dispatchRepeatedRootCauseReplan({stateCapability,plan,
  producerOperationId,seam}={}){
  const authenticated=await require('./root-cause-runtime.js')
    .authenticateRepeatedDerivation({stateCapability,plan,
      operationId:producerOperationId}),observation=authenticated.observation,
    prepared=prepareReplanAuthority({stateCapability,plan,
      sliceId:observation.slice_id,reason:'repeated-root-cause',
      producerOperationId,observationKind:'root-cause-ledger',observation});
  return recordPreparedReplan({stateCapability,plan,
    sliceId:observation.slice_id,prepared,seam});
}
async function dispatchOwnedDiscoveryReplan({stateCapability,plan,sliceId,
  producerOperationId,seam}={}){
  const sid=sessionId(stateCapability);
  const producer=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:producerOperationId,sessionId:sid,kind:'replan-discovery-publish'});
  const terminal=producer.result;
  if(producer.stage!=='completed-ledger'||!exactKeys(terminal,
      ['session_id','plan_authority_sha256','observation_path',
        'observation_digest','observation_artifact_sha256'])||
      terminal.session_id!==sid||
      terminal.plan_authority_sha256!==plan.plan_authority_sha256)
    fail('replan-discovery-producer');
  const raw=readCanonical(path.join(stateCapability.projectRoot,
    ...terminal.observation_path.split('/')),'replan-discovery-producer');
  const observation=validateDiscoveryObservation(raw.value,{stateCapability,plan});
  if(raw.sha256!==terminal.observation_artifact_sha256||
      semanticDigest('owned-discovery',observation)!==terminal.observation_digest||
      observation.scope==='slice'&&observation.slice_id!==sliceId||
      observation.scope==='session'&&sliceId!==null)
    fail('replan-discovery-producer');
  const prepared=prepareReplanAuthority({stateCapability,plan,
    sliceId:observation.slice_id,reason:observation.reason,
    producerOperationId,observationKind:'owned-discovery',observation});
  return recordPreparedReplan({stateCapability,plan,
    sliceId:observation.slice_id,prepared,seam});
}
function parseStoredObject(value,code){
  try{const parsed=typeof value==='string'?JSON.parse(value):value;
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail(code);
    return parsed;}catch(error){if(error.code===code)throw error;fail(code);}
}
async function completeReplan({stateCapability,plan,seam}={}){
  const sid=sessionId(stateCapability);
  const before=fs.readFileSync(stateCapability.path,'utf8');
  const fields=frontmatter.parseFrontmatter(before).fields;
  if(fields.replan_required===false&&DIGEST.test(plan?.replan_epoch||'')&&
      OPERATION.test(fields.replan_epoch_operation_id||'')){
    const priorSpec=parseStoredObject(fields.spec_approval_json,
      'replan-complete-spec-approval');
    const priorPlan=parseStoredObject(fields.plan_approved,
      'replan-complete-plan-approval');
    const replayPreconditions={session_id:sid,epoch_id:plan.replan_epoch,
      epoch_operation_id:fields.replan_epoch_operation_id,
      spec_approval_operation_id:priorSpec.approval_operation_id,
      spec_approval_sha256:priorSpec.approval_sha256,
      plan_approval_operation_id:priorPlan.approval_operation_id,
      plan_authority_sha256:plan.plan_authority_sha256};
    const replayId=operationId('replan-complete-v1',replayPreconditions);
    const replay=await journal.resumeOperation({projectCapability:project(stateCapability),
      operationId:replayId,sessionId:sid,kind:'replan-complete'});
    if(replay.stage!=='completed-ledger'||replay.result?.epoch_id!==plan.replan_epoch||
        replay.result?.plan_authority_sha256!==plan.plan_authority_sha256)
      fail('replan-complete-replay');
    return{...replay.result,operation_id:replayId,operation_receipt:replay,
      adopted:true};
  }
  if(fields.replan_required!==true||!DIGEST.test(fields.active_replan_epoch_id||'')||
      plan?.replan_epoch!==fields.active_replan_epoch_id||
      journal.sha256(canonical(plan))!==fields.plan_projection_sha256)
    fail('replan-complete-state');
  const epoch=parseStoredObject(fields.active_replan_epoch_json,'replan-complete-epoch');
  if(!exactKeys(epoch,['schema_version','session_id','trigger_id',
      'trigger_operation_id','trigger_ledger_result_sha256',
      'prior_plan_authority_sha256','epoch_operation_id','epoch_id'])||
      epoch.schema_version!==1||epoch.session_id!==sid||
      epoch.epoch_id!==fields.active_replan_epoch_id||
      semanticDigest('replan-epoch-v1',epoch,'epoch_id')!==epoch.epoch_id||
      epoch.epoch_operation_id!==fields.replan_epoch_operation_id)
    fail('replan-complete-epoch');
  const epochReceipt=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:epoch.epoch_operation_id,sessionId:sid,kind:'replan-epoch-publication'});
  if(epochReceipt.stage!=='completed-ledger'||!exactKeys(epochReceipt.result,
      ['epoch_id','epoch_sha256','post_state_sha256'])||
      epochReceipt.result.epoch_id!==epoch.epoch_id)
    fail('replan-complete-epoch');
  const specApproval=parseStoredObject(fields.spec_approval_json,
    'replan-complete-spec-approval');
  if(!exactKeys(specApproval,['schema_version','session_id','spec_sha256',
      'spec_approved_hash','risk_profile_sha256','replan_epoch',
      'spec_review_ref_sha256','approval_operation_id','approval_sha256'])||
      specApproval.schema_version!==1||specApproval.session_id!==sid||
      specApproval.replan_epoch!==epoch.epoch_id||
      specApproval.spec_approved_hash!==fields.spec_approved_hash||
      specApproval.risk_profile_sha256!==fields.risk_profile_sha256||
      specApproval.approval_operation_id!==fields.spec_approval_operation_id||
      specApproval.approval_sha256!==journal.sha256(canonical(Object.fromEntries(
        Object.entries(specApproval).filter(([key])=>key!=='approval_sha256')))))
    fail('replan-complete-spec-approval');
  const planApproval=parseStoredObject(fields.plan_approved,'replan-complete-plan-approval');
  if(planApproval.replan_epoch!==epoch.epoch_id||
      planApproval.approval_operation_id===null||
      planApproval.approval_operation_id===undefined||
      planApproval.artifact_sha256!==fields.plan_source_sha256)
    fail('replan-complete-plan-approval');
  const [specReceipt,planReceipt]=await Promise.all([
    journal.resumeOperation({projectCapability:project(stateCapability),
      operationId:specApproval.approval_operation_id,sessionId:sid,kind:'phase-approval'}),
    journal.resumeOperation({projectCapability:project(stateCapability),
      operationId:planApproval.approval_operation_id,sessionId:sid,kind:'phase-approval'}),
  ]);
  if(specReceipt.stage!=='completed-ledger'||planReceipt.stage!=='completed-ledger'||
      specReceipt.operationId===planReceipt.operationId)
    fail('replan-complete-approval-ledger');
  const preconditions={session_id:sid,epoch_id:epoch.epoch_id,
    epoch_operation_id:epoch.epoch_operation_id,
    spec_approval_operation_id:specApproval.approval_operation_id,
    spec_approval_sha256:specApproval.approval_sha256,
    plan_approval_operation_id:planApproval.approval_operation_id,
    plan_authority_sha256:plan.plan_authority_sha256};
  const id=operationId('replan-complete-v1',preconditions);
  const existing=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:id,sessionId:sid,kind:'replan-complete'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(existing?.stage==='completed-ledger')return{...existing.result,
    operation_id:id,operation_receipt:existing,adopted:true};
  const operation=await journal.beginOperation({projectCapability:project(stateCapability),
    sessionId:sid,kind:'replan-complete',operationId:id,preconditions});
  await journal.recordOperationStage(operation,'epoch-authenticated',{owned:{
    epochId:epoch.epoch_id,epochLedgerResultSha256:epochReceipt.resultSha256}});
  await journal.recordOperationStage(operation,'approvals-authenticated',{owned:{
    specApprovalLedgerResultSha256:specReceipt.resultSha256,
    planApprovalLedgerResultSha256:planReceipt.resultSha256}});
  const patch={replan_required:false,replan_reason:null,
    active_replan_epoch_json:null,active_replan_epoch_id:null};
  const after=frontmatter.updateFrontmatterText(before,patch);
  if(after!==before){seam?.('before-replan-complete-state-write',{operationId:id});
    platform.atomicWriteFile(stateCapability,after);}
  await journal.recordOperationStage(operation,'state-written',{owned:{
    statePath:stateCapability.path,postStateSha256:journal.sha256(Buffer.from(after))}});
  const receipt=await journal.completeOperation(operation,{epoch_id:epoch.epoch_id,
    plan_authority_sha256:plan.plan_authority_sha256,
    post_state_sha256:journal.sha256(Buffer.from(after))});
  return{...receipt.result,operation_id:id,operation_receipt:receipt,adopted:false};
}
function invalidationPatch(fields,{sliceId,trigger,invalidation,triggerOperationId,
  triggerPath,invalidationPath,statePatch={}}){
  const prior=parseArray(fields.replan_invalidations_json,'replan-invalidation-state');
  const history=parseArray(fields.replan_trigger_history_json,'replan-trigger-state');
  const patch={current_phase:'research',subphase:'spec',replan_required:true,
    replan_reason:trigger.reason,active_slice:null,tdd_state:'PENDING',
    active_replan_trigger_id:trigger.trigger_id,
    replan_trigger_operation_id:triggerOperationId,replan_trigger_ref:triggerPath,
    replan_invalidation_sha256:invalidation.invalidation_sha256,
    replan_invalidation_ref:invalidationPath,
    replan_invalidations_json:canonical([...prior,invalidation]).trimEnd(),
    replan_trigger_history_json:canonical([...history,trigger]).trimEnd()};
  for(const key of [
    'red_proof_state','red_transition_operation_id','red_verification_result_path',
    'red_verification_result_sha256','red_proof_ref','red_proof_sha256',
    'red_proof_operation_id','verification_operation_id','verification_result_sha256',
    'accepted_write_operation_id','accepted_write_receipt_sha256','accepted_write_class',
    'tdd_override','debug_root_json','active_cluster_takeover','delegation_snapshot',
    'delegation_operation_id','delegation_sha256','refactor_cycle','sensor_cycle_operation_id',
    'sensor_results_sha256','spec_completed_at','spec_approved_hash','spec_contract_json',
    'spec_gate_result_json','plan_approved','plan_projection_sha256','plan_source_sha256',
    'plan_spec_gate_result_json','verification_plan_json','verification_plan_sha256',
    'evidence_pointer_json','evidence_summary_json','evidence_summary_sha256',
    'governed_finding_refs_json'])patch[key]=null;
  patch.verification_consumptions_json='{}';patch.test_passed=false;
  Object.assign(patch,statePatch);
  return patch;
}
async function publishEpoch({stateCapability,trigger,triggerReceipt,priorPlanAuthoritySha256,
  seam}){
  const sid=sessionId(stateCapability);
  const preconditions={session_id:sid,trigger_id:trigger.trigger_id,
    trigger_operation_id:triggerReceipt.operationId,
    trigger_ledger_result_sha256:triggerReceipt.resultSha256,
    prior_plan_authority_sha256:priorPlanAuthoritySha256};
  const id=operationId('replan-epoch-publication-v1',preconditions);
  const existing=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:id,sessionId:sid,kind:'replan-epoch-publication'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(existing?.stage==='completed-ledger')return{...existing.result,operation_id:id,
    operation_receipt:existing,adopted:true};
  const operation=await journal.beginOperation({projectCapability:project(stateCapability),
    sessionId:sid,kind:'replan-epoch-publication',operationId:id,preconditions});
  await journal.recordOperationStage(operation,'trigger-receipt-authenticated',{owned:{
    triggerId:trigger.trigger_id,triggerLedgerResultSha256:triggerReceipt.resultSha256}});
  const epoch={schema_version:1,session_id:sid,trigger_id:trigger.trigger_id,
    trigger_operation_id:triggerReceipt.operationId,
    trigger_ledger_result_sha256:triggerReceipt.resultSha256,
    prior_plan_authority_sha256:priorPlanAuthoritySha256,epoch_operation_id:id,epoch_id:null};
  epoch.epoch_id=semanticDigest('replan-epoch-v1',epoch,'epoch_id');
  const relative=`.deep-work/${sid}/replans/epoch-${epoch.epoch_id}.json`;
  const epochSha256=writeExclusive(path.join(stateCapability.projectRoot,...relative.split('/')),
    epoch,'replan-epoch-publish');
  await journal.recordOperationStage(operation,'epoch-published',{owned:{
    epochPath:relative,epochSha256,epochId:epoch.epoch_id}});
  const before=fs.readFileSync(stateCapability.path,'utf8');
  const fields=frontmatter.parseFrontmatter(before).fields;
  if(fields.active_replan_trigger_id!==trigger.trigger_id)fail('replan-epoch-state');
  const after=frontmatter.updateFrontmatterText(before,{active_replan_epoch_json:
    canonical(epoch).trimEnd(),active_replan_epoch_id:epoch.epoch_id,
    replan_epoch_operation_id:id,replan_epoch_ref:relative});
  if(after!==before){seam?.('before-epoch-state-write',{operationId:id});
    platform.atomicWriteFile(stateCapability,after);}
  await journal.recordOperationStage(operation,'active-epoch-committed',{owned:{
    epochId:epoch.epoch_id,statePath:stateCapability.path}});
  const receipt=await journal.completeOperation(operation,{epoch_id:epoch.epoch_id,
    epoch_sha256:epochSha256,post_state_sha256:journal.sha256(Buffer.from(after))});
  return{...receipt.result,operation_id:id,operation_receipt:receipt,adopted:false};
}
function prepareReplanAuthority({stateCapability,plan,sliceId,reason,producerOperationId,
  observationKind,observation,fromRisk,toRisk}={}){
  const fields=frontmatter.parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  const risk=stateRiskClass(fields);
  const priorRisk=fromRisk||risk,nextRisk=toRisk||risk;
  let riskAuthorityMatches=priorRisk===risk;
  if(!riskAuthorityMatches&&reason==='risk-class-increase'&&
      fields.replan_required===true&&risk===nextRisk){
    const transition=parseStoredObject(fields.risk_transition_json,
      'replan-risk-class');
    riskAuthorityMatches=transition.from===priorRisk&&transition.to===nextRisk&&
      transition.reason==='risk-class-increase';
  }
  if(!riskAuthorityMatches||!RISK_CLASSES.includes(nextRisk)||
      (reason==='risk-class-increase'?
        RISK_CLASSES.indexOf(nextRisk)<=RISK_CLASSES.indexOf(priorRisk):
        nextRisk!==priorRisk))
    fail('replan-risk-class');
  const scope=sliceId===null?'session':'slice';
  const observationDigest=semanticDigest(observationKind,observation);
  const trigger={schema_version:1,reason,scope,slice_id:sliceId,
    plan_authority_sha256:plan.plan_authority_sha256,
    risk_profile_sha256:plan.contract_binding.risk_profile_sha256,
    from_risk:priorRisk,to_risk:nextRisk,
    producer_operation_id:producerOperationId,observation_kind:observationKind,
    observation_digest:observationDigest,trigger_id:null};
  trigger.trigger_id=digestExcluding(trigger,'trigger_id');
  let invalidation;
  if(scope==='slice')invalidation={schema_version:1,scope:'slice',slice_id:sliceId,
    receipt_sha256:null,prior_plan_authority_sha256:plan.plan_authority_sha256,
    trigger_id:trigger.trigger_id,invalidation_sha256:null};
  else{
    let pointer=null;
    if(fields.evidence_pointer_json!==undefined&&fields.evidence_pointer_json!==null&&
        fields.evidence_pointer_json!=='')pointer=parseStoredObject(
          fields.evidence_pointer_json,'replan-evidence-pointer');
    invalidation=pointer?{schema_version:1,scope:'session-package',session_id:
      sessionId(stateCapability),evidence_pointer_sha256:journal.sha256(canonical(pointer)),
    prior_plan_authority_sha256:plan.plan_authority_sha256,
    trigger_id:trigger.trigger_id,invalidation_sha256:null}:
      {schema_version:1,scope:'session-plan',session_id:sessionId(stateCapability),
        prior_plan_authority_sha256:plan.plan_authority_sha256,
        trigger_id:trigger.trigger_id,invalidation_sha256:null};
  }
  invalidation.invalidation_sha256=digestExcluding(invalidation,'invalidation_sha256');
  return{fields,observation,observationDigest,trigger,invalidation,statePatch:{}};
}
async function recordPreparedReplan({stateCapability,plan,sliceId,prepared,seam,
  _lockHeld=false}={}){
  const {observation,observationDigest,trigger,invalidation,
    statePatch={}}=prepared;
  const sid=sessionId(stateCapability),root=stateCapability.projectRoot;
  if(!_lockHeld)return transaction.withRankedLocks([
    {rank:transaction.RANKS.session,capability:platform.issueProjectStateCapability(
      root,path.join(root,'.claude',`deep-work.${sid}.rank-operation.lock`),
      {allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.state,
      capability:transaction.stateLock(stateCapability)},
  ],()=>recordPreparedReplan({stateCapability,plan,sliceId,prepared,seam,
    _lockHeld:true}));
  const lockedFields=frontmatter.parseFrontmatter(
    fs.readFileSync(stateCapability.path,'utf8')).fields;
  if(lockedFields.replan_required===true&&
      lockedFields.active_replan_trigger_id!==trigger.trigger_id)
    fail('replan-active-conflict');
  const id=operationId('replan-trigger-record-v1',trigger);
  const existing=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:id,sessionId:sid,kind:'replan-trigger-record'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  let triggerReceipt=existing;
  if(existing?.stage!=='completed-ledger'){
    const operation=await journal.beginOperation({projectCapability:project(stateCapability),
      sessionId:sid,kind:'replan-trigger-record',operationId:id,slice:sliceId,
      preconditions:trigger});
    const base=`.deep-work/${sid}/replans`;
    const observationPath=`${base}/observation-${observationDigest}.json`;
    const triggerPath=`${base}/trigger-${trigger.trigger_id}.json`;
    const invalidationPath=`${base}/invalidation-${invalidation.invalidation_sha256}.json`;
    writeExclusive(path.join(stateCapability.projectRoot,...observationPath.split('/')),
      observation,'replan-observation-publish');
    writeExclusive(path.join(stateCapability.projectRoot,...triggerPath.split('/')),
      trigger,'replan-trigger-publish');
    writeExclusive(path.join(stateCapability.projectRoot,...invalidationPath.split('/')),
      invalidation,'replan-invalidation-publish');
    await journal.recordOperationStage(operation,'trigger-authenticated',{owned:{
      triggerId:trigger.trigger_id,observationDigest}});
    const before=fs.readFileSync(stateCapability.path,'utf8');
    const currentFields=frontmatter.parseFrontmatter(before).fields;
    const already=currentFields.active_replan_trigger_id===trigger.trigger_id&&
      currentFields.replan_invalidation_sha256===invalidation.invalidation_sha256;
    const after=already?before:frontmatter.updateFrontmatterText(before,
      invalidationPatch(currentFields,{sliceId,trigger,invalidation,triggerOperationId:id,
        triggerPath,invalidationPath,statePatch}));
    if(after!==before){seam?.('before-invalidation-state-write',{operationId:id});
      platform.atomicWriteFile(stateCapability,after);
      seam?.('after-invalidation-state-write-before-stage',{operationId:id});}
    await journal.recordOperationStage(operation,'invalidation-applied',{owned:{
      invalidationSha256:invalidation.invalidation_sha256,
      postStateSha256:journal.sha256(Buffer.from(after))}});
    await journal.recordOperationStage(operation,'trigger-recorded',{owned:{
      triggerPath,triggerId:trigger.trigger_id}});
    triggerReceipt=await journal.completeOperation(operation,{trigger_id:trigger.trigger_id,
      invalidation_sha256:invalidation.invalidation_sha256,
      prior_plan_authority_sha256:plan.plan_authority_sha256,
      post_state_sha256:journal.sha256(Buffer.from(after))});
  }
  const epoch=await publishEpoch({stateCapability,trigger,triggerReceipt,
    priorPlanAuthoritySha256:plan.plan_authority_sha256,seam});
  return{trigger_id:trigger.trigger_id,trigger_operation_id:id,
    invalidation_sha256:invalidation.invalidation_sha256,replan_epoch:epoch.epoch_id,
    epoch_operation_id:epoch.operation_id};
}
function prepareManifestReplanAuthority({stateCapability,plan,sliceId,parentWriteOperationId,
  observationKind,preManifestSha256,candidatePostManifestSha256,
  observedPostManifestSha256,affectedPaths}={}){
  const paths=byteSort(affectedPaths||[]);
  if(paths.length===0||!['scope-expansion','manifest-divergence'].includes(observationKind))
    fail('accept-or-replan-observation');
  const observation=observationKind==='scope-expansion'?
    {schema_version:1,write_operation_id:parentWriteOperationId,
      pre_manifest_sha256:preManifestSha256,post_manifest_sha256:candidatePostManifestSha256,
      unexpected_paths:paths}:
    {schema_version:1,write_operation_id:parentWriteOperationId,
      pre_manifest_sha256:preManifestSha256,
      candidate_post_manifest_sha256:candidatePostManifestSha256,
      observed_post_manifest_sha256:observedPostManifestSha256,differing_paths:paths};
  return prepareReplanAuthority({stateCapability,plan,sliceId,reason:'scope-expansion',
    producerOperationId:parentWriteOperationId,
    observationKind:observationKind==='scope-expansion'?'post-write-manifest':
      'manifest-divergence',observation});
}
function loadPreparedReplan({stateCapability,triggerId,invalidationSha256}={}){
  if(!DIGEST.test(triggerId||'')||!DIGEST.test(invalidationSha256||''))
    fail('replan-prepared-identity');
  const sid=sessionId(stateCapability),base=path.join(stateCapability.projectRoot,
    '.deep-work',sid,'replans');
  const trigger=readCanonical(path.join(base,`trigger-${triggerId}.json`),
    'replan-trigger-replay').value;
  const invalidation=readCanonical(path.join(base,
    `invalidation-${invalidationSha256}.json`),'replan-invalidation-replay').value;
  const observation=readCanonical(path.join(base,
    `observation-${trigger.observation_digest}.json`),'replan-observation-replay').value;
  if(trigger.trigger_id!==digestExcluding(trigger,'trigger_id')||
      invalidation.invalidation_sha256!==digestExcluding(invalidation,'invalidation_sha256')||
      invalidation.trigger_id!==trigger.trigger_id||
      semanticDigest(trigger.observation_kind,observation)!==trigger.observation_digest)
    fail('replan-prepared-identity');
  return{fields:frontmatter.parseFrontmatter(
    fs.readFileSync(stateCapability.path,'utf8')).fields,observation,
  observationDigest:trigger.observation_digest,trigger,invalidation};
}
async function dispatchVerificationSideEffectReplan({stateCapability,planCapability,plan,sliceId,
  verificationOperationId,verificationResultSha256,seam}={}){
  const authority=await require('./verification-v2-runtime.js').authenticateVerificationV2({
    stateCapability,planCapability,plan,sliceId,operationId:verificationOperationId,
    resultSha256:verificationResultSha256});
  const verification=authority.verification;
  if(verification.disposition!=='rejected'||
      verification.classification.observed_class!=='test-side-effect'||
      verification.scope_disposition!=='test-side-effect'||
      !Array.isArray(verification.changed_paths)||verification.changed_paths.length===0)
    fail('replan-verification-side-effect');
  const sid=sessionId(stateCapability);
  const observation={schema_version:1,verification_operation_id:verificationOperationId,
    verification_result_sha256:verificationResultSha256,
    pre_manifest_sha256:authority.manifests.pre.manifest_sha256,
    post_manifest_sha256:authority.manifests.post.manifest_sha256,
    changed_paths:byteSort(verification.changed_paths)};
  if(canonical(observation.changed_paths)!==canonical(verification.changed_paths))
    fail('replan-verification-side-effect');
  const prepared=prepareReplanAuthority({stateCapability,plan,sliceId,
    reason:'test-side-effect',producerOperationId:verificationOperationId,
    observationKind:'verification-manifest',observation});
  return recordPreparedReplan({stateCapability,plan,sliceId,prepared,seam});
}

async function adoptVerificationSideEffectReplay({stateCapability,plan,sliceId,spec,fields}={}){
  if(fields.current_phase!=='research'||fields.subphase!=='spec'||
      fields.replan_required!==true||fields.replan_reason!=='test-side-effect'||
      !DIGEST.test(fields.active_replan_trigger_id||'')||
      typeof fields.replan_trigger_ref!=='string')return null;
  const sid=sessionId(stateCapability);
  const triggerRaw=readCanonical(path.join(stateCapability.projectRoot,
    ...fields.replan_trigger_ref.split('/')),'replan-trigger-replay');
  const trigger=triggerRaw.value;
  const triggerPreimage=structuredClone(trigger);delete triggerPreimage.trigger_id;
  if(trigger.schema_version!==1||trigger.reason!=='test-side-effect'||
      trigger.scope!=='slice'||trigger.slice_id!==sliceId||
      trigger.plan_authority_sha256!==plan.plan_authority_sha256||
      trigger.risk_profile_sha256!==plan.contract_binding.risk_profile_sha256||
      trigger.from_risk!==trigger.to_risk||
      trigger.observation_kind!=='verification-manifest'||
      trigger.trigger_id!==journal.sha256(canonical(triggerPreimage))||
      trigger.trigger_id!==fields.active_replan_trigger_id)
    fail('replan-trigger-replay');
  const verificationReceipt=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:trigger.producer_operation_id,sessionId:sid,kind:'verification-run-v2'});
  const terminal=verificationReceipt.result;
  if(verificationReceipt.stage!=='completed-ledger'||terminal?.session_id!==sid||
      terminal?.slice_id!==sliceId||terminal?.disposition!=='rejected'||
      terminal?.observed_class!=='test-side-effect'||
      terminal?.scope_disposition!=='test-side-effect')fail('replan-verification-replay');
  const resultRaw=readCanonical(path.join(stateCapability.projectRoot,
    ...terminal.result_path.split('/')),'replan-verification-replay');
  const verification=require('./bootstrap-runtime.js').validateBootstrapVerificationResultV2(
    resultRaw.value,{expectedSignal:spec.red_failure.expected_signal});
  if(verification.verification_operation_id!==trigger.producer_operation_id||
      verification.result_sha256!==terminal.result_sha256||
      verification.plan_authority_sha256!==plan.plan_authority_sha256||
      verification.slice_id!==sliceId||verification.disposition!=='rejected'||
      verification.classification.observed_class!=='test-side-effect')
    fail('replan-verification-replay');
  const verificationRuntime=require('./verification-v2-runtime.js'),manifests={};
  for(const phase of ['pre','post']){
    const ref=verification[`${phase}_manifest_ref`];
    const raw=readCanonical(path.join(stateCapability.projectRoot,...ref.path.split('/')),
      'replan-manifest-replay');
    if(raw.sha256!==ref.sha256)fail('replan-manifest-replay');
    manifests[phase]=verificationRuntime.validateManifest(raw.value,{sessionId:sid,
      operationId:trigger.producer_operation_id,phase});
  }
  const changed=verificationRuntime.changedPaths(manifests.pre,manifests.post);
  if(canonical(changed)!==canonical(verification.changed_paths)||changed.length===0)
    fail('replan-manifest-replay');
  const observation={schema_version:1,
    verification_operation_id:trigger.producer_operation_id,
    verification_result_sha256:verification.result_sha256,
    pre_manifest_sha256:manifests.pre.manifest_sha256,
    post_manifest_sha256:manifests.post.manifest_sha256,changed_paths:changed};
  if(semanticDigest('verification-manifest',observation)!==trigger.observation_digest)
    fail('replan-observation-replay');
  const triggerReceipt=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:fields.replan_trigger_operation_id,sessionId:sid,kind:'replan-trigger-record'});
  if(triggerReceipt.stage!=='completed-ledger'||
      triggerReceipt.result?.trigger_id!==trigger.trigger_id||
      triggerReceipt.result?.prior_plan_authority_sha256!==plan.plan_authority_sha256)
    fail('replan-trigger-replay');
  let epoch;try{epoch=JSON.parse(fields.active_replan_epoch_json);}catch{
    fail('replan-epoch-replay');}
  const epochReceipt=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:fields.replan_epoch_operation_id,sessionId:sid,
    kind:'replan-epoch-publication'});
  if(epochReceipt.stage!=='completed-ledger'||epoch.trigger_id!==trigger.trigger_id||
      epoch.trigger_operation_id!==triggerReceipt.operationId||
      epoch.trigger_ledger_result_sha256!==triggerReceipt.resultSha256||
      epoch.prior_plan_authority_sha256!==plan.plan_authority_sha256||
      epoch.epoch_operation_id!==epochReceipt.operationId||
      semanticDigest('replan-epoch-v1',epoch,'epoch_id')!==epoch.epoch_id||
      epochReceipt.result?.epoch_id!==epoch.epoch_id)
    fail('replan-epoch-replay');
  return{...terminal,verification_result_path:terminal.result_path,
    verification_result_sha256:terminal.result_sha256,
    operation_id:trigger.producer_operation_id,operation_receipt:verificationReceipt,
    replan_trigger_id:trigger.trigger_id,replan_epoch:epoch.epoch_id,
    replan_operation_id:triggerReceipt.operationId,adopted:true};
}

module.exports={dispatchVerificationSideEffectReplan,adoptVerificationSideEffectReplay,
  publishOwnedDiscovery,dispatchOwnedDiscoveryReplan,validateDiscoveryObservation,
  publishRiskObservation,dispatchRiskIncreaseReplan,validateRiskObservation,
  dispatchRepeatedRootCauseReplan,
  completeReplan,
  prepareManifestReplanAuthority,loadPreparedReplan,recordPreparedReplan,
  semanticDigest,operationId};
