'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {canonicalJson}=require('./operation-journal.js');
const {compileVerificationPlan,requiredGateIds,validateVerificationPlan,computeResidualRisk}=require('./verification-policy-runtime.js');
const labels={lean:'최소 검증 (기록 전용)',standard:'표준 검증',strict:'강화 검증',critical:'전수 검증 + human gate'};
function input(risk_class,profile){return{riskProfile:{class:risk_class,score:5,triggers:[]},riskProfileSha256:'c'.repeat(64),
  policySnapshot:{risk_class,profile,verification_policy:{recommended:labels[profile]}},
  specContract:{schema_version:1,spec_id:'SPEC-POLICY',risk_class,requirements:[{id:'REQ-001'}],failure_modes:[]},
  specSha256:'a'.repeat(64),specApprovedHash:'b'.repeat(64),planProjection:{schema_version:1,
    contract_binding:{mode:'strict-spec',created_by_version:'6.13.0',source_plan_sha256:'d'.repeat(64),
      risk_profile_sha256:'c'.repeat(64),spec_contract:{spec_id:'SPEC-POLICY',spec_sha256:'a'.repeat(64),
        spec_approved_hash:'b'.repeat(64)}},slices:[]},capabilities:{},
  compatibilityFacts:{created_by_version:'6.13.0',spec_policy_required:true}};}
test('required gate sets are monotonic low through critical',()=>{const rows=[['low','lean'],['medium','standard'],['high','strict'],['critical','critical']]
  .map(([risk,profile])=>compileVerificationPlan(input(risk,profile)));for(const plan of rows)assert.equal(validateVerificationPlan(plan).pass,true);
  for(let i=1;i<rows.length;i++){const prev=new Set(rows[i-1].required_gate_ids);for(const id of prev)assert.equal(rows[i].required_gate_ids.includes(id),true,id);}
  assert.equal(requiredGateIds(rows[3],{at:'finish-pre-action'}).includes('GATE-human-ack'),true);
});

test('validator recomputes required dispositions and rejects a Critical zero-gate downgrade',()=>{
  const downgraded=structuredClone(compileVerificationPlan(input('critical','critical')));
  for(const gate of downgraded.gates)gate.disposition='advisory';
  downgraded.required_gate_ids=[];downgraded.evidence_required_gate_ids=[];
  const preimage=structuredClone(downgraded);delete preimage.plan_sha256;
  downgraded.plan_sha256=crypto.createHash('sha256').update(canonicalJson(preimage)).digest('hex');
  const result=validateVerificationPlan(downgraded);
  assert.equal(result.pass,false);assert.ok(result.errors.some((row)=>row.code==='verification-plan-disposition'));
});

test('compiler embeds durable compatibility proof and evidence accepts the exact catalog round trip',()=>{
  const plan=compileVerificationPlan(input('medium','standard'));
  assert.equal(plan.compatibility_mode,'strict-spec');
  assert.match(plan.compatibility_proof_sha256,/^[0-9a-f]{64}$/);
  assert.equal(validateVerificationPlan(JSON.parse(canonicalJson(plan))).pass,true);
  assert.doesNotThrow(()=>require('./evidence-runtime.js').validateVerificationPlan(plan));
});

test('invalid risk acceptance cannot authorize residual downgrade',()=>{
  const residual=computeResidualRisk({initialRisk:{class:'medium'},finalRisk:{class:'high'},
    evidenceSummary:{complete:true},unverifiedAreas:[{gate_id:'GATE-host-smoke',reason:'host-unverified'}],
    riskAcceptances:[{}]});
  assert.equal(residual.accepted,false);assert.ok(residual.invalid_acceptance_ids.length>0);
});

