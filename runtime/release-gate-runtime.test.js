'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const gate=require('./release-gate-runtime.js');

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
