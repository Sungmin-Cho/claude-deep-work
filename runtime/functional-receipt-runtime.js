'use strict';

const crypto=require('node:crypto');
const {canonicalJson,sha256}=require('./operation-journal.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
const SLICE=/^SLICE-\d{3}$/;
const SENSOR_KINDS=new Set(['lint','typecheck','coverage','mutation','review-check']);
const REASONS=new Set(['no-clarity-gain','no-duplication','risk-outweighs-change']);
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);error.code=code;throw error;}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());}
function semanticDigest(domain,value,omitted){
  const copy=structuredClone(value);if(omitted)delete copy[omitted];
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(`${domain}\0`),Buffer.from(canonicalJson(copy))])).digest('hex');
}
function validateVerificationResultRefV1(value){
  if(!exactKeys(value,['operation_id','result_path','result_sha256',
    'ledger_result_sha256'])||!OPERATION.test(value.operation_id||'')||
    typeof value.result_path!=='string'||!value.result_path||
    !DIGEST.test(value.result_sha256||'')||
    !DIGEST.test(value.ledger_result_sha256||''))
    fail('verification-result-ref');
  return structuredClone(value);
}
function validateSensorResultRefV1(value){
  if(!exactKeys(value,['kind','operation_id','result_path','result_sha256',
    'ledger_result_sha256'])||!SENSOR_KINDS.has(value.kind)||
    !OPERATION.test(value.operation_id||'')||typeof value.result_path!=='string'||
    !value.result_path||!DIGEST.test(value.result_sha256||'')||
    !DIGEST.test(value.ledger_result_sha256||''))
    fail('sensor-result-ref');
  return structuredClone(value);
}
function validateSensors(values){
  if(!Array.isArray(values))fail('sensor-result-refs');
  const rows=values.map(validateSensorResultRefV1);
  const sorted=[...rows].sort((a,b)=>Buffer.compare(
    Buffer.from(canonicalJson([a.kind,a.operation_id])),
    Buffer.from(canonicalJson([b.kind,b.operation_id]))));
  if(canonicalJson(rows)!==canonicalJson(sorted)||
      new Set(rows.map((row)=>row.kind)).size!==rows.length||
      new Set(rows.map((row)=>row.operation_id)).size!==rows.length)
    fail('sensor-result-refs');
  return rows;
}
function validateRefactorEvidenceV1(value){
  if(value?.kind==='no-refactor'){
    if(!exactKeys(value,['kind','decision_operation_id','reason_code',
      'post_decision_green','sensor_results','decision_sha256'])||
      !OPERATION.test(value.decision_operation_id||'')||
      !REASONS.has(value.reason_code)||
      !DIGEST.test(value.decision_sha256||''))
      fail('refactor-evidence');
    validateVerificationResultRefV1(value.post_decision_green);
    validateSensors(value.sensor_results);
    if(semanticDigest('refactor-evidence-v1',value,'decision_sha256')!==
        value.decision_sha256)fail('refactor-evidence-digest');
    return structuredClone(value);
  }
  if(value?.kind==='performed-refactor'){
    if(!exactKeys(value,['kind','write_operation_id','write_receipt_sha256',
      'post_refactor_green','sensor_results','evidence_sha256'])||
      !OPERATION.test(value.write_operation_id||'')||
      !DIGEST.test(value.write_receipt_sha256||'')||
      !DIGEST.test(value.evidence_sha256||''))
      fail('refactor-evidence');
    validateVerificationResultRefV1(value.post_refactor_green);
    validateSensors(value.sensor_results);
    if(semanticDigest('refactor-evidence-v1',value,'evidence_sha256')!==
        value.evidence_sha256)fail('refactor-evidence-digest');
    return structuredClone(value);
  }
  fail('refactor-evidence-kind');
}
function functionalCompletionOperationId(input){
  const preimage={session_id:input.session_id,slice_id:input.slice_id,
    plan_authority_sha256:input.plan_authority_sha256,
    verification_plan_sha256:input.verification_plan_sha256,
    red_proof_sha256:input.red_proof_sha256,
    green_verification:validateVerificationResultRefV1(input.green_verification),
    refactor_evidence:validateRefactorEvidenceV1(input.refactor_evidence)};
  if(!/^s-[0-9a-f]{8}$/.test(preimage.session_id||'')||
      !SLICE.test(preimage.slice_id||'')||
      !DIGEST.test(preimage.plan_authority_sha256||'')||
      !DIGEST.test(preimage.verification_plan_sha256||'')||
      !DIGEST.test(preimage.red_proof_sha256||''))
    fail('functional-completion-preimage');
  return`op-${sha256(canonicalJson(preimage))}`;
}
function buildFunctionalSliceReceiptV2(input){
  const completionOperationId=functionalCompletionOperationId(input);
  const value={schema_version:2,slice_id:input.slice_id,slice_kind:'functional',
    plan_authority_sha256:input.plan_authority_sha256,
    verification_plan_sha256:input.verification_plan_sha256,
    red_proof_ref:input.red_proof_ref,red_proof_sha256:input.red_proof_sha256,
    red_proof_operation_id:input.red_proof_operation_id,
    green_verification:validateVerificationResultRefV1(input.green_verification),
    refactor_evidence:validateRefactorEvidenceV1(input.refactor_evidence),
    completion_operation_id:completionOperationId,receipt_sha256:null};
  value.receipt_sha256=sha256(canonicalJson(Object.fromEntries(Object.entries(value)
    .filter(([key])=>key!=='receipt_sha256'))));
  return validateFunctionalSliceReceiptV2(value);
}
function validateFunctionalSliceReceiptV2(value){
  const keys=['schema_version','slice_id','slice_kind','plan_authority_sha256',
    'verification_plan_sha256','red_proof_ref','red_proof_sha256',
    'red_proof_operation_id','green_verification','refactor_evidence',
    'completion_operation_id','receipt_sha256'];
  if(!exactKeys(value,keys)||value.schema_version!==2||
      !SLICE.test(value.slice_id||'')||value.slice_kind!=='functional'||
      !DIGEST.test(value.plan_authority_sha256||'')||
      !DIGEST.test(value.verification_plan_sha256||'')||
      typeof value.red_proof_ref!=='string'||!value.red_proof_ref||
      !DIGEST.test(value.red_proof_sha256||'')||
      !OPERATION.test(value.red_proof_operation_id||'')||
      !OPERATION.test(value.completion_operation_id||'')||
      !DIGEST.test(value.receipt_sha256||''))
    fail('functional-receipt');
  validateVerificationResultRefV1(value.green_verification);
  validateRefactorEvidenceV1(value.refactor_evidence);
  const sid=value.red_proof_ref.match(/^\.deep-work\/(s-[0-9a-f]{8})\/red-proofs\/[0-9a-f]{64}\.json$/)?.[1];
  if(!sid||value.completion_operation_id!==functionalCompletionOperationId({
    session_id:sid,...value})||
      value.receipt_sha256!==sha256(canonicalJson(Object.fromEntries(
        Object.entries(value).filter(([key])=>key!=='receipt_sha256')))))
    fail('functional-receipt-digest');
  return structuredClone(value);
}

module.exports={validateVerificationResultRefV1,validateSensorResultRefV1,
  validateRefactorEvidenceV1,functionalCompletionOperationId,
  buildFunctionalSliceReceiptV2,validateFunctionalSliceReceiptV2,semanticDigest};
