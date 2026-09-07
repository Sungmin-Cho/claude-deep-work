'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {canonicalJson}=require('../runtime/operation-journal.js');
const execution=require('../runtime/execution-contract-runtime.js');
const policy=require('../runtime/policy-runtime.js');
const verification=require('../runtime/verification-policy-runtime.js');
const plans=require('../runtime/plan-runtime.js');
const {makeExecutionPlanFixture:fixture}=require('./helpers/execution-fixtures.js');
function input(projection=execution.validateExecutionPlanV3(fixture())) {return {planProjection:projection,
  riskProfile:{class:'low'},riskProfileSha256:'c'.repeat(64),specSha256:'a'.repeat(64),specApprovedHash:'b'.repeat(64),
  policySnapshot:policy.compileMethodologyAuthority({riskProfile:{class:'low'},executionBasis:'per-slice-v1'}),
  specContract:{spec_id:'SPEC-EXECUTION',requirements:projection.slices.flatMap(s=>s.contract.requirements.map(id=>({id}))),invariants:[],failure_matrix:[],compatibility:{}}};}
test('new methodology policy basis is explicit while historical bytes stay identical',()=>{
  const old=policy.compileMethodologyAuthority({riskProfile:{class:'low'}});
  assert.equal(Object.hasOwn(old,'execution_basis'),false);
  const modern=policy.compileMethodologyAuthority({riskProfile:{class:'low'},executionBasis:'per-slice-v1'});
  assert.equal(modern.execution_basis,'per-slice-v1');assert.notEqual(modern.policy_sha256,old.policy_sha256);
  assert.deepEqual(policy.validateMethodologyAuthority(modern),modern);
  assert.throws(()=>policy.compileMethodologyAuthority({executionBasis:'outcome-v1'}));
});
test('commandless README requires positive and control gates in schema three',()=>{
  const plan=verification.compileVerificationPlan(input());assert.equal(plan.schema_version,3);
  assert.equal(verification.validateVerificationPlan(plan).pass,true);
  for(const id of ['GATE-outcome-verification','GATE-outcome-oracle-controls'])assert.equal(plan.required_gate_ids.includes(id),true);
  for(const id of ['GATE-tdd-red','GATE-tdd-green'])assert.equal(plan.gates.find(g=>g.id===id).disposition,'not-applicable');
  for(const id of ['GATE-outcome-verification','GATE-outcome-oracle-controls']){
    const forged=structuredClone(plan);forged.gates.find(g=>g.id===id).disposition='not-applicable';
    const copy=structuredClone(forged);delete copy.plan_sha256;forged.plan_sha256=crypto.createHash('sha256').update(canonicalJson(copy)).digest('hex');
    assert.equal(verification.validateVerificationPlan(forged).pass,false);
  }
});
test('mixed V3 gates retain strict IDs separately and do not satisfy RED with outcome IDs',()=>{
  const strict=fixture({basis:'strict-tdd-v2'}).slices[0],outcome=fixture().slices[0];
  outcome.id=outcome.contract.id='SLICE-002';outcome.contract.requirements=['REQ-002'];outcome.oracle_controls[0].requirement_ids=['REQ-002'];
  const plan=verification.compileVerificationPlan(input(execution.validateExecutionPlanV3(fixture({slices:[strict,outcome]}))));
  assert.deepEqual(plan.gates.find(g=>g.id==='GATE-tdd-red').requirement_ids,['REQ-001']);
  assert.deepEqual(plan.gates.find(g=>g.id==='GATE-outcome-verification').requirement_ids,['REQ-002']);
  assert.equal(verification.validateVerificationPlan(plan).pass,true);
  const bad=input();bad.policySnapshot=policy.compileMethodologyAuthority({riskProfile:{class:'low'}});
  assert.throws(()=>verification.compileVerificationPlan(bad),/execution-policy/);
});
test('V3 source/projection/authority digest construction has no recursion',()=>{
  assert.equal(typeof plans.compilePlanProjectionV3,'function');
  const raw=fixture();delete raw.contract_binding.source_plan_sha256;
  const markdown='## Execution Plan\n\n```json\n'+JSON.stringify(raw,null,2)+'\n```\n';
  const compiled=plans.compilePlanProjectionV3({planMarkdown:markdown});
  assert.equal(compiled.contract_binding.source_plan_sha256,crypto.createHash('sha256').update(markdown).digest('hex'));
  assert.equal(Object.hasOwn(compiled,'plan_projection_sha256'),false);
  assert.equal(plans.validatePlanScopeV1(compiled).schema_version,3);
  const vp=verification.compileVerificationPlan(input(compiled));
  assert.notEqual(vp.source_plan_sha256,vp.plan_projection_sha256);assert.notEqual(vp.plan_authority_sha256,vp.plan_projection_sha256);
  assert.deepEqual(execution.receiptStorePaths({work_dir:'.deep-work/test'},compiled),{internalDir:'.deep-work/test/runtime-receipts',publicDir:'.deep-work/test/receipts'});
});
test('V3 authored source binds validated Spec identity, complete IDs and reviewed slice risk',()=>{
  const contractRuntime=require('../runtime/contract-runtime.js');
  const spec={schema_version:1,spec_id:'SPEC-EXECUTION',risk_class:'low',requirements:[{id:'REQ-001',statement:'Document new heading',
    acceptance:'README includes New heading',priority:'must',negative_test_ids:[],evidence_gate_ids:['GATE-outcome-verification']}],
    invariants:[],failure_matrix:[],negative_tests:[],compatibility:{},open_questions:[]};
  const raw=fixture();delete raw.contract_binding.source_plan_sha256;
  raw.contract_binding.spec_contract.spec_sha256=contractRuntime.specContractDigest(spec);
  const source=p=>'## Execution Plan\n\n```json\n'+JSON.stringify(p)+'\n```\n';
  const risks={'SLICE-001':raw.slices[0].contract.risk};
  const compile=(p=raw,s=spec)=>plans.compilePlanProjectionV1({planMarkdown:source(p),specContract:s,sliceRiskState:risks});
  const projection=compile();assert.equal(projection.schema_version,3);
  assert.equal(projection.contract_binding.spec_contract.spec_sha256,contractRuntime.specContractDigest(spec));
  const sourceChanged=plans.compilePlanProjectionV3({planMarkdown:source(raw)+'\n',specContract:spec,sliceRiskState:risks});
  assert.notEqual(sourceChanged.plan_authority_sha256,projection.plan_authority_sha256);
  const derived=structuredClone(raw);derived.contract_binding.source_plan_sha256='f'.repeat(64);
  assert.throws(()=>compile(derived),/execution-plan-source-derived/);
  const wrongSpec=structuredClone(spec);wrongSpec.requirements[0].id='REQ-002';assert.throws(()=>compile(raw,wrongSpec),/plan-spec-contract/);
  const unknown=structuredClone(spec);unknown.requirements[0].evidence_gate_ids=['GATE-unknown'];
  const unknownPlan=structuredClone(raw);unknownPlan.contract_binding.spec_contract.spec_sha256=contractRuntime.specContractDigest(unknown);
  assert.throws(()=>compile(unknownPlan,unknown),/plan-spec-gate/);
});
