'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const platform=require('./platform.js');
const frontmatter=require('./frontmatter.js');
const journal=require('./operation-journal.js');
const {compileImmutablePlanAuthorityV2}=require('./plan-runtime.js');
const {compileVerificationPlan}=require('./verification-policy-runtime.js');
const {semanticDigest}=require('./release-gate-runtime.js');
const {buildProgressProjectionV1,selectGovernedAdmission,loadGovernedContext}=
  require('./governed-context-runtime.js');

const empty={evidence:{status:'unknown',required_ids:[],completed_ids:[],missing_ids:[],
  invalidated_ids:[]},residual_risk:{status:'unknown',class:null,accepted:null,
  blocking_reasons:[]},replan:{status:'none',epoch:null,reason:null,trigger_id:null},
invalidations:[],findings:{status:'unknown',points:[]},receipts:{status:'unknown',rows:[]},
required_gate_ids:[],satisfied_gate_ids:[],warnings:['projection-input-missing']};

test('no-plan projection has exact defaults and only compatibility plus gate blockers',()=>{
  const built=buildProgressProjectionV1({...empty,plan_identity:{status:'missing',
    plan_authority_sha256:null,verification_plan_sha256:null}});
  assert.deepEqual(built.projection.admissions.map((row)=>row.enforcement_point),
    ['finish-finalize','finish-pre-action','test']);
  for(const row of built.projection.admissions)
    assert.deepEqual(row.blocking_codes,['compatibility-context-missing','gate-missing']);
  assert.equal(selectGovernedAdmission(built.projection,'test').allowed,false);
});

test('active invalidation yields byte-identical authority blockers at every consumer',()=>{
  const invalidation={scope:'session-plan',session_id:'s-aaaaaaaa',
    prior_plan_authority_sha256:'1'.repeat(64),trigger_id:'2'.repeat(64),
    invalidation_sha256:'3'.repeat(64)};
  const built=buildProgressProjectionV1({...empty,plan_identity:{status:'invalidated',
    plan_authority_sha256:null,verification_plan_sha256:null},
  replan:{status:'active',epoch:'4'.repeat(64),reason:'test-side-effect',
    trigger_id:'2'.repeat(64)},invalidations:[invalidation],
  warnings:['invalidation-active']});
  for(const row of built.projection.admissions){
    assert.deepEqual(row.blocking_codes,['authority-invalidated','replan-active']);
  }
});

test('an approved plan without a verification plan has the exact two blockers',()=>{
  const built=buildProgressProjectionV1({...empty,plan_identity:{status:'current',
    plan_authority_sha256:'1'.repeat(64),verification_plan_sha256:null}});
  for(const row of built.projection.admissions)
    assert.deepEqual(row.blocking_codes,['evidence-missing','gate-missing']);
});

test('only finish admissions add a missing Critical human acknowledgment',()=>{
  const common={...empty,plan_identity:{status:'current',
    plan_authority_sha256:'1'.repeat(64),verification_plan_sha256:'2'.repeat(64)},
  evidence:{status:'complete',required_ids:[],completed_ids:[],missing_ids:[],
    invalidated_ids:[]},residual_risk:{status:'accepted',class:'critical',accepted:true,
    blocking_reasons:[]},findings:{status:'complete',points:[]},
  receipts:{status:'complete',rows:[]},warnings:[],human_ack_required:true,
  human_ack_satisfied:false};
  const projection=buildProgressProjectionV1(common).projection;
  assert.deepEqual(selectGovernedAdmission(projection,'test').blocking_codes,[]);
  assert.deepEqual(selectGovernedAdmission(projection,'finish-pre-action').blocking_codes,
    ['human-ack-missing']);
  assert.deepEqual(selectGovernedAdmission(projection,'finish-finalize').blocking_codes,
    ['human-ack-missing']);
});

test('the governed loader emits the same no-plan bytes consumed by all readers',(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-governed-context-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.claude'));fs.mkdirSync(path.join(root,'.deep-work',
    's-aaaaaaaa'),{recursive:true});
  const state=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(state,frontmatter.updateFrontmatterText('',{
    session_id:'s-aaaaaaaa',work_dir:'.deep-work/s-aaaaaaaa',
    current_phase:'research'}));
  const stateCapability=platform.issueProjectStateCapability(root,state,{
    role:'session-state'});
  const loaded=loadGovernedContext({stateCapability});
  assert.equal(loaded.projection.plan_identity.status,'missing');
  for(const point of ['test','finish-pre-action','finish-finalize'])
    assert.deepEqual(selectGovernedAdmission(loaded.projection,point).blocking_codes,
      ['compatibility-context-missing','gate-missing']);
  assert.equal(loaded.bytes.toString('utf8').endsWith('\n'),true);
});

