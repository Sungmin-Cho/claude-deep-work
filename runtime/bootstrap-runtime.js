'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {fileURLToPath,pathToFileURL}=require('node:url');
const journal=require('./operation-journal.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OID=/^[0-9a-f]{40}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
const SESSION=/^s-[0-9a-f]{8}$/;
const ALLOWED_SIGNALS=new Set(['SIGABRT','SIGALRM','SIGBUS','SIGCHLD','SIGCONT','SIGEMT','SIGFPE',
  'SIGHUP','SIGILL','SIGINFO','SIGINT','SIGIO','SIGKILL','SIGPIPE','SIGPROF','SIGQUIT','SIGSEGV',
  'SIGSTOP','SIGSYS','SIGTERM','SIGTRAP','SIGTSTP','SIGTTIN','SIGTTOU','SIGURG','SIGUSR1','SIGUSR2',
  'SIGVTALRM','SIGWINCH','SIGXCPU','SIGXFSZ']);

function fail(code,message=code){const error=new Error(`[${code}] ${message}`);error.code=code;throw error;}
function canonicalText(value){const text=journal.canonicalJson(value);return text.endsWith('\n')?text.slice(0,-1):text;}
function canonicalBootstrapJson(value){return Buffer.from(canonicalText(value));}
function byteSort(values){return [...values].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonicalText(byteSort(Object.keys(value)))===canonicalText(byteSort(keys));}
function rawDigest(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function semanticDigest(label,value,omitted){
  const copy=structuredClone(value);if(omitted)delete copy[omitted];
  return rawDigest(Buffer.concat([Buffer.from(`${label}\0`),Buffer.from(journal.canonicalJson(copy))]));
}
function portablePath(value){return typeof value==='string'&&value.length>0&&!value.startsWith('/')&&
  !value.startsWith('-')&&!value.includes('\\')&&!value.includes('\0')&&
  !value.split('/').some((part)=>!part||part==='.'||part==='..');}
function uniqueSorted(values,{allowEmpty=false,pattern}={}){
  return Array.isArray(values)&&(allowEmpty||values.length>0)&&
    values.every((value)=>typeof value==='string'&&(!pattern||pattern.test(value)))&&
    new Set(values).size===values.length&&
    canonicalText(values)===canonicalText(byteSort(values));
}

const BOOTSTRAP_CONTROL_NAMES=Object.freeze([
  'abort-journal.json','abort-receipt.json','authorization.json','bootstrap-receipt.json',
  'execution-journal.json','execution.json','executor.mjs','failure.json','marker.json',
  'patch-review-executability.json','patch-review-semantic.json','patch-review-structural.json',
  'patch.diff','recovery-required.json','reverse.patch','test-reverse.patch','test.patch',
].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));
const BOOTSTRAP_OPERATION_KINDS=Object.freeze([
  'bootstrap-abort','bootstrap-failure-publish','bootstrap-finalize','bootstrap-first-red',
  'bootstrap-red-adoption','red-proof-publication',
]);
const BOOTSTRAP_OPERATION_STAGE_RULES=Object.freeze({
  'bootstrap-abort':Object.freeze(['prepared','authorization-authenticated',
    'failure-authenticated','observed-manifest-authenticated','production-reverted',
    'test-reverted','base-restored','abort-receipt-published','recovery-required-published']),
  'bootstrap-failure-publish':Object.freeze(['prepared','failure-published','claim-committed']),
  'bootstrap-finalize':Object.freeze(['prepared','authorization-authenticated',
    'execution-authenticated','receipt-precomputed','marker-committed','receipt-published']),
  'bootstrap-first-red':Object.freeze(['prepared','containment-authenticated',
    'pre-manifest-published','process-completed','post-manifest-published',
    'result-published']),
  'bootstrap-red-adoption':Object.freeze(['prepared','bridge-authenticated',
    'red-authority-adopted']),
  'red-proof-publication':Object.freeze(['prepared','proof-published','proof-ref-committed']),
});
const BOOTSTRAP_ABORT_STAGE_PATHS=Object.freeze([
  Object.freeze(['prepared','authorization-authenticated','failure-authenticated',
    'observed-manifest-authenticated','production-reverted','test-reverted','base-restored',
    'abort-receipt-published']),
  Object.freeze(['prepared','authorization-authenticated','failure-authenticated',
    'observed-manifest-authenticated','recovery-required-published']),
]);
const BOOTSTRAP_RUNTIME_JOURNAL_GRAMMAR=
  '.claude/deep-work.<session>.op.<bootstrap-kind>.op-<32-64-lower-hex>.json';
const BOOTSTRAP_FINALIZE_RECOVERY_PROJECTION=Object.freeze({
  kind:'bootstrap-finalize',
  journal_grammar:'.claude/deep-work.<session>.op.bootstrap-finalize.<operation-id>.json',
  top_level_keys:Object.freeze(['createdAt','kind','operationId','owned','preconditions','sessionId',
    'stage','stages','version']),
  first_row_keys:Object.freeze(['at','stage']),
  later_row_keys:Object.freeze(['at','details','stage']),
  manifest_delta:'one-exact-authenticated-pending-journal',
  terminal_artifacts:Object.freeze(['bootstrap-receipt.json','marker.json']),
});
const BOOTSTRAP_CURRENT_OPERATION_DOMAINS=Object.freeze({
  'bootstrap-abort':'bootstrap-abort-v1',
  'bootstrap-first-red':'bootstrap-first-red-v2',
});
const BOOTSTRAP_CURRENT_OPERATION_PROJECTION_KEYS=Object.freeze([
  'kind','operation_id','preconditions','slice',
]);
const BOOTSTRAP_LOCK_PROJECTION_KEYS=Object.freeze([
  'target_identity','pid','process_identity','nonce','claim_sha256',
]);

const BOOTSTRAP_EXECUTION_STAGES=Object.freeze([
  'ready','test-patch-started','test-patch-applied','red-command-completed',
  'production-patch-started','production-patch-applied','post-manifest-captured',
  'green-command-completed','finalize-prepared','finalize-authorization-authenticated',
  'finalize-execution-authenticated','finalize-receipt-precomputed','finalize-marker-committed',
  'finalize-receipt-published','finalize-completed','abort-claimed','abort-completed',
  'recovery-required',
]);

const BOOTSTRAP_REJECTION_CODES=Object.freeze([
  'spawn-failed','output-overflow','timed-out','signaled','stdout-invalid-utf8','stdout-crlf',
  'stdout-reserved-root-token','stdout-out-of-root-location','stdout-malformed-location-context',
  'stdout-malformed-timing','stdout-malformed-summary','stdout-count-invalid',
  'stdout-malformed-failure-detail',
]);
const NODE_TAP_26_GOLDEN_BYTES=fs.readFileSync(path.join(__dirname,'fixtures',
  'node-tap-26.0.0.json'));
const NODE_TAP_26_GOLDEN=JSON.parse(NODE_TAP_26_GOLDEN_BYTES);
if(NODE_TAP_26_GOLDEN.schema_version!==1||NODE_TAP_26_GOLDEN.node_patch!=='26.0.0')
  fail('bootstrap-node-tap-golden');
const BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256=rawDigest(NODE_TAP_26_GOLDEN_BYTES);
const BOOTSTRAP_NODE_TAP_GOLDENS=Object.freeze({'26.0.0':NODE_TAP_26_GOLDEN});

const BOOTSTRAP_VERIFICATION_RESULT_KEYS=Object.freeze([
  'changed_paths','classification','cwd_role','disposition','environment','environment_sha256',
  'executable_identity','execution_containment','execution_containment_sha256','logical_argv',
  'normalized_argv','plan_authority_sha256','post_manifest_ref','pre_manifest_ref','process',
  'raw_stderr','raw_stdout','result_path','result_sha256','schema_version','scope_disposition',
  'session_id','slice_id','spec_sha256','supervisor_control','supervisor_control_sha256',
  'verification_operation_id','verification_plan_sha256','write_operation_id',
]);

const BOOTSTRAP_RED_PROOF_KEYS=Object.freeze([
  'bootstrap_bridge_operation_id','classification_digest','plan_authority_sha256',
  'proof_operation_id','proof_sha256','schema_version','session_id','slice_id','spec_approved_hash',
  'spec_sha256','transition_kind','transition_ledger_result_sha256','transition_operation_id',
  'verification_ledger_result_sha256','verification_operation_id','verification_plan_sha256',
  'verification_result_sha256','write_operation_id','write_receipt_sha256',
]);

function bootstrapRuntimeLockPaths(sessionId){
  return [
    `.claude/deep-work.${sessionId}.bootstrap-control.lock`,
    `.claude/deep-work.${sessionId}.bootstrap-control.lock.claims`,
    `.claude/deep-work.${sessionId}.operations.lock`,
    `.claude/deep-work.${sessionId}.operations.lock.claims`,
  ].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
}
function bootstrapExcludedPaths(sessionId){
  if(!SESSION.test(sessionId||''))fail('bootstrap-session-id');
  return [
    ...BOOTSTRAP_CONTROL_NAMES.map((name)=>`.deep-work/${sessionId}/bootstrap/${name}`),
    ...bootstrapRuntimeLockPaths(sessionId),
  ]
    .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
}
function plainObject(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.getPrototypeOf(value)===Object.prototype;
}
function timestamp(value){
  return typeof value==='string'&&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}
function validateBootstrapCurrentOperation(value){
  if(value===undefined||value===null)return null;
  if(!exactKeys(value,BOOTSTRAP_CURRENT_OPERATION_PROJECTION_KEYS)||
    !Object.hasOwn(BOOTSTRAP_CURRENT_OPERATION_DOMAINS,value.kind)||
    !OPERATION.test(value.operation_id||'')||!plainObject(value.preconditions)||
    !(value.slice===null||typeof value.slice==='string'&&value.slice.length>0))
    fail('bootstrap-manifest-current-operation');
  const expected=deterministicOperationId(BOOTSTRAP_CURRENT_OPERATION_DOMAINS[value.kind],
    value.preconditions);
  if(value.operation_id!==expected)fail('bootstrap-manifest-current-operation');
  return structuredClone(value);
}
function isAuthenticatedBootstrapCurrentJournal(relative,file,sessionId,currentOperation){
  if(currentOperation===null)return false;
  const expectedRelative=`.claude/deep-work.${sessionId}.op.${currentOperation.kind}.`+
    `${currentOperation.operation_id}.json`;
  if(relative!==expectedRelative)return false;
  let stat,afterStat,bytes,afterBytes,value;
  try{
    stat=fs.lstatSync(file,{bigint:true});bytes=fs.readFileSync(file);
    afterBytes=fs.readFileSync(file);afterStat=fs.lstatSync(file,{bigint:true});
    value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{fail('bootstrap-manifest-runtime-journal');}
  const keys=Object.keys(value||{}).sort();
  const expectedKeys=['createdAt','kind','operationId','owned','preconditions','sessionId',
    ...(value&&Object.hasOwn(value,'slice')?['slice']:[]),'stage','stages','version'].sort();
  const stageRules=BOOTSTRAP_OPERATION_STAGE_RULES[currentOperation.kind];
  if(!stat.isFile()||stat.isSymbolicLink()||bytes.length>1024*1024||
    !afterStat.isFile()||afterStat.isSymbolicLink()||!bytes.equals(afterBytes)||
    canonicalText(bootstrapMutationIdentity(stat))!==
      canonicalText(bootstrapMutationIdentity(afterStat))||
    !bytes.equals(Buffer.from(journal.canonicalJson(value)))||
    canonicalText(keys)!==canonicalText(expectedKeys)||value.version!==1||
    value.sessionId!==sessionId||value.kind!==currentOperation.kind||
    value.operationId!==currentOperation.operation_id||
    canonicalText(value.preconditions)!==canonicalText(currentOperation.preconditions)||
    (value.slice??null)!==currentOperation.slice||
    Object.hasOwn(value,'slice')!==(currentOperation.slice!==null)||
    !plainObject(value.preconditions)||
    !(value.owned===null||plainObject(value.owned))||
    !timestamp(value.createdAt)||
    Object.hasOwn(value,'slice')&&(typeof value.slice!=='string'||value.slice.length===0)||
    !Array.isArray(value.stages)||value.stages.length===0||
    value.stages[0]?.stage!=='prepared'||value.stages[0]?.at!==value.createdAt||
    value.stage!==value.stages.at(-1)?.stage)
    fail('bootstrap-manifest-runtime-journal');
  for(let index=0;index<value.stages.length;index+=1){
    const row=value.stages[index];
    const rowKeys=index===0?['at','stage']:['at','details','stage'];
    if(!plainObject(row)||canonicalText(Object.keys(row).sort())!==canonicalText(rowKeys)||
      !timestamp(row.at)||!stageRules.includes(row.stage)||
      index>0&&!plainObject(row.details))
      fail('bootstrap-manifest-runtime-journal');
  }
  const observedStages=value.stages.map((row)=>row.stage);
  const paths=currentOperation.kind==='bootstrap-abort'?
    BOOTSTRAP_ABORT_STAGE_PATHS:[stageRules];
  if(!paths.some((candidate)=>observedStages.length<=candidate.length&&
    observedStages.every((stage,index)=>stage===candidate[index])))
    fail('bootstrap-manifest-runtime-journal');
  return {file,identity:bootstrapMutationIdentity(stat),sha256:rawDigest(bytes),
    size:bytes.length};
}
function bootstrapManifestSchemaSha256(sessionId){
  return semanticDigest('bootstrap-manifest-schema-v1',{
    schema_version:1,
    manifest_keys:['base_head_oid','entries','excluded_paths','manifest_sha256','phase',
      'repository_identity_sha256','schema_version'],
    entry_keys:['mode','path','sha256','size','type'],phases:['base','pre','post','red'],
    excluded_paths:bootstrapExcludedPaths(sessionId),
    runtime_lock_paths:bootstrapRuntimeLockPaths(sessionId),
    lock_projection_keys:BOOTSTRAP_LOCK_PROJECTION_KEYS,
    current_operation_projection_keys:BOOTSTRAP_CURRENT_OPERATION_PROJECTION_KEYS,
    current_operation_domains:BOOTSTRAP_CURRENT_OPERATION_DOMAINS,
    runtime_journal_grammar:BOOTSTRAP_RUNTIME_JOURNAL_GRAMMAR,
    runtime_journal_stage_rules:BOOTSTRAP_OPERATION_STAGE_RULES,
    runtime_journal_abort_stage_paths:BOOTSTRAP_ABORT_STAGE_PATHS,
    finalize_recovery_projection:BOOTSTRAP_FINALIZE_RECOVERY_PROJECTION,
  },'schema_sha256');
}
function validateBootstrapManifest(value,{sessionId}={}){
  if(!exactKeys(value,['schema_version','repository_identity_sha256','base_head_oid','phase',
    'excluded_paths','entries','manifest_sha256'])||value.schema_version!==1||
    !DIGEST.test(value.repository_identity_sha256||'')||!OID.test(value.base_head_oid||'')||
    !['base','red','pre','post'].includes(value.phase)||!DIGEST.test(value.manifest_sha256||''))
    fail('bootstrap-manifest-schema');
  if(canonicalText(value.excluded_paths)!==canonicalText(bootstrapExcludedPaths(sessionId)))
    fail('bootstrap-manifest-exclusions');
  if(!Array.isArray(value.entries))fail('bootstrap-manifest-entries');
  let prior=null;
  for(const entry of value.entries){
    if(!exactKeys(entry,['path','type','mode','size','sha256'])||entry.type!=='file'||
      !portablePath(entry.path)||!/^\d+$/.test(entry.mode||'')||!Number.isSafeInteger(entry.size)||
      entry.size<0||!DIGEST.test(entry.sha256||''))fail('bootstrap-manifest-entry');
    if(prior!==null&&Buffer.compare(Buffer.from(prior),Buffer.from(entry.path))>=0)
      fail('bootstrap-manifest-order');
    if(value.excluded_paths.includes(entry.path))fail('bootstrap-manifest-excluded-entry');
    prior=entry.path;
  }
  if(semanticDigest('bootstrap-manifest-v1',value,'manifest_sha256')!==value.manifest_sha256)
    fail('bootstrap-manifest-digest');
  return structuredClone(value);
}
function validateNodeIdentity(value){
  if(!exactKeys(value,['path','version','sha256','dev','ino','mode','size','mtime_ns'])||
    typeof value.path!=='string'||!path.isAbsolute(value.path)||!DIGEST.test(value.sha256||'')||
    !/^\d+\.\d+\.\d+$/.test(value.version||'')||
    ['dev','ino','mode','size','mtime_ns'].some((key)=>!/^\d+$/.test(value[key]||'')))
    fail('bootstrap-node-identity');
  return structuredClone(value);
}
function bootstrapCommandArgvSha256(argv){
  if(!Array.isArray(argv)||argv.some((part)=>typeof part!=='string'||!part||part.includes('\0')))
    fail('bootstrap-command-argv');
  return rawDigest(Buffer.concat([Buffer.from('bootstrap-command-argv-v1\0'),
    Buffer.from(canonicalText(argv))]));
}
function validateExpectedResult(value){
  if(!exactKeys(value,['argv_sha256','input_manifest_sha256','exit_code','signal','timed_out',
    'output_overflow','stdout_semantic_sha256','stderr_sha256'])||
    !DIGEST.test(value.argv_sha256||'')||!DIGEST.test(value.input_manifest_sha256||'')||
    !Number.isInteger(value.exit_code)||value.exit_code<0||
    value.signal!==null&&!ALLOWED_SIGNALS.has(value.signal)||typeof value.timed_out!=='boolean'||
    typeof value.output_overflow!=='boolean'||!DIGEST.test(value.stdout_semantic_sha256||'')||
    !DIGEST.test(value.stderr_sha256||''))fail('bootstrap-expected-result');
  return structuredClone(value);
}

const WITNESS_KEYS=['schema_version','target_session_id','repository_identity_sha256','base_head_oid',
  'spec_approved_hash','runtime_version','node_identity','route_preflight_sha256',
  'bootstrap_manifest_schema_sha256','base_manifest_sha256','executor_path','executor_sha256',
  'test_patch_path','test_patch_sha256','test_reverse_patch_path','test_reverse_patch_sha256',
  'red_manifest_sha256','test_changed_paths','patch_path','patch_sha256','reverse_patch_path',
  'reverse_patch_sha256','expected_post_manifest_sha256','changed_paths','red_argv','green_argv',
  'expected_red_result','expected_green_result','first_red_slice_id',
  'first_red_verification_spec_sha256','witness_sha256'];

function validateBootstrapWitness(value){
  if(!exactKeys(value,WITNESS_KEYS)||value.schema_version!==1||!SESSION.test(value.target_session_id||'')||
    !DIGEST.test(value.repository_identity_sha256||'')||!OID.test(value.base_head_oid||'')||
    !DIGEST.test(value.spec_approved_hash||'')||typeof value.runtime_version!=='string'||
    ['route_preflight_sha256','bootstrap_manifest_schema_sha256','base_manifest_sha256','executor_sha256',
      'test_patch_sha256','test_reverse_patch_sha256','red_manifest_sha256','patch_sha256',
      'reverse_patch_sha256','expected_post_manifest_sha256','first_red_verification_spec_sha256',
      'witness_sha256'].some((key)=>!DIGEST.test(value[key]||''))||
    !/^SLICE-\d{3}$/.test(value.first_red_slice_id||''))fail('bootstrap-witness-schema');
  const nodeIdentity=validateNodeIdentity(value.node_identity);
  const prefix=`.deep-work/${value.target_session_id}/bootstrap/`;
  for(const [key,name] of [['executor_path','executor.mjs'],['test_patch_path','test.patch'],
    ['test_reverse_patch_path','test-reverse.patch'],['patch_path','patch.diff'],
    ['reverse_patch_path','reverse.patch']])
    if(value[key]!==`${prefix}${name}`)fail('bootstrap-witness-control-path');
  if(!uniqueSorted(value.test_changed_paths,{pattern:/^(?!-).+$/})||
    !uniqueSorted(value.changed_paths,{pattern:/^(?!-).+$/})||
    value.test_changed_paths.some((entry)=>value.changed_paths.includes(entry)))
    fail('bootstrap-witness-paths');
  if(!Array.isArray(value.red_argv)||canonicalText(value.red_argv)!==
    canonicalText(value.green_argv)||value.red_argv[0]!==nodeIdentity.path||
    value.red_argv[1]!=='--test'||value.red_argv[2]!=='--test-reporter=spec'||
    !uniqueSorted(value.red_argv.slice(3),{pattern:/^(?!-).+$/})||
    value.red_argv.slice(3).some((entry)=>!portablePath(entry)))fail('bootstrap-witness-argv');
  const red=validateExpectedResult(value.expected_red_result);
  const green=validateExpectedResult(value.expected_green_result);
  if(red.input_manifest_sha256!==value.red_manifest_sha256||
    green.input_manifest_sha256!==value.expected_post_manifest_sha256||
    red.argv_sha256!==bootstrapCommandArgvSha256(value.red_argv)||
    green.argv_sha256!==bootstrapCommandArgvSha256(value.green_argv)||
    red.exit_code!==1||green.exit_code!==0||red.signal!==null||green.signal!==null||
    red.timed_out||green.timed_out||red.output_overflow||green.output_overflow||
    red.stderr_sha256!==rawDigest(Buffer.alloc(0))||green.stderr_sha256!==rawDigest(Buffer.alloc(0)))
    fail('bootstrap-witness-result-manifest');
  if(value.bootstrap_manifest_schema_sha256!==bootstrapManifestSchemaSha256(value.target_session_id))
    fail('bootstrap-witness-manifest-schema');
  if(semanticDigest('bootstrap-witness-v1',value,'witness_sha256')!==value.witness_sha256)
    fail('bootstrap-witness-digest');
  return {...structuredClone(value),node_identity:nodeIdentity,
    expected_red_result:red,expected_green_result:green};
}

function decodeUtf8Fatal(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{fail('stdout-invalid-utf8');}}
function replaceAuthenticatedLocation(candidate,root,rootUrl){
  if(candidate.startsWith(`${root}/`))return `<worktree>/${candidate.slice(root.length+1)}`;
  if(candidate.startsWith(`${rootUrl}/`))return `file://<worktree>/${candidate.slice(rootUrl.length+1)}`;
  fail('stdout-out-of-root-location');
}
function tokenizeLocations(text,worktreeRoot){
  if(text.includes('<worktree>/')||text.includes('file://<worktree>/'))
    fail('stdout-reserved-root-token');
  const root=path.resolve(worktreeRoot),rootUrl=pathToFileURL(root).href.replace(/\/$/u,'');
  const lines=text.slice(0,-1).split('\n');
  const frame=`((?:file:\\/\\/\\/|\\/)[^\\s)\\]}'"]+:[1-9][0-9]*:[1-9][0-9]*)`;
  const module=`((?:file:\\/\\/\\/|\\/)[^\\s)\\]}'"]+)`;
  const patterns=[new RegExp(`^(test at )${frame}$`,'u'),
    new RegExp(`^([ \\t]+at )${frame}$`,'u'),
    new RegExp(`^([ \\t]+at .+ \\()${frame}(\\))$`,'u')];
  for(let index=0;index<lines.length;index+=1){
    if(lines[index]==='Require stack:'){
      let cursor=index+1,count=0;
      for(;cursor<lines.length;cursor+=1){
        const match=lines[cursor].match(new RegExp(`^(- )${module}$`,'u'));if(!match)break;
        lines[cursor]=`${match[1]}${replaceAuthenticatedLocation(match[2],root,rootUrl)}`;count+=1;
      }
      if(count===0)fail('stdout-malformed-location-context');index=cursor-1;continue;
    }
    if(lines[index]==='  requireStack: ['){
      const rows=[];let cursor=index+1;
      for(;cursor<lines.length&&lines[cursor]!=='  ]';cursor+=1){
        const match=lines[cursor].match(new RegExp(`^(    ')${module}('(,?))$`,'u'));
        if(!match)fail('stdout-malformed-location-context');
        rows.push({index:cursor,prefix:match[1],
          location:replaceAuthenticatedLocation(match[2],root,rootUrl),comma:match[4]});
      }
      if(cursor>=lines.length||rows.length===0)fail('stdout-malformed-location-context');
      rows.forEach((row,rowIndex)=>{const comma=rowIndex<rows.length-1?',':'';
        if(row.comma!==comma)fail('stdout-malformed-location-context');
        lines[row.index]=`${row.prefix}${row.location}'${comma}`;});
      index=cursor;continue;
    }
    for(const pattern of patterns){const match=lines[index].match(pattern);if(!match)continue;
      lines[index]=`${match[1]}${replaceAuthenticatedLocation(match[2],root,rootUrl)}`+
        `${pattern===patterns[2]?match[3]:''}`;break;}
  }
  return `${lines.join('\n')}\n`;
}
function detailLocationAllowed(location,testPaths,worktreeRoot){
  const root=path.resolve(worktreeRoot),rootUrl=pathToFileURL(root).href.replace(/\/$/u,'');
  return testPaths.some((testPath)=>{
    const escaped=testPath.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
    if(new RegExp(`^${escaped}:[1-9][0-9]*:[1-9][0-9]*$`,'u')
      .test(location.replace(/^<worktree>\//u,'')))return true;
    const suffix=pathToFileURL(path.join(root,testPath)).href.slice(rootUrl.length+1)
      .replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
    return new RegExp(`^file://<worktree>/${suffix}:[1-9][0-9]*:[1-9][0-9]*$`,'u').test(location);
  });
}
function validateBootstrapArgv(argv,nodeIdentity){
  if(!Array.isArray(argv)||argv.length<4||argv[0]!==nodeIdentity.path||argv[1]!=='--test'||
    argv[2]!=='--test-reporter=spec'||!uniqueSorted(argv.slice(3),{pattern:/^(?!-).+$/})||
    argv.slice(3).some((entry)=>!portablePath(entry)))fail('bootstrap-command-argv');
  return argv.slice(3);
}
function normalizeNodeTestBootstrapStdout(stdoutBytes,{worktreeRoot,nodeIdentity,reporter,argv}={}){
  const node=validateNodeIdentity(nodeIdentity);
  if(reporter!=='spec'||typeof worktreeRoot!=='string'||!path.isAbsolute(worktreeRoot))
    fail('bootstrap-normalizer-context');
  const testPaths=validateBootstrapArgv(argv,node);
  let text=decodeUtf8Fatal(Buffer.from(stdoutBytes));
  if(text.includes('\r'))fail('stdout-crlf');
  if(!text.endsWith('\n'))fail('stdout-malformed-summary');
  text=tokenizeLocations(text,worktreeRoot);
  const source=text.slice(0,-1).split('\n'),lines=[];
  const status=/^([ \t]*(?:✔|✖|﹣).*) \(((?:0|[1-9][0-9]*)(?:\.[0-9]+)?)ms\)$/u;
  const timing=/^[ \t]*(?:✔|✖|﹣).* \(.*ms\)$/u;
  const duration=/^ℹ duration_ms ((?:0|[1-9][0-9]*)(?:\.[0-9]+)?)$/u;
  for(const line of source){const match=line.match(status);
    if(match)lines.push(`${match[1]} (<duration>ms)`);
    else{if(timing.test(line)||line.startsWith('ℹ duration_ms ')&&!duration.test(line))
      fail('stdout-malformed-timing');lines.push(line);}}
  const names=['tests','suites','pass','fail','cancelled','skipped','todo'],starts=[];
  for(let start=0;start+7<lines.length;start+=1){
    if(names.every((name,offset)=>new RegExp(`^ℹ ${name} (0|[1-9][0-9]*)$`,'u')
      .test(lines[start+offset]))&&duration.test(lines[start+7]))starts.push(start);
  }
  if(starts.length!==1)fail('stdout-malformed-summary');
  const summaryStart=starts[0],indexes=new Set(Array.from({length:8},(_,index)=>summaryStart+index));
  for(let index=0;index<lines.length;index+=1){
    if(indexes.has(index))continue;
    if([...names,'duration_ms'].some((name)=>lines[index]===`ℹ ${name}`||
      lines[index].startsWith(`ℹ ${name} `)))fail('stdout-malformed-summary');
  }
  const counts=Object.fromEntries(names.map((name,index)=>[name,
    Number(lines[summaryStart+index].split(' ').at(-1))]));
  if(counts.suites!==0||counts.cancelled!==0||counts.todo!==0||
    counts.tests!==counts.pass+counts.fail+counts.skipped+counts.cancelled+counts.todo)
    fail('stdout-count-invalid');
  lines[summaryStart+7]='ℹ duration_ms <duration>';
  let cursor=summaryStart+8;
  if(counts.fail===0){if(cursor!==lines.length)fail('stdout-malformed-failure-detail');}
  else{
    if(lines[cursor]!==''||lines[cursor+1]!=='✖ failing tests:'||lines[cursor+2]!=='')
      fail('stdout-malformed-failure-detail');
    cursor+=3;let blocks=0;
    while(cursor<lines.length){
      const location=lines[cursor];
      if(typeof location!=='string'||!location.startsWith('test at ')||
        !detailLocationAllowed(location.slice(8),testPaths,worktreeRoot))
        fail('stdout-malformed-failure-detail');
      cursor+=1;
      if(!/^✖.* \(<duration>ms\)$/u.test(lines[cursor]||''))fail('stdout-malformed-failure-detail');
      cursor+=1;const diagnosticStart=cursor;
      while(cursor<lines.length&&lines[cursor].startsWith('  '))cursor+=1;
      if(cursor===diagnosticStart)fail('stdout-malformed-failure-detail');
      blocks+=1;if(cursor===lines.length)break;
      if(lines[cursor]!==''||cursor+1===lines.length)fail('stdout-malformed-failure-detail');
      cursor+=1;
    }
    if(blocks===0||blocks>counts.fail||cursor!==lines.length)fail('stdout-malformed-failure-detail');
  }
  const normalized=Buffer.from(`${lines.join('\n')}\n`);
  const semantic={schema_version:1,normalized_stdout_sha256:rawDigest(normalized),
    tests:counts.tests,pass:counts.pass,fail:counts.fail,skipped:counts.skipped};
  return {normalized_bytes:normalized,semantic,
    stdout_semantic_sha256:semanticDigest('node-test-bootstrap-semantic-v1',semantic,'unused')};
}
function strictBase64(value){if(typeof value!=='string')fail('bootstrap-command-raw');
  const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)fail('bootstrap-command-raw');
  return bytes;}
function classifyBootstrapObservedCommandResult(observation,{worktreeRoot,nodeIdentity}={}){
  const node=validateNodeIdentity(nodeIdentity);validateBootstrapArgv(observation.argv,node);
  const stdout=Buffer.from(observation.stdout||''),stderr=Buffer.from(observation.stderr||'');
  let rejection=null,normalized=null;
  if(observation.spawn_failed)rejection='spawn-failed';
  else if(observation.output_overflow)rejection='output-overflow';
  else if(observation.timed_out)rejection='timed-out';
  else if(observation.signal!==null)rejection='signaled';
  if(rejection===null)try{normalized=normalizeNodeTestBootstrapStdout(stdout,
    {worktreeRoot,nodeIdentity:node,reporter:'spec',argv:observation.argv});}
  catch(error){if(!BOOTSTRAP_REJECTION_CODES.includes(error.code))throw error;rejection=error.code;}
  const common={argv_sha256:bootstrapCommandArgvSha256(observation.argv),
    input_manifest_sha256:observation.input_manifest_sha256,exit_code:observation.exit_code,
    signal:observation.signal,timed_out:observation.timed_out,output_overflow:observation.output_overflow};
  const raw={stderr_sha256:rawDigest(stderr),stdout_sha256:rawDigest(stdout),
    stdout_base64:stdout.toString('base64'),stderr_base64:stderr.toString('base64')};
  return rejection?{result_kind:'rejected',...common,stdout_semantic_sha256:null,
    rejection_code:rejection,...raw}:{result_kind:'normalized',...common,
    stdout_semantic_sha256:normalized.stdout_semantic_sha256,...raw};
}
function validateBootstrapObservedCommandResult(value,{argv,inputManifestSha256,worktreeRoot,nodeIdentity}={}){
  const common=['result_kind','argv_sha256','input_manifest_sha256','exit_code','signal','timed_out',
    'output_overflow','stdout_semantic_sha256','stderr_sha256','stdout_sha256','stdout_base64',
    'stderr_base64'];
  if(!exactKeys(value,value?.result_kind==='rejected'?[...common,'rejection_code']:common)||
    !['normalized','rejected'].includes(value?.result_kind)||!DIGEST.test(value.argv_sha256||'')||
    !DIGEST.test(value.input_manifest_sha256||'')||
    value.exit_code!==null&&(!Number.isInteger(value.exit_code)||value.exit_code<0)||
    value.signal!==null&&!ALLOWED_SIGNALS.has(value.signal)||typeof value.timed_out!=='boolean'||
    typeof value.output_overflow!=='boolean'||!DIGEST.test(value.stderr_sha256||'')||
    !DIGEST.test(value.stdout_sha256||''))fail('bootstrap-command-result');
  const stdout=strictBase64(value.stdout_base64),stderr=strictBase64(value.stderr_base64);
  if(rawDigest(stdout)!==value.stdout_sha256||rawDigest(stderr)!==value.stderr_sha256)
    fail('bootstrap-command-raw');
  if(value.argv_sha256!==bootstrapCommandArgvSha256(argv)||value.input_manifest_sha256!==inputManifestSha256)
    fail('bootstrap-command-binding');
  const recomputed=classifyBootstrapObservedCommandResult({argv,input_manifest_sha256:inputManifestSha256,
    exit_code:value.exit_code,signal:value.signal,timed_out:value.timed_out,
    output_overflow:value.output_overflow,spawn_failed:value.rejection_code==='spawn-failed',stdout,stderr},
  {worktreeRoot,nodeIdentity});
  if(canonicalText(recomputed)!==canonicalText(value))
    fail('bootstrap-command-classification');
  return structuredClone(value);
}

function validateBootstrapFailureArtifact(value,{witness,worktreeRoot}={}){
  if(!exactKeys(value,['schema_version','target_session_id','authorization_sha256','witness_sha256',
    'executor_sha256','node_identity','execution_journal_sha256','observed_stage',
    'observed_manifest_sha256','error_kind','command_result'])||value.schema_version!==1||
    value.target_session_id!==witness.target_session_id||!DIGEST.test(value.authorization_sha256||'')||
    value.witness_sha256!==witness.witness_sha256||value.executor_sha256!==witness.executor_sha256||
    !DIGEST.test(value.execution_journal_sha256||'')||!DIGEST.test(value.observed_manifest_sha256||'')||
    !['command','patch','manifest','finalize','crash-recovery','node-identity'].includes(value.error_kind)||
    canonicalText(validateNodeIdentity(value.node_identity))!==
      canonicalText(witness.node_identity))fail('bootstrap-failure-artifact');
  const stages=new Set(BOOTSTRAP_EXECUTION_STAGES.slice(0,11));
  if(!stages.has(value.observed_stage))fail('bootstrap-failure-stage');
  if(value.error_kind!=='command'){if(value.command_result!==null)fail('bootstrap-failure-command');
    return structuredClone(value);}
  if(value.command_result===null)fail('bootstrap-failure-command');
  const red=new Set(['test-patch-applied','red-command-completed']);
  const green=new Set(['production-patch-applied','post-manifest-captured','green-command-completed',
    'finalize-prepared','finalize-authorization-authenticated','finalize-execution-authenticated']);
  const argv=red.has(value.observed_stage)?witness.red_argv:green.has(value.observed_stage)?witness.green_argv:null;
  const manifest=red.has(value.observed_stage)?witness.red_manifest_sha256:
    green.has(value.observed_stage)?witness.expected_post_manifest_sha256:null;
  if(!argv||value.observed_manifest_sha256!==manifest)fail('bootstrap-command-binding');
  const result=validateBootstrapObservedCommandResult(value.command_result,
    {argv,inputManifestSha256:manifest,worktreeRoot,nodeIdentity:witness.node_identity});
  const expected=red.has(value.observed_stage)?witness.expected_red_result:witness.expected_green_result;
  const projection={argv_sha256:result.argv_sha256,input_manifest_sha256:result.input_manifest_sha256,
    exit_code:result.exit_code,signal:result.signal,timed_out:result.timed_out,
    output_overflow:result.output_overflow,stdout_semantic_sha256:result.stdout_semantic_sha256,
    stderr_sha256:result.stderr_sha256};
  if(result.result_kind==='normalized'&&canonicalText(projection)===
    canonicalText(expected))fail('bootstrap-failure-command');
  return structuredClone(value);
}

function validateBootstrapAuthorization(value){
  if(!exactKeys(value,['schema_version','witness','human_ack','review_report_refs',
    'authorization_sha256'])||value.schema_version!==1||!DIGEST.test(value.authorization_sha256||''))
    fail('bootstrap-authorization-schema');
  const witness=validateBootstrapWitness(value.witness),ack=value.human_ack;
  if(!exactKeys(ack,['actor','at','scope','witness_sha256'])||ack.actor!=='human'||
    !Number.isFinite(Date.parse(ack.at))||ack.scope!=='one-shot-bootstrap'||
    ack.witness_sha256!==witness.witness_sha256)fail('bootstrap-human-ack');
  const roles=['structural','semantic','executability'];
  if(!Array.isArray(value.review_report_refs)||value.review_report_refs.length!==3||
    canonicalText(value.review_report_refs.map((row)=>row.role))!==canonicalText(roles))
    fail('bootstrap-review-roles');
  for(const row of value.review_report_refs)
    if(!exactKeys(row,['role','path','sha256','reviewer_identity','witness_sha256','verdict'])||
      !roles.includes(row.role)||row.path!==`.deep-work/${witness.target_session_id}/bootstrap/patch-review-${row.role}.json`||
      !DIGEST.test(row.sha256||'')||typeof row.reviewer_identity!=='string'||!row.reviewer_identity||
      row.witness_sha256!==witness.witness_sha256||row.verdict!=='APPROVE')
      fail('bootstrap-review-witness');
  if(new Set(value.review_report_refs.map((row)=>row.reviewer_identity)).size!==3)
    fail('bootstrap-review-identity');
  if(semanticDigest('bootstrap-authorization-v1',value,'authorization_sha256')!==value.authorization_sha256)
    fail('bootstrap-authorization-digest');
  return {...structuredClone(value),witness};
}

function validateBootstrapExecutionJournal(value){
  if(!exactKeys(value,['schema_version','target_session_id','authorization_sha256','witness_sha256',
    'executor_sha256','node_identity','stage','stage_manifest_sha256','claim','claim_operation_id',
    'claim_input','journal_sha256'])||value.schema_version!==1||!SESSION.test(value.target_session_id||'')||
    !DIGEST.test(value.authorization_sha256||'')||!DIGEST.test(value.witness_sha256||'')||
    !DIGEST.test(value.executor_sha256||'')||!BOOTSTRAP_EXECUTION_STAGES.includes(value.stage)||
    !DIGEST.test(value.stage_manifest_sha256||'')||!['none','abort','finalize'].includes(value.claim)||
    !DIGEST.test(value.journal_sha256||''))fail('bootstrap-journal-schema');
  validateNodeIdentity(value.node_identity);
  if(value.claim==='none'){
    if(value.claim_operation_id!==null||value.claim_input!==null)fail('bootstrap-journal-claim');
  }else{
    const input=value.claim_input;
    if(!OPERATION.test(value.claim_operation_id||'')||
      !exactKeys(input,['kind','input_journal_sha256','input_stage','input_manifest_sha256',
        'input_artifact_sha256'])||
      !['failure','failure-conflict','finalize-receipt'].includes(input.kind)||
      !DIGEST.test(input.input_journal_sha256||'')||!BOOTSTRAP_EXECUTION_STAGES.includes(input.input_stage)||
      !DIGEST.test(input.input_manifest_sha256||'')||!DIGEST.test(input.input_artifact_sha256||''))
      fail('bootstrap-journal-claim');
    if(value.claim==='finalize'&&input.kind!=='finalize-receipt'||
      value.claim==='abort'&&input.kind==='finalize-receipt')fail('bootstrap-journal-claim');
  }
  if(semanticDigest('bootstrap-execution-journal-v1',value,'journal_sha256')!==value.journal_sha256)
    fail('bootstrap-journal-digest');
  return structuredClone(value);
}
function validateBootstrapExecutionJournalTransition(prior,next,{priorRawSha256}={}){
  const before=validateBootstrapExecutionJournal(prior);
  const allowedPriorDigests=new Set([
    rawDigest(Buffer.from(journal.canonicalJson(before))),
    rawDigest(canonicalBootstrapJson(before)),
  ]);
  if(!DIGEST.test(priorRawSha256||'')||!allowedPriorDigests.has(priorRawSha256))
    fail('bootstrap-journal-cas');
  if(before.claim!=='none'&&next?.claim!==before.claim)fail('bootstrap-journal-claim-switch');
  const after=validateBootstrapExecutionJournal(next);
  for(const key of ['target_session_id','authorization_sha256','witness_sha256','executor_sha256'])
    if(after[key]!==before[key])fail('bootstrap-journal-identity');
  if(canonicalText(after.node_identity)!==canonicalText(before.node_identity))
    fail('bootstrap-journal-identity');
  if(before.claim!=='none'&&(after.claim!==before.claim||
    after.claim_operation_id!==before.claim_operation_id||
    canonicalText(after.claim_input)!==canonicalText(before.claim_input)))
    fail('bootstrap-journal-claim-switch');
  if(before.claim==='none'&&after.claim!=='none'&&
    (after.claim_input.input_journal_sha256!==priorRawSha256||
    after.claim_input.input_stage!==before.stage||
    after.claim_input.input_manifest_sha256!==before.stage_manifest_sha256))
    fail('bootstrap-journal-claim-input');
  return after;
}

function validateRawChannel(value,code){
  if(!exactKeys(value,['base64','byte_length','sha256'])||!Number.isInteger(value.byte_length)||
    value.byte_length<0||!DIGEST.test(value.sha256||''))fail(code);
  const bytes=strictBase64(value.base64);
  if(bytes.length!==value.byte_length||rawDigest(bytes)!==value.sha256)fail(code);
  return bytes;
}
function normalizedSignalMatchesExpected(observed,expected){
  if(!exactKeys(observed,['kind','operator','test_identity','expected_digest','actual_digest',
    'message'])||!expected)return false;
  const pattern=normalizeTapString(expected.message_pattern??expected.message??'');
  if(!pattern||observed.kind!==expected.kind||observed.operator!==expected.operator||
    canonicalText(observed.test_identity)!==canonicalText(expected.test_identity)||
    (expected.expected_digest!==null&&observed.expected_digest!==expected.expected_digest)||
    (expected.actual_digest!==null&&observed.actual_digest!==expected.actual_digest)||
    !normalizeTapString(observed.message).includes(pattern))return false;
  return true;
}
function classifyVerificationObservation({processResult,changedPaths,stdout,stderr,root,testPath,
  nodePatch,expectedSignal}){
  let observedClass,reasonCode,event=null,normalizedSignal=null;
  if(processResult.spawnError){observedClass='pre-spawn-rejected';reasonCode='pre-spawn';}
  else if(processResult.timedOut){observedClass='timed-out';reasonCode='timed-out';}
  else if(processResult.outputOverflow){
    observedClass='output-overflow';reasonCode='output-overflow';
  }else if(processResult.signal!==null||processResult.exitCode===null){
    observedClass='terminated';reasonCode='terminated';
  }else if(processResult.exitCode===0){
    observedClass='unexpected-pass';reasonCode='unexpected-pass';
  }else if(changedPaths.length!==0){
    observedClass='test-side-effect';reasonCode='governed-path-changed';
  }else if(stderr.length!==0){
    observedClass='invalid-output';reasonCode='stderr-nonempty';
  }else{
    try{
      const text=new TextDecoder('utf-8',{fatal:true}).decode(stdout);
      event=parseNodeTapFailure(text,{root,testPath,nodePatch});
    }catch(error){
      observedClass='invalid-output';
      reasonCode=error instanceof TypeError?'invalid-utf8':'invalid-tap';
    }
    if(event){
      const derived=deriveTapSignal(event);
      normalizedSignal=derived?{kind:derived.kind,operator:derived.operator,
        test_identity:{test_file:event.test_file,test_name:event.test_name,
          start_line:event.start_line},expected_digest:event.expected_digest,
        actual_digest:event.actual_digest,message:event.message}:null;
      const classified=classifyTapDiagnostic(event);
      if(classified?.observed_class==='expected-failure'&&
        normalizedSignalMatchesExpected(normalizedSignal,expectedSignal)){
        observedClass='expected-failure';reasonCode='signal-matched';
      }else if(classified&&classified.observed_class!=='expected-failure'){
        observedClass=classified.observed_class;reasonCode=classified.reason_code;
      }else{
        observedClass='unknown';reasonCode='unmatched';
      }
    }
  }
  return {adapter:'node-test-tap',adapter_version:1,observed_class:observedClass,
    diagnostic_event:event,diagnostic_event_sha256:event?
      semanticDigest('diagnostic-event-v1',event,null):null,
    normalized_signal:normalizedSignal,reason_code:reasonCode};
}
function validateBootstrapVerificationResultV2(value,{expectedSignal}={}){
  const terminalReasons=new Map([
    ['pre-spawn-rejected',new Set(['pre-spawn'])],
    ['timed-out',new Set(['timed-out'])],
    ['output-overflow',new Set(['output-overflow'])],
    ['terminated',new Set(['terminated'])],
    ['unexpected-pass',new Set(['unexpected-pass'])],
    ['test-side-effect',new Set(['governed-path-changed'])],
    ['invalid-output',new Set(['stderr-nonempty','unsupported-node','invalid-utf8','invalid-tap'])],
    ['syntax-error',new Set(['syntax-diagnostic'])],
    ['import-error',new Set(['import-diagnostic'])],
    ['fixture-error',new Set(['fixture-diagnostic'])],
    ['expected-failure',new Set(['signal-matched'])],
    ['collection-error',new Set(['collection-diagnostic'])],
    ['unknown',new Set(['unmatched'])],
  ]);
  if(!exactKeys(value,BOOTSTRAP_VERIFICATION_RESULT_KEYS)||value.schema_version!==2||
    !SESSION.test(value.session_id||'')||!/^SLICE-\d{3}$/.test(value.slice_id||'')||
    ['plan_authority_sha256','spec_sha256','verification_plan_sha256','result_sha256',
      'environment_sha256','execution_containment_sha256','supervisor_control_sha256']
      .some((key)=>!DIGEST.test(value[key]||''))||
    !OPERATION.test(value.write_operation_id||'')||!OPERATION.test(value.verification_operation_id||'')||
    value.cwd_role!=='worktree'||!new Set(['accepted','rejected']).has(value.disposition)||
    !Array.isArray(value.logical_argv)||!Array.isArray(value.normalized_argv))
    fail('bootstrap-verification-result');
  if(!exactKeys(value.executable_identity,['path','sha256','dev','ino','mode','size',
    'mtime_ns','node_version'])||!path.isAbsolute(value.executable_identity.path)||
    !DIGEST.test(value.executable_identity.sha256||'')||
    !/^\d+\.\d+\.\d+$/u.test(value.executable_identity.node_version||'')||
    ['dev','ino','mode','size','mtime_ns'].some((key)=>
      !/^\d+$/u.test(value.executable_identity[key]||'')))
    fail('bootstrap-verification-executable');
  if(!new Set(['clean','test-side-effect']).has(value.scope_disposition)||
    !uniqueSorted(value.changed_paths,{allowEmpty:true,pattern:/^.+$/})||
    (value.scope_disposition==='clean'&&value.changed_paths.length!==0)||
    (value.scope_disposition==='test-side-effect'&&value.changed_paths.length===0))
    fail('bootstrap-verification-scope');
  if(value.result_path!==`.claude/deep-work.${value.session_id}.verification.${value.verification_operation_id}.json`)
    fail('bootstrap-verification-path');
  if(!exactKeys(value.environment,['mode','values'])||value.environment.mode!=='closed'||
    semanticDigest('node-test-env-v1',value.environment,null)!==value.environment_sha256)
    fail('bootstrap-verification-environment');
  if(!exactKeys(value.execution_containment,['provider','node_patch','worktree_realpath',
    'owned_temp_realpath','logical_argv_sha256','effective_argv_sha256','denied_capabilities'])||
    semanticDigest('execution-containment-v1',value.execution_containment,null)!==
      value.execution_containment_sha256)fail('bootstrap-verification-containment');
  if(!exactKeys(value.supervisor_control,['platform','values','identities'])||
    semanticDigest('supervisor-control-v1',value.supervisor_control,null)!==
      value.supervisor_control_sha256)fail('bootstrap-verification-supervisor');
  if(!exactKeys(value.process,['exit_code','signal','timed_out','output_overflow','duration_ms',
    'spawn_error'])||
    !(Number.isInteger(value.process.exit_code)||value.process.exit_code===null)||
    !(typeof value.process.signal==='string'||value.process.signal===null)||
    typeof value.process.timed_out!=='boolean'||typeof value.process.output_overflow!=='boolean'||
    !Number.isInteger(value.process.duration_ms)||value.process.duration_ms<0||
    !(value.process.spawn_error===null||
      (exactKeys(value.process.spawn_error,['code','message_sha256'])&&
        new Set(['invalid-target','identity-drift','spawn-failed','environment-invalid'])
          .has(value.process.spawn_error.code)&&
        DIGEST.test(value.process.spawn_error.message_sha256||''))))
    fail('bootstrap-verification-process');
  const rawStdout=validateRawChannel(value.raw_stdout,'bootstrap-verification-stdout');
  const rawStderr=validateRawChannel(value.raw_stderr,'bootstrap-verification-stderr');
  for(const [name,ref] of [['pre',value.pre_manifest_ref],['post',value.post_manifest_ref]])
    if(!exactKeys(ref,['path','sha256'])||!DIGEST.test(ref.sha256||'')||
      ref.path!==`.claude/deep-work.${value.session_id}.verification-manifest.${value.verification_operation_id}.${name}.json`)
      fail('bootstrap-verification-manifest');
  const classification=value.classification;
  if(!exactKeys(classification,['adapter','adapter_version','observed_class','diagnostic_event',
    'diagnostic_event_sha256','normalized_signal','reason_code'])||
    classification.adapter!=='node-test-tap'||classification.adapter_version!==1||
    !terminalReasons.get(classification.observed_class)?.has(classification.reason_code))
    fail('bootstrap-verification-classification');
  const accepted=classification.observed_class==='expected-failure'&&
    classification.reason_code==='signal-matched'&&value.scope_disposition==='clean';
  if(value.disposition!==(accepted?'accepted':'rejected')||
    (classification.observed_class==='test-side-effect')!==
      (value.scope_disposition==='test-side-effect')||
    (classification.reason_code==='stderr-nonempty')!==(rawStderr.length!==0))
    fail('bootstrap-verification-classification');
  const processClass=classification.observed_class;
  const preSpawn=processClass==='pre-spawn-rejected';
  if((preSpawn&&(value.process.exit_code!==null||value.process.signal!==null||
      value.process.timed_out||value.process.output_overflow||
      value.process.duration_ms!==0||value.process.spawn_error===null||
      rawStdout.length!==0||rawStderr.length!==0))||
    (!preSpawn&&value.process.spawn_error!==null)||
    (processClass==='timed-out'&&(!value.process.timed_out||
      value.process.output_overflow))||
    (processClass==='output-overflow'&&(!value.process.output_overflow||
      value.process.timed_out))||
    (processClass==='terminated'&&(value.process.timed_out||
      value.process.output_overflow||(value.process.signal===null&&
        value.process.exit_code!==null)))||
    (processClass==='unexpected-pass'&&(value.process.exit_code!==0||
      value.process.signal!==null||value.process.timed_out||value.process.output_overflow))||
    (!new Set(['pre-spawn-rejected','timed-out','output-overflow','terminated',
      'unexpected-pass']).has(processClass)&&
      (!Number.isInteger(value.process.exit_code)||value.process.exit_code===0||
        value.process.signal!==null||value.process.timed_out||value.process.output_overflow)))
    fail('bootstrap-verification-process');
  const parsed=classification.diagnostic_event!==null;
  if(parsed!==DIGEST.test(classification.diagnostic_event_sha256||'')||
    (parsed&&semanticDigest('diagnostic-event-v1',classification.diagnostic_event,null)!==
      classification.diagnostic_event_sha256)||
    (!parsed&&(classification.diagnostic_event_sha256!==null||
      classification.normalized_signal!==null)))
    fail('bootstrap-verification-classification');
  const replay=classifyVerificationObservation({processResult:{
    exitCode:value.process.exit_code,signal:value.process.signal,
    timedOut:value.process.timed_out,outputOverflow:value.process.output_overflow,
    spawnError:value.process.spawn_error},changedPaths:value.changed_paths,
    stdout:rawStdout,stderr:rawStderr,root:value.execution_containment.worktree_realpath,
    testPath:value.logical_argv[3],nodePatch:value.executable_identity.node_version,
    expectedSignal});
  if(canonicalText(replay)!==canonicalText(classification))
    fail('bootstrap-verification-classification');
  if(semanticDigest('verification-result-v2',value,'result_sha256')!==value.result_sha256)
    fail('bootstrap-verification-digest');
  return structuredClone(value);
}
function validateBootstrapRedProofV1(value){
  if(!exactKeys(value,BOOTSTRAP_RED_PROOF_KEYS)||value.schema_version!==1||
    !SESSION.test(value.session_id||'')||!/^SLICE-\d{3}$/.test(value.slice_id||'')||
    value.transition_kind!=='bootstrap-adoption'||
    ['plan_authority_sha256','spec_sha256','spec_approved_hash','verification_plan_sha256',
      'write_receipt_sha256','verification_result_sha256','verification_ledger_result_sha256',
      'transition_ledger_result_sha256','classification_digest','proof_sha256']
      .some((key)=>!DIGEST.test(value[key]||''))||
    ['write_operation_id','verification_operation_id','transition_operation_id',
      'bootstrap_bridge_operation_id','proof_operation_id'].some((key)=>!OPERATION.test(value[key]||'')))
    fail(value?.transition_kind!=='bootstrap-adoption'?'bootstrap-red-proof-transition':'bootstrap-red-proof');
  if(semanticDigest('red-proof-v1',value,'proof_sha256')!==value.proof_sha256)
    fail('bootstrap-red-proof-digest');
  return structuredClone(value);
}
function precomputeBootstrapCompletion(input){
  const keys=['target_session_id','authorization_sha256','witness_sha256','execution_sha256',
    'pre_runtime_version','post_runtime_version','test_patch_sha256','patch_sha256',
    'base_manifest_sha256','red_manifest_sha256','post_manifest_sha256','test_changed_paths',
    'changed_paths','review_report_refs','first_red_slice_id','first_red_verification_spec_sha256',
    'completion_operation_id'];
  if(!exactKeys(input,keys)||!SESSION.test(input.target_session_id||'')||
    ['authorization_sha256','witness_sha256','execution_sha256','test_patch_sha256','patch_sha256',
      'base_manifest_sha256','red_manifest_sha256','post_manifest_sha256',
      'first_red_verification_spec_sha256'].some((key)=>!DIGEST.test(input[key]||''))||
    !OPERATION.test(input.completion_operation_id||'')||!/^SLICE-\d{3}$/.test(input.first_red_slice_id||'')||
    !uniqueSorted(input.test_changed_paths,{pattern:/^.+$/})||
    !uniqueSorted(input.changed_paths,{pattern:/^.+$/})||!Array.isArray(input.review_report_refs))
    fail('bootstrap-completion-input');
  const receipt={schema_version:1,...structuredClone(input),receipt_sha256:null};
  receipt.receipt_sha256=semanticDigest('bootstrap-receipt-v1',receipt,'receipt_sha256');
  const marker={schema_version:1,target_session_id:input.target_session_id,
    authorization_sha256:input.authorization_sha256,witness_sha256:input.witness_sha256,
    execution_sha256:input.execution_sha256,
    bootstrap_receipt_path:`.deep-work/${input.target_session_id}/bootstrap/bootstrap-receipt.json`,
    bootstrap_receipt_sha256:receipt.receipt_sha256,first_red_slice_id:input.first_red_slice_id,
    first_red_verification_spec_sha256:input.first_red_verification_spec_sha256,
    completion_operation_id:input.completion_operation_id,marker_sha256:null};
  marker.marker_sha256=semanticDigest('bootstrap-marker-v1',marker,'marker_sha256');
  return {receipt,marker};
}

function validateBootstrapCompletionAuthority({receipt,marker,operationReceipt}={}){
  const receiptKeys=['schema_version','target_session_id','authorization_sha256','witness_sha256',
    'execution_sha256','pre_runtime_version','post_runtime_version','test_patch_sha256',
    'patch_sha256','base_manifest_sha256','red_manifest_sha256','post_manifest_sha256',
    'test_changed_paths','changed_paths','review_report_refs','first_red_slice_id',
    'first_red_verification_spec_sha256','completion_operation_id','receipt_sha256'];
  const markerKeys=['schema_version','target_session_id','authorization_sha256','witness_sha256',
    'execution_sha256','bootstrap_receipt_path','bootstrap_receipt_sha256','first_red_slice_id',
    'first_red_verification_spec_sha256','completion_operation_id','marker_sha256'];
  if(!exactKeys(receipt,receiptKeys)||receipt.schema_version!==1||
    !SESSION.test(receipt.target_session_id||'')||!OPERATION.test(receipt.completion_operation_id||'')||
    ['authorization_sha256','witness_sha256','execution_sha256','test_patch_sha256','patch_sha256',
      'base_manifest_sha256','red_manifest_sha256','post_manifest_sha256',
      'first_red_verification_spec_sha256','receipt_sha256']
      .some((key)=>!DIGEST.test(receipt[key]||''))||
    semanticDigest('bootstrap-receipt-v1',receipt,'receipt_sha256')!==receipt.receipt_sha256)
    fail('bootstrap-completion-receipt');
  if(!exactKeys(marker,markerKeys)||marker.schema_version!==1||
    marker.target_session_id!==receipt.target_session_id||
    marker.authorization_sha256!==receipt.authorization_sha256||
    marker.witness_sha256!==receipt.witness_sha256||
    marker.execution_sha256!==receipt.execution_sha256||
    marker.bootstrap_receipt_path!==`.deep-work/${receipt.target_session_id}/bootstrap/bootstrap-receipt.json`||
    marker.bootstrap_receipt_sha256!==receipt.receipt_sha256||
    marker.first_red_slice_id!==receipt.first_red_slice_id||
    marker.first_red_verification_spec_sha256!==receipt.first_red_verification_spec_sha256||
    marker.completion_operation_id!==receipt.completion_operation_id||
    semanticDigest('bootstrap-marker-v1',marker,'marker_sha256')!==marker.marker_sha256)
    fail('bootstrap-completion-marker');
  const expectedResult={target_session_id:receipt.target_session_id,
    receipt_path:marker.bootstrap_receipt_path,receipt_sha256:receipt.receipt_sha256,
    marker_path:`.deep-work/${receipt.target_session_id}/bootstrap/marker.json`,
    marker_sha256:marker.marker_sha256};
  if(!operationReceipt||operationReceipt.operationId!==receipt.completion_operation_id||
    operationReceipt.kind!=='bootstrap-finalize'||operationReceipt.stage!=='completed-ledger'||
    canonicalText(operationReceipt.result)!==canonicalText(expectedResult))
    fail('bootstrap-completion-producer');
  return {receipt:structuredClone(receipt),marker:structuredClone(marker),
    operationReceipt:structuredClone(operationReceipt)};
}

function sessionIdForState(stateCapability){
  const match=path.basename(stateCapability?.path||'').match(/^deep-work\.(s-[0-9a-f]{8})\.md$/);
  if(!match||typeof stateCapability.projectRoot!=='string')fail('bootstrap-state-capability');
  return match[1];
}
function controlRelative(sessionId,name){return `.deep-work/${sessionId}/bootstrap/${name}`;}
function assertControlPath(root,file,sessionId,name){
  const expected=path.join(root,...controlRelative(sessionId,name).split('/'));
  if(path.resolve(file)!==expected)fail('bootstrap-control-path');
  return expected;
}
function readJsonArtifact(file,code,{canonical=false,maxBytes=16*1024*1024}={}){
  let stat;try{stat=fs.lstatSync(file);}catch{fail(code);}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)fail(code);
  const bytes=fs.readFileSync(file);let value;
  try{value=JSON.parse(bytes);}catch{fail(code);}
  if(canonical){
    const noLf=canonicalBootstrapJson(value),withLf=Buffer.from(journal.canonicalJson(value));
    if(!bytes.equals(noLf)&&!bytes.equals(withLf))fail(`${code}-canonical`);
  }
  return {value,bytes,sha256:rawDigest(bytes)};
}
function writeExclusiveArtifact(file,value){
  const bytes=canonicalBootstrapJson(value);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
  }catch(error){
    if(error.code==='EEXIST'){
      const current=fs.readFileSync(file);
      if(current.equals(bytes))return {bytes:current,sha256:rawDigest(current),adopted:true};
      fail('bootstrap-exclusive-conflict');
    }
    throw error;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  const current=fs.readFileSync(file);
  if(!current.equals(bytes))fail('bootstrap-exclusive-reread');
  return {bytes:current,sha256:rawDigest(current),adopted:false};
}
function writeExclusiveBytes(file,bytes){
  const expected=Buffer.from(bytes);fs.mkdirSync(path.dirname(file),{recursive:true});let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
    fs.writeFileSync(fd,expected);fs.fsyncSync(fd);
  }catch(error){
    if(error.code==='EEXIST'&&fs.readFileSync(file).equals(expected))
      return {sha256:rawDigest(expected),adopted:true};
    throw error;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
  if(!fs.readFileSync(file).equals(expected))fail('bootstrap-exclusive-reread');
  return {sha256:rawDigest(expected),adopted:false};
}
function deterministicOperationId(label,value){
  return `op-${rawDigest(Buffer.concat([Buffer.from(`${label}\0`),
    Buffer.from(journal.canonicalJson(value))]))}`;
}
function sessionFileCapability(stateCapability,file,basenames,role,{allowMissing=false}={}){
  const platform=require('./platform.js'),transaction=require('./transaction-runtime.js');
  const sessionId=sessionIdForState(stateCapability);
  const sessionCapability=platform.issueProjectStateCapability(stateCapability.projectRoot,
    path.join(stateCapability.projectRoot,'.deep-work',sessionId),
    {role:'session-work-dir',sessionStateCapability:stateCapability});
  return transaction.issueSessionFileCapability({sessionCapability,candidate:file,
    allowedBasenames:basenames,allowMissingLeaf:allowMissing,role});
}
function replaceExecutionJournal(stateCapability,file,prior,next){
  const transaction=require('./transaction-runtime.js');
  const current=readJsonArtifact(file,'bootstrap-execution-journal',{canonical:true});
  if(current.value.journal_sha256!==prior.journal_sha256)fail('bootstrap-journal-cas');
  next.journal_sha256=semanticDigest('bootstrap-execution-journal-v1',next,'journal_sha256');
  const checked=validateBootstrapExecutionJournalTransition(prior,next,{priorRawSha256:current.sha256});
  const capability=sessionFileCapability(stateCapability,file,['execution-journal.json'],
    'bootstrap-execution-journal');
  transaction.atomicWriteSessionFile(capability,canonicalBootstrapJson(checked));
  return checked;
}
function withBootstrapLock(stateCapability,callback){
  const platform=require('./platform.js'),sessionId=sessionIdForState(stateCapability);
  const lock=platform.issueProjectStateCapability(stateCapability.projectRoot,
    path.join(stateCapability.projectRoot,'.claude',`deep-work.${sessionId}.bootstrap-control.lock`),
    {role:'lock',allowMissingLeaf:true});
  return platform.withDirectoryLock(lock,{timeoutMs:30_000,staleMs:120_000,heartbeatMs:5_000,
    inspectable:true,
    processIdentity:rawDigest(Buffer.from(`bootstrap:${process.pid}`)).slice(0,32)},callback);
}
function loadBootstrapControl({stateCapability,authorizationPath,failurePath}){
  const sessionId=sessionIdForState(stateCapability),root=stateCapability.projectRoot;
  const authorizationFile=assertControlPath(root,authorizationPath,sessionId,'authorization.json');
  const failureFile=failurePath===undefined?null:
    assertControlPath(root,failurePath,sessionId,'failure.json');
  const authorization=validateBootstrapAuthorization(
    readJsonArtifact(authorizationFile,'bootstrap-authorization',{canonical:true}).value);
  if(authorization.witness.target_session_id!==sessionId)fail('bootstrap-authorization-identity');
  return {stateCapability,sessionId,root,authorization,failurePath:failureFile,
    journalPath:path.join(root,...controlRelative(sessionId,'execution-journal.json').split('/'))};
}
function reconstructClaimedPrior(current){
  if(current.claim==='none')return current;
  const prior={...current,stage:current.claim_input.input_stage,
    stage_manifest_sha256:current.claim_input.input_manifest_sha256,
    claim:'none',claim_operation_id:null,claim_input:null,journal_sha256:null};
  prior.journal_sha256=semanticDigest('bootstrap-execution-journal-v1',prior,'journal_sha256');
  return validateBootstrapExecutionJournal(prior);
}
function bindControlJournal(context){
  const raw=readJsonArtifact(context.journalPath,'bootstrap-execution-journal',{canonical:true});
  const value=validateBootstrapExecutionJournal(raw.value),witness=context.authorization.witness;
  if(value.target_session_id!==context.sessionId||
    value.authorization_sha256!==context.authorization.authorization_sha256||
    value.witness_sha256!==witness.witness_sha256||value.executor_sha256!==witness.executor_sha256||
    canonicalText(value.node_identity)!==canonicalText(witness.node_identity))
    fail('bootstrap-journal-identity');
  return {value,raw};
}
function recoveryRequiredForConflict(context,current,conflictSha256){
  const preimage={target_session_id:context.sessionId,
    authorization_sha256:context.authorization.authorization_sha256,
    witness_sha256:context.authorization.witness.witness_sha256,
    execution_journal_sha256:current.journal_sha256,observed_stage:current.stage,
    observed_manifest_sha256:current.stage_manifest_sha256,
    failure_artifact_sha256:conflictSha256};
  const operationId=deterministicOperationId('bootstrap-abort-v1',preimage);
  let claimed=current;
  if(current.claim==='none'){
    const currentRaw=readJsonArtifact(context.journalPath,'bootstrap-execution-journal',
      {canonical:true});
    claimed=replaceExecutionJournal(context.stateCapability,context.journalPath,current,{
      ...current,stage:'recovery-required',claim:'abort',claim_operation_id:operationId,
      claim_input:{kind:'failure-conflict',input_journal_sha256:currentRaw.sha256,
        input_stage:current.stage,input_manifest_sha256:current.stage_manifest_sha256,
        input_artifact_sha256:conflictSha256},journal_sha256:null});
  }else if(current.claim!=='abort'||current.claim_operation_id!==operationId){
    fail('bootstrap-abort-claim-conflict');
  }
  const artifact={schema_version:1,target_session_id:context.sessionId,operation_id:operationId,
    authorization_sha256:context.authorization.authorization_sha256,
    witness_sha256:context.authorization.witness.witness_sha256,
    failure_artifact_sha256:conflictSha256,observed_stage:preimage.observed_stage,
    observed_manifest_sha256:preimage.observed_manifest_sha256,
    reason:'failure-artifact-conflict',artifact_sha256:null};
  artifact.artifact_sha256=semanticDigest('bootstrap-recovery-required-v1',artifact,'artifact_sha256');
  const artifactPath=path.join(context.root,...controlRelative(context.sessionId,
    'recovery-required.json').split('/'));
  try{writeExclusiveArtifact(artifactPath,artifact);}
  catch(error){if(error.code!=='bootstrap-exclusive-conflict')throw error;
    const existing=readJsonArtifact(artifactPath,'bootstrap-recovery-required',{canonical:true});
    if(canonicalText(existing.value)!==canonicalText(artifact))throw error;}
  return {status:'recovery-required',operation_id:operationId,
    artifact_path:controlRelative(context.sessionId,'recovery-required.json'),
    artifact_sha256:artifact.artifact_sha256,journal_sha256:claimed.journal_sha256};
}
function claimBootstrapFailure(context){
  const {value:current}=bindControlJournal(context);
  if(current.claim==='finalize')fail('bootstrap-finalizer-recovery-required');
  let failureRaw,failure;
  try{
    failureRaw=readJsonArtifact(context.failurePath,'bootstrap-failure',{canonical:true});
    failure=validateBootstrapFailureArtifact(failureRaw.value,{
      witness:context.authorization.witness,worktreeRoot:context.root});
  }catch(error){
    let bytes;try{bytes=fs.readFileSync(context.failurePath);}catch{throw error;}
    return {terminal:recoveryRequiredForConflict(context,current,rawDigest(bytes))};
  }
  const observed=reconstructClaimedPrior(current);
  if(failure.authorization_sha256!==context.authorization.authorization_sha256||
    failure.execution_journal_sha256!==observed.journal_sha256||
    failure.observed_stage!==observed.stage||
    failure.observed_manifest_sha256!==observed.stage_manifest_sha256)
    fail('bootstrap-failure-binding');
  const preimage={target_session_id:context.sessionId,
    authorization_sha256:context.authorization.authorization_sha256,
    witness_sha256:context.authorization.witness.witness_sha256,
    execution_journal_sha256:failure.execution_journal_sha256,
    observed_stage:failure.observed_stage,
    observed_manifest_sha256:failure.observed_manifest_sha256,
    failure_artifact_sha256:failureRaw.sha256};
  const operationId=deterministicOperationId('bootstrap-abort-v1',preimage);
  if(current.claim==='abort'){
    if(current.claim_operation_id!==operationId||current.claim_input?.kind!=='failure'||
      current.claim_input.input_artifact_sha256!==failureRaw.sha256)
      fail('bootstrap-abort-claim-conflict');
    return {operationId,failure,failureRaw,preimage,current,adopted:true};
  }
  const currentRaw=readJsonArtifact(context.journalPath,'bootstrap-execution-journal',{canonical:true});
  const next=replaceExecutionJournal(context.stateCapability,context.journalPath,current,{
    ...current,stage:'abort-claimed',claim:'abort',claim_operation_id:operationId,
    claim_input:{kind:'failure',input_journal_sha256:currentRaw.sha256,input_stage:current.stage,
      input_manifest_sha256:current.stage_manifest_sha256,
      input_artifact_sha256:failureRaw.sha256},journal_sha256:null});
  return {operationId,failure,failureRaw,preimage,current:next,adopted:false};
}
async function publishBootstrapFailure({stateCapability,authorizationPath,failurePath}={}){
  const context=loadBootstrapControl({stateCapability,authorizationPath,failurePath});
  return withBootstrapLock(stateCapability,async()=>{
    const claimed=claimBootstrapFailure(context);
    if(claimed.terminal)return claimed.terminal;
    return {status:'abort-claimed',operation_id:claimed.operationId,
      failure_artifact_sha256:claimed.failureRaw.sha256,
      journal_sha256:claimed.current.journal_sha256,adopted:claimed.adopted};
  });
}

function bootstrapMutationIdentity(stat){
  const nanos=(value,millis)=>value===undefined?
    String(Math.trunc(Number(millis)*1_000_000)):String(value);
  return {dev:String(stat.dev),ino:String(stat.ino),mode:String(stat.mode),
    type:stat.isDirectory()?'directory':stat.isFile()?'file':
      stat.isSymbolicLink()?'link':'other',size:String(stat.size),
    mtime_ns:nanos(stat.mtimeNs,stat.mtimeMs),ctime_ns:nanos(stat.ctimeNs,stat.ctimeMs)};
}
function snapshotIdleRuntimeLock(root,lockRelative,claimsRelative){
  const lockPath=path.join(root,...lockRelative.split('/'));
  try{
    fs.lstatSync(lockPath);
    fail('bootstrap-manifest-lock-active');
  }catch(error){
    if(error.code!=='ENOENT')throw error;
  }
  const claimsPath=path.join(root,...claimsRelative.split('/'));
  let stat,names;
  try{
    stat=fs.lstatSync(claimsPath,{bigint:true});
    names=fs.readdirSync(claimsPath)
      .sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)));
  }catch(error){
    if(error.code==='ENOENT')return {present:false};
    fail('bootstrap-manifest-lock-claims');
  }
  if(!stat.isDirectory()||stat.isSymbolicLink()||names.length!==0)
    fail('bootstrap-manifest-lock-claims');
  return {present:true,identity:bootstrapMutationIdentity(stat),names};
}
function verifyIdleRuntimeLock(root,lockRelative,claimsRelative,prior){
  const current=snapshotIdleRuntimeLock(root,lockRelative,claimsRelative);
  if(canonicalText(current)!==canonicalText(prior))fail('bootstrap-manifest-lock-unstable');
}
function heldBootstrapLockProjection(root,sessionId,claim){
  const platform=require('./platform.js');
  const lock=platform.issueProjectStateCapability(root,
    path.join(root,'.claude',`deep-work.${sessionId}.bootstrap-control.lock`),
    {role:'lock',allowMissingLeaf:true});
  return platform.inspectOwnedDirectoryClaim(lock,claim);
}

