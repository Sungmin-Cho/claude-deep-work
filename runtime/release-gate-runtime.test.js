'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const gate=require('./release-gate-runtime.js');
const journal=require('./operation-journal.js');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');
const frontmatter=require('./frontmatter.js');
const {compileImmutablePlanAuthorityV2}=require('./plan-runtime.js');
const {dispatch}=require('../scripts/deep-work-runtime.js');

test('release gate catalog fixes all command argv and every v6.14 gate exactly once',()=>{
  assert.deepEqual(Object.keys(gate.RELEASE_GATE_CATALOG),
    ['carrier','tdd','replan','integration','full','pack']);
  assert.deepEqual(gate.RELEASE_GATE_CATALOG.full.argv,['npm','test']);
  assert.deepEqual(gate.RELEASE_GATE_CATALOG.pack.argv,
    ['npm','pack','--dry-run','--json']);
  const ids=Object.values(gate.RELEASE_GATE_CATALOG)
    .flatMap((row)=>row.gate_ids)
    .concat(Object.values(gate.DETERMINISTIC_GATE_MAPPING).flat());
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(ids.length,32);
});

test('GateFactArtifactV1 separates semantic facts and raw artifact digests',()=>{
  const facts={changed_paths:['README.md','runtime/a.js'],
    checked_paths:['runtime/a.js'],failure_paths:[]};
  const artifact=gate.buildGateFactArtifact('changed-js-syntax-v1',facts);
  const validated=gate.validateGateFactArtifact(artifact);
  assert.equal(validated.blocking_codes.length,0);
  assert.notEqual(artifact.facts_sha256,validated.facts_artifact_sha256);
  const tampered=structuredClone(artifact);
  tampered.facts.checked_paths=[];
  assert.throws(()=>gate.validateGateFactArtifact(tampered),/gate-fact-artifact/);
});

test('deterministic fact validators emit only their closed blocker vocabulary',()=>{
  const integrity={manifest_versions:{claude:'6.14.0',codex:'6.14.0'},
    package_version:'6.14.0',runtime_version:'6.14.0',
    docs_rule_sha256:'a'.repeat(64),v7_surface_violations:[],
    git_state:{head:'b'.repeat(40),branch:'worktree-v6-14',dirty:false,
      changed_paths:[]},external_effect_operation_ids:[]};
  assert.deepEqual(gate.computeBlockingCodes('release-integrity-v1',integrity),[]);
  integrity.runtime_version='7.0.0';
  integrity.external_effect_operation_ids=[`op-${'c'.repeat(64)}`];
  assert.deepEqual(gate.computeBlockingCodes('release-integrity-v1',integrity),
    ['external-effect-seen','version-mismatch']);
  assert.throws(()=>gate.computeBlockingCodes('release-integrity-v1',{
    ...integrity,caller_note:'forged'}),/release-gate-facts/);
});

test('CheckerInputCatalogV1 rejects wrong roles, duplicates, and caller ordering',()=>{
  const refs=['spec-approval','spec-contract','spec-gate-result'].map((kind,index)=>({
    kind,path:`.deep-work/s-aaaaaaaa/${kind}.json`,sha256:String(index+1).repeat(64),
    producer_operation_id:`op-${String(index+4).repeat(64)}`}));
  assert.deepEqual(gate.validateCheckerInputRefs('spec-gate-v1',refs),refs);
  assert.throws(()=>gate.validateCheckerInputRefs('spec-gate-v1',
    [refs[1],refs[0],refs[2]]),/checker-input-catalog/);
  assert.throws(()=>gate.validateCheckerInputRefs('spec-gate-v1',
    [refs[0],refs[0],refs[2]]),/checker-input-catalog/);
});