test('the governed loader derives finish locks from the review execution carrier',(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-governed-review-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.claude'));const sessionId='s-aaaaaaaa';
  const work=path.join(root,'.deep-work',sessionId);
  fs.mkdirSync(work,{recursive:true});
  const riskSha='4'.repeat(64),specSha='5'.repeat(64),approved='6'.repeat(64);
  const facts={schema_version:1,authority:'reviewed-plan',destructive:false,
    external_action:false,has_backward_compat:true,has_migration:true,
    host_dependent:false,source_requirement_ids:['REQ-001'],
    source_slice_ids:['SLICE-001']};
  facts.facts_sha256=semanticDigest('capability-facts-v1',facts);
  const plan={schema_version:2,replan_epoch:null,contract_binding:{
    mode:'strict-spec',created_by_version:'6.14.0',
    source_plan_sha256:'3'.repeat(64),risk_profile_sha256:riskSha,
    spec_contract:{schema_version:1,spec_id:'SPEC-GOVERNED',
      spec_sha256:specSha,spec_approved_hash:approved}},
  capability_facts:facts,slices:[{id:'SLICE-001',
    slice_kind:'release-verification',checked:false,scope_schema_version:1,
    files:[],write_scope:{failing_test:[],production:[],refactor:[]},
    verification_scope:['npm test'],release_gate_ids:['GATE-human-ack'],
    verification_spec:null,verification_spec_sha256:null}]};
  plan.plan_authority_sha256=
    compileImmutablePlanAuthorityV2(plan).plan_authority_sha256;
  const verificationPlan=compileVerificationPlan({
    riskProfile:{class:'critical',score:8,triggers:[]},
    riskProfileSha256:riskSha,policySnapshot:{risk_class:'critical',
      profile:'critical',verification_policy:{recommended:
        '전수 검증 + human gate'}},
    specContract:{schema_version:1,spec_id:'SPEC-GOVERNED',
      risk_class:'critical',requirements:[{id:'REQ-001',
        evidence_gate_ids:['GATE-backward-compat','GATE-migration-dry-run']}],
      failure_modes:[],compatibility:{legacy_inputs:'covered',
        migration:'covered'}},
    specSha256:specSha,specApprovedHash:approved,planProjection:plan,
    capabilities:{},compatibilityFacts:{created_by_version:'6.14.0',
      spec_policy_required:true}});
  fs.writeFileSync(path.join(work,'plan.json'),journal.canonicalJson(plan));
  const statePath=path.join(root,'.claude',`deep-work.${sessionId}.md`);
  const review={external_change_lock:true,points:{final:{
    risk_class:'critical',human_ack:null}}};
  fs.writeFileSync(statePath,frontmatter.updateFrontmatterText('',{
    session_id:sessionId,work_dir:`.deep-work/${sessionId}`,
    current_phase:'test',verification_plan_sha256:verificationPlan.plan_sha256,
    verification_plan_json:JSON.stringify(verificationPlan),
    review_execution_json:JSON.stringify(review)}));
  const stateCapability=platform.issueProjectStateCapability(root,statePath,{
    role:'session-state'});
  let admission=selectGovernedAdmission(
    loadGovernedContext({stateCapability}).projection,'finish-finalize');
  assert.equal(admission.blocking_codes.includes('human-ack-missing'),true);
  assert.equal(admission.blocking_codes.includes('external-change-lock'),true);
  review.external_change_lock=false;
  review.points.final.human_ack={required:true,
    at:'2026-07-27T00:00:00.000Z',actor:'human'};
  fs.writeFileSync(statePath,frontmatter.updateFrontmatterText(
    fs.readFileSync(statePath,'utf8'),{
      review_execution_json:JSON.stringify(review)}));
  admission=selectGovernedAdmission(
    loadGovernedContext({stateCapability}).projection,'finish-finalize');
  assert.equal(admission.blocking_codes.includes('human-ack-missing'),false);
  assert.equal(admission.blocking_codes.includes('external-change-lock'),false);
});