function captureBootstrapManifest(root,witness,phase,options={}){
  if(!plainObject(options)||Object.keys(options).some((key)=>
    !['bootstrapLockClaim','currentOperation'].includes(key)))
    fail('bootstrap-manifest-capture-options');
  const bootstrapLockClaim=options.bootstrapLockClaim??null;
  const currentOperation=validateBootstrapCurrentOperation(options.currentOperation);
  const sessionId=witness.target_session_id;
  const bootstrapLockRelative=`.claude/deep-work.${sessionId}.bootstrap-control.lock`;
  const bootstrapClaimsRelative=`${bootstrapLockRelative}.claims`;
  const operationLockRelative=`.claude/deep-work.${sessionId}.operations.lock`;
  const operationClaimsRelative=`${operationLockRelative}.claims`;
  const heldProjection=bootstrapLockClaim===null?null:
    heldBootstrapLockProjection(root,sessionId,bootstrapLockClaim);
  const bootstrapIdle=bootstrapLockClaim===null?
    snapshotIdleRuntimeLock(root,bootstrapLockRelative,bootstrapClaimsRelative):null;
  const operationIdle=snapshotIdleRuntimeLock(root,operationLockRelative,operationClaimsRelative);
  const {spawnSync}=require('node:child_process');
  const git=(args,{allowStatusOne=false}={})=>{
    const result=spawnSync('git',['-C',root,...args],{encoding:null});
    if(result.signal!==null||(!allowStatusOne&&result.status!==0)||
      (allowStatusOne&&![0,1].includes(result.status))||(result.stderr?.length||0))
      fail('bootstrap-manifest-git');
    return result;
  };
  const decode=(bytes)=>{
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch{fail('bootstrap-manifest-git');}
  };
  const head=decode(git(['rev-parse','HEAD']).stdout).trim();
  if(!OID.test(head)||head!==witness.base_head_oid)fail('bootstrap-manifest-head');
  const commonText=decode(git(['rev-parse','--git-common-dir']).stdout).trim();
  const worktreeText=decode(git(['worktree','list','--porcelain']).stdout);
  const firstWorktree=worktreeText.split('\n').find((line)=>line.startsWith('worktree '));
  if(!commonText||!firstWorktree)fail('bootstrap-manifest-repository');
  let commonGitDir,repositoryRoot,targetWorktreeRoot;
  try{
    commonGitDir=fs.realpathSync(path.resolve(root,commonText));
    repositoryRoot=fs.realpathSync(firstWorktree.slice('worktree '.length));
    targetWorktreeRoot=fs.realpathSync(root);
  }catch{fail('bootstrap-manifest-repository');}
  const repositoryIdentity=rawDigest(Buffer.from(canonicalText({
    common_git_dir:commonGitDir,repository_root:repositoryRoot,
    target_worktree_root:targetWorktreeRoot,base_head_oid:head,
  })));
  if(repositoryIdentity!==witness.repository_identity_sha256)
    fail('bootstrap-manifest-repository');
  if((git(['ls-files','-u','-z']).stdout?.length||0)!==0)
    fail('bootstrap-manifest-index');
  const cached=git(['diff','--cached','--quiet','HEAD','--'],{allowStatusOne:true});
  if(cached.status!==0||(cached.stdout?.length||0)!==0)fail('bootstrap-manifest-index');
  const parseIndex=()=>{
    const bytes=git(['ls-files','-s','-z']).stdout||Buffer.alloc(0);
    const records=bytes.length?decode(bytes.subarray(0,bytes.at(-1)===0?bytes.length-1:bytes.length))
      .split('\0'):[];
    return records.map((record)=>{
      const match=record.match(/^([0-7]{6}) ([0-9a-f]{40}) ([0-3])\t([\s\S]+)$/);
      if(!match||match[3]!=='0'||!portablePath(match[4]))fail('bootstrap-manifest-index');
      return {mode:match[1],oid:match[2],path:match[4]};
    }).sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
  };
  const parseTree=()=>{
    const bytes=git(['ls-tree','-r','-z','--full-tree','HEAD']).stdout||Buffer.alloc(0);
    const records=bytes.length?decode(bytes.subarray(0,bytes.at(-1)===0?bytes.length-1:bytes.length))
      .split('\0'):[];
    return records.map((record)=>{
      const match=record.match(/^([0-7]{6}) blob ([0-9a-f]{40})\t([\s\S]+)$/);
      if(!match||!portablePath(match[3]))fail('bootstrap-manifest-index');
      return {mode:match[1],oid:match[2],path:match[3]};
    }).sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
  };
  const indexRows=parseIndex(),treeRows=parseTree();
  if(canonicalText(indexRows)!==canonicalText(treeRows))fail('bootstrap-manifest-index');
  const flagBytes=git(['ls-files','-v','-z']).stdout||Buffer.alloc(0);
  const flagRecords=flagBytes.length?
    decode(flagBytes.subarray(0,flagBytes.at(-1)===0?flagBytes.length-1:flagBytes.length))
      .split('\0'):[];
  const flagPaths=flagRecords.map((record)=>{
    if(!record.startsWith('H ')||!portablePath(record.slice(2)))
      fail('bootstrap-manifest-index');
    return record.slice(2);
  }).sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)));
  if(canonicalText(flagPaths)!==canonicalText(indexRows.map((row)=>row.path)))
    fail('bootstrap-manifest-index');
  const exclusions=new Set(bootstrapExcludedPaths(sessionId));
  const directoryExclusions=new Set(bootstrapRuntimeLockPaths(sessionId));
  const inodeOwners=new Set();
  const entries=[];
  const observedFiles=[];
  let currentJournalFound=false;
  let currentJournalObservation=null;
  const walk=(directory,relativeRoot='')=>{
    let directoryStat,names;
    try{
      directoryStat=fs.lstatSync(directory);
      names=fs.readdirSync(directory)
        .sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)));
    }catch{fail('bootstrap-manifest-capture');}
    if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())
      fail('bootstrap-manifest-capture');
    const directoryIdentity=`${directoryStat.dev}:${directoryStat.ino}:${directoryStat.mode}`;
    for(const name of names){
      const relative=relativeRoot?`${relativeRoot}/${name}`:name;
      if(relative==='.git')continue;
      if(!portablePath(relative))fail('bootstrap-manifest-capture');
      const file=path.join(directory,name);let stat;
      try{stat=fs.lstatSync(file,{bigint:true});}catch{fail('bootstrap-manifest-capture');}
      const currentVerificationPre=currentOperation?.kind==='bootstrap-first-red'&&
        relative===`.claude/deep-work.${sessionId}.verification-manifest.`+
          `${currentOperation.operation_id}.pre.json`;
      if(currentVerificationPre){
        if(!stat.isFile()||stat.isSymbolicLink())fail('bootstrap-manifest-capture');
        const raw=readJsonArtifact(file,'bootstrap-first-red-pre-manifest',{canonical:true});
        const prior=validateBootstrapManifest(raw.value,{sessionId});
        if(prior.phase!=='pre'||prior.repository_identity_sha256!==
          witness.repository_identity_sha256||prior.base_head_oid!==witness.base_head_oid)
          fail('bootstrap-manifest-current-operation');
        continue;
      }
      const currentJournal=isAuthenticatedBootstrapCurrentJournal(relative,file,sessionId,
        currentOperation);
      if(currentJournal){
        if(currentJournalFound)fail('bootstrap-manifest-current-operation');
        currentJournalFound=true;
        currentJournalObservation=currentJournal;
        continue;
      }
      if(exclusions.has(relative)){
        const valid=directoryExclusions.has(relative)?stat.isDirectory():stat.isFile();
        if(!valid||stat.isSymbolicLink())fail('bootstrap-manifest-capture');
        continue;
      }
      if(stat.isDirectory()&&!stat.isSymbolicLink())walk(file,relative);
      else{
        if(!stat.isFile()||stat.isSymbolicLink())fail('bootstrap-manifest-capture');
        const inode=`${stat.dev}:${stat.ino}`;
        if(inodeOwners.has(inode))fail('bootstrap-manifest-hardlink');
        inodeOwners.add(inode);
        const identity=bootstrapMutationIdentity(stat);
        const content=fs.readFileSync(file);
        let afterContent,afterFileStat;
        try{
          afterContent=fs.readFileSync(file);
          afterFileStat=fs.lstatSync(file,{bigint:true});
        }catch{fail('bootstrap-manifest-file-unstable');}
        if(!content.equals(afterContent)||
          canonicalText(identity)!==canonicalText(bootstrapMutationIdentity(afterFileStat)))
          fail('bootstrap-manifest-file-unstable');
        entries.push({path:relative,type:'file',mode:String(stat.mode),size:content.length,
          sha256:rawDigest(content)});
        observedFiles.push({file,identity,sha256:rawDigest(content),size:content.length});
      }
    }
    let afterStat,afterNames;
    try{
      afterStat=fs.lstatSync(directory);
      afterNames=fs.readdirSync(directory)
        .sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)));
    }catch{fail('bootstrap-manifest-capture');}
    if(!afterStat.isDirectory()||afterStat.isSymbolicLink()||
      `${afterStat.dev}:${afterStat.ino}:${afterStat.mode}`!==directoryIdentity||
      canonicalText(afterNames)!==canonicalText(names))
      fail('bootstrap-manifest-unstable');
  };
  walk(root);
  for(const observed of observedFiles){
    let stat,content;
    try{
      stat=fs.lstatSync(observed.file,{bigint:true});
      content=fs.readFileSync(observed.file);
    }catch{fail('bootstrap-manifest-file-unstable');}
    if(canonicalText(bootstrapMutationIdentity(stat))!==canonicalText(observed.identity)||
      content.length!==observed.size||rawDigest(content)!==observed.sha256)
      fail('bootstrap-manifest-file-unstable');
  }
  if(currentJournalObservation!==null){
    let stat,content;
    try{
      stat=fs.lstatSync(currentJournalObservation.file,{bigint:true});
      content=fs.readFileSync(currentJournalObservation.file);
    }catch{fail('bootstrap-manifest-runtime-journal');}
    if(canonicalText(bootstrapMutationIdentity(stat))!==
      canonicalText(currentJournalObservation.identity)||
      content.length!==currentJournalObservation.size||
      rawDigest(content)!==currentJournalObservation.sha256)
      fail('bootstrap-manifest-runtime-journal');
  }
  if(currentOperation!==null&&!currentJournalFound)
    fail('bootstrap-manifest-current-operation-missing');
  if(bootstrapLockClaim===null)
    verifyIdleRuntimeLock(root,bootstrapLockRelative,bootstrapClaimsRelative,bootstrapIdle);
  else if(canonicalText(heldBootstrapLockProjection(root,sessionId,bootstrapLockClaim))!==
    canonicalText(heldProjection))fail('bootstrap-manifest-lock-unstable');
  verifyIdleRuntimeLock(root,operationLockRelative,operationClaimsRelative,operationIdle);
  entries.sort((left,right)=>Buffer.compare(Buffer.from(left.path),Buffer.from(right.path)));
  const value={schema_version:1,repository_identity_sha256:repositoryIdentity,
    base_head_oid:head,phase,
    excluded_paths:bootstrapExcludedPaths(witness.target_session_id),entries,manifest_sha256:null};
  value.manifest_sha256=semanticDigest('bootstrap-manifest-v1',value,'manifest_sha256');
  return validateBootstrapManifest(value,{sessionId:witness.target_session_id});
}
function applyReversePatch(root,file){
  const {spawnSync}=require('node:child_process');let stat;
  try{stat=fs.lstatSync(file);}catch{return false;}
  if(!stat.isFile()||stat.isSymbolicLink())return false;
  const checked=spawnSync('git',['-C',root,'apply','--check',file],{encoding:null});
  if(checked.status!==0||checked.signal!==null)return false;
  const applied=spawnSync('git',['-C',root,'apply',file],{encoding:null});
  return applied.status===0&&applied.signal===null;
}
function validateAbortArtifact(value,kind){
  const common=['schema_version','target_session_id','operation_id','authorization_sha256',
    'witness_sha256','failure_artifact_sha256','observed_stage','observed_manifest_sha256'];
  const keys=kind==='receipt'?[...common,'restored_base_manifest_sha256','receipt_sha256']:
    [...common,'reason','artifact_sha256'];
  const digestKey=kind==='receipt'?'receipt_sha256':'artifact_sha256';
  if(!exactKeys(value,keys)||value.schema_version!==1||!SESSION.test(value.target_session_id||'')||
    !OPERATION.test(value.operation_id||'')||
    ['authorization_sha256','witness_sha256','failure_artifact_sha256',
      'observed_manifest_sha256',digestKey].some((key)=>!DIGEST.test(value[key]||''))||
    !BOOTSTRAP_EXECUTION_STAGES.includes(value.observed_stage)||
    kind==='receipt'&&!DIGEST.test(value.restored_base_manifest_sha256||'')||
    kind==='recovery'&&typeof value.reason!=='string'||
    semanticDigest(kind==='receipt'?'bootstrap-abort-receipt-v1':
      'bootstrap-recovery-required-v1',value,digestKey)!==value[digestKey])
    fail(`bootstrap-abort-${kind}`);
  return structuredClone(value);
}
async function completedOperation(project,operationId,sessionId,kind){
  try{return await journal.resumeOperation({projectCapability:project,operationId,sessionId,kind});}
  catch(error){if(error.code==='operation-not-found')return null;throw error;}
}
function stageSet(operationState){return new Set((operationState?.stages||[]).map((row)=>row.stage));}
async function abortBootstrap({stateCapability,authorizationPath,failurePath}={}){
  const context=loadBootstrapControl({stateCapability,authorizationPath,failurePath});
  return withBootstrapLock(stateCapability,async(bootstrapLockClaim)=>{
    const claimed=claimBootstrapFailure(context);
    if(claimed.terminal)return claimed.terminal;
    const transaction=require('./transaction-runtime.js');
    const project=transaction.projectCapabilityFor(stateCapability);
    const controlRoot=path.join(context.root,'.deep-work',context.sessionId,'bootstrap');
    const receiptPath=path.join(controlRoot,'abort-receipt.json');
    const recoveryPath=path.join(controlRoot,'recovery-required.json');
    const resultFor=(terminal,kind)=>kind==='receipt'?{
      status:'aborted-restored',target_session_id:context.sessionId,
      receipt_path:controlRelative(context.sessionId,'abort-receipt.json'),
      receipt_sha256:rawDigest(canonicalBootstrapJson(terminal)),
      restored_base_manifest_sha256:terminal.restored_base_manifest_sha256}:{
      status:'recovery-required',target_session_id:context.sessionId,
      artifact_path:controlRelative(context.sessionId,'recovery-required.json'),
      artifact_sha256:terminal.artifact_sha256,
      observed_manifest_sha256:terminal.observed_manifest_sha256};
    const existingOperation=await completedOperation(project,claimed.operationId,context.sessionId,
      'bootstrap-abort');
    if(existingOperation?.stage==='completed-ledger'){
      const isReceipt=existingOperation.result?.status==='aborted-restored';
      const terminalPath=isReceipt?receiptPath:recoveryPath;
      const terminal=validateAbortArtifact(readJsonArtifact(terminalPath,
        isReceipt?'bootstrap-abort-receipt':'bootstrap-recovery-required',
        {canonical:true}).value,isReceipt?'receipt':'recovery');
      const result=resultFor(terminal,isReceipt?'receipt':'recovery');
      if(canonicalText(existingOperation.result)!==canonicalText(result))
        fail('bootstrap-abort-producer');
      return {...result,operation_id:claimed.operationId,adopted:true};
    }
    const operation=await journal.beginOperation({projectCapability:project,
      sessionId:context.sessionId,kind:'bootstrap-abort',operationId:claimed.operationId,
      preconditions:claimed.preimage});
    let pending=await journal.resumeOperation({projectCapability:project,
      operationId:claimed.operationId,sessionId:context.sessionId,kind:'bootstrap-abort'});
    let stages=stageSet(pending);
    await journal.recordOperationStage(operation,'authorization-authenticated',{owned:{
      authorizationSha256:context.authorization.authorization_sha256}});
    await journal.recordOperationStage(operation,'failure-authenticated',{owned:{
      failureArtifactSha256:claimed.failureRaw.sha256}});
    await journal.recordOperationStage(operation,'observed-manifest-authenticated',{owned:{
      observedStage:claimed.failure.observed_stage,
      observedManifestSha256:claimed.failure.observed_manifest_sha256}});
    pending=await journal.resumeOperation({projectCapability:project,operationId:claimed.operationId,
      sessionId:context.sessionId,kind:'bootstrap-abort'});stages=stageSet(pending);
    const witness=context.authorization.witness,observedStage=claimed.failure.observed_stage;
    const manifestOptions={bootstrapLockClaim,currentOperation:{kind:'bootstrap-abort',
      operation_id:claimed.operationId,preconditions:claimed.preimage,slice:null}};
    const captured={
      base:captureBootstrapManifest(context.root,witness,'base',manifestOptions).manifest_sha256,
      red:captureBootstrapManifest(context.root,witness,'red',manifestOptions).manifest_sha256,
      post:captureBootstrapManifest(context.root,witness,'post',manifestOptions).manifest_sha256,
    };
    const currentKind=captured.base===witness.base_manifest_sha256?'base':
      captured.red===witness.red_manifest_sha256?'red':
      captured.post===witness.expected_post_manifest_sha256?'post':null;
    const expectsPost=['production-patch-applied','post-manifest-captured','green-command-completed',
      'finalize-prepared','finalize-authorization-authenticated',
      'finalize-execution-authenticated'].includes(observedStage);
    const expectsRed=['test-patch-applied','red-command-completed',
      'production-patch-started'].includes(observedStage);
    const expectsBase=['test-patch-started'].includes(observedStage);
    const allowedCurrent=stages.has('test-reverted')||stages.has('base-restored')||
      stages.has('abort-receipt-published')?['base']:
      stages.has('production-reverted')?['red','base']:
      expectsPost?['post']:expectsRed?['red']:expectsBase?['base']:[];
    if(currentKind===null||!allowedCurrent.includes(currentKind)){
      const recovery={schema_version:1,target_session_id:context.sessionId,
        operation_id:claimed.operationId,
        authorization_sha256:context.authorization.authorization_sha256,
        witness_sha256:witness.witness_sha256,failure_artifact_sha256:claimed.failureRaw.sha256,
        observed_stage:observedStage,
        observed_manifest_sha256:claimed.failure.observed_manifest_sha256,
        reason:'observed-worktree-not-authenticated',artifact_sha256:null};
      recovery.artifact_sha256=semanticDigest('bootstrap-recovery-required-v1',recovery,'artifact_sha256');
      writeExclusiveArtifact(recoveryPath,recovery);
      if(!stages.has('recovery-required-published'))
        await journal.recordOperationStage(operation,'recovery-required-published',{owned:{
          artifactSha256:recovery.artifact_sha256}});
      const result=resultFor(recovery,'recovery');
      const ledger=await journal.completeOperation(operation,result);
      const journalState=bindControlJournal(context).value;
      if(journalState.stage!=='recovery-required')
        replaceExecutionJournal(stateCapability,context.journalPath,journalState,
          {...journalState,stage:'recovery-required',journal_sha256:null});
      return {...result,operation_id:claimed.operationId,operation_receipt:ledger,adopted:false};
    }
    if(!stages.has('production-reverted')){
      if(currentKind==='post'&&
        !applyReversePatch(context.root,path.join(controlRoot,'reverse.patch')))
        fail('bootstrap-recovery-production-reverse');
      await journal.recordOperationStage(operation,'production-reverted',{owned:{
        applied:currentKind==='post'}});
    }
    pending=await journal.resumeOperation({projectCapability:project,operationId:claimed.operationId,
      sessionId:context.sessionId,kind:'bootstrap-abort'});stages=stageSet(pending);
    const afterProductionRed=captureBootstrapManifest(context.root,witness,'red',
      manifestOptions).manifest_sha256;
    const afterProductionBase=captureBootstrapManifest(context.root,witness,'base',
      manifestOptions).manifest_sha256;
    const afterProductionKind=afterProductionRed===witness.red_manifest_sha256?'red':
      afterProductionBase===witness.base_manifest_sha256?'base':null;
    if(afterProductionKind===null)
      fail('bootstrap-recovery-production-postcondition');
    if(!stages.has('test-reverted')){
      if(afterProductionKind==='red'&&
        !applyReversePatch(context.root,path.join(controlRoot,'test-reverse.patch')))
        fail('bootstrap-recovery-test-reverse');
      await journal.recordOperationStage(operation,'test-reverted',{owned:{
        applied:afterProductionKind==='red'}});
    }
    const restored=captureBootstrapManifest(context.root,witness,'base',manifestOptions);
    if(restored.manifest_sha256!==witness.base_manifest_sha256)
      fail('bootstrap-recovery-base-postcondition');
    await journal.recordOperationStage(operation,'base-restored',{owned:{
      baseManifestSha256:restored.manifest_sha256}});
    const receipt={schema_version:1,target_session_id:context.sessionId,
      operation_id:claimed.operationId,
      authorization_sha256:context.authorization.authorization_sha256,
      witness_sha256:witness.witness_sha256,failure_artifact_sha256:claimed.failureRaw.sha256,
      observed_stage:observedStage,
      observed_manifest_sha256:claimed.failure.observed_manifest_sha256,
      restored_base_manifest_sha256:restored.manifest_sha256,receipt_sha256:null};
    receipt.receipt_sha256=semanticDigest('bootstrap-abort-receipt-v1',receipt,'receipt_sha256');
    const receiptWrite=writeExclusiveArtifact(receiptPath,receipt);
    await journal.recordOperationStage(operation,'abort-receipt-published',{owned:{
      receiptSha256:receipt.receipt_sha256,receiptRawSha256:receiptWrite.sha256}});
    const journalState=bindControlJournal(context).value;
    if(journalState.stage!=='abort-completed')
      replaceExecutionJournal(stateCapability,context.journalPath,journalState,
        {...journalState,stage:'abort-completed',
          stage_manifest_sha256:witness.base_manifest_sha256,journal_sha256:null});
    const result=resultFor(receipt,'receipt');
    const ledger=await journal.completeOperation(operation,result);
    return {...result,operation_id:claimed.operationId,operation_receipt:ledger,adopted:false};
  });
}