test('GateResultV1 derives deterministic status and GateResultRefV1 binds its producer',()=>{
  const facts={changed_paths:['runtime/a.js'],checked_paths:['runtime/a.js'],
    failure_paths:[]};
  const artifact=gate.buildGateFactArtifact('changed-js-syntax-v1',facts);
  const artifactSha256=gate.validateGateFactArtifact(artifact).facts_artifact_sha256;
  const factsRef={kind:'gate-fact',
    path:`.deep-work/s-aaaaaaaa/gate-facts/changed-js-syntax-v1-${artifact.facts_sha256}.json`,
    sha256:artifactSha256,producer_operation_id:`op-${'7'.repeat(64)}`};
  const result=gate.buildDeterministicGateResult({
    sessionId:'s-aaaaaaaa',planAuthoritySha256:'1'.repeat(64),
    verificationPlanSha256:'2'.repeat(64),checkerId:'changed-js-syntax-v1',
    gateIds:['GATE-impacted-lint-typecheck'],factsRef,artifact});
  assert.equal(result.status,'passed');
  assert.equal(gate.validateGateResult(result).result.passed,true);
  const ref={gate_id:'GATE-impacted-lint-typecheck',
    operation_id:`op-${'8'.repeat(64)}`,
    result_path:`.deep-work/s-aaaaaaaa/gate-results/op-${'8'.repeat(64)}.json`,
    result_sha256:result.result_sha256,ledger_result_sha256:'9'.repeat(64),
    checker_id:'changed-js-syntax-v1',argv_sha256:gate.argvSha256([])};
  assert.deepEqual(gate.validateGateResultRef(ref),ref);
  assert.throws(()=>gate.validateGateResult({...result,status:'failed'}),
    /gate-result/);
});

test('command GateResultV1 rejects a caller-forged pass on timeout',()=>{
  const result=gate.buildCommandGateResult({sessionId:'s-aaaaaaaa',
    planAuthoritySha256:'1'.repeat(64),verificationPlanSha256:'2'.repeat(64),
    commandId:'full',inputRefs:[],releaseEnvironmentSha256:'3'.repeat(64),
    processResult:{exit_code:null,signal:'SIGTERM',timed_out:true,
      output_overflow:false,stdout_sha256:'4'.repeat(64),stderr_sha256:'5'.repeat(64)}});
  assert.equal(result.status,'failed');
  assert.throws(()=>gate.validateGateResult({...result,status:'passed'}),
    /gate-result/);
});

