'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {makeExecutionPlanFixture:fixture}=require('../tests/helpers/execution-fixtures.js');
const planRuntime=require('./plan-runtime.js');
let api;try{api=require('./execution-contract-runtime.js');}catch{api={};}
test('V3 README outcome compiles without a failing-test scope and has stable authority',()=>{
  assert.equal(typeof api.validateExecutionPlanV3,'function','V3 validator is available');
  const plan=api.validateExecutionPlanV3(fixture());
  assert.deepEqual(plan.slices[0].write_scope.failing_test,[]);
  assert.equal(api.resolvePlanExecution(plan).sliceBasis['SLICE-001'],'outcome-v1');
  assert.equal(plan.plan_authority_sha256,'4e4c5825724030d2fcb6ebff6285f07cf773483d3e03fd257896cb0ec7c85aa4');
  const progressed=structuredClone(plan);progressed.slices[0].checked=true;
  assert.equal(api.validateExecutionPlanV3(progressed).plan_authority_sha256,plan.plan_authority_sha256);
  const forged=structuredClone(plan);forged.slices[0].oracle_controls[0].check.value='wrong';
  assert.throws(()=>api.validateExecutionPlanV3(forged),/plan-authority-digest/);
});
test('V3 mixed basis is exact and strict-required cannot weaken',()=>{
  assert.equal(typeof api.validateExecutionPlanV3,'function');
  const strict=fixture({basis:'strict-tdd-v2'}).slices[0];
  const outcome=fixture().slices[0];outcome.id=outcome.contract.id='SLICE-002';outcome.contract.requirements=['REQ-002'];
  outcome.oracle_controls[0].requirement_ids=['REQ-002'];
  const plan=api.validateExecutionPlanV3(fixture({slices:[outcome,strict],strictRequired:['SLICE-001']}));
  assert.deepEqual(api.resolvePlanExecution(plan).sliceBasis,{'SLICE-001':'strict-tdd-v2','SLICE-002':'outcome-v1'});
  assert.throws(()=>api.validateExecutionPlanV3(fixture({strictRequired:['SLICE-001']})),/execution-basis-required/);
  assert.throws(()=>api.validateExecutionPlanV3(fixture({method:'strict',slices:[{...outcome,change_kind:'functional'}]})),/execution-basis-required/);
});
test('V3 rejects malformed identity, coverage, scope and cross-basis fields',()=>{
  assert.equal(typeof api.validateExecutionPlanV3,'function');
  for(const mutate of [p=>delete p.execution_policy,p=>p.contract_binding.mode='strict-spec',p=>p.slices.push(p.slices[0]),
    p=>p.slices[0].oracle_controls[0].requirement_ids=[],p=>p.slices[0].contract.evidence_required=['GATE-invented'],
    p=>p.slices[0].files.push('../escape'),p=>p.slices[0].verification_spec={},p=>p.slices[0].checked='false',
    p=>p.execution_policy.extra=true,p=>p.slices[0].contract.depends_on=['SLICE-001']]) {
    const p=fixture();mutate(p);assert.throws(()=>api.validateExecutionPlanV3(p));
  }
});
test('closed outcome environment rejects arbitrary behavior, credentials and HOME at compile time',()=>{
  assert.equal(typeof api.validateExecutionPlanV3,'function');
  for(const [key,value] of [['NODE_OPTIONS','--require ./x'],['PYTHONPATH','x'],['PYTHONSTARTUP','x'],['LD_PRELOAD','x'],
    ['DYLD_INSERT_LIBRARIES','x'],['AWS_SECRET_ACCESS_KEY','x'],['HOME','/Users/person'],['EXTRA','x'],['TZ',false],['LANG',42]]) {
    const p=fixture();p.outcome_environment.values[key]=value;assert.throws(()=>api.validateExecutionPlanV3(p),/outcome-environment/);
  }
});
test('legacy schema one remains separate and V2 dispatch never inserts basis keys',()=>{
  assert.equal(typeof api.resolvePlanExecution,'function');
  assert.deepEqual(api.resolvePlanExecution({schema_version:1}),{version:1,sliceBasis:null,strictRequiredSliceIds:[]});
  const p=fixture({basis:'strict-tdd-v2'});p.schema_version=2;p.contract_binding.mode='strict-spec';
  p.capability_facts.source_requirement_ids=['REQ-001'];p.capability_facts.source_slice_ids=['SLICE-001'];
  const crypto=require('node:crypto'),{canonicalJson}=require('./operation-journal.js');
  delete p.capability_facts.facts_sha256;p.capability_facts.facts_sha256=crypto.createHash('sha256').update('capability-facts-v1\0'+canonicalJson(p.capability_facts)).digest('hex');
  delete p.execution_policy;delete p.outcome_environment;delete p.slices[0].execution_basis;delete p.slices[0].change_kind;
  const before=JSON.stringify(p);assert.deepEqual(api.compileImmutablePlanAuthority(p),planRuntime.compileImmutablePlanAuthorityV2(p));
  assert.equal(crypto.createHash('sha256').update(canonicalJson(api.compileImmutablePlanAuthority(p))).digest('hex'),
    'bffd608b9cd398ea794a32d45fccfe138f9d0601b0ec94002f89d67383d3a64f');
  assert.equal(JSON.stringify(p),before);assert.equal(api.resolvePlanExecution(p).sliceBasis['SLICE-001'],'strict-tdd-v2');
  const invalid=structuredClone(p);invalid.slices[0].execution_basis='outcome-v1';assert.throws(()=>api.resolvePlanExecution(invalid));
});