const BOOTSTRAP_EXECUTION_KEYS=['schema_version','authorization_sha256','witness_sha256',
  'executor_sha256','execution_journal_sha256','base_manifest_sha256','test_patch_sha256',
  'red_manifest_sha256','red_result','patch_sha256','post_patch_manifest_sha256','green_result',
  'test_changed_paths','changed_paths','execution_sha256'];
function validateBootstrapExecution(value,authorization){
  if(!exactKeys(value,BOOTSTRAP_EXECUTION_KEYS)||value.schema_version!==1||
    ['authorization_sha256','witness_sha256','executor_sha256','execution_journal_sha256',
      'base_manifest_sha256','test_patch_sha256','red_manifest_sha256','patch_sha256',
      'post_patch_manifest_sha256','execution_sha256'].some((key)=>!DIGEST.test(value[key]||''))||
    !uniqueSorted(value.test_changed_paths,{pattern:/^.+$/})||
    !uniqueSorted(value.changed_paths,{pattern:/^.+$/}))
    fail('bootstrap-execution-schema');
  const witness=authorization.witness;
  if(value.authorization_sha256!==authorization.authorization_sha256||
    value.witness_sha256!==witness.witness_sha256||value.executor_sha256!==witness.executor_sha256||
    value.base_manifest_sha256!==witness.base_manifest_sha256||
    value.test_patch_sha256!==witness.test_patch_sha256||
    value.red_manifest_sha256!==witness.red_manifest_sha256||
    value.patch_sha256!==witness.patch_sha256||
    value.post_patch_manifest_sha256!==witness.expected_post_manifest_sha256||
    canonicalText(value.test_changed_paths)!==canonicalText(witness.test_changed_paths)||
    canonicalText(value.changed_paths)!==canonicalText(witness.changed_paths)||
    canonicalText(value.red_result)!==canonicalText(witness.expected_red_result)||
    canonicalText(value.green_result)!==canonicalText(witness.expected_green_result))
    fail('bootstrap-execution-witness');
  if(semanticDigest('bootstrap-execution-v1',value,'execution_sha256')!==value.execution_sha256)
    fail('bootstrap-execution-digest');
  return structuredClone(value);
}
function authenticateBootstrapReviewReports(root,authorization){
  for(const ref of authorization.review_report_refs){
    const file=assertControlPath(root,path.join(root,...ref.path.split('/')),
      authorization.witness.target_session_id,`patch-review-${ref.role}.json`);
    const raw=readJsonArtifact(file,'bootstrap-review');
    const report=raw.value;
    const expectedBytes=Buffer.concat([canonicalBootstrapJson(report),Buffer.from('\n')]);
    if(!raw.bytes.equals(expectedBytes))fail('bootstrap-review-terminal-lf');
    if(raw.sha256!==ref.sha256||
      !exactKeys(report,['schema_version','role','reviewer_identity','witness_sha256',
        'verdict','findings','report_sha256'])||
      report.schema_version!==1||report.role!==ref.role||
      report.reviewer_identity!==ref.reviewer_identity||
      report.witness_sha256!==ref.witness_sha256||report.verdict!==ref.verdict||
      report.verdict!=='APPROVE'||!Array.isArray(report.findings)||report.findings.length!==0||
      !DIGEST.test(report.report_sha256||'')||
      semanticDigest('bootstrap-patch-review-v1',report,'report_sha256')!==report.report_sha256)
      fail('bootstrap-review-authority');
  }
}
function authenticateBootstrapBoundFile(root,witness,pathKey,digestKey,code){
  const relative=witness[pathKey];
  const file=path.join(root,...relative.split('/'));let stat;
  try{stat=fs.lstatSync(file);}catch{fail(code);}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)
    fail(code);
  if(rawDigest(fs.readFileSync(file))!==witness[digestKey])fail(code);
}
function authenticateBootstrapFinalizeFiles(root,authorization){
  const witness=authorization.witness;
  authenticateBootstrapReviewReports(root,authorization);
  for(const [pathKey,digestKey,code] of [
    ['executor_path','executor_sha256','bootstrap-executor-authority'],
    ['test_patch_path','test_patch_sha256','bootstrap-patch-authority'],
    ['test_reverse_patch_path','test_reverse_patch_sha256','bootstrap-patch-authority'],
    ['patch_path','patch_sha256','bootstrap-patch-authority'],
    ['reverse_patch_path','reverse_patch_sha256','bootstrap-patch-authority'],
  ])authenticateBootstrapBoundFile(root,witness,pathKey,digestKey,code);
}
function authenticateBootstrapFinalizeManifest(root,authorization,manifestOptions){
  const witness=authorization.witness;
  const captured=captureBootstrapManifest(root,witness,'post',manifestOptions);
  if(captured.manifest_sha256!==witness.expected_post_manifest_sha256)
    fail('bootstrap-manifest-authority');
}
function validateBootstrapFinalizePendingJournal(raw,operationState,expected){
  if(operationState?.status!=='pending')fail('bootstrap-finalize-pending-operation');
  const {status,...journalState}=operationState;
  const value=raw.value;
  if(!raw.bytes.equals(Buffer.from(journal.canonicalJson(value)))||
    !exactKeys(value,BOOTSTRAP_FINALIZE_RECOVERY_PROJECTION.top_level_keys)||
    value.version!==1||value.operationId!==expected.operationId||
    value.sessionId!==expected.sessionId||value.kind!=='bootstrap-finalize'||
    canonicalText(value.preconditions)!==canonicalText(expected.preconditions)||
    !plainObject(value.preconditions)||
    value.owned!==null&&!plainObject(value.owned)||!timestamp(value.createdAt)||
    !Array.isArray(value.stages)||value.stages.length<1)
    fail('bootstrap-finalize-pending-operation');
  const stageRules=BOOTSTRAP_OPERATION_STAGE_RULES['bootstrap-finalize'];
  if(value.stages.length>stageRules.length||value.stage!==value.stages.at(-1)?.stage)
    fail('bootstrap-finalize-pending-operation');
  for(let index=0;index<value.stages.length;index+=1){
    const row=value.stages[index];
    if(!exactKeys(row,index===0?BOOTSTRAP_FINALIZE_RECOVERY_PROJECTION.first_row_keys:
      BOOTSTRAP_FINALIZE_RECOVERY_PROJECTION.later_row_keys)||
      row.stage!==stageRules[index]||!timestamp(row.at)||
      index===0&&(row.at!==value.createdAt||row.stage!=='prepared')||
      index>0&&(!plainObject(row.details)||
        canonicalText(row.details)!==canonicalText(expected.stageDetails[row.stage])))
      fail('bootstrap-finalize-pending-operation');
  }
  const expectedOwned=value.stages.length===1?null:
    expected.stageDetails[value.stages.at(-1).stage].owned;
  if(canonicalText(value.owned)!==canonicalText(expectedOwned)||
    canonicalText(journalState)!==canonicalText(value))
    fail('bootstrap-finalize-pending-operation');
  return value;
}
function authenticateBootstrapFinalizeRecoveryManifest(root,authorization,manifestOptions,
  operationState,expected){
  const sessionId=authorization.witness.target_session_id;
  const relative=`.claude/deep-work.${sessionId}.op.bootstrap-finalize.`+
    `${expected.operationId}.json`;
  const journalFile=path.join(root,...relative.split('/'));
  const raw=readJsonArtifact(journalFile,'bootstrap-finalize-pending-operation',
    {canonical:true,maxBytes:1024*1024});
  validateBootstrapFinalizePendingJournal(raw,operationState,{...expected,sessionId});
  const captured=captureBootstrapManifest(root,authorization.witness,'post',manifestOptions);
  const matches=captured.entries.filter((entry)=>entry.path===relative);
  if(matches.length!==1||matches[0].type!=='file'||matches[0].size!==raw.bytes.length||
    matches[0].sha256!==raw.sha256)
    fail('bootstrap-finalize-pending-operation');
  const projected={...captured,entries:captured.entries.filter((entry)=>entry.path!==relative),
    manifest_sha256:null};
  projected.manifest_sha256=semanticDigest('bootstrap-manifest-v1',projected,'manifest_sha256');
  if(projected.manifest_sha256!==authorization.witness.expected_post_manifest_sha256)
    fail('bootstrap-manifest-authority');
  const afterRaw=readJsonArtifact(journalFile,'bootstrap-finalize-pending-operation',
    {canonical:true,maxBytes:1024*1024});
  if(!afterRaw.bytes.equals(raw.bytes))fail('bootstrap-finalize-pending-operation');
}
function authenticateBootstrapFinalizeCompletionArtifacts(markerPath,receiptPath,completion){
  const markerRaw=readJsonArtifact(markerPath,'bootstrap-marker',{canonical:true});
  const receiptRaw=readJsonArtifact(receiptPath,'bootstrap-receipt',{canonical:true});
  if(!markerRaw.bytes.equals(canonicalBootstrapJson(completion.marker)))fail('bootstrap-marker');
  if(!receiptRaw.bytes.equals(canonicalBootstrapJson(completion.receipt)))fail('bootstrap-receipt');
}
async function finalizeBootstrap({stateCapability,authorizationPath,executionPath}={}){
  const sessionId=sessionIdForState(stateCapability),root=stateCapability.projectRoot;
  const authorizationFile=assertControlPath(root,authorizationPath,sessionId,'authorization.json');
  const executionFile=assertControlPath(root,executionPath,sessionId,'execution.json');
  const context=loadBootstrapControl({stateCapability,authorizationPath:authorizationFile});
  return withBootstrapLock(stateCapability,async(bootstrapLockClaim)=>{
    const execution=validateBootstrapExecution(
      readJsonArtifact(executionFile,'bootstrap-execution',{canonical:true}).value,
      context.authorization);
    const witness=context.authorization.witness;
    authenticateBootstrapFinalizeFiles(root,context.authorization);
    const preimage={target_session_id:sessionId,
      authorization_sha256:context.authorization.authorization_sha256,
      witness_sha256:witness.witness_sha256,execution_sha256:execution.execution_sha256,
      pre_runtime_version:witness.runtime_version,post_runtime_version:'6.14.0',
      test_patch_sha256:execution.test_patch_sha256,patch_sha256:execution.patch_sha256,
      base_manifest_sha256:execution.base_manifest_sha256,
      red_manifest_sha256:execution.red_manifest_sha256,
      post_manifest_sha256:execution.post_patch_manifest_sha256,
      test_changed_paths:execution.test_changed_paths,changed_paths:execution.changed_paths,
      review_report_refs:context.authorization.review_report_refs,
      first_red_slice_id:witness.first_red_slice_id,
      first_red_verification_spec_sha256:witness.first_red_verification_spec_sha256};
    const operationId=deterministicOperationId('bootstrap-finalize-v1',preimage);
    const completion=precomputeBootstrapCompletion({...preimage,
      completion_operation_id:operationId});
    const result={target_session_id:sessionId,
      receipt_path:controlRelative(sessionId,'bootstrap-receipt.json'),
      receipt_sha256:completion.receipt.receipt_sha256,
      marker_path:controlRelative(sessionId,'marker.json'),
      marker_sha256:completion.marker.marker_sha256};
    const transaction=require('./transaction-runtime.js');
    const project=transaction.projectCapabilityFor(stateCapability);
    const receiptPath=path.join(root,...result.receipt_path.split('/'));
    const markerPath=path.join(root,...result.marker_path.split('/'));
    const priorOperation=await completedOperation(project,operationId,sessionId,'bootstrap-finalize');
    if(priorOperation?.stage==='completed-ledger'){
      const receipt=readJsonArtifact(receiptPath,'bootstrap-receipt',{canonical:true}).value;
      const marker=readJsonArtifact(markerPath,'bootstrap-marker',{canonical:true}).value;
      validateBootstrapCompletionAuthority({receipt,marker,operationReceipt:priorOperation});
      if(canonicalText(priorOperation.result)!==canonicalText(result))
        fail('bootstrap-finalize-completed-conflict');
      return {...result,operation_id:operationId,operation_receipt:priorOperation,adopted:true};
    }
    let executionJournal=bindControlJournal(context).value;
    if(executionJournal.claim==='abort'||executionJournal.claim==='finalize'&&
      executionJournal.claim_operation_id!==operationId)fail('bootstrap-finalize-claim-conflict');
    const originalJournal=reconstructClaimedPrior(executionJournal);
    if(originalJournal.stage!=='green-command-completed'||
      originalJournal.journal_sha256!==execution.execution_journal_sha256)
      fail('bootstrap-finalize-journal');
    const receiptRawSha256=rawDigest(canonicalBootstrapJson(completion.receipt));
    const finalizeStageDetails={
      'authorization-authenticated':{owned:{
        authorizationSha256:context.authorization.authorization_sha256,
        witnessSha256:witness.witness_sha256}},
      'execution-authenticated':{owned:{executionSha256:execution.execution_sha256}},
      'receipt-precomputed':{owned:{
        receiptSha256:completion.receipt.receipt_sha256,receiptRawSha256}},
      'marker-committed':{owned:{
        markerPath:result.marker_path,markerSha256:completion.marker.marker_sha256}},
      'receipt-published':{owned:{
        receiptPath:result.receipt_path,receiptSha256:completion.receipt.receipt_sha256}},
    };
    const finalizeRecoveryExpected={operationId,preconditions:preimage,
      stageDetails:finalizeStageDetails};
    if(executionJournal.claim==='finalize'&&
      (executionJournal.claim_input?.kind!=='finalize-receipt'||
      executionJournal.claim_input.input_artifact_sha256!==receiptRawSha256))
      fail('bootstrap-finalize-claim-conflict');
    const advanceJournal=(nextStage)=>{
      const order=['finalize-receipt-precomputed','finalize-marker-committed',
        'finalize-receipt-published','finalize-completed'];
      if(order.indexOf(executionJournal.stage)>=order.indexOf(nextStage))return;
      executionJournal=replaceExecutionJournal(stateCapability,context.journalPath,
        executionJournal,{...executionJournal,stage:nextStage,
          stage_manifest_sha256:execution.post_patch_manifest_sha256,journal_sha256:null});
    };
    if(priorOperation===null){
      authenticateBootstrapFinalizeManifest(root,context.authorization,{bootstrapLockClaim});
      if(executionJournal.claim==='none'){
        const currentRaw=readJsonArtifact(context.journalPath,'bootstrap-execution-journal',
          {canonical:true});
        executionJournal=replaceExecutionJournal(stateCapability,context.journalPath,
          executionJournal,{...executionJournal,stage:'finalize-receipt-precomputed',
            claim:'finalize',claim_operation_id:operationId,
            claim_input:{kind:'finalize-receipt',input_journal_sha256:currentRaw.sha256,
              input_stage:executionJournal.stage,
              input_manifest_sha256:executionJournal.stage_manifest_sha256,
              input_artifact_sha256:receiptRawSha256},journal_sha256:null});
      }
      authenticateBootstrapFinalizeManifest(root,context.authorization,{bootstrapLockClaim});
      writeExclusiveArtifact(markerPath,completion.marker);
      advanceJournal('finalize-marker-committed');
      authenticateBootstrapFinalizeManifest(root,context.authorization,{bootstrapLockClaim});
      writeExclusiveArtifact(receiptPath,completion.receipt);
      advanceJournal('finalize-receipt-published');
      authenticateBootstrapFinalizeManifest(root,context.authorization,{bootstrapLockClaim});
      advanceJournal('finalize-completed');
    }else{
      if(executionJournal.stage!=='finalize-completed')
        fail('bootstrap-finalize-pending-publication');
      authenticateBootstrapFinalizeRecoveryManifest(root,context.authorization,
        {bootstrapLockClaim},priorOperation,finalizeRecoveryExpected);
      authenticateBootstrapFinalizeCompletionArtifacts(markerPath,receiptPath,completion);
    }
    const operation=await journal.beginOperation({projectCapability:project,sessionId,
      kind:'bootstrap-finalize',operationId,preconditions:preimage});
    await journal.recordOperationStage(operation,'authorization-authenticated',{owned:{
      authorizationSha256:context.authorization.authorization_sha256,
      witnessSha256:witness.witness_sha256}});
    await journal.recordOperationStage(operation,'execution-authenticated',{owned:{
      executionSha256:execution.execution_sha256}});
    await journal.recordOperationStage(operation,'receipt-precomputed',{owned:{
      receiptSha256:completion.receipt.receipt_sha256,receiptRawSha256}});
    await journal.recordOperationStage(operation,'marker-committed',{owned:{
      markerPath:result.marker_path,markerSha256:completion.marker.marker_sha256}});
    await journal.recordOperationStage(operation,'receipt-published',{owned:{
      receiptPath:result.receipt_path,receiptSha256:completion.receipt.receipt_sha256}});
    const pendingForCompletion=await completedOperation(project,operationId,sessionId,
      'bootstrap-finalize');
    authenticateBootstrapFinalizeRecoveryManifest(root,context.authorization,
      {bootstrapLockClaim},pendingForCompletion,finalizeRecoveryExpected);
    authenticateBootstrapFinalizeCompletionArtifacts(markerPath,receiptPath,completion);
    const ledger=await journal.completeOperation(operation,result);
    validateBootstrapCompletionAuthority({receipt:completion.receipt,marker:completion.marker,
      operationReceipt:ledger});
    return {...result,operation_id:operationId,operation_receipt:ledger,adopted:false};
  });
}

