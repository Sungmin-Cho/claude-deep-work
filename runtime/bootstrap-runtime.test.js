'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const platform=require('./platform.js');
const {dispatch}=require('../scripts/deep-work-runtime.js');
let bootstrapRuntime={};
try{
  bootstrapRuntime=require('./bootstrap-runtime.js');
}catch(error){
  if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'./bootstrap-runtime.js'"))throw error;
}
const {
  BOOTSTRAP_CONTROL_NAMES,
  BOOTSTRAP_EXECUTION_STAGES,
  BOOTSTRAP_REJECTION_CODES,
  BOOTSTRAP_VERIFICATION_RESULT_KEYS,
  BOOTSTRAP_RED_PROOF_KEYS,
  bootstrapManifestSchemaSha256,
  bootstrapCommandArgvSha256,
  normalizeNodeTestBootstrapStdout,
  classifyBootstrapObservedCommandResult,
  validateBootstrapObservedCommandResult,
  validateBootstrapFailureArtifact,
  validateBootstrapManifest,
  validateBootstrapWitness,
  validateBootstrapAuthorization,
  validateBootstrapExecutionJournal,
  validateBootstrapExecutionJournalTransition,
  validateBootstrapVerificationResultV2,
  validateBootstrapRedProofV1,
  validateBootstrapCompletionAuthority,
  publishBootstrapFailure,
  abortBootstrap,
  finalizeBootstrap,
  runBootstrapFirstRed,
  adoptBootstrapRed,
  publishBootstrapRedProof,
  canonicalBootstrapJson,
  BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256,
  precomputeBootstrapCompletion,
}=bootstrapRuntime;
const {canonicalJson}=require('./operation-journal.js');
const journalRuntime=require('./operation-journal.js');
const {beginScopedWrite,acceptScopedWrite}=require('./slice-runtime.js');
const {deriveScopedWriteAuthority,compileImmutablePlanAuthorityV2}=require('./plan-runtime.js');
const {compileVerificationPlan}=require('./verification-policy-runtime.js');
const {updateFrontmatterText,parseFrontmatter}=require('./frontmatter.js');
const transaction=require('./transaction-runtime.js');

const digest=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const NODE_PATH='/opt/homebrew/Cellar/node/26.0.0/bin/node';
const WORKTREE=process.cwd();
const EMPTY_SHA256=digest(Buffer.alloc(0));
const semantic=(label,value,key)=>{
  const copy=structuredClone(value);delete copy[key];
  return digest(Buffer.concat([Buffer.from(`${label}\0`),Buffer.from(canonicalJson(copy))]));
};

function specOutput({root=WORKTREE,name='bootstrap contract',duration='1.25',status='✔',pass=1,fail=0,
  testPath='runtime/a.test.js',moduleLoad=false,opaqueLine=null}={}){
  let prelude=moduleLoad?`Error: Cannot find module ./bootstrap-runtime.js\nRequire stack:\n- ${root}/${testPath}\n`+
    `    at Example (${root}/${testPath}:1:2) {\n  requireStack: [\n    '${root}/${testPath}'\n  ]\n}\n`:
    `    at Example (${root}/${testPath}:1:2)\n`;
  if(opaqueLine!==null)prelude+=`${opaqueLine}\n`;
  const details=fail===0?'':`\n✖ failing tests:\n\ntest at ${testPath}:1:2\n`+
    `✖ ${name} (${duration}ms)\n  Error: expected failure\n`;
  return Buffer.from(prelude+`${status} ${name} (${duration}ms)\n`+
    `ℹ tests ${pass+fail}\nℹ suites 0\nℹ pass ${pass}\nℹ fail ${fail}\nℹ cancelled 0\n`+
    `ℹ skipped 0\nℹ todo 0\nℹ duration_ms ${duration}\n${details}`);
}

const normalizationContext=(root=WORKTREE)=>({worktreeRoot:root,nodeIdentity:witness().node_identity,
  reporter:'spec',argv:witness().red_argv});

function fixtureBootstrapExcludedPaths(){
  return [
    ...BOOTSTRAP_CONTROL_NAMES.map((name)=>`.deep-work/s-aaaaaaaa/bootstrap/${name}`),
    '.claude/deep-work.s-aaaaaaaa.bootstrap-control.lock',
    '.claude/deep-work.s-aaaaaaaa.bootstrap-control.lock.claims',
    '.claude/deep-work.s-aaaaaaaa.completed-operations.json',
    '.claude/deep-work.s-aaaaaaaa.operations.lock',
    '.claude/deep-work.s-aaaaaaaa.operations.lock.claims',
  ].sort();
}

function manifest(phase='base'){
  const value={schema_version:1,repository_identity_sha256:'1'.repeat(64),base_head_oid:'2'.repeat(40),phase,
    excluded_paths:fixtureBootstrapExcludedPaths(),
    entries:[{path:'runtime/a.js',type:'file',mode:'33188',size:1,sha256:'3'.repeat(64)}]};
  value.manifest_sha256=semantic('bootstrap-manifest-v1',value,'manifest_sha256');
  return value;
}

function witness(overrides={}){
  const value={schema_version:1,target_session_id:'s-aaaaaaaa',repository_identity_sha256:'1'.repeat(64),
    base_head_oid:'2'.repeat(40),spec_approved_hash:'3'.repeat(64),runtime_version:'6.13.0',
    node_identity:{path:NODE_PATH,version:'26.0.0',sha256:'4'.repeat(64),dev:'1',ino:'2',mode:'33261',
      size:'3',mtime_ns:'4'},
    route_preflight_sha256:'5'.repeat(64),bootstrap_manifest_schema_sha256:bootstrapManifestSchemaSha256('s-aaaaaaaa'),
    base_manifest_sha256:'6'.repeat(64),executor_path:'.deep-work/s-aaaaaaaa/bootstrap/executor.mjs',
    executor_sha256:'7'.repeat(64),test_patch_path:'.deep-work/s-aaaaaaaa/bootstrap/test.patch',
    test_patch_sha256:'8'.repeat(64),test_reverse_patch_path:'.deep-work/s-aaaaaaaa/bootstrap/test-reverse.patch',
    test_reverse_patch_sha256:'9'.repeat(64),red_manifest_sha256:'a'.repeat(64),
    test_changed_paths:['runtime/a.test.js'],patch_path:'.deep-work/s-aaaaaaaa/bootstrap/patch.diff',
    patch_sha256:'b'.repeat(64),reverse_patch_path:'.deep-work/s-aaaaaaaa/bootstrap/reverse.patch',
    reverse_patch_sha256:'c'.repeat(64),expected_post_manifest_sha256:'d'.repeat(64),
    changed_paths:['runtime/a.js'],
    red_argv:[NODE_PATH,'--test','--test-reporter=spec','runtime/a.test.js'],
    green_argv:[NODE_PATH,'--test','--test-reporter=spec','runtime/a.test.js'],
    expected_red_result:{argv_sha256:bootstrapCommandArgvSha256(
      [NODE_PATH,'--test','--test-reporter=spec','runtime/a.test.js']),
    input_manifest_sha256:'a'.repeat(64),exit_code:1,signal:null,timed_out:false,output_overflow:false,
    stdout_semantic_sha256:'f'.repeat(64),stderr_sha256:EMPTY_SHA256},
    expected_green_result:{argv_sha256:bootstrapCommandArgvSha256(
      [NODE_PATH,'--test','--test-reporter=spec','runtime/a.test.js']),
    input_manifest_sha256:'d'.repeat(64),exit_code:0,signal:null,timed_out:false,output_overflow:false,
    stdout_semantic_sha256:'1'.repeat(64),stderr_sha256:EMPTY_SHA256},
    first_red_slice_id:'SLICE-001',first_red_verification_spec_sha256:'2'.repeat(64),...overrides};
  value.witness_sha256=semantic('bootstrap-witness-v1',value,'witness_sha256');
  return value;
}