test('verification plan binds slice kind/spec map, capability facts and immutable plan authority',()=>{
  const value=input('critical','critical');
  const spec={schema_version:2,executable:{kind:'node-toolchain',name:'node',supported_patches_sha256:'1'.repeat(64)},
    args:['--test','--test-reporter=tap','--','runtime/a.test.js'],cwd_role:'worktree',timeout_ms:120000,
    max_output_bytes:1048576,environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},
    red_failure:{adapter:'node-test-tap',adapter_version:1,expected_class:'expected-failure',
      expected_signal:{kind:'assertion',operator:'strictEqual',test_identity:{test_file:'runtime/a.test.js',
        test_name:'fails first',start_line:1},expected_digest:'2'.repeat(64),actual_digest:null,message_pattern:'fails'}}};
  const specSha=crypto.createHash('sha256').update(Buffer.from(canonicalJson(spec))).digest('hex');
  value.planProjection.slices=[
    {id:'SLICE-001',slice_kind:'functional',checked:false,verification_spec:spec,verification_spec_sha256:specSha},
    {id:'SLICE-002',slice_kind:'release-verification',checked:false,verification_spec:null,verification_spec_sha256:null},
  ];
  value.planProjection.plan_authority_sha256='3'.repeat(64);
  const plan=compileVerificationPlan(value);
  assert.equal(plan.plan_authority_sha256,'3'.repeat(64));
  assert.deepEqual(plan.slice_verification_specs,{
    'SLICE-001':{slice_kind:'functional',verification_spec_sha256:specSha},
    'SLICE-002':{slice_kind:'release-verification',verification_spec_sha256:null},
  });
  assert.match(plan.slice_verification_specs_sha256,/^[0-9a-f]{64}$/);
  const tampered=structuredClone(plan);tampered.slice_verification_specs['SLICE-001'].verification_spec_sha256='4'.repeat(64);
  const preimage=structuredClone(tampered);delete preimage.plan_sha256;
  tampered.plan_sha256=crypto.createHash('sha256').update(canonicalJson(preimage)).digest('hex');
  assert.equal(validateVerificationPlan(tampered).pass,false);
});

test('first-RED verification-plan authority rejects swapped Plan, Spec and capability carriers',()=>{
  const value=input('critical','critical');
  const spec={schema_version:2,executable:{kind:'node-toolchain',name:'node',
    supported_patches_sha256:'1'.repeat(64)},
  args:['--test','--test-reporter=tap','--','runtime/first-red.test.js'],cwd_role:'worktree',
  timeout_ms:30000,max_output_bytes:262144,
  environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},
  red_failure:{adapter:'node-test-tap',adapter_version:1,expected_class:'expected-failure',
    expected_signal:{kind:'contract',operator:'contract',
      test_identity:{test_file:'runtime/first-red.test.js',test_name:'rejects production',start_line:7},
      expected_digest:'2'.repeat(64),actual_digest:'3'.repeat(64),
      message_pattern:'bootstrap proof required'}}};
  const specSha=crypto.createHash('sha256').update(Buffer.from(canonicalJson(spec))).digest('hex');
  value.planProjection.plan_authority_sha256='4'.repeat(64);
  value.planProjection.capability_facts={schema_version:1,authority:'reviewed-plan',
    destructive:false,external_action:false,has_backward_compat:true,has_migration:true,
    host_dependent:true,source_requirement_ids:['REQ-001'],source_slice_ids:['SLICE-001'],
    facts_sha256:'5'.repeat(64)};
  value.planProjection.slices=[{id:'SLICE-001',slice_kind:'functional',checked:false,
    verification_spec:spec,verification_spec_sha256:specSha}];
  const plan=compileVerificationPlan(value);
  assert.equal(plan.plan_authority_sha256,'4'.repeat(64));
  assert.equal(plan.slice_verification_specs['SLICE-001'].verification_spec_sha256,specSha);
  for(const [name,mutate] of [
    ['plan authority',(copy)=>{copy.plan_authority_sha256='6'.repeat(64);}],
    ['spec authority',(copy)=>{copy.slice_verification_specs['SLICE-001'].verification_spec_sha256=
      '7'.repeat(64);}],
    ['capability facts',(copy)=>{copy.capability_facts.facts_sha256='8'.repeat(64);}],
  ]){
    const tampered=structuredClone(plan);mutate(tampered);
    const preimage=structuredClone(tampered);delete preimage.plan_sha256;
    tampered.plan_sha256=crypto.createHash('sha256').update(canonicalJson(preimage)).digest('hex');
    const result=validateVerificationPlan(tampered);
    assert.equal(result.pass,false,name);
  }
});