function relativeProjectPath(root,file){
  const value=path.relative(root,path.resolve(file)).split(path.sep).join('/');
  if(!portablePath(value))fail('bootstrap-path');
  return value;
}
function authenticateBootstrapCompletion({stateCapability,authorizationPath,receiptPath,markerPath}){
  const sessionId=sessionIdForState(stateCapability),root=stateCapability.projectRoot;
  const authorizationFile=assertControlPath(root,authorizationPath,sessionId,'authorization.json');
  const receiptFile=assertControlPath(root,receiptPath,sessionId,'bootstrap-receipt.json');
  const markerFile=assertControlPath(root,markerPath,sessionId,'marker.json');
  const authorization=validateBootstrapAuthorization(
    readJsonArtifact(authorizationFile,'bootstrap-authorization',{canonical:true}).value);
  const receipt=readJsonArtifact(receiptFile,'bootstrap-receipt',{canonical:true}).value;
  const marker=readJsonArtifact(markerFile,'bootstrap-marker',{canonical:true}).value;
  if(authorization.witness.target_session_id!==sessionId||
    receipt.target_session_id!==sessionId||marker.target_session_id!==sessionId||
    receipt.authorization_sha256!==authorization.authorization_sha256||
    receipt.witness_sha256!==authorization.witness.witness_sha256)
    fail('bootstrap-session-authority');
  return {sessionId,root,authorization,receipt,marker};
}
const TAP_AUTHORITY_KEYS=new Set(['location','failureType','error','code','name','message',
  'operator','expected','actual','stack','requireStack']);