test('bootstrap manifest has one exact control exclusion schema and rejects widening',()=>{
  assert.equal(BOOTSTRAP_CONTROL_NAMES.length,17);
  const checked=validateBootstrapManifest(manifest(),{sessionId:'s-aaaaaaaa'});
  assert.equal(checked.excluded_paths.length,22);
  assert.equal(checked.excluded_paths.includes(
    '.claude/deep-work.s-aaaaaaaa.bootstrap-control.lock'),true);
  assert.equal(checked.excluded_paths.includes(
    '.claude/deep-work.s-aaaaaaaa.bootstrap-control.lock.claims'),true);
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

test('node spec bootstrap normalization binds the complete stream but erases only root and timing',()=>{
  const first=normalizeNodeTestBootstrapStdout(specOutput({duration:'1.25'}),normalizationContext());
  const alternate=normalizeNodeTestBootstrapStdout(
    specOutput({root:'/private/tmp/isolated-bootstrap',duration:'999.5'}),
    normalizationContext('/private/tmp/isolated-bootstrap'));
  assert.equal(first.stdout_semantic_sha256,alternate.stdout_semantic_sha256);
  assert.equal(first.semantic.normalized_stdout_sha256,alternate.semantic.normalized_stdout_sha256);
  const changed=normalizeNodeTestBootstrapStdout(
    specOutput({name:'same counts, different identity'}),normalizationContext());
  assert.notEqual(first.stdout_semantic_sha256,changed.stdout_semantic_sha256);
  assert.deepEqual(first.semantic,{schema_version:1,normalized_stdout_sha256:first.semantic.normalized_stdout_sha256,
    tests:1,pass:1,fail:0,skipped:0});
});

test('normalizer closes reserved roots, module contexts, timing, summaries and failure details',()=>{
  const context=normalizationContext();
  assert.throws(()=>normalizeNodeTestBootstrapStdout(Buffer.from([0xff]),context),/stdout-invalid-utf8/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(Buffer.from(specOutput().toString().replaceAll('\n','\r\n')),
    context),/stdout-crlf/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(specOutput({root:'/outside-root'}),context),
    /stdout-out-of-root-location/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(
    Buffer.from(specOutput().toString().replace('(1.25ms)','(01.25ms)')),context),/stdout-malformed-timing/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(Buffer.from('✔ incomplete (1ms)\n'),context),
    /stdout-malformed-summary/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(
    Buffer.from(specOutput().toString().replace('ℹ tests 1','ℹ tests 2')),context),/stdout-count-invalid/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(
    Buffer.from(specOutput().toString().replace('bootstrap contract','<worktree>/bootstrap contract')),context),
  /stdout-reserved-root-token/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(
    Buffer.from(specOutput({moduleLoad:true}).toString().replace(`- ${WORKTREE}/runtime/a.test.js\n`,'')),context),
  /stdout-malformed-location-context/);
  assert.throws(()=>normalizeNodeTestBootstrapStdout(
    Buffer.from(specOutput({status:'✖',pass:0,fail:1}).toString().replace('✖ failing tests:','✖ failures:')),
    context),/stdout-malformed-failure-detail/);
  const opaque=normalizeNodeTestBootstrapStdout(
    specOutput({opaqueLine:'  Error: command --state /tmp/state expected /bootstrap-proof-required/'}),context);
  assert.notEqual(opaque.stdout_semantic_sha256,
    normalizeNodeTestBootstrapStdout(specOutput(),context).stdout_semantic_sha256);
});

function observed(overrides={}){
  const bound=witness();
  return {
    argv:bound.red_argv,input_manifest_sha256:bound.red_manifest_sha256,exit_code:1,signal:null,
    timed_out:false,output_overflow:false,spawn_failed:false,stdout:specOutput({status:'✖',pass:0,fail:1}),
    stderr:Buffer.alloc(0),...overrides,
  };
}

test('observed command result uses a closed normalized/rejected union and exact precedence',()=>{
  assert.deepEqual(BOOTSTRAP_REJECTION_CODES,[
    'spawn-failed','output-overflow','timed-out','signaled','stdout-invalid-utf8','stdout-crlf',
    'stdout-reserved-root-token','stdout-out-of-root-location','stdout-malformed-location-context',
    'stdout-malformed-timing','stdout-malformed-summary','stdout-count-invalid','stdout-malformed-failure-detail']);
  const normalized=classifyBootstrapObservedCommandResult(observed(),{
    worktreeRoot:WORKTREE,nodeIdentity:witness().node_identity});
  assert.equal(normalized.result_kind,'normalized');
  assert.equal(normalized.argv_sha256,bootstrapCommandArgvSha256(witness().red_argv));
  assert.equal(validateBootstrapObservedCommandResult(normalized,{
    argv:witness().red_argv,inputManifestSha256:witness().red_manifest_sha256,
    worktreeRoot:WORKTREE,nodeIdentity:witness().node_identity}).result_kind,'normalized');
  const rejected=classifyBootstrapObservedCommandResult(observed({
    output_overflow:true,timed_out:true,signal:'SIGKILL',stdout:Buffer.from([0xff])}),{
    worktreeRoot:WORKTREE,nodeIdentity:witness().node_identity});
  assert.equal(rejected.result_kind,'rejected');
  assert.equal(rejected.rejection_code,'output-overflow');
  assert.equal(rejected.stdout_semantic_sha256,null);
  const forged=structuredClone(rejected);forged.stdout_base64=Buffer.from('tampered').toString('base64');
  assert.throws(()=>validateBootstrapObservedCommandResult(forged,{
    argv:witness().red_argv,inputManifestSha256:witness().red_manifest_sha256,
    worktreeRoot:WORKTREE,nodeIdentity:witness().node_identity}),/bootstrap-command-raw/);
});

test('failure artifact durably carries rejected raw command bytes and rejects replay under another manifest',()=>{
  const bound=witness();
  const command_result=classifyBootstrapObservedCommandResult(observed({stdout:Buffer.from([0xff])}),{
    worktreeRoot:WORKTREE,nodeIdentity:bound.node_identity});
  const failure={schema_version:1,target_session_id:bound.target_session_id,
    authorization_sha256:'1'.repeat(64),witness_sha256:bound.witness_sha256,executor_sha256:bound.executor_sha256,
    node_identity:bound.node_identity,execution_journal_sha256:'2'.repeat(64),observed_stage:'test-patch-applied',
    observed_manifest_sha256:bound.red_manifest_sha256,error_kind:'command',command_result};
  assert.equal(validateBootstrapFailureArtifact(failure,{witness:bound,worktreeRoot:WORKTREE}).error_kind,'command');
  const replay=structuredClone(failure);replay.command_result.input_manifest_sha256='0'.repeat(64);
  assert.throws(()=>validateBootstrapFailureArtifact(replay,{witness:bound,worktreeRoot:WORKTREE}),
    /bootstrap-command-binding/);
  const noncommand=structuredClone(failure);noncommand.error_kind='patch';noncommand.command_result=null;
  assert.equal(validateBootstrapFailureArtifact(noncommand,{witness:bound,worktreeRoot:WORKTREE}).command_result,null);
  const undeclared=structuredClone(noncommand);undeclared.observed_stage='caller-selected-stage';
  assert.throws(()=>validateBootstrapFailureArtifact(undeclared,{witness:bound,worktreeRoot:WORKTREE}),
    /bootstrap-failure-stage/);
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
  const duplicateIdentity=structuredClone(value);
  duplicateIdentity.review_report_refs[1].reviewer_identity=
    duplicateIdentity.review_report_refs[0].reviewer_identity;
  duplicateIdentity.authorization_sha256=semantic(
    'bootstrap-authorization-v1',duplicateIdentity,'authorization_sha256');
  assert.throws(()=>validateBootstrapAuthorization(duplicateIdentity),
    /bootstrap-review-(?:identity|witness)/);
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

test('shared execution-journal transition authenticates prior bytes and cannot switch abort/finalize claims',()=>{
  const prior={schema_version:1,target_session_id:'s-aaaaaaaa',authorization_sha256:'1'.repeat(64),
    witness_sha256:'2'.repeat(64),executor_sha256:'3'.repeat(64),node_identity:witness().node_identity,
    stage:'red-command-completed',stage_manifest_sha256:'4'.repeat(64),claim:'none',
    claim_operation_id:null,claim_input:null,journal_sha256:null};
  prior.journal_sha256=semantic('bootstrap-execution-journal-v1',prior,'journal_sha256');
  const failureSha='5'.repeat(64),operationId=`op-${'6'.repeat(64)}`;
  const claimed={...prior,stage:'abort-claimed',claim:'abort',claim_operation_id:operationId,
    claim_input:{kind:'failure',input_journal_sha256:digest(Buffer.from(canonicalJson(prior))),
      input_stage:prior.stage,input_manifest_sha256:prior.stage_manifest_sha256,
      input_artifact_sha256:failureSha},journal_sha256:null};
  claimed.journal_sha256=semantic('bootstrap-execution-journal-v1',claimed,'journal_sha256');
  assert.equal(validateBootstrapExecutionJournalTransition(prior,claimed,{
    priorRawSha256:claimed.claim_input.input_journal_sha256}).claim,'abort');
  const switched={...claimed,claim:'finalize',journal_sha256:null};
  switched.journal_sha256=semantic('bootstrap-execution-journal-v1',switched,'journal_sha256');
  assert.throws(()=>validateBootstrapExecutionJournalTransition(claimed,switched,{
    priorRawSha256:digest(Buffer.from(canonicalJson(claimed)))}),/bootstrap-journal-claim-switch/);
});

function verificationResult(){
  const session='s-aaaaaaaa',operationId=`op-${'1'.repeat(64)}`;
  const environment={mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}};
  const containment={provider:'node-permission-v1',node_patch:'26.0.0',
    worktree_realpath:WORKTREE,owned_temp_realpath:`${WORKTREE}/.deep-work/s-aaaaaaaa/tmp`,
    logical_argv_sha256:'2'.repeat(64),effective_argv_sha256:'3'.repeat(64),
    denied_capabilities:['child-process','native-addon','wasi','worker']};
  const supervisor={platform:'posix',values:{},identities:{}};
  const event={event_type:'test-failure',test_file:'runtime/a.test.js',test_name:'fails first',
    start_line:1,error_code:'ERR_ASSERTION',error_name:'AssertionError',failure_type:'testCodeFailure',
    operator:'strictEqual',expected_digest:'4'.repeat(64),actual_digest:'5'.repeat(64),message:'expected first'};
  const signal={kind:'assertion',operator:'strictEqual',
    test_identity:{test_file:'runtime/a.test.js',test_name:'fails first',start_line:1},
    expected_digest:event.expected_digest,actual_digest:event.actual_digest,message:'expected first'};
  const classification={adapter:'node-test-tap',adapter_version:1,observed_class:'expected-failure',
    diagnostic_event:event,diagnostic_event_sha256:semantic('diagnostic-event-v1',event,null),
    normalized_signal:signal,reason_code:'signal-matched'};
  const value={schema_version:2,session_id:session,slice_id:'SLICE-001',
    plan_authority_sha256:'6'.repeat(64),spec_sha256:'7'.repeat(64),
    verification_plan_sha256:'8'.repeat(64),write_operation_id:`op-${'9'.repeat(64)}`,
    verification_operation_id:operationId,
    result_path:`.claude/deep-work.${session}.verification.${operationId}.json`,
    executable_identity:{path:NODE_PATH,sha256:'a'.repeat(64),dev:'1',ino:'2',mode:'33261',size:'3',
      mtime_ns:'4',node_version:'26.0.0'},
    logical_argv:['--test','--test-reporter=tap','--','runtime/a.test.js'],
    normalized_argv:['--no-warnings','--permission',`--allow-fs-read=${WORKTREE}`,
      `--allow-fs-write=${containment.owned_temp_realpath}`,'--test','--test-isolation=none',
      '--test-reporter=tap','--','runtime/a.test.js'],cwd_role:'worktree',environment,
    environment_sha256:semantic('node-test-env-v1',environment,null),execution_containment:containment,
    execution_containment_sha256:semantic('execution-containment-v1',containment,null),
    supervisor_control:supervisor,supervisor_control_sha256:semantic('supervisor-control-v1',supervisor,null),
    process:{exit_code:1,signal:null,timed_out:false,output_overflow:false,duration_ms:1,spawn_error:null},
    raw_stdout:{base64:'',byte_length:0,sha256:EMPTY_SHA256},
    raw_stderr:{base64:'',byte_length:0,sha256:EMPTY_SHA256},
    pre_manifest_ref:{path:`.claude/deep-work.${session}.verification-manifest.${operationId}.pre.json`,
      sha256:'b'.repeat(64)},
    post_manifest_ref:{path:`.claude/deep-work.${session}.verification-manifest.${operationId}.post.json`,
      sha256:'c'.repeat(64)},changed_paths:[],scope_disposition:'clean',classification,
    disposition:'accepted',result_sha256:null};
  value.result_sha256=semantic('verification-result-v2',value,'result_sha256');
  return value;
}

test('bootstrap first-RED consumes the closed VerificationResultV2 union, not output substring prose',()=>{
  assert.deepEqual(BOOTSTRAP_VERIFICATION_RESULT_KEYS,Object.keys(verificationResult()).sort());
  const value=verificationResult();
  assert.equal(validateBootstrapVerificationResultV2(value,{
    expectedSignal:value.classification.normalized_signal}).disposition,'accepted');
  const sideEffect=structuredClone(value);sideEffect.changed_paths=['runtime/a.js'];
  sideEffect.scope_disposition='clean';
  sideEffect.result_sha256=semantic('verification-result-v2',sideEffect,'result_sha256');
  assert.throws(()=>validateBootstrapVerificationResultV2(sideEffect,{
    expectedSignal:value.classification.normalized_signal}),/bootstrap-verification-scope/);
  const prose=structuredClone(value);prose.classification.normalized_signal.message='some expected text only';
  prose.result_sha256=semantic('verification-result-v2',prose,'result_sha256');
  assert.throws(()=>validateBootstrapVerificationResultV2(prose,{
    expectedSignal:value.classification.normalized_signal}),/bootstrap-verification-signal/);
});

test('canonical RedProofV1 binds bootstrap adoption, verified result and completed proof producer',()=>{
  const value={schema_version:1,session_id:'s-aaaaaaaa',slice_id:'SLICE-001',
    plan_authority_sha256:'1'.repeat(64),spec_sha256:'2'.repeat(64),spec_approved_hash:'3'.repeat(64),
    verification_plan_sha256:'4'.repeat(64),write_operation_id:`op-${'5'.repeat(64)}`,
    write_receipt_sha256:'6'.repeat(64),verification_operation_id:`op-${'7'.repeat(64)}`,
    verification_result_sha256:'8'.repeat(64),verification_ledger_result_sha256:'9'.repeat(64),
    transition_kind:'bootstrap-adoption',transition_operation_id:`op-${'a'.repeat(64)}`,
    transition_ledger_result_sha256:'b'.repeat(64),bootstrap_bridge_operation_id:`op-${'c'.repeat(64)}`,
    proof_operation_id:`op-${'d'.repeat(64)}`,classification_digest:'e'.repeat(64),proof_sha256:null};
  value.proof_sha256=semantic('red-proof-v1',value,'proof_sha256');
  assert.deepEqual(BOOTSTRAP_RED_PROOF_KEYS,Object.keys(value).sort());
  assert.equal(validateBootstrapRedProofV1(value).proof_sha256,value.proof_sha256);
  const swapped=structuredClone(value);swapped.transition_kind='ordinary';
  swapped.proof_sha256=semantic('red-proof-v1',swapped,'proof_sha256');
  assert.throws(()=>validateBootstrapRedProofV1(swapped),/bootstrap-red-proof-transition/);
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
  const operationReceipt={operationId:completion.receipt.completion_operation_id,
    kind:'bootstrap-finalize',stage:'completed-ledger',result:{
      target_session_id:'s-aaaaaaaa',
      receipt_path:'.deep-work/s-aaaaaaaa/bootstrap/bootstrap-receipt.json',
      receipt_sha256:completion.receipt.receipt_sha256,
      marker_path:'.deep-work/s-aaaaaaaa/bootstrap/marker.json',
      marker_sha256:completion.marker.marker_sha256}};
  assert.equal(validateBootstrapCompletionAuthority({
    receipt:completion.receipt,marker:completion.marker,operationReceipt}).receipt.receipt_sha256,
  completion.receipt.receipt_sha256);
  const forged=structuredClone(operationReceipt);forged.result.receipt_sha256='0'.repeat(64);
  assert.throws(()=>validateBootstrapCompletionAuthority({
    receipt:completion.receipt,marker:completion.marker,operationReceipt:forged}),
  /bootstrap-completion-producer/);
});

test('post-patch failure publication and abort are public production functions',()=>{
  assert.equal(typeof publishBootstrapFailure,'function');
  assert.equal(typeof abortBootstrap,'function');
});

function bootstrapAuthorization(bound=witness(),reviewReportRefs=null){
  const review_report_refs=reviewReportRefs||['structural','semantic','executability'].map((role,index)=>({
    role,path:`.deep-work/s-aaaaaaaa/bootstrap/patch-review-${role}.json`,
    sha256:String(index+3).repeat(64).slice(0,64),reviewer_identity:`reviewer:${role}`,
    witness_sha256:bound.witness_sha256,verdict:'APPROVE'}));
  const value={schema_version:1,witness:bound,human_ack:{actor:'human',
    at:'2026-07-23T00:00:00.000Z',scope:'one-shot-bootstrap',
    witness_sha256:bound.witness_sha256},review_report_refs};
  value.authorization_sha256=semantic('bootstrap-authorization-v1',value,'authorization_sha256');
  return value;
}

function bootstrapReviewReport(role,witnessSha256){
  const value={schema_version:1,role,reviewer_identity:`reviewer:${role}`,
    witness_sha256:witnessSha256,verdict:'APPROVE',findings:[],report_sha256:null};
  value.report_sha256=semantic('bootstrap-patch-review-v1',value,'report_sha256');
  return value;
}

function bootstrapJournal({authorization=bootstrapAuthorization(),stage='green-command-completed',
  manifestSha=authorization.witness.expected_post_manifest_sha256,claim='none',
  claimOperationId=null,claimInput=null}={}){
  const value={schema_version:1,target_session_id:'s-aaaaaaaa',
    authorization_sha256:authorization.authorization_sha256,
    witness_sha256:authorization.witness.witness_sha256,
    executor_sha256:authorization.witness.executor_sha256,
    node_identity:authorization.witness.node_identity,stage,stage_manifest_sha256:manifestSha,
    claim,claim_operation_id:claimOperationId,claim_input:claimInput,journal_sha256:null};
  value.journal_sha256=semantic('bootstrap-execution-journal-v1',value,'journal_sha256');
  return value;
}

function bootstrapExecution(journal,authorization=bootstrapAuthorization()){
  const bound=authorization.witness;
  const value={schema_version:1,authorization_sha256:authorization.authorization_sha256,
    witness_sha256:bound.witness_sha256,executor_sha256:bound.executor_sha256,
    execution_journal_sha256:journal.journal_sha256,
    base_manifest_sha256:bound.base_manifest_sha256,test_patch_sha256:bound.test_patch_sha256,
    red_manifest_sha256:bound.red_manifest_sha256,red_result:bound.expected_red_result,
    patch_sha256:bound.patch_sha256,post_patch_manifest_sha256:bound.expected_post_manifest_sha256,
    green_result:bound.expected_green_result,test_changed_paths:bound.test_changed_paths,
    changed_paths:bound.changed_paths,execution_sha256:null};
  value.execution_sha256=semantic('bootstrap-execution-v1',value,'execution_sha256');
  return value;
}

function writeBootstrapCanonical(file,value){
  const bytes=Buffer.from(canonicalJson(value));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,bytes);
  return {bytes,sha256:digest(bytes)};
}

function nodeIdentity(){
  const executable=fs.realpathSync(process.execPath);
  const stat=fs.statSync(executable,{bigint:true});
  return {path:executable,version:process.versions.node,sha256:digest(fs.readFileSync(executable)),
    dev:String(stat.dev),ino:String(stat.ino),mode:String(stat.mode),size:String(stat.size),
    mtime_ns:String(stat.mtimeNs)};
}

function fixtureManifest(root,phase,repositoryIdentity,baseHead){
  const excluded=new Set(fixtureBootstrapExcludedPaths());
  const entries=[];
  const walk=(directory,relativeRoot='')=>{
    for(const name of fs.readdirSync(directory)
      .sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)))){
      const relative=relativeRoot?`${relativeRoot}/${name}`:name;
      if(relative==='.git'||excluded.has(relative))continue;
      const file=path.join(directory,name);
      const stat=fs.lstatSync(file);
      if(stat.isDirectory()&&!stat.isSymbolicLink())walk(file,relative);
      else{
        assert.equal(stat.isFile()&&!stat.isSymbolicLink(),true,relative);
        const bytes=fs.readFileSync(file);
        entries.push({path:relative,type:'file',mode:String(stat.mode),size:bytes.length,
          sha256:digest(bytes)});
      }
    }
  };
  walk(root);
  entries.sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
  const value={schema_version:1,repository_identity_sha256:repositoryIdentity,
    base_head_oid:baseHead,phase,
    excluded_paths:fixtureBootstrapExcludedPaths(),
    entries,manifest_sha256:null};
  value.manifest_sha256=semantic('bootstrap-manifest-v1',value,'manifest_sha256');
  return value;
}

