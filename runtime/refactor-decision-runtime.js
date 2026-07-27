'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');
const journal=require('./operation-journal.js');
const frontmatter=require('./frontmatter.js');
const planRuntime=require('./plan-runtime.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
const SLICE=/^SLICE-\d{3}$/;
const REASONS=new Set(['no-clarity-gain','no-duplication','risk-outweighs-change']);

function fail(code,message=code){
  const error=new Error(`[${code}] ${message}`);error.code=code;throw error;
}
function canonical(value){return journal.canonicalJson(value);}
function exactKeys(value,keys){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    canonical(Object.keys(value).sort())===canonical([...keys].sort());
}
function decisionDigest(preconditions){
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from('refactor-no-change-decision-v1\0'),
    Buffer.from(canonical(preconditions))])).digest('hex');
}
function decisionPreconditions({sessionId,sliceId,plan,verificationPlanSha256,
  greenVerification,reasonCode}){
  const green=require('./functional-receipt-runtime.js')
    .validateVerificationResultRefV1(greenVerification);
  if(!/^s-[0-9a-f]{8}$/.test(sessionId||'')||!SLICE.test(sliceId||'')||
      !DIGEST.test(plan?.plan_authority_sha256||'')||
      !DIGEST.test(verificationPlanSha256||'')||!REASONS.has(reasonCode))
    fail('no-refactor-decision-input');
  return{session_id:sessionId,slice_id:sliceId,
    plan_authority_sha256:plan.plan_authority_sha256,
    verification_plan_sha256:verificationPlanSha256,
    green_verification:green,reason_code:reasonCode};
}
function decisionOperationId(preconditions){
  return`op-${decisionDigest(preconditions)}`;
}
function decisionArtifactPath(stateCapability,operationId){
  return path.join(stateCapability.projectRoot,'.claude',
    `deep-work.${transaction.sessionIdFromState(stateCapability)}.refactor-decision.${operationId}.json`);
}
function buildDecisionArtifact(preconditions){
  const operationId=decisionOperationId(preconditions);
  return{schema_version:1,...structuredClone(preconditions),
    operation_id:operationId,decision_sha256:decisionDigest(preconditions)};
}
function readDecisionArtifact(stateCapability,operationId){
  const file=decisionArtifactPath(stateCapability,operationId);
  let bytes,value,stat;try{stat=fs.lstatSync(file);bytes=fs.readFileSync(file);
    value=JSON.parse(bytes);}catch{fail('no-refactor-decision-artifact');}
  if(!stat.isFile()||stat.isSymbolicLink()||
      !bytes.equals(Buffer.from(canonical(value)))||
      !exactKeys(value,['schema_version','session_id','slice_id',
        'plan_authority_sha256','verification_plan_sha256','green_verification',
        'reason_code','operation_id','decision_sha256'])||
      value.schema_version!==1||value.operation_id!==operationId)
    fail('no-refactor-decision-artifact');
  const preconditions=decisionPreconditions({
    sessionId:value.session_id,sliceId:value.slice_id,
    plan:{plan_authority_sha256:value.plan_authority_sha256},
    verificationPlanSha256:value.verification_plan_sha256,
    greenVerification:value.green_verification,reasonCode:value.reason_code});
  if(operationId!==decisionOperationId(preconditions)||
      value.decision_sha256!==decisionDigest(preconditions))
    fail('no-refactor-decision-artifact');
  return{value,preconditions,file};
}
function loadPlan(planCapability,plan){
  transaction.revalidateSessionFile(planCapability);
  let current;try{current=JSON.parse(transaction.readSessionFile(planCapability));}
  catch{fail('no-refactor-decision-plan');}
  if(canonical(current)!==canonical(plan)||
      current.contract_binding?.mode!=='strict-spec')
    fail('no-refactor-decision-plan');
  const authority=planRuntime.compileImmutablePlanAuthorityV2(current);
  if(authority.plan_authority_sha256!==current.plan_authority_sha256)
    fail('no-refactor-decision-plan');
  return current;
}
async function authenticateNoRefactorDecision({stateCapability,plan,sliceId,
  greenVerification,reasonCode,operationId}={}){
  const sessionId=transaction.sessionIdFromState(stateCapability);
  const fields=transaction.readState(stateCapability);
  const artifact=readDecisionArtifact(stateCapability,operationId);
  const preconditions=artifact.preconditions;
  const expected=decisionOperationId(preconditions);
  if(operationId!==expected||!OPERATION.test(operationId||'')||
      preconditions.session_id!==sessionId||preconditions.slice_id!==sliceId||
      preconditions.plan_authority_sha256!==plan.plan_authority_sha256||
      preconditions.verification_plan_sha256!==fields.verification_plan_sha256||
      greenVerification&&canonical(preconditions.green_verification)!==
        canonical(greenVerification)||
      reasonCode&&preconditions.reason_code!==reasonCode)
    fail('no-refactor-decision-identity');
  const receipt=await journal.resumeOperation({
    projectCapability:transaction.projectCapabilityFor(stateCapability),
    operationId,sessionId,kind:'refactor-no-change-decision'});
  const result=receipt.result;
  if(receipt.stage!=='completed-ledger'||
      !exactKeys(result,['session_id','slice_id','reason_code',
        'green_result_sha256','post_state_sha256'])||
      result.session_id!==sessionId||result.slice_id!==sliceId||
      result.reason_code!==preconditions.reason_code||
      result.green_result_sha256!==
        preconditions.green_verification.result_sha256||
      !DIGEST.test(result.post_state_sha256||'')||
      receipt.resultSha256!==journal.sha256(canonical(result)))
    fail('no-refactor-decision-ledger');
  return{operationId,writeClass:'no-refactor-decision',
    receiptSha256:decisionDigest(preconditions),receipt,preconditions,
    artifact:artifact.value};
}
async function recordNoRefactorDecision({stateCapability,planCapability,plan,
  sliceId,greenVerification,reasonCode,seam,_lockHeld=false}={}){
  const root=stateCapability?.projectRoot;
  if(!root||!SLICE.test(sliceId||'')||!REASONS.has(reasonCode))
    fail('no-refactor-decision-input');
  const sessionId=transaction.sessionIdFromState(stateCapability);
  if(!_lockHeld){
    return transaction.withRankedLocks([
      {rank:transaction.RANKS.session,capability:platform.issueProjectStateCapability(
        root,path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),
        {allowMissingLeaf:true,role:'lock'})},
      {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)},
    ],()=>recordNoRefactorDecision({stateCapability,planCapability,plan,sliceId,
      greenVerification,reasonCode,seam,_lockHeld:true}));
  }
  require('./slice-runtime.js').assertNoPendingScopedWrite(stateCapability);
  const current=loadPlan(planCapability,plan);
  const target=current.slices?.find((row)=>row.id===sliceId);
  if(!target||target.slice_kind!=='functional')
    fail('no-refactor-decision-slice');
  const fields=transaction.readState(stateCapability);
  const replayState=fields.tdd_state==='REFACTOR_PENDING'&&
    fields.accepted_write_class==='no-refactor-decision';
  if(fields.current_phase!=='implement'||fields.active_slice!==sliceId||
      !(fields.tdd_state==='SENSOR_CLEAN'||replayState)||
      !DIGEST.test(fields.verification_plan_sha256||''))
    fail('no-refactor-decision-state');
  const green=await require('./functional-receipt-runtime.js')
    .authenticateVerificationResultRefV1({stateCapability,planCapability,
      plan:current,sliceId,ref:greenVerification,expectedWriteClass:'production'});
  const preconditions=decisionPreconditions({sessionId,sliceId,plan:current,
    verificationPlanSha256:fields.verification_plan_sha256,
    greenVerification:green.ref,reasonCode});
  const operationId=decisionOperationId(preconditions);
  const completed=await journal.resumeOperation({
    projectCapability:transaction.projectCapabilityFor(stateCapability),
    operationId,sessionId,kind:'refactor-no-change-decision'})
    .catch((error)=>{if(error.code==='operation-not-found')return null;throw error;});
  if(completed?.stage==='completed-ledger')
    return authenticateNoRefactorDecision({stateCapability,plan:current,sliceId,
      greenVerification:green.ref,reasonCode,operationId});
  if(replayState&&fields.accepted_write_operation_id!==operationId)
    fail('no-refactor-decision-state');
  const operation=await journal.beginOperation({
    projectCapability:transaction.projectCapabilityFor(stateCapability),
    operationId,sessionId,kind:'refactor-no-change-decision',slice:sliceId,
    preconditions});
  await journal.recordOperationStage(operation,'green-authenticated',{owned:{
    greenResultSha256:green.ref.result_sha256,
    greenLedgerResultSha256:green.ref.ledger_result_sha256}});
  const receiptSha256=decisionDigest(preconditions);
  const artifactValue=buildDecisionArtifact(preconditions);
  const artifactPath=decisionArtifactPath(stateCapability,operationId);
  const artifactBytes=Buffer.from(canonical(artifactValue));
  if(fs.existsSync(artifactPath)){
    if(!fs.readFileSync(artifactPath).equals(artifactBytes))
      fail('no-refactor-decision-artifact');
  }else{
    const capability=platform.issueProjectStateCapability(root,artifactPath,
      {allowMissingLeaf:true,role:'state'});
    seam?.('before-decision-write',{operationId,artifactPath});
    platform.atomicWriteFile(capability,artifactBytes);
    seam?.('after-decision-write-before-stage',{operationId,artifactPath});
  }
  await journal.recordOperationStage(operation,'decision-published',{owned:{
    artifactPath:path.relative(root,artifactPath).split(path.sep).join('/'),
    decisionSha256:receiptSha256}});
  const cycle={schema_version:1,sliceId,
    planSha256:journal.sha256(canonical(current)),
    planAuthoritySha256:current.plan_authority_sha256,
    writeOperationId:operationId,writeReceiptSha256:receiptSha256,
    verificationOperationId:null,verificationResultSha256:null,
    sensorCycleOperationId:null};
  const before=fs.readFileSync(stateCapability.path,'utf8');
  const after=frontmatter.updateFrontmatterText(before,{
    tdd_state:'REFACTOR_PENDING',fresh_sensor_required:true,
    sensor_cycle_operation_id:null,sensor_results_sha256:null,
    accepted_write_operation_id:operationId,
    accepted_write_receipt_sha256:receiptSha256,
    accepted_write_class:'no-refactor-decision',
    refactor_cycle:JSON.stringify(cycle)});
  if(after!==before){
    seam?.('before-state-write',{operationId});
    platform.atomicWriteFile(stateCapability,after);
    seam?.('after-state-write-before-stage',{operationId});
  }
  await journal.recordOperationStage(operation,'decision-committed',{owned:{
    postStateSha256:journal.sha256(Buffer.from(after)),receiptSha256}});
  const result={session_id:sessionId,slice_id:sliceId,reason_code:reasonCode,
    green_result_sha256:green.ref.result_sha256,
    post_state_sha256:journal.sha256(Buffer.from(after))};
  const receipt=await journal.completeOperation(operation,result);
  return{operationId,writeClass:'no-refactor-decision',receiptSha256,
    receipt,preconditions};
}

module.exports={decisionDigest,decisionPreconditions,decisionOperationId,
  buildDecisionArtifact,authenticateNoRefactorDecision,recordNoRefactorDecision};
