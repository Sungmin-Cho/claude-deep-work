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
