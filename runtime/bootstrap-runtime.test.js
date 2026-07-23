'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {
  BOOTSTRAP_CONTROL_NAMES,
  BOOTSTRAP_EXECUTION_STAGES,
  bootstrapManifestSchemaSha256,
  validateBootstrapManifest,
  validateBootstrapWitness,
  validateBootstrapAuthorization,
  validateBootstrapExecutionJournal,
  precomputeBootstrapCompletion,
}=require('./bootstrap-runtime.js');
const {canonicalJson}=require('./operation-journal.js');

const digest=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const semantic=(label,value,key)=>{
  const copy=structuredClone(value);delete copy[key];
  return digest(Buffer.concat([Buffer.from(`${label}\0`),Buffer.from(canonicalJson(copy))]));
};

function manifest(phase='base'){
  const value={schema_version:1,repository_identity_sha256:'1'.repeat(64),base_head_oid:'2'.repeat(40),phase,
    excluded_paths:BOOTSTRAP_CONTROL_NAMES.map((name)=>`.deep-work/s-aaaaaaaa/bootstrap/${name}`).sort(),
    entries:[{path:'runtime/a.js',type:'file',mode:'33188',size:1,sha256:'3'.repeat(64)}]};
  value.manifest_sha256=semantic('bootstrap-manifest-v1',value,'manifest_sha256');
  return value;
}

function witness(){
  const value={schema_version:1,target_session_id:'s-aaaaaaaa',repository_identity_sha256:'1'.repeat(64),
    base_head_oid:'2'.repeat(40),spec_approved_hash:'3'.repeat(64),runtime_version:'6.13.0',
    node_identity:{path:'/usr/bin/node',sha256:'4'.repeat(64),dev:'1',ino:'2',mode:'33261',size:'3',mtime_ns:'4'},
    route_preflight_sha256:'5'.repeat(64),bootstrap_manifest_schema_sha256:bootstrapManifestSchemaSha256('s-aaaaaaaa'),
    base_manifest_sha256:'6'.repeat(64),executor_path:'.deep-work/s-aaaaaaaa/bootstrap/executor.mjs',
    executor_sha256:'7'.repeat(64),test_patch_path:'.deep-work/s-aaaaaaaa/bootstrap/test.patch',
    test_patch_sha256:'8'.repeat(64),test_reverse_patch_path:'.deep-work/s-aaaaaaaa/bootstrap/test-reverse.patch',
    test_reverse_patch_sha256:'9'.repeat(64),red_manifest_sha256:'a'.repeat(64),
    test_changed_paths:['runtime/a.test.js'],patch_path:'.deep-work/s-aaaaaaaa/bootstrap/patch.diff',
    patch_sha256:'b'.repeat(64),reverse_patch_path:'.deep-work/s-aaaaaaaa/bootstrap/reverse.patch',
    reverse_patch_sha256:'c'.repeat(64),expected_post_manifest_sha256:'d'.repeat(64),
    changed_paths:['runtime/a.js'],red_argv:['node','--test','runtime/a.test.js'],
    green_argv:['node','--test','runtime/a.test.js'],expected_red_literal:'bootstrap carrier unavailable',
    expected_red_result:{argv_sha256:'e'.repeat(64),input_manifest_sha256:'a'.repeat(64),exit_code:1,signal:null,
      timed_out:false,output_overflow:false,stdout_sha256:'f'.repeat(64),stderr_sha256:'0'.repeat(64)},
    expected_green_result:{argv_sha256:'e'.repeat(64),input_manifest_sha256:'d'.repeat(64),exit_code:0,signal:null,
      timed_out:false,output_overflow:false,stdout_sha256:'1'.repeat(64),stderr_sha256:'0'.repeat(64)},
    first_red_slice_id:'SLICE-001',first_red_verification_spec_sha256:'2'.repeat(64)};
  value.witness_sha256=semantic('bootstrap-witness-v1',value,'witness_sha256');
  return value;
}

test('bootstrap manifest has one exact control exclusion schema and rejects widening',()=>{
  assert.equal(BOOTSTRAP_CONTROL_NAMES.length,17);
  const checked=validateBootstrapManifest(manifest(),{sessionId:'s-aaaaaaaa'});
  assert.equal(checked.phase,'base');
  assert.match(bootstrapManifestSchemaSha256('s-aaaaaaaa'),/^[0-9a-f]{64}$/);
  const widened=structuredClone(checked);widened.excluded_paths.push('.deep-work/s-aaaaaaaa/bootstrap/*');
  widened.manifest_sha256=semantic('bootstrap-manifest-v1',widened,'manifest_sha256');
  assert.throws(()=>validateBootstrapManifest(widened,{sessionId:'s-aaaaaaaa'}),/bootstrap-manifest-exclusions/);
});

