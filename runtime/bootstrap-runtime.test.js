'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
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
  precomputeBootstrapCompletion,
}=bootstrapRuntime;
const {canonicalJson}=require('./operation-journal.js');

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