function fixtureRepositoryIdentity(root,baseHead){
  const exec=(args)=>require('node:child_process').execFileSync('git',args,{
    cwd:root,encoding:'utf8'}).trim();
  const common=fs.realpathSync(path.resolve(root,exec(['rev-parse','--git-common-dir'])));
  const worktrees=exec(['worktree','list','--porcelain']).split('\n');
  const repositoryRoot=fs.realpathSync(worktrees.find((line)=>line.startsWith('worktree '))
    .slice('worktree '.length));
  return digest(Buffer.from(canonicalJson({common_git_dir:common,
    repository_root:repositoryRoot,target_worktree_root:fs.realpathSync(root),
    base_head_oid:baseHead}).replace(/\n$/u,'')));
}

function bootstrapControlFixture({stage='green-command-completed',partialPatch=false,
  firstRedSpecSha256='2'.repeat(64),testSource=null}={}){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-bootstrap-control-')));
  require('node:child_process').execFileSync('git',['init','-q'],{cwd:root});
  require('node:child_process').execFileSync('git',['config','user.email','bootstrap@example.invalid'],{cwd:root});
  require('node:child_process').execFileSync('git',['config','user.name','Bootstrap Fixture'],{cwd:root});
  fs.mkdirSync(path.join(root,'runtime'));fs.mkdirSync(path.join(root,'.claude'));
  fs.writeFileSync(path.join(root,'.gitignore'),'.claude/\n.deep-work/\n');
  fs.writeFileSync(path.join(root,'runtime','a.js'),'module.exports = 1;\n');
  fs.writeFileSync(path.join(root,'runtime','a.test.js'),'// bootstrap base test\n');
  require('node:child_process').execFileSync('git',['add','-A'],{cwd:root});
  require('node:child_process').execFileSync('git',['commit','-qm','base'],{cwd:root});
  const baseHead=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],
    {cwd:root,encoding:'utf8'}).trim();
  const repositoryIdentity=fixtureRepositoryIdentity(root,baseHead);
  const statePath=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(statePath,'---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\n'+
    'current_phase: implement\nactive_slice: SLICE-001\ntdd_state: PENDING\n---\n');
  const baseManifest=fixtureManifest(root,'base',repositoryIdentity,baseHead);
  fs.writeFileSync(path.join(root,'runtime','a.test.js'),testSource||[
    "'use strict';",
    "const test=require('node:test');",
    "const assert=require('node:assert/strict');",
    "test('fails first',()=>assert.strictEqual(1,2,'expected exact authority'));",
    '',
  ].join('\n'));
  const testPatch=require('node:child_process').execFileSync('git',['diff','--binary','--',
    'runtime/a.test.js'],{cwd:root});
  const testReverse=require('node:child_process').execFileSync('git',['diff','--binary','-R','--',
    'runtime/a.test.js'],{cwd:root});
  const redManifest=fixtureManifest(root,'red',repositoryIdentity,baseHead);
  fs.writeFileSync(path.join(root,'runtime','a.js'),'module.exports = 2;\n');
  const patchBytes=require('node:child_process').execFileSync('git',['diff','--binary','--',
    'runtime/a.js'],{cwd:root});
  const reverseBytes=require('node:child_process').execFileSync('git',['diff','--binary','-R','--',
    'runtime/a.js'],{cwd:root});
  const postManifest=fixtureManifest(root,'post',repositoryIdentity,baseHead);
  const control=path.join(root,'.deep-work','s-aaaaaaaa','bootstrap');
  fs.mkdirSync(control,{recursive:true});
  for(const [name,bytes] of [['test.patch',testPatch],['test-reverse.patch',testReverse],
    ['patch.diff',patchBytes],['reverse.patch',reverseBytes]])fs.writeFileSync(path.join(control,name),bytes);
  const executorBytes=Buffer.from('#!/usr/bin/env node\n');
  const bound=witness({repository_identity_sha256:repositoryIdentity,base_head_oid:baseHead,
    node_identity:nodeIdentity(),base_manifest_sha256:baseManifest.manifest_sha256,
    executor_sha256:digest(executorBytes),
    test_patch_sha256:digest(testPatch),test_reverse_patch_sha256:digest(testReverse),
    red_manifest_sha256:redManifest.manifest_sha256,patch_sha256:digest(patchBytes),
    reverse_patch_sha256:digest(reverseBytes),expected_post_manifest_sha256:postManifest.manifest_sha256,
    expected_red_result:{...witness().expected_red_result,
      argv_sha256:bootstrapCommandArgvSha256([nodeIdentity().path,'--test','--test-reporter=spec',
        'runtime/a.test.js']),input_manifest_sha256:redManifest.manifest_sha256},
    expected_green_result:{...witness().expected_green_result,
      argv_sha256:bootstrapCommandArgvSha256([nodeIdentity().path,'--test','--test-reporter=spec',
        'runtime/a.test.js']),input_manifest_sha256:postManifest.manifest_sha256},
    red_argv:[nodeIdentity().path,'--test','--test-reporter=spec','runtime/a.test.js'],
    green_argv:[nodeIdentity().path,'--test','--test-reporter=spec','runtime/a.test.js'],
    first_red_verification_spec_sha256:firstRedSpecSha256});
  const reviewReports=['structural','semantic','executability'].map((role)=>{
    const value=bootstrapReviewReport(role,bound.witness_sha256);
    const bytes=Buffer.from(canonicalJson(value));
    const relative=`.deep-work/s-aaaaaaaa/bootstrap/patch-review-${role}.json`;
    return {value,bytes,ref:{role,path:relative,sha256:digest(bytes),
      reviewer_identity:value.reviewer_identity,witness_sha256:value.witness_sha256,
      verdict:value.verdict}};
  });
  const authorization=bootstrapAuthorization(bound,reviewReports.map((row)=>row.ref));
  fs.writeFileSync(path.join(control,'executor.mjs'),executorBytes);
  for(const row of reviewReports)
    fs.writeFileSync(path.join(root,...row.ref.path.split('/')),row.bytes);
  const manifestByStage=new Map([
    ['ready',baseManifest.manifest_sha256],['test-patch-started',baseManifest.manifest_sha256],
    ['test-patch-applied',redManifest.manifest_sha256],['red-command-completed',redManifest.manifest_sha256],
    ['production-patch-started',redManifest.manifest_sha256],
    ['production-patch-applied',postManifest.manifest_sha256],
    ['post-manifest-captured',postManifest.manifest_sha256],
    ['green-command-completed',postManifest.manifest_sha256],
    ['finalize-prepared',postManifest.manifest_sha256],
    ['finalize-authorization-authenticated',postManifest.manifest_sha256],
    ['finalize-execution-authenticated',postManifest.manifest_sha256],
  ]);
  let manifestSha=manifestByStage.get(stage);
  if(partialPatch){
    fs.writeFileSync(path.join(root,'runtime','a.js'),'module.exports = ');
    manifestSha=fixtureManifest(root,'post',repositoryIdentity,baseHead).manifest_sha256;
  }else if(['ready','test-patch-started'].includes(stage)){
    require('node:child_process').execFileSync('git',['checkout','--','runtime/a.js','runtime/a.test.js'],{cwd:root});
  }else if(['test-patch-applied','red-command-completed','production-patch-started'].includes(stage)){
    require('node:child_process').execFileSync('git',['checkout','--','runtime/a.js'],{cwd:root});
  }
  const journal=bootstrapJournal({authorization,stage,manifestSha});
  const execution=bootstrapExecution(journal,authorization);
  const authorizationPath=path.join(control,'authorization.json');
  const journalPath=path.join(control,'execution-journal.json');
  const executionPath=path.join(control,'execution.json');
  writeBootstrapCanonical(authorizationPath,authorization);
  writeBootstrapCanonical(journalPath,journal);
  writeBootstrapCanonical(executionPath,execution);
  return {root,statePath,stateCapability:platform.issueProjectStateCapability(root,statePath,
    {role:'session-state'}),control,authorization,authorizationPath,journal,journalPath,
    execution,executionPath,baseManifest,redManifest,postManifest,reviewReports,executorBytes};
}

