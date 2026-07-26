'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const platform=require('./platform.js');
const frontmatter=require('./frontmatter.js');
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
