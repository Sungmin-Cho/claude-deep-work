'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {buildFunctionalSliceReceiptV2,validateFunctionalSliceReceiptV2,
  validateRefactorEvidenceV1,semanticDigest}=require('./functional-receipt-runtime.js');

const op=(char)=>`op-${char.repeat(64)}`;
const ref=(char)=>({operation_id:op(char),
  result_path:`.claude/deep-work.s-aaaaaaaa.verification.${op(char)}.json`,
  result_sha256:char.repeat(64),ledger_result_sha256:
    (char==='f'?'e':((Number.parseInt(char,16)+1)%16).toString(16)).repeat(64)});
function noRefactor(){
  const value={kind:'no-refactor',decision_operation_id:op('3'),
    reason_code:'no-duplication',post_decision_green:ref('4'),
    sensor_results:[{kind:'lint',operation_id:op('5'),
      result_path:'.claude/deep-work.s-aaaaaaaa.sensor.result.json',
      result_sha256:'6'.repeat(64),ledger_result_sha256:'7'.repeat(64)}],
    decision_sha256:null};
  value.decision_sha256=semanticDigest('refactor-evidence-v1',value,
    'decision_sha256');
  return value;
}
function receipt(){
  return buildFunctionalSliceReceiptV2({session_id:'s-aaaaaaaa',
    slice_id:'SLICE-001',plan_authority_sha256:'8'.repeat(64),
    verification_plan_sha256:'9'.repeat(64),
    red_proof_ref:`.deep-work/s-aaaaaaaa/red-proofs/${'a'.repeat(64)}.json`,
    red_proof_sha256:'a'.repeat(64),red_proof_operation_id:op('b'),
    green_verification:ref('c'),refactor_evidence:noRefactor()});
}

test('FunctionalSliceReceiptV2 derives exact deterministic completion identity',()=>{
  const first=receipt(),second=receipt();
  assert.deepEqual(first,second);
  assert.match(first.completion_operation_id,/^op-[0-9a-f]{64}$/);
  assert.equal(validateFunctionalSliceReceiptV2(first).receipt_sha256,
    first.receipt_sha256);
});

test('refactor evidence rejects unsorted duplicate sensor authority',()=>{
  const value=noRefactor();
  value.sensor_results.push({...value.sensor_results[0]});
  value.decision_sha256=semanticDigest('refactor-evidence-v1',value,
    'decision_sha256');
  assert.throws(()=>validateRefactorEvidenceV1(value),/sensor-result-refs/);
});

test('receipt rejects swapped GREEN and red proof authority',()=>{
  const green=receipt();green.green_verification.result_sha256='f'.repeat(64);
  assert.throws(()=>validateFunctionalSliceReceiptV2(green),
    /functional-receipt-digest/);
  const proof=receipt();proof.red_proof_sha256='f'.repeat(64);
  assert.throws(()=>validateFunctionalSliceReceiptV2(proof),
    /functional-receipt-digest/);
});