test('outcome command accepts registered Node/Python argv and rejects interpreter escape routes',()=>{
  const spec={schema_version:1,executable:{kind:'node',value:'node'},args:['--test','tests/a.test.js'],cwd_role:'active-worktree',timeout_ms:1000,max_output_bytes:4096};
  const command={id:'CMD-tests',gate_ids:['GATE-outcome-verification'],spec};
  assert.equal(api.validateOutcomeCommandV1(command).spec.cwd_role,'active-worktree');
  const python=structuredClone(command);python.spec.executable={kind:'absolute-native',value:'/usr/bin/python3'};python.spec.args=['-m','unittest','discover','-s','tests','-p','test_*.py'];
  assert.doesNotThrow(()=>api.validateOutcomeCommandV1(python));
  for(const mutation of [c=>c.spec.args=['--eval','process.exit(0)'],c=>c.spec.args=['--test','--import=./evil.js','tests/a.test.js'],
    c=>c.spec.executable={kind:'npm',value:'npm'},c=>c.spec.red_failure_literal='failed',c=>c.spec.environment={},
    c=>c.spec.executable={kind:'project-relative',value:'scripts/test.sh'},c=>c.spec.args=['--test','/etc/passwd'],
    c=>c.spec.timeout_ms='1000',c=>c.spec.executable={kind:'absolute-native',value:'/usr/bin/git'},
    c=>{c.spec.executable={kind:'absolute-native',value:'/usr/bin/python3'};c.spec.args=['-c','print(0)'];}]) {
    const copy=structuredClone(command);mutation(copy);assert.throws(()=>api.validateOutcomeCommandV1(copy));
  }
});
test('program oracle cannot mutate its own code and requires exact command/ID mapping',()=>{
  const p=fixture(),s=p.slices[0];s.files=['README.md','tests/check.test.js'];s.contract.files=s.files;
  s.write_scope.production=s.files;
  s.verification_commands=[{id:'CMD-check',gate_ids:['GATE-outcome-verification'],spec:{schema_version:1,
    executable:{kind:'node',value:'node'},args:['--test','tests/check.test.js'],cwd_role:'active-worktree',timeout_ms:1000,max_output_bytes:4096}}];
  Object.assign(s.oracle_controls[0],{source_kind:'slice-authored',source_refs:[{path:'tests/check.test.js'}],
    check:{kind:'program',command_id:'CMD-check'},command_id:'CMD-check'});
  assert.doesNotThrow(()=>api.validateExecutionPlanV3(p));
  for(const mutate of [p=>p.slices[0].oracle_controls[0].counterexample.path='tests/check.test.js',
    p=>p.slices[0].oracle_controls[0].command_id='CMD-other',p=>p.slices[0].verification_commands=[],
    p=>p.slices[0].oracle_controls[0].source_refs=[{path:'outside.test.js'}],
    p=>p.slices[0].oracle_controls[0].invariant_ids=['INV-999']]){
    const copy=structuredClone(p);mutate(copy);assert.throws(()=>api.validateExecutionPlanV3(copy));
  }
});
test('built-in counterexamples reject unchanged passing fixtures and invalid raw JSON values',()=>{
  const p=fixture();p.slices[0].oracle_controls[0].counterexample.content='New heading';
  assert.throws(()=>api.validateExecutionPlanV3(p),/oracle-counterexample-ineffective/);
  const malformed=fixture();malformed.slices[0].contract.steps=42;
  assert.throws(()=>api.validateExecutionPlanV3(malformed),/execution-slice-contract/);
  const withNonfinite=fixture();withNonfinite.slices[0].oracle_controls[0].check={kind:'json-pointer-equals',path:'README.md',pointer:'/a',value:Infinity};
  assert.throws(()=>api.validateExecutionPlanV3(withNonfinite));
});
test('V3 authority cannot alias a legacy policy through the old verification compiler',()=>{
  const verification=require('./verification-policy-runtime.js');
  const policy=require('./policy-runtime.js').compileMethodologyAuthority({riskProfile:{class:'low'},executionBasis:'per-slice-v1'});
  assert.throws(()=>verification.compileVerificationPlan({riskProfile:{class:'low'},policySnapshot:policy,
    specSha256:'a'.repeat(64),specApprovedHash:'b'.repeat(64),riskProfileSha256:'c'.repeat(64),
    specContract:{spec_id:'SPEC-EXECUTION',requirements:[{id:'REQ-001'}]},planProjection:{schema_version:1,
      contract_binding:{mode:'strict-spec',created_by_version:'6.13.0',source_plan_sha256:'d'.repeat(64),risk_profile_sha256:'c'.repeat(64),
        spec_contract:{spec_id:'SPEC-EXECUTION',spec_sha256:'a'.repeat(64),spec_approved_hash:'b'.repeat(64)}},slices:[]}}),/execution-policy/);
});
test('a counterexample cannot mutate another oracle source',()=>{
  const p=fixture(),s=p.slices[0];s.files=['README.md','tests/check.test.js'];s.contract.files=s.files;s.write_scope.production=s.files;
  s.verification_commands=[{id:'CMD-check',gate_ids:['GATE-outcome-verification'],spec:{schema_version:1,executable:{kind:'node',value:'node'},
    args:['--test','tests/check.test.js'],cwd_role:'active-worktree',timeout_ms:1000,max_output_bytes:4096}}];
  s.oracle_controls.push({...structuredClone(s.oracle_controls[0]),id:'ORACLE-002',source_kind:'slice-authored',
    source_refs:[{path:'tests/check.test.js'}],check:{kind:'program',command_id:'CMD-check'},command_id:'CMD-check'});
  s.oracle_controls[0].check.path=s.oracle_controls[0].counterexample.path='tests/check.test.js';
  assert.throws(()=>api.validateExecutionPlanV3(p),/oracle-counterexample-source/);
});
test('legacy scoped write validator rejects outcome basis injected into old projection',()=>{
  const legacy={schema_version:1,slices:[{id:'SLICE-001',checked:false,scope_schema_version:1,execution_basis:'outcome-v1',
    files:['src/a.js','tests/a.test.js'],write_scope:{failing_test:['tests/a.test.js'],production:['src/a.js'],refactor:[]}}]};
  assert.throws(()=>planRuntime.validatePlanScopeV1(legacy),/execution-legacy-injection/);
});