function nonCommandFailure(fixture){
  return {schema_version:1,target_session_id:'s-aaaaaaaa',
    authorization_sha256:fixture.authorization.authorization_sha256,
    witness_sha256:fixture.authorization.witness.witness_sha256,
    executor_sha256:fixture.authorization.witness.executor_sha256,
    node_identity:fixture.authorization.witness.node_identity,
    execution_journal_sha256:fixture.journal.journal_sha256,observed_stage:fixture.journal.stage,
    observed_manifest_sha256:fixture.journal.stage_manifest_sha256,error_kind:'patch',
    command_result:null};
}

test('bootstrap semantic artifacts use sorted no-LF bytes while retaining exact executor bytes',()=>{
  assert.equal(typeof canonicalBootstrapJson,'function');
  const bytes=canonicalBootstrapJson({z:2,a:1});
  assert.equal(Buffer.isBuffer(bytes),true);
  assert.deepEqual(bytes,Buffer.from('{"a":1,"z":2}'));
  assert.notEqual(bytes.at(-1),0x0a);
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'dw-bootstrap-bytes-')),'artifact.json');
  fs.writeFileSync(file,bytes);
  assert.deepEqual(fs.readFileSync(file),bytes);
});

test('public failure publication adopts matching EEXIST and fences conflicting bytes',async(t)=>{
  const matching=bootstrapControlFixture({stage:'red-command-completed'});
  t.after(()=>fs.rmSync(matching.root,{recursive:true,force:true}));
  const failurePath=path.join(matching.control,'failure.json');
  const failure=nonCommandFailure(matching);
  writeBootstrapCanonical(failurePath,failure);
  const route=(fixture,name,failure)=>dispatch(['bootstrap',name,'--state',fixture.statePath,
    '--authorization',fixture.authorizationPath,'--failure',failure],{cwd:fixture.root});
  const first=await route(matching,'failure-publish',failurePath);
  const firstBytes=fs.readFileSync(failurePath);
  const replay=await route(matching,'failure-publish',failurePath);
  assert.equal(replay.operationId||replay.operation_id,first.operationId||first.operation_id);
  assert.deepEqual(fs.readFileSync(failurePath),firstBytes);

  const conflicting=bootstrapControlFixture({stage:'red-command-completed'});
  t.after(()=>fs.rmSync(conflicting.root,{recursive:true,force:true}));
  const conflictingPath=path.join(conflicting.control,'failure.json');
  fs.mkdirSync(path.dirname(conflictingPath),{recursive:true});
  fs.writeFileSync(conflictingPath,Buffer.from('{"foreign":true}'));
  const fenced=await route(conflicting,'failure-publish',conflictingPath);
  assert.equal(fenced.status,'recovery-required');
  assert.equal(fs.existsSync(path.join(conflicting.control,'recovery-required.json')),true);
  assert.deepEqual(fs.readFileSync(conflictingPath),Buffer.from('{"foreign":true}'));
});

test('public failure publication reauthenticates normalized and every rejected raw-channel arm',async(t)=>{
  const cases=[
    ['spawn-failed',{exit_code:null,spawn_failed:true,stdout:Buffer.alloc(0)}],
    ['output-overflow',{output_overflow:true,stdout:Buffer.from('x'.repeat(128))}],
    ['timed-out',{timed_out:true,stdout:Buffer.from('partial')}],
    ['signaled',{exit_code:null,signal:'SIGTERM',stdout:Buffer.from('partial')}],
    ['stdout-invalid-utf8',{stdout:Buffer.from([0xff])}],
    ['stdout-crlf',{stdout:(root)=>Buffer.from(specOutput({root}).toString().replaceAll('\n','\r\n'))}],
    ['stdout-reserved-root-token',{stdout:(root)=>Buffer.from(specOutput({root}).toString()
      .replace('bootstrap contract','<worktree>/bootstrap contract'))}],
    ['stdout-out-of-root-location',{stdout:()=>specOutput({root:'/outside-bootstrap-root'})}],
    ['stdout-malformed-location-context',{stdout:(root)=>Buffer.from(
      specOutput({root,moduleLoad:true}).toString().replace('  ]\n',''))}],
    ['stdout-malformed-timing',{stdout:(root)=>Buffer.from(
      specOutput({root}).toString().replace('(1.25ms)','(01.25ms)'))}],
    ['stdout-malformed-summary',{stdout:()=>Buffer.from('✔ incomplete (1ms)\n')}],
    ['stdout-count-invalid',{stdout:(root)=>Buffer.from(
      specOutput({root}).toString().replace('ℹ tests 1','ℹ tests 2'))}],
    ['stdout-malformed-failure-detail',{stdout:(root)=>Buffer.from(
      specOutput({root,status:'✖',pass:0,fail:1}).toString()
        .replace('✖ failing tests:','✖ failures:'))}],
  ];
  for(const [code,change] of cases){
    await t.test(code,async()=>{
      const fixture=bootstrapControlFixture({stage:'red-command-completed'});
      t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
      const bound=fixture.authorization.witness;
      const base={argv:bound.red_argv,input_manifest_sha256:bound.red_manifest_sha256,
        exit_code:1,signal:null,timed_out:false,output_overflow:false,spawn_failed:false,
        stdout:specOutput({root:fixture.root,status:'✖',pass:0,fail:1}),stderr:Buffer.alloc(0)};
      const resolved=Object.fromEntries(Object.entries(change).map(([key,value])=>[
        key,typeof value==='function'?value(fixture.root):value]));
      const commandResult=classifyBootstrapObservedCommandResult({...base,...resolved},{
        worktreeRoot:fixture.root,nodeIdentity:bound.node_identity});
      assert.equal(commandResult.result_kind,'rejected');
      assert.equal(commandResult.rejection_code,code);
      const failure={...nonCommandFailure(fixture),error_kind:'command',command_result:commandResult};
      const failurePath=path.join(fixture.control,'failure.json');
      writeBootstrapCanonical(failurePath,failure);
      const argv=['bootstrap','failure-publish','--state',fixture.statePath,'--authorization',
        fixture.authorizationPath,'--failure',failurePath];
      const first=await dispatch(argv,{cwd:fixture.root});
      const bytes=fs.readFileSync(failurePath);
      const replay=await dispatch(argv,{cwd:fixture.root});
      assert.equal(replay.operation_id,first.operation_id);
      assert.deepEqual(fs.readFileSync(failurePath),bytes);
    });
  }
  await t.test('normalized-mismatch',async()=>{
    const fixture=bootstrapControlFixture({stage:'red-command-completed'});
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const bound=fixture.authorization.witness;
    const commandResult=classifyBootstrapObservedCommandResult({argv:bound.red_argv,
      input_manifest_sha256:bound.red_manifest_sha256,exit_code:1,signal:null,timed_out:false,
      output_overflow:false,spawn_failed:false,
      stdout:specOutput({root:fixture.root,status:'✖',pass:0,fail:1}),stderr:Buffer.alloc(0)},{
      worktreeRoot:fixture.root,nodeIdentity:bound.node_identity});
    assert.equal(commandResult.result_kind,'normalized');
    const failurePath=path.join(fixture.control,'failure.json');
    writeBootstrapCanonical(failurePath,{...nonCommandFailure(fixture),error_kind:'command',
      command_result:commandResult});
    const argv=['bootstrap','failure-publish','--state',fixture.statePath,'--authorization',
      fixture.authorizationPath,'--failure',failurePath];
    const first=await dispatch(argv,{cwd:fixture.root});
    assert.equal((await dispatch(argv,{cwd:fixture.root})).operation_id,first.operation_id);
  });
  await t.test('claim-cas-replay',async()=>{
    const fixture=bootstrapControlFixture({stage:'red-command-completed'});
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const failurePath=path.join(fixture.control,'failure.json');
    writeBootstrapCanonical(failurePath,nonCommandFailure(fixture));
    const argv=['bootstrap','failure-publish','--state',fixture.statePath,'--authorization',
      fixture.authorizationPath,'--failure',failurePath];
    const original=transaction.atomicWriteSessionFile;
    let armed=true;
    transaction.atomicWriteSessionFile=(capability,bytes)=>{
      const result=original(capability,bytes);
      if(armed&&capability.path===fixture.journalPath){
        armed=false;throw new Error('crash-after-failure-claim-cas');
      }
      return result;
    };
    try{await assert.rejects(()=>dispatch(argv,{cwd:fixture.root}),
      /crash-after-failure-claim-cas/);}
    finally{transaction.atomicWriteSessionFile=original;}
    assert.equal((await dispatch(argv,{cwd:fixture.root})).status,'abort-claimed');
  });
});