const TAP_WRAPPER_KEYS=new Set(['duration_ms','type']);
const ASSERTION_OPERATORS=new Set(['strictEqual','deepStrictEqual','notStrictEqual',
  'notDeepStrictEqual','match','doesNotMatch','throws','rejects']);
function normalizeTapString(value){
  if(typeof value!=='string')fail('bootstrap-first-red-tap');
  return value.replaceAll('\r\n','\n').normalize('NFC');
}
function parseTapScalar(source,key){
  if(typeof source!=='string'||!source||source.includes('\t')||
    source!==source.trim())fail('bootstrap-first-red-tap');
  if(source==='undefined'){
    if(!['expected','actual'].includes(key))fail('bootstrap-first-red-tap');
    return undefined;
  }
  if(source==='null')return null;
  if(source==='true')return true;
  if(source==='false')return false;
  if(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(source)){
    const value=Number(source);
    if(!Number.isFinite(value))fail('bootstrap-first-red-tap');
    return value;
  }
  if(/^'(?:[^']|'')*'$/u.test(source))
    return normalizeTapString(source.slice(1,-1).replaceAll("''","'"));
  if(source.startsWith('"')&&source.endsWith('"')){
    let value;
    try{value=JSON.parse(source);}catch{fail('bootstrap-first-red-tap');}
    if(typeof value!=='string')fail('bootstrap-first-red-tap');
    return normalizeTapString(value);
  }
  if(/^[\[\]{},&*!|>@`]/u.test(source)||source.startsWith('- ')||
    source.startsWith('? ')||source.includes(': ')||source.includes(' #')||
    /^(?:\.nan|[-+]?\.inf|[-+]?(?:NaN|Infinity)|-?[0-9]+n)$/iu.test(source))
    fail('bootstrap-first-red-tap');
  return normalizeTapString(source);
}
function tapValueDigest(value){
  let domain;
  if(value===undefined)domain='u:';
  else if(value===null)domain='n:';
  else if(typeof value==='boolean')domain=`b:${value?'1':'0'}`;
  else if(typeof value==='number'&&Number.isFinite(value))
    domain=`d:${JSON.stringify(value)}`;
  else if(typeof value==='string')domain=`s:${normalizeTapString(value)}`;
  else fail('bootstrap-first-red-tap-value');
  return rawDigest(Buffer.concat([Buffer.from('tap-value-v1\0'),Buffer.from(domain)]));
}
function parseTapDiagnostic(lines,start,indent,{role='leaf'}={}){
  const prefix=' '.repeat(indent),contentPrefix=' '.repeat(indent+2);
  if(lines[start]!==`${prefix}---`)fail('bootstrap-first-red-tap');
  const outerKeys=new Set(['duration_ms','type','location','failureType','error','code']);
  const processKeys=new Set(['duration_ms','type','location','failureType','exitCode','signal',
    'error','code']);
  const fields={},forms={},keys=[],allowed=role==='wrapper'?TAP_WRAPPER_KEYS:
    role==='outer'?outerKeys:role==='process'?processKeys:
      new Set([...TAP_WRAPPER_KEYS,...TAP_AUTHORITY_KEYS]);
  let index=start+1;
  for(;index<lines.length&&lines[index]!==`${prefix}...`;index+=1){
    if(lines[index].includes('\t'))fail('bootstrap-first-red-tap');
    const requireStackLine=lines[index]===`${prefix}requireStack:`;
    const match=requireStackLine?['','requireStack','']:
      lines[index].match(new RegExp(`^ {${indent}}([A-Za-z][A-Za-z0-9_]*): (.*)$`,'u'));
    if(!match||!allowed.has(match[1])||Object.hasOwn(fields,match[1]))
      fail('bootstrap-first-red-tap');
    const [,key,source]=match;
    keys.push(key);
    if(key==='requireStack'){
      if(role!=='leaf'||source!==''||
        !lines[index+1]?.startsWith(contentPrefix))fail('bootstrap-first-red-tap');
      const paths=[];
      while(index+1<lines.length&&lines[index+1].startsWith(contentPrefix)){
        index+=1;
        const row=lines[index].slice(indent+2).match(/^([0-9]+): (.+)$/u);
        if(!row||Number(row[1])!==paths.length)fail('bootstrap-first-red-tap');
        const value=parseTapScalar(row[2],'requireStack');
        if(typeof value!=='string'||!value)fail('bootstrap-first-red-tap');
        paths.push(value);
      }
      if(!paths.length)fail('bootstrap-first-red-tap');
      fields[key]=paths;forms[key]='indexed-paths';
    }else if(source==='|-'){
      if(role!=='leaf'||!['error','stack'].includes(key))fail('bootstrap-first-red-tap');
      const content=[];
      while(index+1<lines.length&&lines[index+1].startsWith(contentPrefix)){
        index+=1;content.push(lines[index].slice(indent+2));
      }
      if(!content.length)fail('bootstrap-first-red-tap');
      fields[key]=normalizeTapString(content.join('\n'));
      forms[key]='literal';
    }else{
      if(['error','stack'].includes(key)&&['|','>','>-','|+','>+'].includes(source))
        fail('bootstrap-first-red-tap');
      fields[key]=parseTapScalar(source,key);
      forms[key]='scalar';
    }
  }
  if(index>=lines.length||lines[index]!==`${prefix}...`)fail('bootstrap-first-red-tap');
  if(!Object.hasOwn(fields,'duration_ms')||typeof fields.duration_ms!=='number'||
    !Object.hasOwn(fields,'type')||typeof fields.type!=='string')
    fail('bootstrap-first-red-tap');
  return {fields,forms,keys,next:index+1};
}
function exactTapSummary(lines,start,{tests,suites,pass,failures}){
  const expected=['1..1',`# tests ${tests}`,`# suites ${suites}`,`# pass ${pass}`,
    `# fail ${failures}`,'# cancelled 0','# skipped 0','# todo 0'];
  if(canonicalText(lines.slice(start,start+expected.length))!==canonicalText(expected)||
    !/^# duration_ms (?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(lines[start+expected.length]||'')||
    start+expected.length+1!==lines.length)fail('bootstrap-first-red-tap');
}
function reporterLocation(location,{root,testPath}){
  if(typeof location!=='string'||location.includes('\0'))fail('bootstrap-first-red-tap');
  const match=location.match(/^(.*):([1-9][0-9]*):([1-9][0-9]*)$/u);
  if(!match)fail('bootstrap-first-red-tap');
  let candidate=match[1];
  if(candidate.startsWith('file:')){
    if(/%2f|%5c/iu.test(candidate))fail('bootstrap-first-red-tap');
    const rawUrl=candidate;
    try{candidate=fileURLToPath(rawUrl);}catch{fail('bootstrap-first-red-tap');}
    if(pathToFileURL(candidate).href!==rawUrl)fail('bootstrap-first-red-tap');
  }
  if(!path.isAbsolute(candidate)||path.normalize(candidate)!==candidate)
    fail('bootstrap-first-red-tap');
  const expected=fs.realpathSync(path.join(root,...testPath.split('/')));
  let actual;
  try{actual=fs.realpathSync(candidate);}catch{fail('bootstrap-first-red-tap');}
  if(actual!==expected||path.resolve(candidate)!==expected)fail('bootstrap-first-red-tap');
  return {line:Number(match[2]),column:Number(match[3])};
}
function tapEventFrom({fields,forms,keys,testName,root,testPath,diagnosticOverride=null}){
  const golden=BOOTSTRAP_NODE_TAP_GOLDENS[process.versions.node];
  const assertionShape=fields.code==='ERR_ASSERTION'||fields.name==='AssertionError';
  const contractShape=fields.code==='ERR_DEEP_WORK_CONTRACT';
  const syntaxShape=fields.name==='SyntaxError'||fields.code==='ERR_INVALID_TYPESCRIPT_SYNTAX';
  const importShape=new Set(['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND',
    'ERR_PACKAGE_PATH_NOT_EXPORTED']).has(fields.code);
  const fixtureShape=new Set(['hookFailed','globalSetup','globalTeardown'])
    .has(fields.failureType);
  const collectionShape=fields.code==='ERR_TEST_FAILURE'&&
    new Set(['subtestsFailed','configuration']).has(fields.failureType);
  const processShape=diagnosticOverride!==null;
  const shapes=[assertionShape,contractShape,syntaxShape,importShape,fixtureShape,
    collectionShape,processShape]
    .filter(Boolean).length;
  const layout=shapes===1?(assertionShape?golden?.leaf_layouts?.assertion:
    contractShape?golden?.leaf_layouts?.contract:
      syntaxShape?golden?.leaf_layouts?.syntax:
        importShape?golden?.leaf_layouts?.import:
          fixtureShape?golden?.leaf_layouts?.fixture:
        collectionShape?golden?.leaf_layouts?.collection:
          golden?.leaf_layouts?.process_failure):null;
  if(!layout||canonicalText(keys)!==canonicalText(layout.keys)||
    Object.entries(layout.constants).some(([key,value])=>fields[key]!==value)||
    Object.entries(layout.forms).some(([key,value])=>forms[key]!==value))
    fail('bootstrap-first-red-tap');
  const location=reporterLocation(fields.location,{root,testPath});
  const hasExpected=Object.hasOwn(fields,'expected'),hasActual=Object.hasOwn(fields,'actual');
  if((assertionShape||contractShape)&&!hasExpected&&!hasActual)
    fail('bootstrap-first-red-tap');
  const nullableString=(key)=>{
    if(!Object.hasOwn(fields,key))return null;
    if(typeof fields[key]!=='string'||!fields[key])fail('bootstrap-first-red-tap');
    return normalizeTapString(fields[key]);
  };
  const rawMessage=diagnosticOverride?.message??(Object.hasOwn(fields,'message')?fields.message:
    String(fields.error).split('\n')[0]);
  const message=normalizeTapString(rawMessage);
  const name=normalizeTapString(diagnosticOverride?.test_name??testName);
  if(!message||!name)fail('bootstrap-first-red-tap');
  return {event_type:'test-failure',test_file:testPath,test_name:name,start_line:location.line,
    error_code:diagnosticOverride?.error_code??nullableString('code'),
    error_name:diagnosticOverride?.error_name??nullableString('name'),
    failure_type:diagnosticOverride?.failure_type??nullableString('failureType'),
    operator:diagnosticOverride?.operator??nullableString('operator'),
    expected_digest:hasExpected?tapValueDigest(fields.expected):null,
    actual_digest:hasActual?tapValueDigest(fields.actual):
      (assertionShape||contractShape)?null:tapValueDigest(message),message};
}
function parseNodeTapFailure(stdout,{root,testPath,nodePatch=process.versions.node}){
  const grammar=BOOTSTRAP_NODE_TAP_GOLDENS[nodePatch];
  if(!grammar)fail('bootstrap-first-red-tap');
  if(typeof stdout!=='string'||stdout.includes('\r')||stdout.includes('\t')||
    !stdout.startsWith('TAP version 13\n')||!stdout.endsWith('\n'))
    fail('bootstrap-first-red-tap');
  const lines=stdout.slice(0,-1).split('\n');
  let leafName,leafFields,summaryStart;
  const directHeader=lines[1]?.match(/^# Subtest: (.+)$/u);
  const directLeaf=lines[2]?.match(/^not ok 1 - (.+)$/u);
  if(directHeader&&directLeaf&&directHeader[1]===directLeaf[1]){
    const diagnostic=parseTapDiagnostic(lines,3,2);
    leafName=directLeaf[1];leafFields=diagnostic;summaryStart=diagnostic.next;
    exactTapSummary(lines,summaryStart,grammar.topologies.direct);
  }else{
    const wrapper=lines[1]?.match(/^# Subtest: (.+)$/u);
    const nestedHeader=lines[2]?.match(/^    # Subtest: (.+)$/u);
    const nestedLeaf=lines[3]?.match(/^    not ok 1 - (.+)$/u);
    if(!wrapper||!nestedHeader||!nestedLeaf||nestedHeader[1]!==nestedLeaf[1])
      fail('bootstrap-first-red-tap');
    const leafDiagnostic=parseTapDiagnostic(lines,4,6);
    if(lines[leafDiagnostic.next]!=='    1..1'||
      lines[leafDiagnostic.next+1]!==`not ok 1 - ${wrapper[1]}`)
      fail('bootstrap-first-red-tap');
    const wrapperDiagnostic=parseTapDiagnostic(lines,leafDiagnostic.next+2,2,{role:'outer'});
    const wrapperLayout=grammar.suite_wrapper_layout;
    if(canonicalText(wrapperDiagnostic.keys)!==canonicalText(wrapperLayout.keys)||
      Object.entries(wrapperLayout.forms).some(([key,value])=>
        wrapperDiagnostic.forms[key]!==value)||
      Object.entries(wrapperLayout.constants).some(([key,value])=>
        wrapperDiagnostic.fields[key]!==value))
      fail('bootstrap-first-red-tap');
    reporterLocation(wrapperDiagnostic.fields.location,{root,testPath});
    leafName=nestedLeaf[1];leafFields=leafDiagnostic;
    summaryStart=wrapperDiagnostic.next;
    exactTapSummary(lines,summaryStart,grammar.topologies.suite_wrapper);
  }
  return tapEventFrom({...leafFields,testName:leafName,root,testPath});
}
function classifyExpectedTapSignal(event){
  const classified=classifyTapDiagnostic(event);
  if(classified?.observed_class==='expected-failure')return classified.signal;
  return null;
}
function classifyTapDiagnostic(event){
  const syntax=event.error_name==='SyntaxError'||
    event.error_code==='ERR_INVALID_TYPESCRIPT_SYNTAX';
  const imported=new Set(['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND',
    'ERR_PACKAGE_PATH_NOT_EXPORTED']).has(event.error_code);
  const fixture=new Set(['hookFailed','globalSetup','globalTeardown']).has(event.failure_type);
  const assertion=(event.error_code==='ERR_ASSERTION'||event.error_name==='AssertionError')&&
    ASSERTION_OPERATORS.has(event.operator);
  const contract=event.error_code==='ERR_DEEP_WORK_CONTRACT'&&event.operator==='contract';
  const collection=event.error_code==='ERR_TEST_FAILURE'&&
    new Set(['subtestsFailed','configuration']).has(event.failure_type);
  const recognized=[syntax,imported,fixture,assertion,contract,collection].filter(Boolean).length;
  if(recognized!==1)return null;
  if(syntax)return {observed_class:'syntax-error',reason_code:'syntax-diagnostic',signal:null};
  if(imported)return {observed_class:'import-error',reason_code:'import-diagnostic',signal:null};
  if(fixture)return {observed_class:'fixture-error',reason_code:'fixture-diagnostic',signal:null};
  if(assertion)return {observed_class:'expected-failure',reason_code:'signal-matched',
    signal:{kind:'assertion',operator:event.operator}};
  if(contract)return {observed_class:'expected-failure',reason_code:'signal-matched',
    signal:{kind:'contract',operator:'contract'}};
  return {observed_class:'collection-error',reason_code:'collection-diagnostic',signal:null};
}
function deriveTapSignal(event){
  if((event.error_code==='ERR_ASSERTION'||event.error_name==='AssertionError')&&
    ASSERTION_OPERATORS.has(event.operator))
    return {kind:'assertion',operator:event.operator};
  if(event.error_code==='ERR_DEEP_WORK_CONTRACT')
    return {kind:'contract',operator:event.operator};
  return null;
}
function trackedChangedPaths(before,after){
  const left=new Map(before.entries.map((row)=>[row.path,row]));
  const right=new Map(after.entries.map((row)=>[row.path,row]));
  return byteSort([...new Set([...left.keys(),...right.keys()])].filter((key)=>
    canonicalText(left.get(key)||null)!==canonicalText(right.get(key)||null)));
}
function executableIdentity(){
  const executable=fs.realpathSync(process.execPath),stat=fs.statSync(executable,{bigint:true});
  return {path:executable,sha256:rawDigest(fs.readFileSync(executable)),dev:String(stat.dev),
    ino:String(stat.ino),mode:String(stat.mode),size:String(stat.size),mtime_ns:String(stat.mtimeNs),
    node_version:process.versions.node};
}
function authenticateBootstrapVerificationContext({verification,bound,plan,verificationPlan,
  spec,specRawSha256,write,operationId,logicalArgv,normalizedArgv,identity,environment,
  containment,supervisor}){
  if(verification.session_id!==bound.sessionId||
    verification.slice_id!==write.receipt.sliceId||
    verification.plan_authority_sha256!==plan.plan_authority_sha256||
    verification.spec_sha256!==plan.contract_binding?.spec_contract?.spec_sha256||
    verification.verification_plan_sha256!==verificationPlan.plan_sha256||
    verification.write_operation_id!==write.receipt.operationId||
    verification.verification_operation_id!==operationId||
    specRawSha256!==plan.slices.find((row)=>row.id===write.receipt.sliceId)
      ?.verification_spec_sha256||
    canonicalText(verification.logical_argv)!==canonicalText(spec.args)||
    canonicalText(verification.logical_argv)!==canonicalText(logicalArgv)||
    canonicalText(verification.normalized_argv)!==canonicalText(normalizedArgv)||
    canonicalText(verification.executable_identity)!==canonicalText(identity)||
    canonicalText(verification.environment)!==canonicalText(environment)||
    canonicalText(verification.execution_containment)!==canonicalText(containment)||
    canonicalText(verification.supervisor_control)!==canonicalText(supervisor))
    fail('bootstrap-verification-context');
  const manifests={};
  for(const [name,ref] of [['pre',verification.pre_manifest_ref],
    ['post',verification.post_manifest_ref]]){
    const raw=readJsonArtifact(path.join(bound.root,...ref.path.split('/')),
      `bootstrap-first-red-${name}-manifest`,{canonical:true});
    if(raw.sha256!==ref.sha256)fail('bootstrap-verification-manifest');
    const manifest=validateBootstrapManifest(raw.value,{sessionId:bound.sessionId});
    if(manifest.repository_identity_sha256!==bound.authorization.witness.repository_identity_sha256||
      manifest.base_head_oid!==bound.authorization.witness.base_head_oid||
      manifest.phase!==name)
      fail('bootstrap-verification-manifest');
    manifests[name]=manifest;
  }
  const changed=trackedChangedPaths(manifests.pre,manifests.post);
  if(canonicalText(changed)!==canonicalText(verification.changed_paths)||
    verification.scope_disposition!==(changed.length?'test-side-effect':'clean'))
    fail('bootstrap-verification-manifest');
  return verification;
}
function acceptedWriteAuthority({stateCapability,plan,sliceId,writeReceiptPath}){
  const frontmatter=require('./frontmatter.js'),transaction=require('./transaction-runtime.js');
  const fields=frontmatter.parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  const raw=readJsonArtifact(writeReceiptPath,'bootstrap-write-receipt',{canonical:true});
  const receipt=raw.value;
  if(!OPERATION.test(receipt?.operationId||'')||
    path.resolve(writeReceiptPath)!==path.join(stateCapability.projectRoot,'.claude',
      `deep-work.${sessionIdForState(stateCapability)}.scoped-write.${receipt.operationId}.json`)||
    receipt.status!=='accepted'||receipt.sliceId!==sliceId||receipt.writeClass!=='failing-test'||
    !DIGEST.test(receipt.receiptSha256||'')||
    receipt.planSha256!==require('./plan-runtime.js').canonicalizePlanScopeV1(plan).sha256||
    fields.current_phase!=='implement'||fields.active_slice!==sliceId||fields.tdd_state!=='PENDING'||
    fields.accepted_write_operation_id!==receipt.operationId||
    fields.accepted_write_receipt_sha256!==receipt.receiptSha256||
    fields.accepted_write_class!=='failing-test')
    fail('bootstrap-first-red-write');
  return {fields,receipt,raw,project:transaction.projectCapabilityFor(stateCapability)};
}
function authenticateImmutableBootstrapPlan(plan,failureCode='bootstrap-first-red-plan'){
  let compiled;
  try{compiled=require('./plan-runtime.js').compileImmutablePlanAuthorityV2(plan);}
  catch{fail(failureCode);}
  if(compiled.plan_authority_sha256!==plan?.plan_authority_sha256)
    fail(failureCode);
  return compiled;
}
function authenticateBootstrapVerificationPlan({plan,verificationPlan,sliceId,specSha256,
  failureCode='bootstrap-first-red-plan'}){
  const compiled=authenticateImmutableBootstrapPlan(plan,failureCode);
  const policy=require('./verification-policy-runtime.js');
  if(!policy.validateVerificationPlan(verificationPlan).pass||
    verificationPlan.plan_authority_sha256!==compiled.plan_authority_sha256||
    verificationPlan.plan_projection_sha256!==
      rawDigest(Buffer.from(journal.canonicalJson(plan)))||
    verificationPlan.spec_sha256!==plan.contract_binding?.spec_contract?.spec_sha256||
    verificationPlan.spec_approved_hash!==
      plan.contract_binding?.spec_contract?.spec_approved_hash||
    verificationPlan.source_plan_sha256!==plan.contract_binding?.source_plan_sha256||
    canonicalText(verificationPlan.capability_facts)!==
      canonicalText(plan.capability_facts)||
    canonicalText(verificationPlan.slice_verification_specs?.[sliceId])!==
      canonicalText({slice_kind:'functional',verification_spec_sha256:specSha256}))
    fail(failureCode);
  return verificationPlan;
}
function currentBootstrapVerificationPlan({fields,plan,sliceId,specSha256,failureCode}){
  let verificationPlan;
  try{verificationPlan=typeof fields.verification_plan_json==='string'?
    JSON.parse(fields.verification_plan_json):fields.verification_plan_json;}
  catch{fail(failureCode);}
  if(!verificationPlan||verificationPlan.plan_sha256!==fields.verification_plan_sha256)
    fail(failureCode);
  return authenticateBootstrapVerificationPlan({plan,verificationPlan,sliceId,specSha256,
    failureCode});
}
function authenticateBootstrapProducerVerification({plan,verificationPlan,verification,
  bridgeOperationId,bridge,sliceId,failureCode}){
  const target=plan.slices?.find((row)=>row.id===sliceId);
  if(!target||target.slice_kind!=='functional'||
    verification.plan_authority_sha256!==plan.plan_authority_sha256||
    verification.spec_sha256!==plan.contract_binding?.spec_contract?.spec_sha256||
    verification.verification_plan_sha256!==verificationPlan.plan_sha256||
    verification.verification_operation_id!==bridgeOperationId||
    verification.result_sha256!==bridge.result?.result_sha256||
    bridge.result?.result_path!==verification.result_path||
    bridge.result?.disposition!=='accepted'||bridge.result?.slice_id!==sliceId)
    fail(failureCode);
  return target;
}
function closedEnvironmentGuardBytes(root,testPath){
  return Buffer.from([
    "'use strict';",
    "const allowed=new Set(['LANG','LC_ALL','TZ']);",
    `const governed=${JSON.stringify(path.join(root,...testPath.split('/')))};`,
    "const source=process.env;",
    "Object.defineProperty(process,'env',{configurable:false,enumerable:true,value:new Proxy(source,{",
    "  get(target,key,receiver){",
    "    const stack=new Error().stack||'';",
    "    if(typeof key==='string'&&!allowed.has(key)&&stack.includes(governed)){",
    "      const error=new Error(`ambient environment access forbidden: ${key}`);",
    "      error.code='ERR_DEEP_WORK_AMBIENT_ENV';throw error;",
    "    }",
    "    return Reflect.get(target,key,receiver);",
    "  }",
    "})});",
    '',
  ].join('\n'));
}
function bootstrapFirstRedExecutionContext(bound,spec){
  const ownedTemp=path.join(bound.root,'.deep-work',bound.sessionId,'tmp');
  const environmentGuardPath=path.join(ownedTemp,'closed-environment-guard.cjs');
  let guardBytes;
  try{guardBytes=fs.readFileSync(environmentGuardPath);}catch{
    fail('bootstrap-verification-context');
  }
  if(!guardBytes.equals(closedEnvironmentGuardBytes(bound.root,spec.args[3])))
    fail('bootstrap-verification-context');
  const identity=executableIdentity(),logicalArgv=spec.args;
  const normalizedArgv=['--no-warnings','--permission',`--allow-fs-read=${bound.root}`,
    `--allow-fs-write=${fs.realpathSync(ownedTemp)}`,`--require=${environmentGuardPath}`,
    '--test','--test-isolation=none','--test-reporter=tap','--',spec.args[3]];
  const environment=structuredClone(spec.environment);
  const containment={provider:'node-permission-v1',node_patch:process.versions.node,
    worktree_realpath:fs.realpathSync(bound.root),owned_temp_realpath:fs.realpathSync(ownedTemp),
    logical_argv_sha256:bootstrapCommandArgvSha256(logicalArgv),
    effective_argv_sha256:bootstrapCommandArgvSha256(normalizedArgv),
    denied_capabilities:['child-process','native-addon','wasi','worker']};
  const supervisor={platform:process.platform==='win32'?'win32':'posix',values:{},identities:{}};
  return {logicalArgv,normalizedArgv,identity,environment,containment,supervisor};
}
async function runBootstrapFirstRed({stateCapability,planCapability,plan,sliceId,authorizationPath,
  receiptPath,markerPath,specPath,writeReceiptPath}={}){
  const bound=authenticateBootstrapCompletion({stateCapability,authorizationPath,receiptPath,markerPath});
  const transaction=require('./transaction-runtime.js'),frontmatter=require('./frontmatter.js');
  const locked=JSON.parse(transaction.readSessionFile(planCapability));
  if(canonicalText(locked)!==canonicalText(plan)||
    bound.receipt.first_red_slice_id!==sliceId||bound.marker.first_red_slice_id!==sliceId)
    fail('bootstrap-first-red-plan');
  authenticateImmutableBootstrapPlan(plan);
  const target=plan.slices?.find((row)=>row.id===sliceId);
  const specRaw=readJsonArtifact(specPath,'bootstrap-first-red-spec',{canonical:true});
  const spec=require('./contract-runtime.js').validateVerificationSpecV2(specRaw.value);
  if(!target||target.slice_kind!=='functional'||
    target.verification_spec_sha256!==specRaw.sha256||
    bound.receipt.first_red_verification_spec_sha256!==specRaw.sha256||
    bound.marker.first_red_verification_spec_sha256!==specRaw.sha256)
    fail('bootstrap-first-red-spec');
  const supportedNode=spec.executable.supported_patches_sha256===
    BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256&&process.versions.node==='26.0.0';
  const completionReceipt=await journal.resumeOperation({
    projectCapability:transaction.projectCapabilityFor(stateCapability),
    operationId:bound.receipt.completion_operation_id,sessionId:bound.sessionId,
    kind:'bootstrap-finalize'});
  validateBootstrapCompletionAuthority({receipt:bound.receipt,marker:bound.marker,
    operationReceipt:completionReceipt});
  const write=acceptedWriteAuthority({stateCapability,plan,sliceId,writeReceiptPath});
  let verificationPlan;
  try{verificationPlan=typeof write.fields.verification_plan_json==='string'?
    JSON.parse(write.fields.verification_plan_json):write.fields.verification_plan_json;}
  catch{fail('bootstrap-first-red-plan');}
  if(!verificationPlan||verificationPlan.plan_sha256!==write.fields.verification_plan_sha256)
    fail('bootstrap-first-red-plan');
  authenticateBootstrapVerificationPlan({plan,verificationPlan,sliceId,
    specSha256:specRaw.sha256});
  const writeLedger=await journal.resumeOperation({projectCapability:write.project,
    operationId:write.receipt.operationId,sessionId:bound.sessionId,
    kind:'delegation-scope-publish'});
  if(writeLedger.stage!=='completed-ledger'||writeLedger.result?.status!=='accepted'||
    writeLedger.result?.receiptSha256!==write.receipt.receiptSha256||
    writeLedger.result?.sliceId!==sliceId||writeLedger.result?.writeClass!=='failing-test')
    fail('bootstrap-first-red-write-producer');
  const ownedTemp=path.join(bound.root,'.deep-work',bound.sessionId,'tmp');
  fs.mkdirSync(ownedTemp,{recursive:true});
  const environmentGuardPath=path.join(ownedTemp,'closed-environment-guard.cjs');
  if(!fs.existsSync(environmentGuardPath))
    writeExclusiveBytes(environmentGuardPath,closedEnvironmentGuardBytes(bound.root,spec.args[3]));
  const executionContext=bootstrapFirstRedExecutionContext(bound,spec);
  const preconditions={target_session_id:bound.sessionId,
    authorization_sha256:bound.authorization.authorization_sha256,
    witness_sha256:bound.authorization.witness.witness_sha256,
    bootstrap_receipt_sha256:bound.receipt.receipt_sha256,
    plan_authority_sha256:plan.plan_authority_sha256,slice_id:sliceId,
    verification_spec_sha256:specRaw.sha256,
    failing_test_write_operation_id:write.receipt.operationId,
    failing_test_write_receipt_sha256:write.receipt.receiptSha256,
    execution_containment_sha256:
      semanticDigest('execution-containment-v1',executionContext.containment,null),
    supervisor_control_sha256:
      semanticDigest('supervisor-control-v1',executionContext.supervisor,null),
    expected_outcome:spec.red_failure};
  const operationId=deterministicOperationId('bootstrap-first-red-v2',preconditions);
  const resultRelative=`.claude/deep-work.${bound.sessionId}.verification.${operationId}.json`;
  const resultPath=path.join(bound.root,...resultRelative.split('/'));
  const existing=await completedOperation(write.project,operationId,bound.sessionId,
    'bootstrap-first-red');
  if(existing?.stage==='completed-ledger'){
    const existingVerification=validateBootstrapVerificationResultV2(
      readJsonArtifact(resultPath,'bootstrap-first-red-result',{canonical:true}).value,{
        expectedSignal:spec.red_failure.expected_signal});
    authenticateBootstrapVerificationContext({verification:existingVerification,bound,plan,
      verificationPlan,spec,specRawSha256:specRaw.sha256,write,operationId,...executionContext});
    if(existingVerification.verification_operation_id!==operationId||
      existingVerification.result_sha256!==
        (existing.result?.result_sha256||existing.result?.verification_result_sha256))
      fail('bootstrap-first-red-result');
    if(!exactKeys(existing.result,['session_id','slice_id','result_path','result_sha256',
      'disposition','observed_class','scope_disposition'])||
      existing.result.result_path!==resultRelative||
      existing.result.disposition!==existingVerification.disposition||
      existing.result.observed_class!==existingVerification.classification.observed_class||
      existing.result.scope_disposition!==existingVerification.scope_disposition)
      fail('bootstrap-first-red-result');
    const aliases={
      verification_result_path:existing.result.result_path,
      verification_result_sha256:existing.result.result_sha256,
      verification_operation_id:operationId,write_operation_id:write.receipt.operationId,
      write_receipt_sha256:write.receipt.receiptSha256};
    return {...existing.result,...aliases,operation_id:operationId,
      operation_receipt:existing,adopted:true};
  }
  const operation=await journal.beginOperation({projectCapability:write.project,
    sessionId:bound.sessionId,kind:'bootstrap-first-red',operationId,slice:sliceId,
    preconditions});
  await journal.recordOperationStage(operation,'containment-authenticated',{owned:{
    executionContainmentSha256:preconditions.execution_containment_sha256,
    supervisorControlSha256:preconditions.supervisor_control_sha256}});
  const manifestOptions={currentOperation:{kind:'bootstrap-first-red',
    operation_id:operationId,preconditions,slice:sliceId}};
  let verification;
  if(fs.existsSync(resultPath)){
    verification=validateBootstrapVerificationResultV2(
      readJsonArtifact(resultPath,'bootstrap-first-red-result',{canonical:true}).value,{
        expectedSignal:spec.red_failure.expected_signal});
    authenticateBootstrapVerificationContext({verification,bound,plan,verificationPlan,spec,
      specRawSha256:specRaw.sha256,write,operationId,
      ...executionContext});
    await journal.recordOperationStage(operation,'pre-manifest-published',{owned:{
      path:verification.pre_manifest_ref.path,sha256:verification.pre_manifest_ref.sha256}});
    await journal.recordOperationStage(operation,'process-completed',{owned:{
      processSha256:semanticDigest('verification-process-v1',verification.process,null)}});
    await journal.recordOperationStage(operation,'post-manifest-published',{owned:{
      path:verification.post_manifest_ref.path,sha256:verification.post_manifest_ref.sha256}});
    await journal.recordOperationStage(operation,'result-published',{owned:{
      resultPath:resultRelative,resultSha256:verification.result_sha256}});
  }else{
    const {identity,logicalArgv,normalizedArgv,environment,containment,supervisor}=
      executionContext;
    const preRef={path:`.claude/deep-work.${bound.sessionId}.verification-manifest.${operationId}.pre.json`,
      sha256:null};
    const postRef={path:`.claude/deep-work.${bound.sessionId}.verification-manifest.${operationId}.post.json`,
      sha256:null};
    const manifestBefore=captureBootstrapManifest(bound.root,bound.authorization.witness,'pre',
      manifestOptions);
    const preWrite=writeExclusiveArtifact(path.join(bound.root,...preRef.path.split('/')),manifestBefore);
    preRef.sha256=preWrite.sha256;
    await journal.recordOperationStage(operation,'pre-manifest-published',{owned:{
      path:preRef.path,sha256:preRef.sha256}});
    let ran;
    if(supportedNode){
      try{
        ran=await require('./process-supervisor.js').runSupervisedProcess({
          executable:identity.path,args:normalizedArgv},{cwd:bound.root,timeoutMs:spec.timeout_ms,
          maxOutputBytes:spec.max_output_bytes,env:structuredClone(spec.environment.values),
          rawOutput:true});
      }catch(error){
        ran={exitCode:null,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),
          timedOut:false,outputOverflow:false,durationMs:0,
          spawnError:{code:'spawn-failed',
            message_sha256:rawDigest(Buffer.from(String(error?.message||error||'spawn failure')
              .normalize('NFC')))}};
      }
    }else{
      ran={exitCode:null,signal:null,stdout:'',stderr:'',timedOut:false,
        outputOverflow:false,durationMs:0,spawnError:{code:'identity-drift',
          message_sha256:rawDigest(Buffer.from('unsupported-node-patch'))}};
    }
    const stdout=Buffer.isBuffer(ran.stdout)?Buffer.from(ran.stdout):
      Buffer.from(ran.stdout||'','utf8');
    const stderr=Buffer.isBuffer(ran.stderr)?Buffer.from(ran.stderr):
      Buffer.from(ran.stderr||'','utf8');
    const processRecord={exit_code:ran.exitCode,signal:ran.signal,timed_out:ran.timedOut,
      output_overflow:ran.outputOverflow,duration_ms:ran.durationMs,
      spawn_error:ran.spawnError||null};
    await journal.recordOperationStage(operation,'process-completed',{owned:{
      processSha256:semanticDigest('verification-process-v1',processRecord,null)}});
    const manifestAfter=captureBootstrapManifest(bound.root,bound.authorization.witness,'post',
      manifestOptions);
    const postWrite=writeExclusiveArtifact(path.join(bound.root,...postRef.path.split('/')),manifestAfter);
    postRef.sha256=postWrite.sha256;
    await journal.recordOperationStage(operation,'post-manifest-published',{owned:{
      path:postRef.path,sha256:postRef.sha256}});
    const changed=trackedChangedPaths(manifestBefore,manifestAfter);
    const expected=spec.red_failure.expected_signal;
    const classification=classifyVerificationObservation({processResult:ran,
      changedPaths:changed,stdout,stderr,root:bound.root,testPath:spec.args[3],
      nodePatch:process.versions.node,expectedSignal:expected});
    const observedClass=classification.observed_class;
    verification={schema_version:2,session_id:bound.sessionId,slice_id:sliceId,
      plan_authority_sha256:plan.plan_authority_sha256,
      spec_sha256:plan.contract_binding?.spec_contract?.spec_sha256,
      verification_plan_sha256:verificationPlan.plan_sha256,
      write_operation_id:write.receipt.operationId,verification_operation_id:operationId,
      result_path:resultRelative,executable_identity:identity,logical_argv:logicalArgv,
      normalized_argv:normalizedArgv,cwd_role:'worktree',environment,
      environment_sha256:semanticDigest('node-test-env-v1',environment,null),
      execution_containment:containment,
      execution_containment_sha256:semanticDigest('execution-containment-v1',containment,null),
      supervisor_control:supervisor,
      supervisor_control_sha256:semanticDigest('supervisor-control-v1',supervisor,null),
      process:processRecord,
      raw_stdout:{base64:stdout.toString('base64'),byte_length:stdout.length,
        sha256:rawDigest(stdout)},
      raw_stderr:{base64:stderr.toString('base64'),byte_length:stderr.length,
        sha256:rawDigest(stderr)},pre_manifest_ref:preRef,post_manifest_ref:postRef,
      changed_paths:changed,scope_disposition:changed.length===0?'clean':'test-side-effect',
      classification,disposition:observedClass==='expected-failure'&&changed.length===0?
        'accepted':'rejected',result_sha256:null};
    verification.result_sha256=semanticDigest('verification-result-v2',verification,'result_sha256');
    validateBootstrapVerificationResultV2(verification,{expectedSignal:expected});
    authenticateBootstrapVerificationContext({verification,bound,plan,verificationPlan,spec,
      specRawSha256:specRaw.sha256,write,operationId,logicalArgv,normalizedArgv,identity,
      environment,containment,supervisor});
    writeExclusiveArtifact(resultPath,verification);
    await journal.recordOperationStage(operation,'result-published',{owned:{
      resultPath:resultRelative,resultSha256:verification.result_sha256}});
  }
  if(verification.disposition==='rejected'){
    const terminal={session_id:bound.sessionId,slice_id:sliceId,result_path:resultRelative,
      result_sha256:verification.result_sha256,disposition:'rejected',
      observed_class:verification.classification.observed_class,
      scope_disposition:verification.scope_disposition};
    const ledger=await journal.completeOperation(operation,terminal);
    if(verification.classification.observed_class==='test-side-effect'){
      await require('./phase-runtime.js').invalidateForReplan({stateCapability,
        reason:'external-side-effect',fromRisk:'high',toRisk:'critical',
        affectedSliceIds:[sliceId],
        riskProfileSha256:semanticDigest('bootstrap-side-effect-replan-v1',{
          verification_result_sha256:verification.result_sha256,
          changed_paths:verification.changed_paths},null),
        at:new Date().toISOString()});
    }
    return {...terminal,verification_result_path:resultRelative,
      verification_result_sha256:verification.result_sha256,
      operation_id:operationId,operation_receipt:ledger,adopted:false};
  }
  const stateText=fs.readFileSync(stateCapability.path,'utf8');
  const fields=frontmatter.parseFrontmatter(stateText).fields;
  if(fields.tdd_state!=='PENDING'&&!(fields.tdd_state==='RED_VERIFIED'&&
    fields.bootstrap_bridge_operation_id===operationId))fail('bootstrap-first-red-state');
  const updated=frontmatter.updateFrontmatterText(stateText,{tdd_state:'RED_VERIFIED',
    red_proof_state:'bridge-pending',bootstrap_bridge_operation_id:operationId,
    bootstrap_verification_result_path:resultRelative,
    bootstrap_verification_result_sha256:verification.result_sha256});
  if(updated!==stateText)require('./platform.js').atomicWriteFile(stateCapability,updated);
  const terminal={session_id:bound.sessionId,slice_id:sliceId,result_path:resultRelative,
    result_sha256:verification.result_sha256,disposition:'accepted',
    observed_class:verification.classification.observed_class,
    scope_disposition:verification.scope_disposition};
  const ledger=await journal.completeOperation(operation,terminal);
  return {...terminal,verification_result_path:resultRelative,
    verification_result_sha256:verification.result_sha256,
    verification_operation_id:operationId,write_operation_id:write.receipt.operationId,
    write_receipt_sha256:write.receipt.receiptSha256,
    post_state_sha256:rawDigest(Buffer.from(updated)),bridge_consumed:true,
    operation_id:operationId,operation_receipt:ledger,adopted:false};
}
async function adoptBootstrapRed({stateCapability,planCapability,plan,sliceId,authorizationPath,
  receiptPath,markerPath,bridgeOperationId}={}){
  const bound=authenticateBootstrapCompletion({stateCapability,authorizationPath,receiptPath,markerPath});
  const transaction=require('./transaction-runtime.js'),frontmatter=require('./frontmatter.js');
  const locked=JSON.parse(transaction.readSessionFile(planCapability));
  if(canonicalText(locked)!==canonicalText(plan)||sliceId!==bound.receipt.first_red_slice_id)
    fail('bootstrap-red-adoption-plan');
  authenticateImmutableBootstrapPlan(plan,'bootstrap-red-adoption-plan');
  const project=transaction.projectCapabilityFor(stateCapability);
  const bridge=await journal.resumeOperation({projectCapability:project,
    operationId:bridgeOperationId,sessionId:bound.sessionId,kind:'bootstrap-first-red'});
  if(bridge.stage!=='completed-ledger'||bridge.result?.disposition!=='accepted'||
    bridge.result?.slice_id!==sliceId||!DIGEST.test(bridge.resultSha256||''))
    fail('bootstrap-red-adoption-bridge');
  const verification=validateBootstrapVerificationResultV2(
    readJsonArtifact(path.join(bound.root,...bridge.result.result_path.split('/')),
      'bootstrap-first-red-result',{canonical:true}).value,{expectedSignal:
        plan.slices.find((row)=>row.id===sliceId).verification_spec.red_failure.expected_signal});
  if(verification.result_sha256!==bridge.result.result_sha256||
    verification.verification_operation_id!==bridgeOperationId)
    fail('bootstrap-red-adoption-bridge');
  const stateText=fs.readFileSync(stateCapability.path,'utf8');
  const fields=frontmatter.parseFrontmatter(stateText).fields;
  const target=plan.slices?.find((row)=>row.id===sliceId);
  const verificationPlan=currentBootstrapVerificationPlan({fields,plan,sliceId,
    specSha256:target?.verification_spec_sha256,failureCode:'bootstrap-red-adoption-plan'});
  authenticateBootstrapProducerVerification({plan,verificationPlan,verification,
    bridgeOperationId,bridge,sliceId,failureCode:'bootstrap-red-adoption-bridge'});
  const expectedBridgeOperationId=deterministicOperationId('bootstrap-first-red-v2',{
    target_session_id:bound.sessionId,
    authorization_sha256:bound.authorization.authorization_sha256,
    witness_sha256:bound.authorization.witness.witness_sha256,
    bootstrap_receipt_sha256:bound.receipt.receipt_sha256,
    plan_authority_sha256:plan.plan_authority_sha256,slice_id:sliceId,
    verification_spec_sha256:target.verification_spec_sha256,
    failing_test_write_operation_id:verification.write_operation_id,
    failing_test_write_receipt_sha256:fields.accepted_write_receipt_sha256,
    execution_containment_sha256:verification.execution_containment_sha256,
    supervisor_control_sha256:verification.supervisor_control_sha256,
    expected_outcome:target.verification_spec.red_failure,
  });
  if(expectedBridgeOperationId!==bridgeOperationId)fail('bootstrap-red-adoption-bridge');
  const preconditions={session_id:bound.sessionId,slice_id:sliceId,
    plan_authority_sha256:plan.plan_authority_sha256,
    bootstrap_bridge_operation_id:bridgeOperationId,
    bootstrap_bridge_ledger_result_sha256:bridge.resultSha256,
    verification_result_sha256:verification.result_sha256,
    write_receipt_sha256:fields.accepted_write_receipt_sha256};
  const operationId=deterministicOperationId('bootstrap-red-adoption-v1',preconditions);
  const existing=await completedOperation(project,operationId,bound.sessionId,
    'bootstrap-red-adoption');
  if(existing?.stage==='completed-ledger')
    return {...existing.result,operation_id:operationId,operation_receipt:existing,adopted:true};
  const operation=await journal.beginOperation({projectCapability:project,
    sessionId:bound.sessionId,kind:'bootstrap-red-adoption',operationId,slice:sliceId,
    preconditions});
  await journal.recordOperationStage(operation,'bridge-authenticated',{owned:{
    bridgeOperationId,bridgeLedgerResultSha256:bridge.resultSha256}});
  if(fields.tdd_state!=='RED_VERIFIED'||fields.bootstrap_bridge_operation_id!==bridgeOperationId||
    !['bridge-pending','proof-pending'].includes(fields.red_proof_state))
    fail('bootstrap-red-adoption-state');
  const updated=frontmatter.updateFrontmatterText(stateText,{red_proof_state:'proof-pending',
    bootstrap_adoption_operation_id:operationId});
  if(updated!==stateText)require('./platform.js').atomicWriteFile(stateCapability,updated);
  await journal.recordOperationStage(operation,'red-authority-adopted',{owned:{sliceId}});
  const terminal={slice_id:sliceId,post_state_sha256:rawDigest(Buffer.from(updated)),
    verification_result_sha256:verification.result_sha256,
    write_receipt_sha256:fields.accepted_write_receipt_sha256,
    bootstrap_bridge_operation_id:bridgeOperationId};
  const ledger=await journal.completeOperation(operation,terminal);
  return {...terminal,operation_id:operationId,operation_receipt:ledger,adopted:false};
}
async function publishBootstrapRedProof({stateCapability,planCapability,plan,sliceId,
  transitionOperationId}={}){
  const transaction=require('./transaction-runtime.js'),frontmatter=require('./frontmatter.js');
  const sessionId=sessionIdForState(stateCapability),root=stateCapability.projectRoot;
  const locked=JSON.parse(transaction.readSessionFile(planCapability));
  if(canonicalText(locked)!==canonicalText(plan))fail('bootstrap-proof-plan');
  authenticateImmutableBootstrapPlan(plan,'bootstrap-proof-plan');
  const project=transaction.projectCapabilityFor(stateCapability);
  const transition=await journal.resumeOperation({projectCapability:project,
    operationId:transitionOperationId,sessionId,kind:'bootstrap-red-adoption'});
  if(transition.stage!=='completed-ledger'||transition.result?.slice_id!==sliceId||
    !DIGEST.test(transition.result?.verification_result_sha256||'')||
    !DIGEST.test(transition.result?.write_receipt_sha256||'')||
    !DIGEST.test(transition.resultSha256||''))
    fail('bootstrap-proof-transition');
  const bridgeOperationId=transition.result.bootstrap_bridge_operation_id;
  const bridge=await journal.resumeOperation({projectCapability:project,
    operationId:bridgeOperationId,sessionId,kind:'bootstrap-first-red'});
  if(bridge.stage!=='completed-ledger'||bridge.result?.disposition!=='accepted')
    fail('bootstrap-proof-bridge');
  const target=plan.slices?.find((row)=>row.id===sliceId);
  if(!target||target.slice_kind!=='functional')fail('bootstrap-proof-plan');
  const verification=validateBootstrapVerificationResultV2(
    readJsonArtifact(path.join(root,...bridge.result.result_path.split('/')),
      'bootstrap-first-red-result',{canonical:true}).value,
    {expectedSignal:target.verification_spec.red_failure.expected_signal});
  const stateText=fs.readFileSync(stateCapability.path,'utf8');
  const fields=frontmatter.parseFrontmatter(stateText).fields;
  if(transition.result.verification_result_sha256!==verification.result_sha256||
    transition.result.write_receipt_sha256!==fields.accepted_write_receipt_sha256)
    fail('bootstrap-proof-transition');
  const verificationPlan=currentBootstrapVerificationPlan({fields,plan,sliceId,
    specSha256:target.verification_spec_sha256,failureCode:'bootstrap-proof-plan'});
  authenticateBootstrapProducerVerification({plan,verificationPlan,verification,
    bridgeOperationId,bridge,sliceId,failureCode:'bootstrap-proof-bridge'});
  const expectedTransitionOperationId=deterministicOperationId('bootstrap-red-adoption-v1',{
    session_id:sessionId,slice_id:sliceId,plan_authority_sha256:plan.plan_authority_sha256,
    bootstrap_bridge_operation_id:bridgeOperationId,
    bootstrap_bridge_ledger_result_sha256:bridge.resultSha256,
    verification_result_sha256:verification.result_sha256,
    write_receipt_sha256:fields.accepted_write_receipt_sha256,
  });
  if(expectedTransitionOperationId!==transitionOperationId)
    fail('bootstrap-proof-transition');
  if(fields.red_proof_state!=='proof-pending'||
    fields.bootstrap_adoption_operation_id!==transitionOperationId||
    fields.bootstrap_bridge_operation_id!==bridgeOperationId)
    fail('bootstrap-proof-state');
  const preconditions={session_id:sessionId,slice_id:sliceId,
    plan_authority_sha256:plan.plan_authority_sha256,transition_kind:'bootstrap-adoption',
    transition_operation_id:transitionOperationId,
    transition_ledger_result_sha256:transition.resultSha256,
    bootstrap_bridge_operation_id:bridgeOperationId};
  const operationId=deterministicOperationId('red-proof-publication-v1',preconditions);
  const existing=await completedOperation(project,operationId,sessionId,'red-proof-publication');
  if(existing?.stage==='completed-ledger')
    return {...existing.result,operation_id:operationId,operation_receipt:existing,adopted:true};
  const operation=await journal.beginOperation({projectCapability:project,sessionId,
    kind:'red-proof-publication',operationId,slice:sliceId,preconditions});
  const proof={schema_version:1,session_id:sessionId,slice_id:sliceId,
    plan_authority_sha256:plan.plan_authority_sha256,
    spec_sha256:verification.spec_sha256,
    spec_approved_hash:plan.contract_binding.spec_contract.spec_approved_hash,
    verification_plan_sha256:verification.verification_plan_sha256,
    write_operation_id:verification.write_operation_id,
    write_receipt_sha256:fields.accepted_write_receipt_sha256,
    verification_operation_id:verification.verification_operation_id,
    verification_result_sha256:verification.result_sha256,
    verification_ledger_result_sha256:bridge.resultSha256,
    transition_kind:'bootstrap-adoption',transition_operation_id:transitionOperationId,
    transition_ledger_result_sha256:transition.resultSha256,
    bootstrap_bridge_operation_id:bridgeOperationId,proof_operation_id:operationId,
    classification_digest:semanticDigest('bootstrap-classification-v1',
      verification.classification,null),proof_sha256:null};
  proof.proof_sha256=semanticDigest('red-proof-v1',proof,'proof_sha256');
  validateBootstrapRedProofV1(proof);
  const proofRelative=`.deep-work/${sessionId}/red-proofs/${proof.proof_sha256}.json`;
  writeExclusiveArtifact(path.join(root,...proofRelative.split('/')),proof);
  await journal.recordOperationStage(operation,'proof-published',{owned:{
    proofPath:proofRelative,proofSha256:proof.proof_sha256}});
  const updated=frontmatter.updateFrontmatterText(stateText,{red_proof_state:'complete',
    red_proof_ref:proofRelative,red_proof_sha256:proof.proof_sha256,
    red_proof_operation_id:operationId});
  require('./platform.js').atomicWriteFile(stateCapability,updated);
  await journal.recordOperationStage(operation,'proof-ref-committed',{owned:{
    proofSha256:proof.proof_sha256}});
  const terminal={proof_sha256:proof.proof_sha256,red_proof_ref:proofRelative,
    post_state_sha256:rawDigest(Buffer.from(updated))};
  const ledger=await journal.completeOperation(operation,terminal);
  return {...terminal,operation_id:operationId,operation_receipt:ledger,adopted:false};
}

module.exports={
  BOOTSTRAP_CONTROL_NAMES,BOOTSTRAP_EXECUTION_STAGES,BOOTSTRAP_REJECTION_CODES,
  BOOTSTRAP_VERIFICATION_RESULT_KEYS,BOOTSTRAP_RED_PROOF_KEYS,
  bootstrapManifestSchemaSha256,bootstrapCommandArgvSha256,normalizeNodeTestBootstrapStdout,
  parseNodeTapFailure,tapValueDigest,classifyExpectedTapSignal,classifyTapDiagnostic,
  classifyBootstrapObservedCommandResult,validateBootstrapObservedCommandResult,
  validateBootstrapFailureArtifact,validateBootstrapManifest,validateBootstrapWitness,
  validateBootstrapAuthorization,validateBootstrapExecutionJournal,
  validateBootstrapExecutionJournalTransition,validateBootstrapVerificationResultV2,
  validateBootstrapRedProofV1,precomputeBootstrapCompletion,canonicalBootstrapJson,
  BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256,
  validateBootstrapCompletionAuthority,
  publishBootstrapFailure,abortBootstrap,finalizeBootstrap,runBootstrapFirstRed,
  adoptBootstrapRed,publishBootstrapRedProof,
};
