'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');
const journal=require('./operation-journal.js');
const frontmatter=require('./frontmatter.js');
const bootstrap=require('./bootstrap-runtime.js');
const planRuntime=require('./plan-runtime.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
const SLICE=/^SLICE-\d{3}$/;
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);error.code=code;throw error;}
function canonical(value){return journal.canonicalJson(value);}
function semanticDigest(domain,value,omitted){
  const copy=structuredClone(value);if(omitted)delete copy[omitted];
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(`${domain}\0`),Buffer.from(canonical(copy))])).digest('hex');
}
function operationId(domain,value){return `op-${semanticDigest(domain,value)}`;}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonical(Object.keys(value).sort())===canonical([...keys].sort());}
function sessionId(stateCapability){return transaction.sessionIdFromState(stateCapability);}
function project(stateCapability){return transaction.projectCapabilityFor(stateCapability);}
function readCanonicalJson(file,code){
  let stat,bytes;try{stat=fs.lstatSync(file);bytes=fs.readFileSync(file);}catch{fail(code);}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)fail(code);
  let value;try{value=JSON.parse(bytes);}catch{fail(code);}
  if(!bytes.equals(Buffer.from(canonical(value))))fail(code);
  return value;
}
function writeContentAddressed(file,value,code){
  const bytes=Buffer.from(canonical(value));fs.mkdirSync(path.dirname(file),{recursive:true});
  let fd;try{fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
  }catch(error){if(error.code!=='EEXIST'||!fs.readFileSync(file).equals(bytes))fail(code);}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  if(!fs.readFileSync(file).equals(bytes))fail(code);
}
function lockedPlan(planCapability,plan){
  transaction.revalidateSessionFile(planCapability);
  let current;try{current=JSON.parse(transaction.readSessionFile(planCapability));}catch{fail('red-plan-json');}
  if(canonical(current)!==canonical(plan))fail('red-plan-changed');
  let authority;try{authority=planRuntime.compileImmutablePlanAuthorityV2(current);}
  catch{fail('red-plan-authority');}
  if(authority.plan_authority_sha256!==current.plan_authority_sha256||
      current.contract_binding?.mode!=='strict-spec')fail('red-plan-authority');
  return current;
}
async function acceptedFailingWrite({stateCapability,plan,sliceId,fields}){
  const op=fields.accepted_write_operation_id,digest=fields.accepted_write_receipt_sha256;
  if(!OPERATION.test(op||'')||!DIGEST.test(digest||'')||
      fields.accepted_write_class!=='failing-test')fail('red-write-required');
  const file=path.join(stateCapability.projectRoot,'.claude',
    `deep-work.${sessionId(stateCapability)}.scoped-write.${op}.json`);
  const receipt=readCanonicalJson(file,'red-write-receipt');
  const scopedWrite=require('./slice-runtime.js');
  try{scopedWrite.validateAcceptedScopedWriteReceipt(receipt,{
    operationId:op,sliceId});}
  catch{fail('red-write-receipt');}
  const planSha256=planRuntime.canonicalizePlanScopeV1(plan).sha256;
  const recomputed=scopedWrite.scopedWriteReceiptDigest(receipt);
  if(receipt.status!=='accepted'||receipt.operationId!==op||receipt.sliceId!==sliceId||
      receipt.writeClass!=='failing-test'||receipt.planSha256!==planSha256||
      receipt.receiptSha256!==digest||recomputed!==digest)fail('red-write-receipt');
  try{await scopedWrite.authenticateScopedWriteProducer({stateCapability,receipt});}
  catch{fail('red-write-producer-ledger');}
  return receipt;
}
async function authenticateOrdinaryVerification({stateCapability,planCapability,plan,sliceId,
  verificationOperationId,verificationResultSha256}={}){
  if(!SLICE.test(sliceId||'')||!OPERATION.test(verificationOperationId||'')||
      !DIGEST.test(verificationResultSha256||''))fail('red-verification-identity');
  const current=lockedPlan(planCapability,plan);
  const fields=frontmatter.parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  if(fields.current_phase!=='implement'||fields.active_slice!==sliceId||
      !['PENDING','RED_VERIFIED'].includes(fields.tdd_state))fail('red-verification-state');
  const authenticated=await require('./verification-v2-runtime.js').authenticateVerificationV2({
    stateCapability,planCapability,plan:current,sliceId,operationId:verificationOperationId,
    resultSha256:verificationResultSha256});
  const {target,spec,write,verification,verificationReceipt:receipt}=authenticated;
  const sid=sessionId(stateCapability);
  const resultPath=path.join(stateCapability.projectRoot,'.claude',
    `deep-work.${sid}.verification.${verificationOperationId}.json`);
  if(verification.session_id!==sid||verification.slice_id!==sliceId||
      verification.disposition!=='accepted'||
      verification.classification.observed_class!=='expected-failure'||
      verification.scope_disposition!=='clean')fail('red-verification-authority');
  const terminalKeys=['session_id','slice_id','result_path','result_sha256','disposition',
    'observed_class','scope_disposition'];
  if(receipt.stage!=='completed-ledger'||!exactKeys(receipt.result,terminalKeys)||
      receipt.result.session_id!==sid||receipt.result.slice_id!==sliceId||
      receipt.result.result_path!==verification.result_path||
      receipt.result.result_sha256!==verification.result_sha256||
      receipt.result.disposition!=='accepted'||receipt.result.observed_class!=='expected-failure'||
      receipt.result.scope_disposition!=='clean')fail('red-verification-ledger');
  return {fields,plan:current,target,spec,write,verification,verificationReceipt:receipt,
    resultPath};
}
async function transitionOrdinaryRed({stateCapability,planCapability,plan,sliceId,
  verificationOperationId,verificationResultSha256,seam}={}){
  require('./slice-runtime.js').assertNoPendingScopedWrite(stateCapability);
  const authority=await authenticateOrdinaryVerification({stateCapability,planCapability,plan,
    sliceId,verificationOperationId,verificationResultSha256});
  const sid=sessionId(stateCapability);
  const preimage={session_id:sid,slice_id:sliceId,
    plan_authority_sha256:authority.plan.plan_authority_sha256,
    verification_operation_id:verificationOperationId,
    verification_result_sha256:verificationResultSha256,
    write_operation_id:authority.write.operationId,
    write_receipt_sha256:authority.write.receiptSha256};
  const id=operationId('red-transition-v1',preimage);
  const existing=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:id,sessionId:sid,kind:'red-transition'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(existing?.stage==='completed-ledger')return{...existing.result,operation_id:id,
    operation_receipt:existing,adopted:true};
  const operation=await journal.beginOperation({projectCapability:project(stateCapability),
    sessionId:sid,kind:'red-transition',operationId:id,slice:sliceId,preconditions:preimage});
  await journal.recordOperationStage(operation,'red-authenticated',{owned:{
    verificationResultSha256,writeReceiptSha256:authority.write.receiptSha256}});
  const before=fs.readFileSync(stateCapability.path,'utf8');
  const fields=frontmatter.parseFrontmatter(before).fields;
  if(fields.tdd_state!=='PENDING'&&!(fields.tdd_state==='RED_VERIFIED'&&
      fields.red_transition_operation_id===id))fail('red-transition-state');
  const after=frontmatter.updateFrontmatterText(before,{tdd_state:'RED_VERIFIED',
    red_proof_state:'proof-pending',red_transition_operation_id:id,
    red_verification_result_path:authority.verification.result_path,
    red_verification_result_sha256:verificationResultSha256,
    verification_operation_id:verificationOperationId,
    verification_result_sha256:verificationResultSha256});
  if(after!==before){seam?.('before-state-write',{operationId:id});
    platform.atomicWriteFile(stateCapability,after);seam?.('after-state-write-before-stage',
      {operationId:id});}
  await journal.recordOperationStage(operation,'red-state-written',{owned:{
    statePath:stateCapability.path,postStateSha256:journal.sha256(Buffer.from(after))}});
  const result={slice_id:sliceId,post_state_sha256:journal.sha256(Buffer.from(after)),
    verification_result_sha256:verificationResultSha256,
    write_receipt_sha256:authority.write.receiptSha256};
  const receipt=await journal.completeOperation(operation,result);
  return{...result,operation_id:id,operation_receipt:receipt,adopted:false};
}
async function publishOrdinaryRedProof({stateCapability,planCapability,plan,sliceId,
  transitionOperationId,seam}={}){
  require('./slice-runtime.js').assertNoPendingScopedWrite(stateCapability);
  if(!SLICE.test(sliceId||'')||!OPERATION.test(transitionOperationId||''))
    fail('red-proof-transition');
  const current=lockedPlan(planCapability,plan),sid=sessionId(stateCapability);
  const transition=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:transitionOperationId,sessionId:sid,kind:'red-transition'});
  if(transition.stage!=='completed-ledger'||transition.result?.slice_id!==sliceId)
    fail('red-proof-transition');
  const fields=frontmatter.parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  const verificationOperationId=fields.verification_operation_id;
  const authority=await authenticateOrdinaryVerification({stateCapability,planCapability,
    plan:current,sliceId,verificationOperationId,
    verificationResultSha256:transition.result.verification_result_sha256});
  if(fields.red_transition_operation_id!==transitionOperationId||
      transition.result.write_receipt_sha256!==authority.write.receiptSha256)
    fail('red-proof-transition');
  const preconditions={session_id:sid,slice_id:sliceId,
    plan_authority_sha256:current.plan_authority_sha256,transition_kind:'ordinary',
    transition_operation_id:transitionOperationId,
    transition_ledger_result_sha256:transition.resultSha256,
    bootstrap_bridge_operation_id:null};
  const id=operationId('red-proof-publication-v1',preconditions);
  const completed=await journal.resumeOperation({projectCapability:project(stateCapability),
    operationId:id,sessionId:sid,kind:'red-proof-publication'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(completed?.stage==='completed-ledger')return{...completed.result,operation_id:id,
    operation_receipt:completed,adopted:true};
  const operation=await journal.beginOperation({projectCapability:project(stateCapability),
    sessionId:sid,kind:'red-proof-publication',operationId:id,slice:sliceId,
    preconditions});
  const proof={schema_version:1,session_id:sid,slice_id:sliceId,
    plan_authority_sha256:current.plan_authority_sha256,
    spec_sha256:authority.verification.spec_sha256,
    spec_approved_hash:current.contract_binding.spec_contract.spec_approved_hash,
    verification_plan_sha256:authority.verification.verification_plan_sha256,
    write_operation_id:authority.write.operationId,
    write_receipt_sha256:authority.write.receiptSha256,
    verification_operation_id:verificationOperationId,
    verification_result_sha256:authority.verification.result_sha256,
    verification_ledger_result_sha256:authority.verificationReceipt.resultSha256,
    transition_kind:'ordinary',transition_operation_id:transitionOperationId,
    transition_ledger_result_sha256:transition.resultSha256,
    bootstrap_bridge_operation_id:null,proof_operation_id:id,
    classification_digest:semanticDigest('classification-v1',
      authority.verification.classification),proof_sha256:null};
  proof.proof_sha256=semanticDigest('red-proof-v1',proof,'proof_sha256');
  const relative=`.deep-work/${sid}/red-proofs/${proof.proof_sha256}.json`;
  writeContentAddressed(path.join(stateCapability.projectRoot,...relative.split('/')),proof,
    'red-proof-publish');
  await journal.recordOperationStage(operation,'proof-published',{owned:{
    proofPath:relative,proofSha256:proof.proof_sha256}});
  const before=fs.readFileSync(stateCapability.path,'utf8');
  const beforeFields=frontmatter.parseFrontmatter(before).fields;
  if(!['proof-pending','complete'].includes(beforeFields.red_proof_state)||
      beforeFields.red_transition_operation_id!==transitionOperationId)
    fail('red-proof-state');
  const after=frontmatter.updateFrontmatterText(before,{red_proof_state:'complete',
    red_proof_ref:relative,red_proof_sha256:proof.proof_sha256,
    red_proof_operation_id:id});
  if(after!==before){seam?.('before-state-write',{operationId:id});
    platform.atomicWriteFile(stateCapability,after);seam?.('after-state-write-before-stage',
      {operationId:id});}
  await journal.recordOperationStage(operation,'proof-ref-committed',{owned:{
    proofSha256:proof.proof_sha256,statePath:stateCapability.path}});
  const result={proof_sha256:proof.proof_sha256,red_proof_ref:relative,
    post_state_sha256:journal.sha256(Buffer.from(after))};
  const receipt=await journal.completeOperation(operation,result);
  return{...result,operation_id:id,operation_receipt:receipt,adopted:false};
}

module.exports={authenticateOrdinaryVerification,transitionOrdinaryRed,
  publishOrdinaryRedProof,semanticDigest,operationId};