test('witness binds patches, commands, results and disjoint changed paths',()=>{
  assert.equal(validateBootstrapWitness(witness()).witness_sha256,witness().witness_sha256);
  const swapped=structuredClone(witness());swapped.patch_sha256='f'.repeat(64);
  assert.throws(()=>validateBootstrapWitness(swapped),/bootstrap-witness-digest/);
  const overlap=structuredClone(witness());overlap.changed_paths=['runtime/a.test.js'];
  overlap.witness_sha256=semantic('bootstrap-witness-v1',overlap,'witness_sha256');
  assert.throws(()=>validateBootstrapWitness(overlap),/bootstrap-witness-paths/);
});

test('authorization requires one exact human acknowledgment and three witness-bound reviews',()=>{
  const bound=witness();
  const review_report_refs=['structural','semantic','executability'].map((role,index)=>({
    role,path:`.deep-work/s-aaaaaaaa/bootstrap/patch-review-${role}.json`,sha256:String(index+3).repeat(64).slice(0,64),
    reviewer_identity:`reviewer:${role}`,witness_sha256:bound.witness_sha256,verdict:'APPROVE'}));
  const value={schema_version:1,witness:bound,human_ack:{actor:'human',at:'2026-07-23T00:00:00.000Z',
    scope:'one-shot-bootstrap',witness_sha256:bound.witness_sha256},review_report_refs};
  value.authorization_sha256=semantic('bootstrap-authorization-v1',value,'authorization_sha256');
  assert.equal(validateBootstrapAuthorization(value).authorization_sha256,value.authorization_sha256);
  const stale=structuredClone(value);stale.review_report_refs[0].witness_sha256='0'.repeat(64);
  stale.authorization_sha256=semantic('bootstrap-authorization-v1',stale,'authorization_sha256');
  assert.throws(()=>validateBootstrapAuthorization(stale),/bootstrap-review-witness/);
});

test('execution journal has closed stages and mutually exclusive immutable claim input',()=>{
  assert.deepEqual(BOOTSTRAP_EXECUTION_STAGES.slice(0,4),
    ['ready','test-patch-started','test-patch-applied','red-command-completed']);
  const value={schema_version:1,target_session_id:'s-aaaaaaaa',authorization_sha256:'1'.repeat(64),
    witness_sha256:'2'.repeat(64),executor_sha256:'3'.repeat(64),
    node_identity:witness().node_identity,stage:'ready',stage_manifest_sha256:'4'.repeat(64),
    claim:'none',claim_operation_id:null,claim_input:null};
  value.journal_sha256=semantic('bootstrap-execution-journal-v1',value,'journal_sha256');
  assert.equal(validateBootstrapExecutionJournal(value).claim,'none');
  const forged=structuredClone(value);forged.claim='finalize';forged.journal_sha256=
    semantic('bootstrap-execution-journal-v1',forged,'journal_sha256');
  assert.throws(()=>validateBootstrapExecutionJournal(forged),/bootstrap-journal-claim/);
});

test('completion precomputes receipt before marker and cross-links without a digest cycle',()=>{
  const completion=precomputeBootstrapCompletion({target_session_id:'s-aaaaaaaa',authorization_sha256:'1'.repeat(64),
    witness_sha256:'2'.repeat(64),execution_sha256:'3'.repeat(64),pre_runtime_version:'6.13.0',
    post_runtime_version:'6.14.0',test_patch_sha256:'4'.repeat(64),patch_sha256:'5'.repeat(64),
    base_manifest_sha256:'6'.repeat(64),red_manifest_sha256:'7'.repeat(64),post_manifest_sha256:'8'.repeat(64),
    test_changed_paths:['runtime/a.test.js'],changed_paths:['runtime/a.js'],review_report_refs:[],
    first_red_slice_id:'SLICE-001',first_red_verification_spec_sha256:'9'.repeat(64),
    completion_operation_id:`op-${'a'.repeat(64)}`});
  assert.equal(completion.marker.bootstrap_receipt_sha256,completion.receipt.receipt_sha256);
  assert.equal(completion.receipt.completion_operation_id,completion.marker.completion_operation_id);
  assert.match(completion.marker.marker_sha256,/^[0-9a-f]{64}$/);
});