test('public abort covers the exact observed-stage branch table and replays one terminal mutation',async(t)=>{
  const rows=[
    ['test-patch-started','aborted-restored'],
    ['test-patch-applied','aborted-restored'],
    ['red-command-completed','aborted-restored'],
    ['production-patch-started','aborted-restored'],
    ['production-patch-applied','aborted-restored'],
    ['post-manifest-captured','aborted-restored'],
    ['green-command-completed','aborted-restored'],
    ['finalize-prepared','aborted-restored'],
    ['finalize-authorization-authenticated','aborted-restored'],
    ['finalize-execution-authenticated','aborted-restored'],
  ];
  for(const [stage,status] of rows){
    await t.test(stage,async()=>{
      const fixture=bootstrapControlFixture({stage});
      t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
      const failurePath=path.join(fixture.control,'failure.json');
      writeBootstrapCanonical(failurePath,nonCommandFailure(fixture));
      const argv=['bootstrap','abort','--state',fixture.statePath,'--authorization',
        fixture.authorizationPath,'--failure',failurePath];
      const first=await dispatch(argv,{cwd:fixture.root});
      assert.equal(first.status,status);
      const terminal=status==='aborted-restored'?'abort-receipt.json':'recovery-required.json';
      const terminalPath=path.join(fixture.control,terminal);
      const bytes=fs.readFileSync(terminalPath);
      const replay=await dispatch(argv,{cwd:fixture.root});
      assert.equal(replay.operation_id,first.operation_id);
      assert.deepEqual(fs.readFileSync(terminalPath),bytes);
    });
  }
  const partial=bootstrapControlFixture({stage:'production-patch-started',partialPatch:true});
  t.after(()=>fs.rmSync(partial.root,{recursive:true,force:true}));
  const partialFailure=path.join(partial.control,'failure.json');
  writeBootstrapCanonical(partialFailure,nonCommandFailure(partial));
  const result=await dispatch(['bootstrap','abort','--state',partial.statePath,'--authorization',
    partial.authorizationPath,'--failure',partialFailure],{cwd:partial.root});
  assert.equal(result.status,'recovery-required');
  assert.equal(fs.existsSync(path.join(partial.control,'abort-receipt.json')),false);
});

test('public finalizer adopts precompute, marker, receipt, journal and completed-ledger seams',async(t)=>{
  const fixture=bootstrapControlFixture();
  t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
  const argv=['bootstrap','finalize','--state',fixture.statePath,'--authorization',
    fixture.authorizationPath,'--execution',fixture.executionPath];
  const first=await dispatch(argv,{cwd:fixture.root});
  assert.equal(first.operation_receipt.stage,'completed-ledger');
  const markerPath=path.join(fixture.control,'marker.json');
  const receiptPath=path.join(fixture.control,'bootstrap-receipt.json');
  const journalPath=path.join(fixture.control,'execution-journal.json');
  const snapshots=[markerPath,receiptPath,journalPath].map((file)=>fs.readFileSync(file));
  for(const bytes of snapshots)assert.notEqual(bytes.at(-1),0x0a);
  const replay=await dispatch(argv,{cwd:fixture.root});
  assert.equal(replay.operation_id,first.operation_id);
  assert.equal(replay.operation_receipt.stage,'completed-ledger');
  assert.deepEqual([markerPath,receiptPath,journalPath].map((file)=>fs.readFileSync(file)),snapshots);
  assert.equal(replay.receipt_sha256,first.receipt_sha256);
  assert.equal(replay.marker_sha256,first.marker_sha256);
});

test('public finalizer authenticates review reports, executor, patches and current post manifest',async(t)=>{
  const cases=[
    ['missing-review',(fixture)=>fs.unlinkSync(path.join(fixture.control,
      'patch-review-structural.json'))],
    ['executor-bytes',(fixture)=>fs.appendFileSync(path.join(fixture.control,'executor.mjs'),'// changed\n')],
    ['test-patch-bytes',(fixture)=>fs.appendFileSync(path.join(fixture.control,'test.patch'),'changed')],
    ['production-patch-bytes',(fixture)=>fs.appendFileSync(path.join(fixture.control,'patch.diff'),'changed')],
    ['current-post-manifest',(fixture)=>fs.writeFileSync(path.join(fixture.root,'runtime','a.js'),
      'module.exports = 3;\n')],
    ['live-head-drift',(fixture)=>require('node:child_process').execFileSync(
      'git',['commit','--allow-empty','-qm','head drift'],{cwd:fixture.root})],
    ['untracked-addition',(fixture)=>fs.writeFileSync(path.join(fixture.root,'untracked.js'),
      'module.exports = true;\n')],
    ['ignored-addition',(fixture)=>{
      fs.mkdirSync(path.join(fixture.root,'.deep-work','ignored'));
      fs.writeFileSync(path.join(fixture.root,'.deep-work','ignored','addition.js'),
        'module.exports = true;\n');
    }],
    ['runtime-journal-near-miss',(fixture)=>fs.writeFileSync(path.join(fixture.root,'.claude',
      'deep-work.s-aaaaaaaa.op.bootstrap-finalize.not-an-operation.json'),'{}\n')],
    ['tracked-deletion',(fixture)=>fs.unlinkSync(path.join(fixture.root,'runtime','a.js'))],
    ['untracked-symlink',(fixture)=>fs.symlinkSync('runtime/a.js',
      path.join(fixture.root,'untracked-link.js'))],
    ['untracked-hardlink',(fixture)=>fs.linkSync(path.join(fixture.root,'runtime','a.js'),
      path.join(fixture.root,'untracked-hardlink.js'))],
    ['index-only-drift',(fixture)=>{
      const file=path.join(fixture.root,'runtime','a.js');
      fs.writeFileSync(file,'module.exports = 9;\n');
      require('node:child_process').execFileSync('git',['add','runtime/a.js'],{cwd:fixture.root});
      fs.writeFileSync(file,'module.exports = 2;\n');
    }],
    ['assume-unchanged-index-flag',(fixture)=>require('node:child_process').execFileSync(
      'git',['update-index','--assume-unchanged','runtime/a.js'],{cwd:fixture.root})],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const fixture=bootstrapControlFixture();
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    mutate(fixture);
    await assert.rejects(()=>dispatch(['bootstrap','finalize','--state',fixture.statePath,
      '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
    {cwd:fixture.root}),/bootstrap-(?:authorization|authority|manifest|review|executor|patch)/);
  });
});