test('gate-fact-publish authenticates catalog inputs and adopts exact fact bytes',
  async(t)=>{
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-gate-fact-')));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
    const sessionId='s-aaaaaaaa';
    const work=path.join(root,'.deep-work',sessionId);fs.mkdirSync(work,{recursive:true});
    const statePath=path.join(root,'.claude',`deep-work.${sessionId}.md`);
    fs.writeFileSync(statePath,frontmatter.updateFrontmatterText('',{
      session_id:sessionId,work_dir:`.deep-work/${sessionId}`,
      current_phase:'test',verification_plan_sha256:'2'.repeat(64)}));
    const stateCapability=platform.issueProjectStateCapability(root,statePath,
      {role:'session-state'});
    const sessionCapability=platform.issueProjectStateCapability(root,work,{
      role:'session-work-dir',sessionStateCapability:stateCapability});
    const planCapability=transaction.issueSessionFileCapability({sessionCapability,
      candidate:path.join(work,'plan.json'),allowedBasenames:['plan.json'],
      allowMissingLeaf:true,role:'locked-plan'});
    const facts={schema_version:1,authority:'reviewed-plan',destructive:false,
      external_action:false,has_backward_compat:true,has_migration:true,
      host_dependent:false,source_requirement_ids:['REQ-001'],
      source_slice_ids:['SLICE-001']};
    facts.facts_sha256=gate.semanticDigest('capability-facts-v1',facts);
    const plan={schema_version:2,replan_epoch:null,contract_binding:{
      mode:'strict-spec',created_by_version:'6.14.0',source_plan_sha256:'3'.repeat(64),
      risk_profile_sha256:'4'.repeat(64),spec_contract:{schema_version:1,
        spec_id:'SPEC-GATE',spec_sha256:'5'.repeat(64),
        spec_approved_hash:'6'.repeat(64)}},capability_facts:facts,slices:[{
      id:'SLICE-001',slice_kind:'release-verification',checked:false,
      scope_schema_version:1,files:[],write_scope:{failing_test:[],production:[],
        refactor:[]},verification_scope:['npm test'],
      release_gate_ids:[...gate.DETERMINISTIC_GATE_MAPPING['spec-gate-v1']],
      verification_spec:null,verification_spec_sha256:null}]};
    plan.plan_authority_sha256=
      compileImmutablePlanAuthorityV2(plan).plan_authority_sha256;
    fs.writeFileSync(planCapability.path,journal.canonicalJson(plan));
    const inputs={
      'spec-approval':{spec_approved_hash:'6'.repeat(64)},
      'spec-contract':{spec_sha256:'5'.repeat(64)},
      'spec-gate-result':{pass:true,requirement_coverage:{
        total:1,covered:1,uncovered_ids:[],ratio:1},failure_matrix_coverage:{
        total:1,covered:1,uncovered_ids:[],ratio:1}},
    };
    const project=transaction.projectCapabilityFor(stateCapability),refs=[];
    let index=7;
    for(const [kind,value] of Object.entries(inputs)){
      const operationId=`op-${String(index).repeat(64)}`;index++;
      const operation=await journal.beginOperation({projectCapability:project,
        sessionId,kind:'phase-approval',operationId,preconditions:{kind}});
      await journal.recordOperationStage(operation,'state-written',{owned:{kind}});
      await journal.completeOperation(operation,{status:'completed',kind});
      const relative=`.deep-work/${sessionId}/release-inputs/${kind}.json`;
      const target=path.join(root,...relative.split('/'));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,journal.canonicalJson(value));
      refs.push({kind,path:relative,sha256:journal.sha256(
        journal.canonicalJson(value)),producer_operation_id:operationId});
    }
    const refsPath=path.join(root,'input-refs.json');
    fs.writeFileSync(refsPath,journal.canonicalJson(refs));
    const published=await dispatch(['release','gate','fact-publish','--state',
      statePath,'--plan',planCapability.path,'--checker','spec-gate-v1',
      '--input-refs-json',refsPath],{cwd:root});
    assert.match(published.facts_sha256,/^[0-9a-f]{64}$/);
    const stored=JSON.parse(fs.readFileSync(path.join(root,
      ...published.facts_path.split('/')),'utf8'));
    assert.equal(stored.facts.pass,true);
    const replay=await gate.publishGateFact({stateCapability,planCapability,
      plan,checkerId:'spec-gate-v1',inputRefs:refs});
    assert.equal(replay.adopted,true);
    const result=await dispatch(['release','gate','result-publish','--state',
      statePath,'--plan',planCapability.path,'--fact-operation-id',
      published.operation_id],{cwd:root});
    assert.equal(result.status,'passed');
    assert.equal(result.gate_result_refs.length,4);
    assert.ok(result.gate_result_refs.every((ref)=>
      ref.operation_id===result.operation_id));
    const resultReplay=await gate.publishDeterministicGateResult({
      stateCapability,planCapability,plan,factOperationId:published.operation_id});
    assert.equal(resultReplay.adopted,true);
    const gateRefsPath=path.join(root,'gate-refs.json');
    const functionalRefsPath=path.join(root,'functional-refs.json');
    fs.writeFileSync(gateRefsPath,journal.canonicalJson(result.gate_result_refs));
    fs.writeFileSync(functionalRefsPath,'[]');
    const completed=await dispatch(['release','verification','complete','--state',
      statePath,'--plan',planCapability.path,'--slice','SLICE-001',
      '--gate-results-json',gateRefsPath,'--functional-receipts-json',
      functionalRefsPath],{cwd:root});
    assert.match(completed.receipt_sha256,/^[0-9a-f]{64}$/);
    const completedPlan=JSON.parse(fs.readFileSync(planCapability.path,'utf8'));
    assert.equal(completedPlan.slices[0].checked,true);
    const completionReplay=await gate.publishReleaseVerificationReceipt({
      stateCapability,planCapability,plan:completedPlan,sliceId:'SLICE-001',
      gateResults:result.gate_result_refs,functionalReceipts:[]});
    assert.equal(completionReplay.adopted,true);
  });
