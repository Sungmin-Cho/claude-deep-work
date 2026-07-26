'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('./review-envelope-runtime.js');

const artifact={path:'spec.md',sha256:'a'.repeat(64)};
const finding={id:'REV-SEMANTIC-001',severity:'major',confidence:0.9,
  review_role:'semantic',channel:'deep-review',model:'review-model',effort:'high',
  artifact:'spec.md',location:'REQ-001',violated_contract:'REQ-001',
  evidence:['spec.md#REQ-001'],failure_scenario:'contract mismatch',
  verification:'node --test',status:'open',disposition_reason:null,round:1,
  blind:true};

test('review request binds artifact, contract, evidence, intent, and blind group',()=>{
  const request=runtime.compileReviewRequest({artifactKind:'spec',
    reviewIntent:'semantic',riskClass:'high',artifactRefs:[artifact],
    contractRefs:['REQ-001'],evidenceRefs:['receipts/SLICE-003.json'],
    blindGroupId:'blind-001'});
  assert.equal(request.required_schema,'review-finding-v2');
  assert.equal(runtime.validateReviewRequest(request).request_sha256,
    request.request_sha256);
  const forged=structuredClone(request);forged.artifact_refs[0].sha256=
    'b'.repeat(64);
  assert.throws(()=>runtime.validateReviewRequest(forged),/review-request/);
});

test('deep-review receipt is an M3 envelope bound to the reviewed request',()=>{
  const request=runtime.compileReviewRequest({artifactKind:'spec',
    reviewIntent:'semantic',riskClass:'high',artifactRefs:[artifact],
    contractRefs:['REQ-001'],evidenceRefs:[],blindGroupId:'blind-001'});
  const receipt=runtime.wrapReviewReceipt({producer:'deep-review',request,
    reviewer:{role:'semantic',provider:'openai',model:'review-model',
      effort:'high'},findings:[finding],verdict:'REQUEST_CHANGES',
    degraded:false,round:1,reviewedCommit:'b'.repeat(40),
    generatedAt:'2026-07-27T00:00:00.000Z',runId:'01ARZ3NDEKTSV4RRFFQ69G5FAV'});
  const checked=runtime.validateReviewReceiptEnvelope(receipt,request);
  assert.equal(checked.payload.request_sha256,request.request_sha256);
  assert.equal(checked.payload.input_artifact_sha256,
    runtime.artifactSetDigest(request.artifact_refs));
  const forged=structuredClone(receipt);forged.payload.verdict='APPROVE';
  assert.throws(()=>runtime.validateReviewReceiptEnvelope(forged,request),
    /review-receipt/);
});

test('legacy reports adapt only through an explicit compatibility receipt',()=>{
  const request=runtime.compileReviewRequest({artifactKind:'code-diff',
    reviewIntent:'code-quality',riskClass:'medium',artifactRefs:[artifact],
    contractRefs:[],evidenceRefs:[],blindGroupId:null});
  const adapted=runtime.adaptLegacyReviewReceipt({request,legacy:{
    reviewer_role:'semantic',model:'legacy-model',findings:[],verdict:'APPROVE',
    reviewed_commit:'c'.repeat(40)}});
  assert.equal(adapted.payload.compatibility_mode,'legacy-adapter');
  assert.equal(runtime.validateReviewReceiptEnvelope(adapted,request)
    .payload.verdict,'APPROVE');
});