test('public finalizer treats an unrelated canonical bootstrap operation journal as governed state',
  async(t)=>{
    const fixture=bootstrapControlFixture();
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const operationId=`op-${'a'.repeat(64)}`;
    const createdAt='2026-07-24T00:00:00.000Z';
    const value={version:1,operationId,sessionId:'s-aaaaaaaa',kind:'bootstrap-finalize',
      preconditions:{},stage:'prepared',owned:null,createdAt,
      stages:[{stage:'prepared',at:createdAt}]};
    fs.writeFileSync(path.join(fixture.root,'.claude',
      `deep-work.s-aaaaaaaa.op.bootstrap-finalize.${operationId}.json`),
    Buffer.from(canonicalJson(value)));
    await assert.rejects(()=>dispatch(['bootstrap','finalize','--state',fixture.statePath,
      '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
    {cwd:fixture.root}),/bootstrap-manifest/);
  });

test('public finalizer treats the completed operation ledger as governed state',async(t)=>{
  const fixture=bootstrapControlFixture();
  t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(fixture.root,'.claude',
    'deep-work.s-aaaaaaaa.completed-operations.json'),
  Buffer.from(canonicalJson({version:1,receipts:[]})));
  await assert.rejects(()=>dispatch(['bootstrap','finalize','--state',fixture.statePath,
    '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
  {cwd:fixture.root}),/bootstrap-manifest/);
});

test('public finalizer rejects pollution in the idle operation lock claims directory',async(t)=>{
  const fixture=bootstrapControlFixture();
  t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
  const claims=path.join(fixture.root,'.claude',
    'deep-work.s-aaaaaaaa.operations.lock.claims');
  fs.mkdirSync(claims);
  fs.writeFileSync(path.join(claims,'foreign'),'foreign\n');
  await assert.rejects(()=>dispatch(['bootstrap','finalize','--state',fixture.statePath,
    '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
  {cwd:fixture.root}),/bootstrap-(?:manifest|lock)/);
  });

test('public finalizer rejects structurally incomplete bootstrap operation journals',async(t)=>{
  const cases=[
    ['missing-preconditions',(value)=>{delete value.preconditions;}],
    ['stage-does-not-match-last-row',(value)=>{value.stage='authorization-authenticated';}],
    ['invalid-prepared-row',(value)=>{value.stages[0].extra=true;}],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const fixture=bootstrapControlFixture();
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const operationId=`op-${'b'.repeat(64)}`;
    const createdAt='2026-07-24T00:00:00.000Z';
    const value={version:1,operationId,sessionId:'s-aaaaaaaa',kind:'bootstrap-finalize',
      preconditions:{},stage:'prepared',owned:null,createdAt,
      stages:[{stage:'prepared',at:createdAt}]};
    mutate(value);
    fs.writeFileSync(path.join(fixture.root,'.claude',
      `deep-work.s-aaaaaaaa.op.bootstrap-finalize.${operationId}.json`),
    Buffer.from(canonicalJson(value)));
    await assert.rejects(()=>dispatch(['bootstrap','finalize','--state',fixture.statePath,
      '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
    {cwd:fixture.root}),/bootstrap-manifest-runtime-journal/);
  });
});

test('public finalizer requires exact one-terminal-LF review bytes after complete rebinding',async(t)=>{
  const fixture=bootstrapControlFixture();
  t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
  const report=fixture.reviewReports[0].value;
  const noLf=Buffer.from(canonicalJson(report).replace(/\n$/u,''));
  fs.writeFileSync(path.join(fixture.root,...fixture.reviewReports[0].ref.path.split('/')),noLf);
  const refs=fixture.reviewReports.map((row,index)=>index===0?
    {...row.ref,sha256:digest(noLf)}:row.ref);
  const authorization=bootstrapAuthorization(fixture.authorization.witness,refs);
  const journal=bootstrapJournal({authorization,stage:fixture.journal.stage,
    manifestSha:fixture.journal.stage_manifest_sha256});
  const execution=bootstrapExecution(journal,authorization);
  writeBootstrapCanonical(fixture.authorizationPath,authorization);
  writeBootstrapCanonical(fixture.journalPath,journal);
  writeBootstrapCanonical(fixture.executionPath,execution);
  await assert.rejects(()=>dispatch(['bootstrap','finalize','--state',fixture.statePath,
    '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
  {cwd:fixture.root}),/bootstrap-review-terminal-lf/);
});

test('public finalizer resumes every operation and publication crash seam with one producer',async(t)=>{
  const stages=['authorization-authenticated','execution-authenticated','receipt-precomputed',
    'marker-committed','receipt-published'];
  for(const stage of stages){
    await t.test(stage,async()=>{
      const fixture=bootstrapControlFixture();
      t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
      const argv=['bootstrap','finalize','--state',fixture.statePath,'--authorization',
        fixture.authorizationPath,'--execution',fixture.executionPath];
      const original=journalRuntime.recordOperationStage;
      let armed=true;
      journalRuntime.recordOperationStage=async(...args)=>{
        const result=await original(...args);
        if(armed&&args[1]===stage){armed=false;throw new Error(`crash-after-${stage}`);}
        return result;
      };
      try{await assert.rejects(()=>dispatch(argv,{cwd:fixture.root}),
        new RegExp(`crash-after-${stage}`));}
      finally{journalRuntime.recordOperationStage=original;}
      const resumed=await dispatch(argv,{cwd:fixture.root});
      assert.equal(resumed.operation_receipt.stage,'completed-ledger');
      assert.equal(resumed.operation_receipt.operationId,resumed.operation_id);
      const second=await dispatch(argv,{cwd:fixture.root});
      assert.equal(second.operation_id,resumed.operation_id);
      assert.equal(second.receipt_sha256,resumed.receipt_sha256);
      assert.equal(second.marker_sha256,resumed.marker_sha256);
    });
  }
  await t.test('completed-ledger',async()=>{
    const fixture=bootstrapControlFixture();
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const argv=['bootstrap','finalize','--state',fixture.statePath,'--authorization',
      fixture.authorizationPath,'--execution',fixture.executionPath];
    const original=journalRuntime.completeOperation;
    let armed=true;
    journalRuntime.completeOperation=async(...args)=>{
      const result=await original(...args);
      if(armed){armed=false;throw new Error('crash-after-completed-ledger');}
      return result;
    };
    try{await assert.rejects(()=>dispatch(argv,{cwd:fixture.root}),
      /crash-after-completed-ledger/);}
    finally{journalRuntime.completeOperation=original;}
    assert.equal((await dispatch(argv,{cwd:fixture.root})).operation_receipt.stage,
      'completed-ledger');
  });
  await t.test('claim-cas',async()=>{
    const fixture=bootstrapControlFixture();
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const argv=['bootstrap','finalize','--state',fixture.statePath,'--authorization',
      fixture.authorizationPath,'--execution',fixture.executionPath];
    const original=transaction.atomicWriteSessionFile;
    let armed=true;
    transaction.atomicWriteSessionFile=(capability,bytes)=>{
      const result=original(capability,bytes);
      if(armed&&capability.path===fixture.journalPath){
        armed=false;throw new Error('crash-after-finalize-claim-cas');
      }
      return result;
    };
    try{await assert.rejects(()=>dispatch(argv,{cwd:fixture.root}),
      /crash-after-finalize-claim-cas/);}
    finally{transaction.atomicWriteSessionFile=original;}
    assert.equal((await dispatch(argv,{cwd:fixture.root})).operation_receipt.stage,
      'completed-ledger');
  });
});

test('public abort resumes every restoration and ledger crash seam without a second reverse',async(t)=>{
  const stages=['authorization-authenticated','failure-authenticated',
    'observed-manifest-authenticated','production-reverted','test-reverted',
    'base-restored','abort-receipt-published'];
  for(const stage of stages){
    await t.test(stage,async()=>{
      const fixture=bootstrapControlFixture({stage:'green-command-completed'});
      t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
      const failurePath=path.join(fixture.control,'failure.json');
      writeBootstrapCanonical(failurePath,nonCommandFailure(fixture));
      const argv=['bootstrap','abort','--state',fixture.statePath,'--authorization',
        fixture.authorizationPath,'--failure',failurePath];
      const original=journalRuntime.recordOperationStage;
      let armed=true;
      journalRuntime.recordOperationStage=async(...args)=>{
        const result=await original(...args);
        if(armed&&args[1]===stage){armed=false;throw new Error(`crash-after-${stage}`);}
        return result;
      };
      try{await assert.rejects(()=>dispatch(argv,{cwd:fixture.root}),
        new RegExp(`crash-after-${stage}`));}
      finally{journalRuntime.recordOperationStage=original;}
      const resumed=await dispatch(argv,{cwd:fixture.root});
      assert.equal(resumed.status,'aborted-restored');
      const receiptBytes=fs.readFileSync(path.join(fixture.control,'abort-receipt.json'));
      const replay=await dispatch(argv,{cwd:fixture.root});
      assert.equal(replay.operation_id,resumed.operation_id);
      assert.deepEqual(fs.readFileSync(path.join(fixture.control,'abort-receipt.json')),
        receiptBytes);
      assert.equal(require('node:child_process').execFileSync('git',['diff','--name-only'],
        {cwd:fixture.root,encoding:'utf8'}),'');
    });
  }
  await t.test('completed-ledger',async()=>{
    const fixture=bootstrapControlFixture({stage:'green-command-completed'});
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const failurePath=path.join(fixture.control,'failure.json');
    writeBootstrapCanonical(failurePath,nonCommandFailure(fixture));
    const argv=['bootstrap','abort','--state',fixture.statePath,'--authorization',
      fixture.authorizationPath,'--failure',failurePath];
    const original=journalRuntime.completeOperation;
    let armed=true;
    journalRuntime.completeOperation=async(...args)=>{
      const result=await original(...args);
      if(armed){armed=false;throw new Error('crash-after-abort-ledger');}
      return result;
    };
    try{await assert.rejects(()=>dispatch(argv,{cwd:fixture.root}),
      /crash-after-abort-ledger/);}
    finally{journalRuntime.completeOperation=original;}
    assert.equal((await dispatch(argv,{cwd:fixture.root})).status,'aborted-restored');
  });
});

test('first-RED bridge, adoption and proof are public functions, not validator-only substitutes',()=>{
  for(const fn of [runBootstrapFirstRed,adoptBootstrapRed,publishBootstrapRedProof])
    assert.equal(typeof fn,'function');
});

function exactFirstRedSpec(overrides={}){
  const tapDigest=(value)=>digest(Buffer.concat([
    Buffer.from('tap-value-v1\0'),Buffer.from(`d:${JSON.stringify(value)}`)]));
  const base={schema_version:2,executable:{kind:'node-toolchain',name:'node',
    supported_patches_sha256:BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256},
  args:['--test','--test-reporter=tap','--','runtime/a.test.js'],cwd_role:'worktree',
  timeout_ms:30000,max_output_bytes:262144,
  environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},
  red_failure:{adapter:'node-test-tap',adapter_version:1,expected_class:'expected-failure',
    expected_signal:{kind:'assertion',operator:'strictEqual',
      test_identity:{test_file:'runtime/a.test.js',test_name:'fails first',start_line:4},
      expected_digest:tapDigest(2),actual_digest:tapDigest(1),
      message_pattern:'expected exact authority'}}};
  return {...base,...overrides};
}

async function preparePublicFirstRedCase(t,{spec=exactFirstRedSpec(),testSource=null,
  planAuthorityOverride=null}={}){
  const specBytes=Buffer.from(canonicalJson(spec));
  const specSha256=digest(specBytes);
  const fixture=bootstrapControlFixture({firstRedSpecSha256:specSha256,testSource});
  t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
  await dispatch(['bootstrap','finalize','--state',fixture.statePath,
    '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
  {cwd:fixture.root});
  const work=path.join(fixture.root,'.deep-work','s-aaaaaaaa');
  const planPath=path.join(work,'plan.json');
  const specPath=path.join(fixture.control,'first-red-spec.json');
  fs.writeFileSync(specPath,specBytes);
  const facts={schema_version:1,authority:'reviewed-plan',destructive:false,external_action:false,
    has_backward_compat:true,has_migration:true,host_dependent:true,
    source_requirement_ids:['REQ-001'],source_slice_ids:['SLICE-002']};
  facts.facts_sha256=semantic('capability-facts-v1',facts,'facts_sha256');
  const plan={schema_version:2,replan_epoch:null,contract_binding:{mode:'strict-spec',
    created_by_version:'6.14.0',source_plan_sha256:'1'.repeat(64),
    risk_profile_sha256:'2'.repeat(64),spec_contract:{schema_version:1,
      spec_id:'SPEC-FIRST-RED',spec_sha256:'3'.repeat(64),spec_approved_hash:'4'.repeat(64)}},
  capability_facts:facts,slices:[{id:'SLICE-001',slice_kind:'functional',checked:false,
    scope_schema_version:1,files:['runtime/a.js','runtime/a.test.js'],
    write_scope:{failing_test:['runtime/a.test.js'],production:['runtime/a.js'],refactor:[]},
    verification_spec:spec,verification_spec_sha256:specSha256},
  {id:'SLICE-002',slice_kind:'release-verification',checked:false,scope_schema_version:1,
    files:[],write_scope:{failing_test:[],production:[],refactor:[]},
    verification_scope:['npm test'],release_gate_ids:['GATE-full-relevant-suite'],
    verification_spec:null,verification_spec_sha256:null}]};
  plan.plan_authority_sha256=planAuthorityOverride||
    compileImmutablePlanAuthorityV2(plan).plan_authority_sha256;
  const verificationPlan=compileVerificationPlan({riskProfile:{class:'critical',score:10,
    triggers:['bootstrap']},riskProfileSha256:'2'.repeat(64),
  policySnapshot:{risk_class:'critical',profile:'critical',
    verification_policy:{recommended:'전수 검증 + human gate'}},
  specContract:{schema_version:1,spec_id:'SPEC-FIRST-RED',risk_class:'critical',
    requirements:[{id:'REQ-001',evidence_gate_ids:['GATE-backward-compat']}],
    compatibility:{legacy_inputs:'explicit legacy reads',migration:'explicit migration'},
    failure_modes:[]},specSha256:'3'.repeat(64),
  specApprovedHash:'4'.repeat(64),planProjection:plan,capabilities:{},
  compatibilityFacts:{created_by_version:'6.14.0',spec_policy_required:true}});
  fs.writeFileSync(planPath,Buffer.from(canonicalJson(plan)));
  fs.writeFileSync(fixture.statePath,updateFrontmatterText(
    fs.readFileSync(fixture.statePath,'utf8'),{
      plan_authority_sha256:plan.plan_authority_sha256,
      verification_plan_json:canonicalJson(verificationPlan),
      verification_plan_sha256:verificationPlan.plan_sha256,
      spec_approved_hash:'4'.repeat(64)}));
  const sessionCapability=platform.issueProjectStateCapability(fixture.root,work,
    {role:'session-work-dir',sessionStateCapability:fixture.stateCapability});
  const planCapability=transaction.issueSessionFileCapability({sessionCapability,candidate:planPath,
    allowedBasenames:['plan.json'],role:'locked-plan'});
  const failingBytes=fs.readFileSync(path.join(fixture.root,'runtime','a.test.js'));
  fs.writeFileSync(path.join(fixture.root,'runtime','a.test.js'),'// bootstrap base test\n');
  const scope=deriveScopedWriteAuthority({plan,sliceId:'SLICE-001',writeClass:'failing-test'});
  const begun=await beginScopedWrite({stateCapability:fixture.stateCapability,planCapability,plan,
    sliceId:'SLICE-001',writeClass:'failing-test',expectedScopeSha256:scope.sha256});
  fs.writeFileSync(path.join(fixture.root,'runtime','a.test.js'),failingBytes);
  const accepted=await acceptScopedWrite({stateCapability:fixture.stateCapability,planCapability,plan,
    sliceId:'SLICE-001',operationId:begun.operationId,
    preManifestSha256:begun.preManifestSha256});
  const argv=['bootstrap','first-red','--state',fixture.statePath,'--plan',planPath,
    '--authorization',fixture.authorizationPath,'--receipt',
    path.join(fixture.control,'bootstrap-receipt.json'),'--marker',
    path.join(fixture.control,'marker.json'),'--spec-json',specPath,'--slice','SLICE-001',
    '--write-receipt',begun.receiptCapability.path];
  return {fixture,plan,planPath,planCapability,verificationPlan,begun,accepted,argv};
}

function rebindPreparedPlan(prepared){
  const plan=structuredClone(prepared.plan);
  plan.replan_epoch='9'.repeat(64);
  plan.plan_authority_sha256=compileImmutablePlanAuthorityV2(plan).plan_authority_sha256;
  const verificationPlan=structuredClone(prepared.verificationPlan);
  verificationPlan.plan_authority_sha256=plan.plan_authority_sha256;
  verificationPlan.plan_projection_sha256=digest(Buffer.from(canonicalJson(plan)));
  verificationPlan.slice_verification_specs_sha256=digest(Buffer.from(canonicalJson({
    plan_authority_sha256:verificationPlan.plan_authority_sha256,
    capability_facts:verificationPlan.capability_facts,
    slice_verification_specs:verificationPlan.slice_verification_specs,
  })));
  delete verificationPlan.plan_sha256;
  verificationPlan.plan_sha256=digest(Buffer.from(canonicalJson(verificationPlan)));
  fs.writeFileSync(prepared.planPath,Buffer.from(canonicalJson(plan)));
  fs.writeFileSync(prepared.fixture.statePath,updateFrontmatterText(
    fs.readFileSync(prepared.fixture.statePath,'utf8'),{
      plan_authority_sha256:plan.plan_authority_sha256,
      verification_plan_json:canonicalJson(verificationPlan),
      verification_plan_sha256:verificationPlan.plan_sha256,
    }));
  return {plan,verificationPlan};
}

test('public first-RED recomputes immutable Plan authority and authenticates verification carriers',
  async(t)=>{
    await t.test('caller-selected-plan-authority',async()=>{
      const prepared=await preparePublicFirstRedCase(t,{planAuthorityOverride:'f'.repeat(64)});
      await assert.rejects(()=>dispatch(prepared.argv,{cwd:prepared.fixture.root}),
        /bootstrap-first-red-plan/);
    });
    const mutateVerificationPlan=async(name,mutate)=>{
      await t.test(name,async()=>{
        const prepared=await preparePublicFirstRedCase(t);
        const changed=structuredClone(prepared.verificationPlan);
        mutate(changed);
        changed.slice_verification_specs_sha256=digest(Buffer.from(canonicalJson({
          plan_authority_sha256:changed.plan_authority_sha256,
          capability_facts:changed.capability_facts,
          slice_verification_specs:changed.slice_verification_specs,
        })));
        delete changed.plan_sha256;
        changed.plan_sha256=digest(Buffer.from(canonicalJson(changed)));
        const state=fs.readFileSync(prepared.fixture.statePath,'utf8');
        fs.writeFileSync(prepared.fixture.statePath,updateFrontmatterText(state,{
          verification_plan_json:canonicalJson(changed),
          verification_plan_sha256:changed.plan_sha256,
        }));
        await assert.rejects(()=>dispatch(prepared.argv,{cwd:prepared.fixture.root}),
          /bootstrap-first-red-plan/);
      });
    };
    await mutateVerificationPlan('verification-plan-authority',(plan)=>{
      plan.plan_authority_sha256='e'.repeat(64);
    });
    await mutateVerificationPlan('selected-slice-spec',(plan)=>{
      plan.slice_verification_specs['SLICE-001'].verification_spec_sha256='d'.repeat(64);
    });
  });

test('public adoption and proof reject a stale first-RED producer chain after replan',async(t)=>{
  await t.test('adoption',async()=>{
    const prepared=await preparePublicFirstRedCase(t);
    const bridge=await dispatch(prepared.argv,{cwd:prepared.fixture.root});
    rebindPreparedPlan(prepared);
    await assert.rejects(()=>dispatch(['bootstrap','red-adopt','--state',
      prepared.fixture.statePath,'--plan',prepared.planPath,'--authorization',
      prepared.fixture.authorizationPath,'--receipt',
      path.join(prepared.fixture.control,'bootstrap-receipt.json'),'--marker',
      path.join(prepared.fixture.control,'marker.json'),'--slice','SLICE-001',
      '--bridge-operation-id',bridge.operation_id],{cwd:prepared.fixture.root}),
    /bootstrap-red-adoption-(?:bridge|plan)/);
  });
  await t.test('proof',async()=>{
    const prepared=await preparePublicFirstRedCase(t);
    const bridge=await dispatch(prepared.argv,{cwd:prepared.fixture.root});
    const adoption=await dispatch(['bootstrap','red-adopt','--state',prepared.fixture.statePath,
      '--plan',prepared.planPath,'--authorization',prepared.fixture.authorizationPath,
      '--receipt',path.join(prepared.fixture.control,'bootstrap-receipt.json'),'--marker',
      path.join(prepared.fixture.control,'marker.json'),'--slice','SLICE-001',
      '--bridge-operation-id',bridge.operation_id],{cwd:prepared.fixture.root});
    rebindPreparedPlan(prepared);
    await assert.rejects(()=>dispatch(['bootstrap','proof-publish','--state',
      prepared.fixture.statePath,'--plan',prepared.planPath,'--slice','SLICE-001',
      '--transition-operation-id',adoption.operation_id],{cwd:prepared.fixture.root}),
    /bootstrap-proof-(?:bridge|plan|transition)/);
  });
});

test('public first-RED, adoption, proof and production admission authenticate the complete producer chain',
  async(t)=>{
    assert.match(BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256,/^[0-9a-f]{64}$/);
    const tapDigest=(value)=>digest(Buffer.concat([
      Buffer.from('tap-value-v1\0'),Buffer.from(`d:${JSON.stringify(value)}`)]));
    const spec={schema_version:2,executable:{kind:'node-toolchain',name:'node',
      supported_patches_sha256:BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256},
    args:['--test','--test-reporter=tap','--','runtime/a.test.js'],cwd_role:'worktree',
    timeout_ms:30000,max_output_bytes:262144,
    environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},
    red_failure:{adapter:'node-test-tap',adapter_version:1,expected_class:'expected-failure',
      expected_signal:{kind:'assertion',operator:'strictEqual',
        test_identity:{test_file:'runtime/a.test.js',test_name:'fails first',start_line:4},
        expected_digest:tapDigest(2),actual_digest:tapDigest(1),
        message_pattern:'expected exact authority'}}};
    const specBytes=Buffer.from(canonicalJson(spec));
    const specSha256=digest(specBytes);
    const fixture=bootstrapControlFixture({firstRedSpecSha256:specSha256});
    t.after(()=>fs.rmSync(fixture.root,{recursive:true,force:true}));
    const finalized=await dispatch(['bootstrap','finalize','--state',fixture.statePath,
      '--authorization',fixture.authorizationPath,'--execution',fixture.executionPath],
    {cwd:fixture.root});
    const work=path.join(fixture.root,'.deep-work','s-aaaaaaaa');
    const planPath=path.join(work,'plan.json');
    const specPath=path.join(fixture.control,'first-red-spec.json');
    fs.writeFileSync(specPath,specBytes);
    const facts={schema_version:1,authority:'reviewed-plan',destructive:false,external_action:false,
      has_backward_compat:true,has_migration:true,host_dependent:true,
      source_requirement_ids:['REQ-001'],source_slice_ids:['SLICE-002']};
    facts.facts_sha256=semantic('capability-facts-v1',facts,'facts_sha256');
    const plan={schema_version:2,replan_epoch:null,contract_binding:{mode:'strict-spec',
      created_by_version:'6.14.0',source_plan_sha256:'1'.repeat(64),
      risk_profile_sha256:'2'.repeat(64),spec_contract:{schema_version:1,
        spec_id:'SPEC-FIRST-RED',spec_sha256:'3'.repeat(64),spec_approved_hash:'4'.repeat(64)}},
    capability_facts:facts,slices:[{id:'SLICE-001',slice_kind:'functional',checked:false,
      scope_schema_version:1,files:['runtime/a.js','runtime/a.test.js'],
      write_scope:{failing_test:['runtime/a.test.js'],production:['runtime/a.js'],refactor:[]},
      verification_spec:spec,verification_spec_sha256:specSha256},
    {id:'SLICE-002',slice_kind:'release-verification',checked:false,scope_schema_version:1,
      files:[],write_scope:{failing_test:[],production:[],refactor:[]},
      verification_scope:['npm test'],release_gate_ids:['GATE-full-relevant-suite'],
      verification_spec:null,verification_spec_sha256:null}]};
    plan.plan_authority_sha256=compileImmutablePlanAuthorityV2(plan).plan_authority_sha256;
    const verificationPlan=compileVerificationPlan({riskProfile:{class:'critical',score:10,triggers:['bootstrap']},
      riskProfileSha256:'2'.repeat(64),policySnapshot:{risk_class:'critical',profile:'critical',
        verification_policy:{recommended:'전수 검증 + human gate'}},
      specContract:{schema_version:1,spec_id:'SPEC-FIRST-RED',risk_class:'critical',
        requirements:[{id:'REQ-001',evidence_gate_ids:['GATE-backward-compat']}],
        compatibility:{legacy_inputs:'explicit legacy reads',migration:'explicit migration'},
        failure_modes:[]},specSha256:'3'.repeat(64),
      specApprovedHash:'4'.repeat(64),planProjection:plan,capabilities:{},
      compatibilityFacts:{created_by_version:'6.14.0',spec_policy_required:true}});
    fs.writeFileSync(planPath,Buffer.from(canonicalJson(plan)));
    const stateText=fs.readFileSync(fixture.statePath,'utf8');
    fs.writeFileSync(fixture.statePath,updateFrontmatterText(stateText,{
      plan_authority_sha256:plan.plan_authority_sha256,
      verification_plan_json:canonicalJson(verificationPlan),
      verification_plan_sha256:verificationPlan.plan_sha256,
      spec_approved_hash:'4'.repeat(64)}));
    const sessionCapability=platform.issueProjectStateCapability(fixture.root,work,
      {role:'session-work-dir',sessionStateCapability:fixture.stateCapability});
    const planCapability=transaction.issueSessionFileCapability({sessionCapability,candidate:planPath,
      allowedBasenames:['plan.json'],role:'locked-plan'});
    const failingBytes=fs.readFileSync(path.join(fixture.root,'runtime','a.test.js'));
    fs.writeFileSync(path.join(fixture.root,'runtime','a.test.js'),'// bootstrap base test\n');
    const scope=deriveScopedWriteAuthority({plan,sliceId:'SLICE-001',writeClass:'failing-test'});
    const begun=await beginScopedWrite({stateCapability:fixture.stateCapability,planCapability,plan,
      sliceId:'SLICE-001',writeClass:'failing-test',expectedScopeSha256:scope.sha256});
    fs.writeFileSync(path.join(fixture.root,'runtime','a.test.js'),failingBytes);
    const accepted=await acceptScopedWrite({stateCapability:fixture.stateCapability,planCapability,plan,
      sliceId:'SLICE-001',operationId:begun.operationId,
      preManifestSha256:begun.preManifestSha256});
    assert.equal(accepted.operationReceipt.stage,'completed-ledger');
    const receiptPath=path.join(fixture.control,'bootstrap-receipt.json');
    const markerPath=path.join(fixture.control,'marker.json');
    const bridge=await dispatch(['bootstrap','first-red','--state',fixture.statePath,'--plan',planPath,
      '--authorization',fixture.authorizationPath,'--receipt',receiptPath,'--marker',markerPath,
      '--spec-json',specPath,'--slice','SLICE-001','--write-receipt',
      begun.receiptCapability.path],{cwd:fixture.root});
    assert.equal(bridge.operation_receipt.stage,'completed-ledger');
    assert.match(bridge.verification_result_sha256,/^[0-9a-f]{64}$/);
    const verification=JSON.parse(fs.readFileSync(path.join(fixture.root,
      ...bridge.verification_result_path.split('/')),'utf8'));
    assert.deepEqual(Object.keys(verification).sort(),BOOTSTRAP_VERIFICATION_RESULT_KEYS);
    assert.equal(verification.process.exit_code,1);
    assert.equal(verification.process.signal,null);
    assert.equal(verification.process.timed_out,false);
    assert.equal(verification.process.output_overflow,false);
    assert.equal(verification.raw_stderr.byte_length,0);
    assert.equal(verification.environment_sha256,
      semantic('node-test-env-v1',spec.environment,null));
    assert.equal(verification.verification_plan_sha256,verificationPlan.plan_sha256);
    const productionScope=deriveScopedWriteAuthority({plan,sliceId:'SLICE-001',
      writeClass:'production'});
    const productionArgv=['implement','write','begin','--state',fixture.statePath,'--plan',planPath,
      '--slice','SLICE-001','--class','production','--scope-sha256',productionScope.sha256];
    await assert.rejects(()=>dispatch(productionArgv,{cwd:fixture.root}),/bootstrap-proof-required/);
    const adoption=await dispatch(['bootstrap','red-adopt','--state',fixture.statePath,'--plan',planPath,
      '--authorization',fixture.authorizationPath,'--receipt',receiptPath,'--marker',markerPath,
      '--slice','SLICE-001','--bridge-operation-id',bridge.operation_id],{cwd:fixture.root});
    assert.equal(adoption.operation_receipt.stage,'completed-ledger');
    const expectedAdoptionPreimage={session_id:'s-aaaaaaaa',slice_id:'SLICE-001',
      plan_authority_sha256:plan.plan_authority_sha256,
      bootstrap_bridge_operation_id:bridge.operation_id,
      bootstrap_bridge_ledger_result_sha256:bridge.operation_receipt.resultSha256,
      verification_result_sha256:bridge.verification_result_sha256,
      write_receipt_sha256:bridge.write_receipt_sha256};
    assert.equal(adoption.operation_id,`op-${digest(Buffer.concat([
      Buffer.from('bootstrap-red-adoption-v1\0'),
      Buffer.from(canonicalJson(expectedAdoptionPreimage))]))}`);
    assert.deepEqual(Object.keys(adoption.operation_receipt.result).sort(),[
      'bootstrap_bridge_operation_id','post_state_sha256','slice_id',
      'verification_result_sha256','write_receipt_sha256'].sort());
    assert.deepEqual(adoption.operation_receipt.result,{
      slice_id:'SLICE-001',post_state_sha256:adoption.post_state_sha256,
      verification_result_sha256:bridge.verification_result_sha256,
      write_receipt_sha256:bridge.write_receipt_sha256,
      bootstrap_bridge_operation_id:bridge.operation_id});
    const published=await dispatch(['bootstrap','proof-publish','--state',fixture.statePath,
      '--plan',planPath,'--slice','SLICE-001','--transition-operation-id',adoption.operation_id],
    {cwd:fixture.root});
    assert.equal(published.operation_receipt.stage,'completed-ledger');
    const expectedProofPreimage={session_id:'s-aaaaaaaa',slice_id:'SLICE-001',
      plan_authority_sha256:plan.plan_authority_sha256,transition_kind:'bootstrap-adoption',
      transition_operation_id:adoption.operation_id,
      transition_ledger_result_sha256:adoption.operation_receipt.resultSha256,
      bootstrap_bridge_operation_id:bridge.operation_id};
    assert.equal(published.operation_id,`op-${digest(Buffer.concat([
      Buffer.from('red-proof-publication-v1\0'),
      Buffer.from(canonicalJson(expectedProofPreimage))]))}`);
    assert.deepEqual(Object.keys(published.operation_receipt.result).sort(),[
      'post_state_sha256','proof_sha256','red_proof_ref'].sort());
    assert.deepEqual(published.operation_receipt.result,{
      proof_sha256:published.proof_sha256,red_proof_ref:published.red_proof_ref,
      post_state_sha256:published.post_state_sha256});
    const fields=parseFrontmatter(fs.readFileSync(fixture.statePath,'utf8')).fields;
    assert.equal(fields.red_proof_state,'complete');
    const proofPath=path.join(fixture.root,...fields.red_proof_ref.split('/'));
    const proofBytes=fs.readFileSync(proofPath);
    const proof=JSON.parse(proofBytes);
    assert.deepEqual(Object.keys(proof).sort(),BOOTSTRAP_RED_PROOF_KEYS);
    assert.equal(proof.bootstrap_bridge_operation_id,bridge.operation_id);
    assert.equal(proof.transition_operation_id,adoption.operation_id);
    assert.equal(proof.proof_operation_id,published.operation_id);
    const originalState=fs.readFileSync(fixture.statePath);
    fs.writeFileSync(fixture.statePath,updateFrontmatterText(originalState.toString('utf8'),{
      red_proof_operation_id:`op-${'f'.repeat(64)}`}));
    await assert.rejects(()=>dispatch(productionArgv,{cwd:fixture.root}),
      /bootstrap-(?:proof|authority)/);
    fs.writeFileSync(fixture.statePath,originalState);
    const underBound=structuredClone(proof);delete underBound.verification_ledger_result_sha256;
    fs.writeFileSync(proofPath,Buffer.from(canonicalJson(underBound)));
    await assert.rejects(()=>dispatch(productionArgv,{cwd:fixture.root}),
      /bootstrap-(?:proof|authority)/);
    fs.writeFileSync(proofPath,proofBytes);
    for(const [name,file] of [
      ['marker',markerPath],
      ['receipt',receiptPath],
      ['authorization',fixture.authorizationPath],
    ]){
      const bytes=fs.readFileSync(file);
      fs.unlinkSync(file);
      await assert.rejects(()=>dispatch(productionArgv,{cwd:fixture.root}),
        /bootstrap-(?:proof|required|authority)/,name);
      fs.writeFileSync(file,bytes);
    }
    const admitted=await dispatch(productionArgv,{cwd:fixture.root});
    assert.equal(admitted.authority.write_class,'production');
    assert.equal(finalized.operation_receipt.stage,'completed-ledger');
  });

test('public first-RED rejects every closed process, TAP, scope, environment and producer substitution',
  async(t)=>{
    const cases=[
      ['alternate-leaf',[
        "'use strict';","const test=require('node:test');",
        "const assert=require('node:assert/strict');",
        "test('different leaf',()=>assert.strictEqual(1,2,'expected exact authority'));",''].join('\n')],
      ['alternate-message',[
        "'use strict';","const test=require('node:test');",
        "const assert=require('node:assert/strict');",
        "test('fails first',()=>assert.strictEqual(1,2,'different message'));",''].join('\n')],
      ['substring-only',[
        "'use strict';","const test=require('node:test');",
        "const assert=require('node:assert/strict');",
        "test('fails first',()=>assert.strictEqual(3,4,'prefix expected exact authority suffix'));",
        ''].join('\n')],
      ['unsupported-tap',"'use strict';\nthis is not valid javascript\n"],
      ['stderr-nonempty',[
        "'use strict';","const test=require('node:test');",
        "const assert=require('node:assert/strict');",
        "test('fails first',()=>{console.error('forbidden stderr');assert.strictEqual(1,2,'expected exact authority');});",
        ''].join('\n')],
      ['ambient-environment',[
        "'use strict';","const test=require('node:test');",
        "const assert=require('node:assert/strict');",
        "test('fails first',()=>{assert.equal(process.env.HOME,undefined,'ambient HOME');assert.strictEqual(1,2,'expected exact authority');});",
        ''].join('\n')],
      ['governed-side-effect',[
        "'use strict';","const test=require('node:test');",
        "const assert=require('node:assert/strict');","const fs=require('node:fs');",
        "test('fails first',()=>{fs.writeFileSync('runtime/a.js','side effect\\n');assert.strictEqual(1,2,'expected exact authority');});",
        ''].join('\n')],
      ['signal',[
        "'use strict';","const test=require('node:test');",
        "test('fails first',()=>process.kill(process.pid,'SIGTERM'));",''].join('\n')],
    ];
    for(const [name,testSource] of cases){
      await t.test(name,async()=>{
        const prepared=await preparePublicFirstRedCase(t,{testSource});
        await assert.rejects(()=>dispatch(prepared.argv,{cwd:prepared.fixture.root}),
          /bootstrap-first-red-(?:classification|process|tap|scope|environment)/);
      });
    }
    await t.test('timeout',async()=>{
      const spec=exactFirstRedSpec({timeout_ms:100});
      const source=[
        "'use strict';","const test=require('node:test');",
        "test('fails first',async()=>new Promise(()=>{}));",''].join('\n');
      const prepared=await preparePublicFirstRedCase(t,{spec,testSource:source});
      await assert.rejects(()=>dispatch(prepared.argv,{cwd:prepared.fixture.root}),
        /bootstrap-first-red-(?:classification|process)/);
    });
    await t.test('overflow',async()=>{
      const spec=exactFirstRedSpec({max_output_bytes:1024});
      const source=[
        "'use strict';","const test=require('node:test');",
        "const assert=require('node:assert/strict');",
        "test('fails first',()=>{console.log('x'.repeat(4096));assert.strictEqual(1,2,'expected exact authority');});",
        ''].join('\n');
      const prepared=await preparePublicFirstRedCase(t,{spec,testSource:source});
      await assert.rejects(()=>dispatch(prepared.argv,{cwd:prepared.fixture.root}),
        /bootstrap-first-red-(?:classification|process)/);
    });
    await t.test('unsupported-node-patch',async()=>{
      const spec=exactFirstRedSpec({executable:{kind:'node-toolchain',name:'node',
        supported_patches_sha256:'f'.repeat(64)}});
      const prepared=await preparePublicFirstRedCase(t,{spec});
      await assert.rejects(()=>dispatch(prepared.argv,{cwd:prepared.fixture.root}),
        /bootstrap-first-red-(?:node|executable|classification)/);
    });
    await t.test('producer-substitution',async()=>{
      const first=await preparePublicFirstRedCase(t);
      const second=await preparePublicFirstRedCase(t);
      const swapped=[...first.argv];
      swapped[swapped.indexOf('--write-receipt')+1]=second.begun.receiptCapability.path;
      await assert.rejects(()=>dispatch(swapped,{cwd:first.fixture.root}),
        /bootstrap-/);
    });
  });
