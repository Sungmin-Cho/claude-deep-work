#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SCRIPT_PATH=fileURLToPath(import.meta.url);
const CANDIDATE_ROOT=path.dirname(SCRIPT_PATH);
const STRANDED_ROOT=path.dirname(CANDIDATE_ROOT);
const PREPARATION_ROOT=path.dirname(STRANDED_ROOT);
const SCRATCH_ROOT=path.resolve(PREPARATION_ROOT,'../..');
const TARGET_ROOT='/Users/sungmin/Dev/claude-plugins/deep-work/.claude/worktrees/v6-14-tdd-replan';
const MAIN_ROOT='/Users/sungmin/Dev/claude-plugins/deep-work';
const SESSION='s-6236e5bc';
const TARGET_SESSION_ROOT=path.join(TARGET_ROOT,'.deep-work',SESSION);
const REVIEWS_ROOT=path.join(TARGET_SESSION_ROOT,'reviews');
const PLAN_PATH=path.join(TARGET_SESSION_ROOT,'plan.md');
const PLAN_APPROVAL_PATH=path.join(TARGET_SESSION_ROOT,'plan-approval-native-goal-e35.json');
const SPEC_PATH=path.join(TARGET_SESSION_ROOT,'spec.md');
const SPEC_APPROVAL_PATH=path.join(TARGET_SESSION_ROOT,'spec-approval-native-goal-e35.json');
const SOURCE_ROOT=path.join(STRANDED_ROOT,'generation-30-candidates');
const SOURCE_PREP=path.join(SOURCE_ROOT,'prep-tool-green.mjs');
const SOURCE_EXECUTOR=path.join(SOURCE_ROOT,'executor-green.mjs');
const SOURCE_CANDIDATE_MANIFEST=path.join(SOURCE_ROOT,'program-candidate-manifest.json');
const SOURCE_PROJECTION_RED=path.join(SOURCE_ROOT,'runtime-projection-red-result.json');
const SOURCE_SELECTOR_RED=path.join(SOURCE_ROOT,'historical-selector-isolation-red-result.json');
const SOURCE_SELECTOR_GREEN=path.join(SOURCE_ROOT,'historical-selector-isolation-green-result.json');
const SOURCE_ARGV_MANIFEST=path.join(STRANDED_ROOT,'generation-30-command-argv-manifest.json');
const SOURCE_ARGV_APPROVAL=path.join(STRANDED_ROOT,'generation-30-argv-approval.json');
const GENERATION30_FAILURE_PATH=path.join(STRANDED_ROOT,'generation-30-first-self-test-failure.json');
const GENERATION31_FAILURE_PATH=path.join(STRANDED_ROOT,'generation-31-builder-failure.json');
const FAILURE_PATH=path.join(STRANDED_ROOT,'generation-32-builder-failure.json');
const GENERATION32_CANDIDATE_ROOT=path.join(STRANDED_ROOT,'generation-32-candidates');
const GENERATION32_BUILDER_PATH=path.join(
  GENERATION32_CANDIDATE_ROOT,'build-generation-32-candidates.mjs');
const GENERATION32_RED_PREP=path.join(GENERATION32_CANDIDATE_ROOT,'prep-tool-red.mjs');
const ARGV_MANIFEST_PATH=path.join(STRANDED_ROOT,'generation-33-command-argv-manifest.json');
const ARGV_APPROVAL_PATH=path.join(STRANDED_ROOT,'generation-33-argv-approval.json');
const LIVE_PREP=path.join(PREPARATION_ROOT,'prep-tool-r2.mjs');
const LIVE_EXECUTOR=path.join(PREPARATION_ROOT,'executor.mjs');
const GENERATION_ROOT=path.join(PREPARATION_ROOT,'generation-33');
const FIRST_SELF_TEST=path.join(PREPARATION_ROOT,'prep-tool-r33-gate0-command-self-test.json');
const POST_SELF_TEST=path.join(PREPARATION_ROOT,'prep-tool-r33-post-authoring-self-test.json');

const AUTH=Object.freeze({
  plan_sha256:'bfb62d4eee3ced99b59a55350f93d71ddcd4777da2af248ef8137357c0091d9f',
  plan_approval_raw_sha256:'664623686d2324037bc150b6443f62d1e06d700cef07faeda93477bfe7cc4d20',
  spec_sha256:'526ca481efd9c1f0586ceb499fd524cc0fe05f1eb558b59e991112cd04dadf76',
  spec_approval_raw_sha256:'65f371775b9571db764868ac10d2762eee54e98e99cef64873cfc97a61e05c14',
  source_prep_sha256:'b75a51ae5f5de1ab7b1eb76ba76a051ef67bbf571e8da3627640549e49f6cb94',
  source_executor_sha256:'79fb366c1f2554b63e2d0e6a3615ecd520c9d9f6706362c5c043b834f6db6c33',
  source_candidate_manifest_raw_sha256:'dd3dcf82ff0f7168968c6421edeb5e845390a377b3fa80921ba2a41bb4f957ae',
  source_candidate_manifest_sha256:'4fc466deef08d16f1789868abda653a0f1e27d2ba858f3b2378357f849700307',
  source_argv_manifest_raw_sha256:'0c2983ab9938f7fe3d316436283ea51e4f9e7039b6c8076383ab24e7093c45a4',
  source_argv_approval_raw_sha256:'76c4f53a2c564487e9d5fd1a69fc7c881ef9ca2b068be3e8f82682f3effd2021',
  source_argv_approval_sha256:'80b0367ca2edd6da6a4f7c8edfe96048f97451c599d653cd40cae9fe2464a5ce',
  source_projection_red_raw_sha256:'5be5a4c573a3b7edac0b0abd692c2fb3353368565b46a7dbd57de181db73bfaf',
  source_selector_red_raw_sha256:'6d936071af6a08fa0ec69942b1ff5a1cd53a85d84989085df08225047714b8bf',
  source_selector_green_raw_sha256:'7c1a07b4e741c6eddf3c80dea9d48c5b295176197449fdeb362d6495859da7b0',
  production_oid:'092306db8665bcb1c5df8c5c4ac871e051b1c604',
  test_oid:'4418614ec6c989980bf2fac9cc29be82d1ce1312',
  runtime_sha256:'1512005dde49dca2a97ef9f7c9de37538a8c6ec61d690e08b64144acbde80e51',
  platform_sha256:'1493c7515194f01bb99f3b307e7e31f8b57a48186a333643e5f1b9c652eba114',
});
const REVIEW_PATHS=Object.freeze(new Map([
  ['structural',path.join(REVIEWS_ROOT,'native-goal-generation-33-argv-structural.json')],
  ['semantic',path.join(REVIEWS_ROOT,'native-goal-generation-33-argv-semantic.json')],
  ['executability',path.join(REVIEWS_ROOT,'native-goal-generation-33-argv-executability.json')],
]));
const CHILDREN=Object.freeze([
  'build-generation-33-candidates.mjs','executor-green.mjs','executor-red-to-green.diff',
  'executor-red.mjs','executor-source-to-red.diff','prep-tool-green.mjs',
  'prep-tool-red-to-green.diff','prep-tool-red.mjs','prep-tool-source-to-red.diff',
  'program-candidate-manifest.json','runtime-parity-green-result.json',
  'runtime-parity-red-result.json',
].sort(compareBytes));

function fail(code,detail=''){const error=new Error(`${code}${detail?`:${detail}`:''}`);error.code=code;throw error;}
function compareBytes(a,b){return Buffer.compare(Buffer.from(a),Buffer.from(b));}
function canonicalJson(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort(compareBytes)
    .map((key)=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function semanticDigest(domain,value,omitted){
  const copy=structuredClone(value);delete copy[omitted];
  return sha256(Buffer.concat([Buffer.from(`${domain}\0`),Buffer.from(canonicalJson(copy))]));
}
function regularFile(file,{absent=false,max=64*1024*1024}={}){
  try{
    const stat=fs.lstatSync(file,{bigint:true});
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>BigInt(max))fail('regular-file',file);
    const bytes=fs.readFileSync(file);
    if(BigInt(bytes.length)!==stat.size)fail('file-size',file);
    return {bytes,sha256:sha256(bytes),size:bytes.length,stat};
  }catch(error){
    if(absent&&error?.code==='ENOENT')return null;
    throw error;
  }
}
function fsyncDirectory(directory){
  const fd=fs.openSync(directory,fs.constants.O_RDONLY);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function writeExclusive(file,bytes){
  const expected=Buffer.from(bytes);
  try{
    const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
    try{fs.writeFileSync(fd,expected);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fsyncDirectory(path.dirname(file));
  }catch(error){
    if(error?.code!=='EEXIST')throw error;
    if(Buffer.compare(regularFile(file).bytes,expected)!==0)fail('existing-byte-drift',file);
  }
  if(Buffer.compare(regularFile(file).bytes,expected)!==0)fail('reopen-byte-drift',file);
}
function parse(file,digest=null){
  const retained=regularFile(file);
  if(digest!==null&&retained.sha256!==digest)fail('raw-authority',file);
  try{return {retained,value:JSON.parse(retained.bytes.toString('utf8'))};}
  catch{fail('json-authority',file);}
}
function exactReplace(text,from,to,count=1){
  const observed=text.split(from).length-1;
  if(observed!==count)fail('replacement-count',`${from}:${observed}`);
  return text.replaceAll(from,to);
}
function gitText(args){
  const result=spawnSync('git',args,{cwd:SCRATCH_ROOT,encoding:'utf8'});
  if(result.status!==0||result.signal!==null||result.stderr!=='')fail('git-authority',args.join(' '));
  return result.stdout.trim();
}
function nodeIdentity(){
  const real=fs.realpathSync(process.execPath),stat=fs.lstatSync(real,{bigint:true});
  return {path:real,version:process.versions.node,sha256:sha256(fs.readFileSync(real)),
    dev:String(stat.dev),ino:String(stat.ino),mode:String(stat.mode),size:String(stat.size),
    mtime_ns:String(stat.mtimeNs)};
}
function fileRow(role,file,base=CANDIDATE_ROOT){
  const retained=regularFile(file);
  return {role,path:path.relative(base,file).split(path.sep).join('/'),
    sha256:retained.sha256,size:retained.size};
}
function sealTree(root){
  const rows=[];
  function visit(current,relative){
    const stat=fs.lstatSync(current,{bigint:true});
    if(stat.isSymbolicLink())fail('seal-symlink',current);
    if(stat.isDirectory()){
      const names=fs.readdirSync(current).sort(compareBytes);
      rows.push({path:relative,type:'directory',mode:String(stat.mode),
        children:names.map((name)=>[name,fs.lstatSync(path.join(current,name)).isDirectory()?'directory':'file'])});
      for(const name of names)visit(path.join(current,name),relative?`${relative}/${name}`:name);
    }else if(stat.isFile()){
      const bytes=fs.readFileSync(current);
      rows.push({path:relative,type:'file',mode:String(stat.mode),size:bytes.length,sha256:sha256(bytes)});
    }else fail('seal-type',current);
  }
  visit(root,'');
  return sha256(Buffer.from(canonicalJson(rows)));
}
function assertAuthority({allowAdopted=false,expectedPrep=null,expectedExecutor=null}={}){
  const exact=[
    [PLAN_PATH,AUTH.plan_sha256],[PLAN_APPROVAL_PATH,AUTH.plan_approval_raw_sha256],
    [SPEC_PATH,AUTH.spec_sha256],[SPEC_APPROVAL_PATH,AUTH.spec_approval_raw_sha256],
    [SOURCE_PREP,AUTH.source_prep_sha256],[SOURCE_EXECUTOR,AUTH.source_executor_sha256],
    [SOURCE_CANDIDATE_MANIFEST,AUTH.source_candidate_manifest_raw_sha256],
    [SOURCE_ARGV_MANIFEST,AUTH.source_argv_manifest_raw_sha256],
    [SOURCE_ARGV_APPROVAL,AUTH.source_argv_approval_raw_sha256],
    [SOURCE_PROJECTION_RED,AUTH.source_projection_red_raw_sha256],
    [SOURCE_SELECTOR_RED,AUTH.source_selector_red_raw_sha256],
    [SOURCE_SELECTOR_GREEN,AUTH.source_selector_green_raw_sha256],
    [GENERATION30_FAILURE_PATH,'652be9224de0b0c3aa8cbb0425579435361de42f16e4a318982c9e1092815262'],
    [GENERATION31_FAILURE_PATH,'263dbabf3d68d54559da25450fb82d4f0cdeadd83904e80b7e3d5aeca40ea307'],
    [GENERATION32_BUILDER_PATH,'58044989986019096737c553ea1d0cfd8fb333c2d36e55100e3a1d3271a4eff5'],
    [path.join(SCRATCH_ROOT,'runtime','bootstrap-runtime.js'),AUTH.runtime_sha256],
    [path.join(SCRATCH_ROOT,'runtime','platform.js'),AUTH.platform_sha256],
  ];
  for(const [file,digest] of exact)if(regularFile(file).sha256!==digest)fail('authority-drift',file);
  retainedGeneration32Children();
  if(gitText(['rev-parse','HEAD'])!==AUTH.production_oid||
    gitText(['rev-parse','bootstrap-v614-test-r10'])!==AUTH.test_oid||
    gitText(['rev-parse','bootstrap-v614-production-r10'])!==AUTH.production_oid)
    fail('ref-authority');
  const planApproval=parse(PLAN_APPROVAL_PATH).value;
  if(planApproval.plan_sha256!==AUTH.plan_sha256||planApproval.replan_epoch!==35||
    planApproval.active_generation!==33||planApproval.verdict!=='APPROVE'||
    !Array.isArray(planApproval.reviews)||planApproval.reviews.length!==3)
    fail('plan-approval-authority');
  const sourceManifest=parse(SOURCE_CANDIDATE_MANIFEST).value;
  if(sourceManifest.manifest_sha256!==AUTH.source_candidate_manifest_sha256)
    fail('source-candidate-manifest');
  const sourceArgv=parse(SOURCE_ARGV_MANIFEST).value;
  const sourceApproval=parse(SOURCE_ARGV_APPROVAL).value;
  if(sourceApproval.approval_sha256!==AUTH.source_argv_approval_sha256||
    sourceApproval.candidate_manifest_sha256!==AUTH.source_candidate_manifest_sha256||
    sourceApproval.argv_manifest_raw_sha256!==AUTH.source_argv_manifest_raw_sha256||
    sourceApproval.verdict!=='APPROVE')fail('source-argv-approval');
  for(const [file,digest] of [[SOURCE_PROJECTION_RED,AUTH.source_projection_red_raw_sha256],
    [SOURCE_SELECTOR_RED,AUTH.source_selector_red_raw_sha256],
    [SOURCE_SELECTOR_GREEN,AUTH.source_selector_green_raw_sha256]]){
    const value=parse(file).value;
    if(value.pre_seal_sha256!==value.post_seal_sha256||value.no_target_writes!==true)
      fail('source-evidence-seal',file);
    if(!sourceManifest.external_red_result_raw_sha256&&file===SOURCE_PROJECTION_RED)
      fail('source-evidence-binding',file);
    if(file===SOURCE_PROJECTION_RED&&sourceManifest.external_red_result_raw_sha256!==digest)
      fail('source-evidence-binding',file);
    if(file===SOURCE_SELECTOR_RED&&sourceManifest.selector_red_result_raw_sha256!==digest)
      fail('source-evidence-binding',file);
    if(file===SOURCE_SELECTOR_GREEN&&sourceManifest.selector_green_result_raw_sha256!==digest)
      fail('source-evidence-binding',file);
  }
  const livePrep=regularFile(LIVE_PREP).sha256,liveExecutor=regularFile(LIVE_EXECUTOR).sha256;
  if(!allowAdopted){
    if(livePrep!==AUTH.source_prep_sha256||liveExecutor!==AUTH.source_executor_sha256)
      fail('live-source-authority');
  }else if(![AUTH.source_prep_sha256,expectedPrep].includes(livePrep)||
    ![AUTH.source_executor_sha256,expectedExecutor].includes(liveExecutor)||
    (livePrep===AUTH.source_prep_sha256&&liveExecutor===expectedExecutor))
    fail('live-adoption-authority');
  if(fs.existsSync(GENERATION_ROOT)||fs.existsSync(FIRST_SELF_TEST)||fs.existsSync(POST_SELF_TEST))
    fail('generation33-output-preexists');
  return {sourceManifest,sourceArgv};
}
function retainedGeneration30Failure(){
  const parsed=parse(GENERATION30_FAILURE_PATH,'652be9224de0b0c3aa8cbb0425579435361de42f16e4a318982c9e1092815262');
  if(parsed.value.artifact_kind!=='Generation30FirstSelfTestFailureV1'||
    semanticDigest('generation-30-first-self-test-failure-v1',parsed.value,'failure_sha256')!==parsed.value.failure_sha256)
    fail('generation30-failure-authority');
  return {value:parsed.value,raw_sha256:parsed.retained.sha256};
}
function retainedGeneration31Failure(){
  const parsed=parse(GENERATION31_FAILURE_PATH,'263dbabf3d68d54559da25450fb82d4f0cdeadd83904e80b7e3d5aeca40ea307');
  if(parsed.value.artifact_kind!=='Generation31BuilderFailureV1'||
    parsed.value.generation31_builder_raw_sha256!=='16bff77cdb28334577956d987a47bcd6d4f5334a9b832a21b0fc282cb3ed0c97'||
    semanticDigest('generation-31-builder-failure-v1',parsed.value,'failure_sha256')!==
      parsed.value.failure_sha256)
    fail('generation31-failure-authority');
  return {value:parsed.value,raw_sha256:parsed.retained.sha256};
}
function retainedGeneration32Children(){
  const expected=new Map([
    ['build-generation-32-candidates.mjs',['58044989986019096737c553ea1d0cfd8fb333c2d36e55100e3a1d3271a4eff5',40906]],
    ['executor-green.mjs',['352217ba87108c0ee8fdb29c5dbce8333d0b13de79482da146ff24da1a8dc1ee',144303]],
    ['executor-red-to-green.diff',['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',0]],
    ['executor-red.mjs',['352217ba87108c0ee8fdb29c5dbce8333d0b13de79482da146ff24da1a8dc1ee',144303]],
    ['executor-source-to-red.diff',['8fbf06ecc7a64dce88707eff048058a4edefbe76507596f7864cad27f029ab4a',27949]],
    ['prep-tool-green.mjs',['bc294ca464e9d814e93962cc6cecd584e07beecce72ef649fb1bb0273a1cd306',461533]],
    ['prep-tool-red-to-green.diff',['d9d958bdc5a937ee4681b469e64d2a5b14537ea7886df3f1fdc49596a95fe6de',584]],
    ['prep-tool-red.mjs',['f38f7903463fd520f5011e8267fa171e30bc1030cb75597d98737a8ab058a1b1',461483]],
    ['prep-tool-source-to-red.diff',['6eb9d8cd5bd3466f9ccc4fbeb47deda0c39705f0688bc7f0d9c39bfd61109024',48458]],
  ]);
  const names=fs.readdirSync(GENERATION32_CANDIDATE_ROOT).sort(compareBytes);
  if(canonicalJson(names)!==canonicalJson([...expected.keys()].sort(compareBytes)))
    fail('generation32-child-set');
  return names.map((name)=>{
    const retained=regularFile(path.join(GENERATION32_CANDIDATE_ROOT,name));
    const [digest,size]=expected.get(name);
    if(retained.sha256!==digest||retained.size!==size)fail('generation32-child-authority',name);
    return {path:name,sha256:digest,size};
  });
}
function reproduceGeneration32Failure(){
  const expected=Buffer.from('[bootstrap-manifest-exclusions]\n','utf8');
  const encoded='W2Jvb3RzdHJhcC1tYW5pZmVzdC1leGNsdXNpb25zXQo=';
  const decoded=Buffer.from(encoded,'base64');
  const rejectedSuffix=Buffer.from([0x5c,0x6e]);
  if(expected.length!==32||Buffer.compare(expected,decoded)!==0||
    expected.toString('base64')!==encoded||
    sha256(expected)!=='3c4249e61087cc18e115b755eb2a5642d986ae5480cfee4dbae2ff986aae7d20'||
    expected.subarray(-2).equals(rejectedSuffix))
    fail('generation32-red-signal-self-test');
  const argv=[process.execPath,GENERATION32_RED_PREP,'self-test-generation32-runtime-parity'];
  const pre={prep:sealTree(SCRATCH_ROOT),target:sealTree(TARGET_ROOT),main:sealTree(MAIN_ROOT)};
  const result=spawnSync(argv[0],argv.slice(1),{cwd:PREPARATION_ROOT,encoding:null,
    timeout:60_000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
    env:{HOME:process.env.HOME||'/nonexistent',LANG:'C',LC_ALL:'C',NO_COLOR:'1',
      FORCE_COLOR:'0',PATH:`${path.dirname(process.execPath)}:/usr/bin`}});
  const timedOut=result.error?.code==='ETIMEDOUT',outputOverflow=result.error?.code==='ENOBUFS';
  const stdout=Buffer.from(result.stdout||''),stderr=Buffer.from(result.stderr||'');
  const post={prep:sealTree(SCRATCH_ROOT),target:sealTree(TARGET_ROOT),main:sealTree(MAIN_ROOT)};
  if(canonicalJson(pre)!==canonicalJson(post))fail('generation32-reproduction-write');
  if(result.status!==2||result.signal!==null||timedOut||outputOverflow||stdout.length!==0||
    Buffer.compare(stderr,expected)!==0||stderr.length!==32||
    stderr.toString('base64')!==encoded||
    sha256(stderr)!=='3c4249e61087cc18e115b755eb2a5642d986ae5480cfee4dbae2ff986aae7d20')
    fail('generation32-reproduction-signal');
  return {argv,stdout,stderr,process:{exit_code:result.status,signal:result.signal,
    timed_out:timedOut,output_overflow:outputOverflow}};
}
function publishFailure(){
  const gen31=retainedGeneration31Failure(),children=retainedGeneration32Children();
  if(fs.existsSync(path.join(STRANDED_ROOT,'generation-32-command-argv-manifest.json'))||
    fs.existsSync(path.join(STRANDED_ROOT,'generation-32-argv-approval.json'))||
    fs.existsSync(path.join(PREPARATION_ROOT,'generation-32'))||
    fs.existsSync(path.join(PREPARATION_ROOT,'prep-tool-r32-gate0-command-self-test.json'))||
    fs.existsSync(path.join(PREPARATION_ROOT,'prep-tool-r32-post-authoring-self-test.json'))||
    fs.existsSync('/Users/sungmin/Dev/claude-plugins/deep-work/.claude/worktrees/v6-14-bootstrap-simulation-g32'))
    fail('generation32-terminal-output-present');
  for(const name of ['runtime-parity-red-result.json','runtime-parity-green-result.json',
    'program-candidate-manifest.json'])
    if(fs.existsSync(path.join(GENERATION32_CANDIDATE_ROOT,name)))
      fail('generation32-result-present',name);
  const run=reproduceGeneration32Failure();
  const failure={schema_version:1,artifact_kind:'Generation32BuilderFailureV1',
    stage:'diagnostic-retained',plan_sha256:AUTH.plan_sha256,
    plan_approval_raw_sha256:AUTH.plan_approval_raw_sha256,spec_approved_hash:AUTH.spec_sha256,
    spec_approval_raw_sha256:AUTH.spec_approval_raw_sha256,
    generation32_builder_raw_sha256:'58044989986019096737c553ea1d0cfd8fb333c2d36e55100e3a1d3271a4eff5',
    generation31_failure_raw_sha256:gen31.raw_sha256,
    generation31_failure_sha256:gen31.value.failure_sha256,candidate_children:children,
    red_prep_raw_sha256:'f38f7903463fd520f5011e8267fa171e30bc1030cb75597d98737a8ab058a1b1',
    reproduction_argv:run.argv,reproduction_cwd:PREPARATION_ROOT,node_identity:nodeIdentity(),
    reproduction_process:run.process,reproduction_stdout_sha256:sha256(run.stdout),
    reproduction_stderr_sha256:sha256(run.stderr),
    reproduction_stderr_base64:run.stderr.toString('base64'),
    observed_failure_code:'parity-red-signal',raw_capture_status:'reproduced-read-only',
    parity_results_absent:true,candidate_manifest_absent:true,argv_manifest_absent:true,
    generation32_root_absent:true,simulation_absent:true,
    live_prep_sha256:AUTH.source_prep_sha256,live_executor_sha256:AUTH.source_executor_sha256,
    trusted_conclusion:'generation-32-stranded-before-parity-result-due-to-red-stderr-double-escape',
    failure_sha256:null};
  failure.failure_sha256=semanticDigest('generation-32-builder-failure-v1',failure,'failure_sha256');
  writeExclusive(FAILURE_PATH,Buffer.from(canonicalJson(failure)));
  const retained=parse(FAILURE_PATH);
  if(canonicalJson(retained.value)!==canonicalJson(failure)||
    semanticDigest('generation-32-builder-failure-v1',retained.value,'failure_sha256')!==
      retained.value.failure_sha256)
    fail('generation32-failure-reopen');
  return {value:failure,raw_sha256:retained.retained.sha256};
}
function transformActive(source,role){
  let text=source;
  const replacements=[
    ['b093aa59c3805b215c6bd4ec8d017ca1bef1b6d4657129157e0a8e3013e0bd15',AUTH.plan_sha256],
    ['95ba4f2379d5db83b7fd5ecd03629ebd21b7a6c3f8d9827534a6dc52588aebd2',
      AUTH.plan_approval_raw_sha256],
    ['09553be6bd8dc633772f9cd051e3fbc9fdb8dce4a734bbf092d6f058c787ff63',
      AUTH.spec_approval_raw_sha256],
    ['6323abc37d11b27a069a7106a42b2aa43f3fdd76c439527984c0f12d429e8639',
      'bd221da12f63260310044e2b6868d82a2faa777137f0e04d35ab094b8e8b8db8'],
    ['aa31f0f35830ebd87ad269e45093b0a3a1b59d4a7600da8b2f1d5d3433a37da2',
      'f9ee45af15ed2a13958cbda188ae0c81aaae6410b9e132e26db8aaa22f1f7439'],
    ['ac73caf67b2e63b0873c02454976417eee2858fcc40d1c4fed7ebb159c721d6e',
      'ac038cd0d581626646161e130d014058f6ae4f5c75fe9c89f52aa3a98b6eca93'],
    ['a944149830bfe7455556b766da7303a1f0284400bb0197167ef96c244ed0dd47',
      '5d94993034eb99e0b5d9bb98b8377aeef550bda46bdae0c4560c4bd4428b9f7c'],
    ['a0f52a2f26b07866d980a88723c3da5bbb0251a6820a393b541e13cd333653a1',
      'f2dfec985e20c11b419df39d7e177c3b3bb72d9f3b62da0f540973e8122663eb'],
    ['37dc3e09d8e03102a942c25a2059344d82aef26060169535fe757aaf8e822b3f',
      'd1914f978cbc4c2372a58a74889acd429cb1398da1081e3efe57664296731505'],
    ['PLAN_E32','PLAN_E35'],['SPEC_E32','SPEC_E35'],
    ['native-goal-plan-e32-r1','native-goal-plan-e35-r2'],
    ['native-goal-spec-e32-r1','native-goal-spec-e35-r1'],
    ['plan-approval-native-goal-e32.json','plan-approval-native-goal-e35.json'],
    ['spec-approval-native-goal-e32.json','spec-approval-native-goal-e35.json'],
    ['GENERATION30','GENERATION33'],['Generation30','Generation33'],
    ['generation30','generation33'],['generation-30','generation-33'],
    ['simulation-g30','simulation-g33'],['prep-tool-r30','prep-tool-r33'],
  ];
  for(const [from,to] of replacements)text=text.replaceAll(from,to);
  text=text.replaceAll('replan_epoch!==32','replan_epoch!==35')
    .replaceAll('replan_epoch !== 32','replan_epoch !== 34')
    .replaceAll('active_generation!==30','active_generation!==33')
    .replaceAll('active_generation !== 30','active_generation !== 32')
    .replaceAll('active_generation: 30','active_generation: 33')
    .replaceAll('active_generation:30','active_generation:32')
    .replaceAll('review_round !== 55','review_round !== 58')
    .replaceAll('review_round!==55','review_round!==57')
    .replaceAll('generation: 30','generation: 33').replaceAll('generation:30','generation:32')
    .replaceAll('generation!==30','generation!==33').replaceAll('generation !== 30','generation !== 32')
    .replaceAll("flags.generation === '30'","flags.generation === '33'")
    .replaceAll("flags.generation !== '30'","flags.generation !== '33'");
  if(role==='prep-tool'){
    const oldRoot=`const PREPARATION_ROOT = process.argv[2]===
  'self-test-historical-selector-isolation'?
  ${JSON.stringify(PREPARATION_ROOT)}:path.dirname(SCRIPT_PATH);`;
    const newRoot=`const PREPARATION_ROOT =
  process.argv[2]==='self-test-historical-selector-isolation'||
  process.argv[2]==='self-test-generation33-runtime-parity'?
  ${JSON.stringify(PREPARATION_ROOT)}:path.dirname(SCRIPT_PATH);`;
    text=exactReplace(text,oldRoot,newRoot);
    const marker="if(process.argv[2]==='self-test-historical-selector-isolation'){";
    const parity=`if(process.argv[2]==='self-test-generation33-runtime-parity'){
  try{
    if(process.argv.length!==3)fail('generation-33-runtime-parity-argv');
    process.stdout.write(\`\${canonicalJson({...runRuntimeDigestParitySelfTest(),pass:true})}\\n\`);
  }catch(error){
    process.stderr.write(\`[\${error.code||'generation-33-runtime-parity'}]\\n\`);
    process.exitCode=2;
  }
}else ${marker}`;
    text=exactReplace(text,marker,parity);
  }else if(role==='executor'){
    if((text.match(/self-test-initialization/gu)||[]).length===0||
      (text.match(/self-test-generation33-runtime-parity/gu)||[]).length!==0)
      fail('executor-prefix-authority');
  }else fail('transform-role',role);
  return text;
}
function greenFromRed(red){
  return exactReplace(red,
    "  base.manifest_sha256 = runtimeSemanticDigest('bootstrap-manifest-v1', base, 'manifest_sha256');",
    "  base.excluded_paths = bootstrapExcludedPaths();\n"+
    "  base.manifest_sha256 = runtimeSemanticDigest('bootstrap-manifest-v1', base, 'manifest_sha256');");
}
function transformVector(value){
  if(typeof value==='string')return value
    .replaceAll('generation-30','generation-33').replaceAll('simulation-g30','simulation-g33')
    .replaceAll('prep-tool-r30-','prep-tool-r33-')
    .replaceAll('plan-approval-native-goal-e32.json','plan-approval-native-goal-e35.json');
  if(Array.isArray(value)){
    const output=value.map(transformVector);
    for(let index=0;index<output.length-1;index++)
      if(output[index]==='--generation'&&output[index+1]==='30')output[index+1]='32';
    return output;
  }
  if(value&&typeof value==='object')
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,transformVector(item)]));
  return value;
}
function normalizedDiff(source,candidate,transition){
  const result=spawnSync('git',['diff','--no-index','--binary','--',source,candidate],
    {encoding:null,maxBuffer:32*1024*1024});
  if(result.status===0&&result.signal===null&&Buffer.from(result.stderr||'').length===0)
    return Buffer.alloc(0);
  if(result.status!==1||result.signal!==null||Buffer.from(result.stderr||'').length!==0)
    fail('candidate-diff',transition);
  let text=Buffer.from(result.stdout).toString('utf8');
  const from=transition==='source-to-red'?'source':'red';
  const to=transition==='source-to-red'?'red':'green';
  text=text.replace(/^diff --git .*$/mu,`diff --git a/${from} b/${to}`)
    .replace(/^--- .*$/mu,`--- a/${from}`).replace(/^\+\+\+ .*$/mu,`+++ b/${to}`);
  if(!text.endsWith('\n'))fail('candidate-diff-terminal',transition);
  return Buffer.from(text);
}
function runParity(program,expectedExit){
  const argv=[process.execPath,program,'self-test-generation33-runtime-parity'];
  const result=spawnSync(argv[0],argv.slice(1),{cwd:PREPARATION_ROOT,encoding:null,
    timeout:60_000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],
    env:{HOME:process.env.HOME||'/nonexistent',LANG:'C',LC_ALL:'C',NO_COLOR:'1',
      FORCE_COLOR:'0',PATH:`${path.dirname(process.execPath)}:/usr/bin`}});
  const timedOut=result.error?.code==='ETIMEDOUT';
  const outputOverflow=result.error?.code==='ENOBUFS';
  if(result.status!==expectedExit||result.signal!==null||timedOut||outputOverflow)
    fail('parity-process',`${expectedExit}:${result.status}`);
  return {argv,exit_code:result.status,signal:result.signal,timed_out:timedOut,
    output_overflow:outputOverflow,stdout:Buffer.from(result.stdout||''),
    stderr:Buffer.from(result.stderr||'')};
}
function parityResult(kind,stage,run,sourceRows,candidateRows,failure,preSeal,postSeal){
  const red=stage==='red-verified',gen30=retainedGeneration30Failure(),
    gen31=retainedGeneration31Failure();
  let observed=null;
  if(red){
    if(run.stdout.length!==0||run.stderr.toString('utf8')!=='[bootstrap-manifest-exclusions]\n')
      fail('parity-red-signal');
  }else{
    if(run.stderr.length!==0||!run.stdout.toString('utf8').endsWith('\n'))fail('parity-green-signal');
    try{observed=JSON.parse(run.stdout.toString('utf8'));}catch{fail('parity-green-json');}
    const keys=['manifest_sha256','normalized_stdout_semantic_sha256','pass',
      'patch_review_sha256','schema_sha256','witness_sha256'].sort(compareBytes);
    if(canonicalJson(Object.keys(observed).sort(compareBytes))!==canonicalJson(keys)||
      observed.pass!==true||keys.filter((key)=>key!=='pass')
        .some((key)=>!/^[0-9a-f]{64}$/u.test(observed[key]||'')))fail('parity-green-value');
  }
  const value={
    schema_version:1,artifact_kind:kind,stage,plan_sha256:AUTH.plan_sha256,
    plan_approval_raw_sha256:AUTH.plan_approval_raw_sha256,spec_approved_hash:AUTH.spec_sha256,
    spec_approval_raw_sha256:AUTH.spec_approval_raw_sha256,
    generation30_failure_raw_sha256:gen30.raw_sha256,
    generation30_failure_sha256:gen30.value.failure_sha256,
    generation31_failure_raw_sha256:gen31.raw_sha256,
    generation31_failure_sha256:gen31.value.failure_sha256,
    generation32_failure_raw_sha256:failure.raw_sha256,
    generation32_failure_sha256:failure.value.failure_sha256,
    source_programs:sourceRows,candidate_programs:candidateRows,argv:run.argv,
    cwd:PREPARATION_ROOT,node_identity:nodeIdentity(),exit_code:run.exit_code,signal:run.signal,
    timed_out:run.timed_out,output_overflow:run.output_overflow,
    stdout_sha256:sha256(run.stdout),stderr_sha256:sha256(run.stderr),
    expected_rejection_code:red?'bootstrap-manifest-exclusions':null,
    observed_rejection_code:red?'bootstrap-manifest-exclusions':null,
    pre_seal_sha256:preSeal,post_seal_sha256:postSeal,observed_parity:observed,
    parity_assertions:{fixture_excluded_paths_reprojected:!red,
      production_validator_unchanged:true,pass:!red},
    no_generation33_writes:true,no_target_writes:true,result_sha256:null,
  };
  value.result_sha256=semanticDigest(
    red?'generation-33-runtime-parity-red-result-v1':
      'generation-33-runtime-parity-green-result-v1',value,'result_sha256');
  return value;
}
function candidateManifest(sourceManifest,argvSource,failure,redResult,greenResult){
  const gen30=retainedGeneration30Failure(),gen31=retainedGeneration31Failure();
  const sourceRows=[
    fileRow('executor',SOURCE_EXECUTOR,PREPARATION_ROOT),
    fileRow('prep-tool',SOURCE_PREP,PREPARATION_ROOT),
  ].sort((a,b)=>compareBytes(a.role,b.role));
  const redRows=[
    fileRow('executor',path.join(CANDIDATE_ROOT,'executor-red.mjs')),
    fileRow('prep-tool',path.join(CANDIDATE_ROOT,'prep-tool-red.mjs')),
  ].sort((a,b)=>compareBytes(a.role,b.role));
  const greenRows=[
    fileRow('executor',path.join(CANDIDATE_ROOT,'executor-green.mjs')),
    fileRow('prep-tool',path.join(CANDIDATE_ROOT,'prep-tool-green.mjs')),
  ].sort((a,b)=>compareBytes(a.role,b.role));
  const diffRefs=[
    ['executor','red-to-green','executor-red-to-green.diff'],
    ['executor','source-to-red','executor-source-to-red.diff'],
    ['prep-tool','red-to-green','prep-tool-red-to-green.diff'],
    ['prep-tool','source-to-red','prep-tool-source-to-red.diff'],
  ].map(([role,transition,name])=>({...fileRow(role,path.join(CANDIDATE_ROOT,name)),transition}))
    .sort((a,b)=>compareBytes(`${a.role}\0${a.transition}`,`${b.role}\0${b.transition}`));
  const successorVectors=transformVector(argvSource.successor_vectors);
  const value={
    schema_version:1,artifact_kind:'Generation33ProgramCandidateManifestV1',
    plan_sha256:AUTH.plan_sha256,plan_approval_raw_sha256:AUTH.plan_approval_raw_sha256,
    spec_approved_hash:AUTH.spec_sha256,spec_approval_raw_sha256:AUTH.spec_approval_raw_sha256,
    source_argv_manifest_raw_sha256:AUTH.source_argv_manifest_raw_sha256,
    source_argv_manifest_sha256:argvSource.manifest_sha256,
    builder_sha256:regularFile(SCRIPT_PATH).sha256,source_programs:sourceRows,
    red_candidates:redRows,green_candidates:greenRows,diff_refs:diffRefs,
    change_families:[...sourceManifest.change_families,'historical-parity-fixture-projection']
      .sort(compareBytes),
    runtime_binding:sourceManifest.runtime_binding,
    external_red_result_raw_sha256:AUTH.source_projection_red_raw_sha256,
    selector_red_result_raw_sha256:AUTH.source_selector_red_raw_sha256,
    selector_green_result_raw_sha256:AUTH.source_selector_green_raw_sha256,
    generation30_failure_raw_sha256:gen30.raw_sha256,
    generation30_failure_sha256:gen30.value.failure_sha256,
    generation31_failure_raw_sha256:gen31.raw_sha256,
    generation31_failure_sha256:gen31.value.failure_sha256,
    generation32_failure_raw_sha256:failure.raw_sha256,
    generation32_failure_sha256:failure.value.failure_sha256,
    parity_red_result_raw_sha256:regularFile(
      path.join(CANDIDATE_ROOT,'runtime-parity-red-result.json')).sha256,
    parity_red_result_sha256:redResult.result_sha256,
    parity_green_result_raw_sha256:regularFile(
      path.join(CANDIDATE_ROOT,'runtime-parity-green-result.json')).sha256,
    parity_green_result_sha256:greenResult.result_sha256,
    successor_vectors:successorVectors,
    substitution_rules:[
      {from:'generation-30',to:'generation-33'},{from:'simulation-g30',to:'simulation-g33'},
      {from:'prep-tool-r30-',to:'prep-tool-r33-'},
      {from:'plan-approval-native-goal-e32.json',to:'plan-approval-native-goal-e35.json'},
      {from_pair:['--generation','30'],to_pair:['--generation','32']},
    ],manifest_sha256:null,
  };
  value.manifest_sha256=semanticDigest(
    'generation-33-program-candidate-manifest-v1',value,'manifest_sha256');
  return value;
}
function argvManifest(source,manifest){
  const value={schema_version:1,artifact_kind:'Generation33CommandArgvManifestV1',
    source_generation:30,successor_generation:32,
    source_prep_tool_sha256:AUTH.source_prep_sha256,
    source_executor_sha256:AUTH.source_executor_sha256,
    source_vectors:source.successor_vectors,successor_vectors:manifest.successor_vectors,
    substitution_rules:manifest.substitution_rules,manifest_sha256:null};
  value.manifest_sha256=semanticDigest(
    'generation-33-command-argv-manifest-v1',value,'manifest_sha256');
  return value;
}
function validateManifest(){
  const manifest=parse(path.join(CANDIDATE_ROOT,'program-candidate-manifest.json')).value;
  if(manifest.artifact_kind!=='Generation33ProgramCandidateManifestV1'||
    manifest.plan_sha256!==AUTH.plan_sha256||
    semanticDigest('generation-33-program-candidate-manifest-v1',manifest,'manifest_sha256')!==
      manifest.manifest_sha256)fail('candidate-manifest');
  const argv=parse(ARGV_MANIFEST_PATH).value;
  if(argv.manifest_sha256!==semanticDigest(
    'generation-33-command-argv-manifest-v1',argv,'manifest_sha256'))fail('argv-manifest');
  return {manifest,argv};
}
function expectedApproval(manifest,argv){
  const reviewRows=[];
  for(const role of [...REVIEW_PATHS.keys()].sort(compareBytes)){
    const file=REVIEW_PATHS.get(role),retained=regularFile(file),value=parse(file).value;
    const exactKeys=['artifact_kind','findings','generation30_failure_raw_sha256',
      'generation30_failure_sha256','generation31_failure_raw_sha256',
      'generation31_failure_sha256','generation32_failure_raw_sha256',
      'generation32_failure_sha256','reviewed_executor_green_sha256',
      'reviewed_manifest_sha256','reviewed_parity_green_raw_sha256',
      'reviewed_parity_green_sha256','reviewed_parity_red_raw_sha256',
      'reviewed_parity_red_sha256','reviewed_prep_green_sha256',
      'reviewed_source_projection_red_raw_sha256','reviewed_source_selector_green_raw_sha256',
      'reviewed_source_selector_red_raw_sha256','reviewer_identity','role','schema_version',
      'verdict'].sort(compareBytes);
    if(canonicalJson(Object.keys(value).sort(compareBytes))!==canonicalJson(exactKeys)||
      value.artifact_kind!=='Generation33ProgramCandidateReviewV1'||value.schema_version!==1||
      value.role!==role||value.verdict!=='APPROVE'||canonicalJson(value.findings)!=='[]'||
      value.reviewed_manifest_sha256!==manifest.manifest_sha256||
      value.reviewed_prep_green_sha256!==
        manifest.green_candidates.find((row)=>row.role==='prep-tool').sha256||
      value.reviewed_executor_green_sha256!==
        manifest.green_candidates.find((row)=>row.role==='executor').sha256||
      value.reviewed_source_projection_red_raw_sha256!==AUTH.source_projection_red_raw_sha256||
      value.reviewed_source_selector_red_raw_sha256!==AUTH.source_selector_red_raw_sha256||
      value.reviewed_source_selector_green_raw_sha256!==AUTH.source_selector_green_raw_sha256||
      value.reviewed_parity_red_raw_sha256!==manifest.parity_red_result_raw_sha256||
      value.reviewed_parity_red_sha256!==manifest.parity_red_result_sha256||
      value.reviewed_parity_green_raw_sha256!==manifest.parity_green_result_raw_sha256||
      value.reviewed_parity_green_sha256!==manifest.parity_green_result_sha256||
      value.generation30_failure_raw_sha256!==manifest.generation30_failure_raw_sha256||
      value.generation30_failure_sha256!==manifest.generation30_failure_sha256||
      value.generation31_failure_raw_sha256!==manifest.generation31_failure_raw_sha256||
      value.generation31_failure_sha256!==manifest.generation31_failure_sha256||
      value.generation32_failure_raw_sha256!==manifest.generation32_failure_raw_sha256||
      value.generation32_failure_sha256!==manifest.generation32_failure_sha256)
      fail('candidate-review',role);
    reviewRows.push({role,path:path.relative(TARGET_ROOT,file).split(path.sep).join('/'),
      raw_sha256:retained.sha256,reviewer_identity:value.reviewer_identity,verdict:'APPROVE'});
  }
  const value={schema_version:1,artifact_kind:'Generation33ArgvApprovalV1',
    stage:'approved',argv_manifest_path:path.relative(STRANDED_ROOT,ARGV_MANIFEST_PATH),
    argv_manifest_raw_sha256:regularFile(ARGV_MANIFEST_PATH).sha256,
    argv_manifest_sha256:argv.manifest_sha256,
    candidate_manifest_path:'generation-33-candidates/program-candidate-manifest.json',
    candidate_manifest_raw_sha256:regularFile(
      path.join(CANDIDATE_ROOT,'program-candidate-manifest.json')).sha256,
    candidate_manifest_sha256:manifest.manifest_sha256,
    green_programs:manifest.green_candidates,
    source_projection_red_raw_sha256:AUTH.source_projection_red_raw_sha256,
    source_selector_red_raw_sha256:AUTH.source_selector_red_raw_sha256,
    source_selector_green_raw_sha256:AUTH.source_selector_green_raw_sha256,
    generation30_failure_raw_sha256:manifest.generation30_failure_raw_sha256,
    generation30_failure_sha256:manifest.generation30_failure_sha256,
    generation31_failure_raw_sha256:manifest.generation31_failure_raw_sha256,
    generation31_failure_sha256:manifest.generation31_failure_sha256,
    generation32_failure_raw_sha256:manifest.generation32_failure_raw_sha256,
    generation32_failure_sha256:manifest.generation32_failure_sha256,
    parity_red_result_raw_sha256:manifest.parity_red_result_raw_sha256,
    parity_red_result_sha256:manifest.parity_red_result_sha256,
    parity_green_result_raw_sha256:manifest.parity_green_result_raw_sha256,
    parity_green_result_sha256:manifest.parity_green_result_sha256,
    reviews:reviewRows,verdict:'APPROVE',approval_sha256:null};
  value.approval_sha256=semanticDigest(
    'generation-33-argv-approval-v1',value,'approval_sha256');
  return value;
}
function reconstructPrograms(){
  const sourcePrep=regularFile(SOURCE_PREP).bytes.toString('utf8');
  const sourceExecutor=regularFile(SOURCE_EXECUTOR).bytes.toString('utf8');
  if((sourcePrep.match(/self-test-historical-selector-isolation/gu)||[]).length===0||
    (sourceExecutor.match(/self-test-initialization/gu)||[]).length===0||
    (sourceExecutor.match(/self-test-generation33-runtime-parity/gu)||[]).length!==0)
    fail('role-prefix-self-test');
  const redPrep=Buffer.from(transformActive(sourcePrep,'prep-tool'));
  const redExecutor=Buffer.from(transformActive(sourceExecutor,'executor'));
  return {redPrep,redExecutor,greenPrep:Buffer.from(greenFromRed(redPrep.toString('utf8'))),
    greenExecutor:Buffer.from(redExecutor)};
}
function reauthenticateAdoption(manifest,expected,expectedPrep,expectedExecutor){
  assertAuthority({allowAdopted:true,expectedPrep,expectedExecutor});
  const current=validateManifest();
  if(current.manifest.manifest_sha256!==manifest.manifest_sha256)fail('adoption-manifest-drift');
  const recomputed=expectedApproval(current.manifest,current.argv);
  if(canonicalJson(recomputed)!==canonicalJson(expected)||
    canonicalJson(parse(ARGV_APPROVAL_PATH).value)!==canonicalJson(expected))
    fail('adoption-approval-drift');
  return {livePrep:regularFile(LIVE_PREP).sha256,liveExecutor:regularFile(LIVE_EXECUTOR).sha256};
}
function adopt(manifest){
  const expected=expectedApproval(manifest,parse(ARGV_MANIFEST_PATH).value);
  if(canonicalJson(parse(ARGV_APPROVAL_PATH).value)!==canonicalJson(expected))fail('approval-authority');
  const programs=reconstructPrograms();
  const expectedPrep=sha256(programs.greenPrep),expectedExecutor=sha256(programs.greenExecutor);
  if(expectedPrep!==manifest.green_candidates.find((row)=>row.role==='prep-tool').sha256||
    expectedExecutor!==manifest.green_candidates.find((row)=>row.role==='executor').sha256)
    fail('reconstructed-program');
  let state=reauthenticateAdoption(manifest,expected,expectedPrep,expectedExecutor);
  if(state.livePrep===AUTH.source_prep_sha256&&state.liveExecutor===expectedExecutor)fail('adoption-prefix');
  if(state.livePrep===AUTH.source_prep_sha256){
    const file=path.join(CANDIDATE_ROOT,'prep-tool-green.mjs');writeExclusive(file,programs.greenPrep);
    fs.renameSync(file,LIVE_PREP);fsyncDirectory(PREPARATION_ROOT);writeExclusive(file,programs.greenPrep);
  }
  state=reauthenticateAdoption(manifest,expected,expectedPrep,expectedExecutor);
  if(state.livePrep!==expectedPrep||![AUTH.source_executor_sha256,expectedExecutor].includes(state.liveExecutor))
    fail('prep-adoption-boundary');
  if(state.liveExecutor===AUTH.source_executor_sha256){
    const file=path.join(CANDIDATE_ROOT,'executor-green.mjs');writeExclusive(file,programs.greenExecutor);
    fs.renameSync(file,LIVE_EXECUTOR);fsyncDirectory(PREPARATION_ROOT);writeExclusive(file,programs.greenExecutor);
  }
  state=reauthenticateAdoption(manifest,expected,expectedPrep,expectedExecutor);
  if(state.livePrep!==expectedPrep||state.liveExecutor!==expectedExecutor)fail('executor-adoption-boundary');
  return expected;
}
function build(){
  const {sourceManifest,sourceArgv}=assertAuthority();
  const failure=publishFailure();
  const programs=reconstructPrograms();
  const paths={
    redPrep:path.join(CANDIDATE_ROOT,'prep-tool-red.mjs'),
    redExecutor:path.join(CANDIDATE_ROOT,'executor-red.mjs'),
    greenPrep:path.join(CANDIDATE_ROOT,'prep-tool-green.mjs'),
    greenExecutor:path.join(CANDIDATE_ROOT,'executor-green.mjs'),
  };
  writeExclusive(paths.redPrep,programs.redPrep);writeExclusive(paths.redExecutor,programs.redExecutor);
  writeExclusive(paths.greenPrep,programs.greenPrep);
  writeExclusive(paths.greenExecutor,programs.greenExecutor);
  const diffs=[
    [SOURCE_PREP,paths.redPrep,'source-to-red','prep-tool-source-to-red.diff'],
    [SOURCE_EXECUTOR,paths.redExecutor,'source-to-red','executor-source-to-red.diff'],
    [paths.redPrep,paths.greenPrep,'red-to-green','prep-tool-red-to-green.diff'],
    [paths.redExecutor,paths.greenExecutor,'red-to-green','executor-red-to-green.diff'],
  ];
  for(const [from,to,transition,name] of diffs)
    writeExclusive(path.join(CANDIDATE_ROOT,name),normalizedDiff(from,to,transition));
  const sourceRows=[fileRow('executor',SOURCE_EXECUTOR,PREPARATION_ROOT),
    fileRow('prep-tool',SOURCE_PREP,PREPARATION_ROOT)].sort((a,b)=>compareBytes(a.role,b.role));
  const redRows=[fileRow('executor',paths.redExecutor),fileRow('prep-tool',paths.redPrep)]
    .sort((a,b)=>compareBytes(a.role,b.role));
  const greenRows=[fileRow('executor',paths.greenExecutor),fileRow('prep-tool',paths.greenPrep)]
    .sort((a,b)=>compareBytes(a.role,b.role));
  const preRed={prep:sealTree(SCRATCH_ROOT),target:sealTree(TARGET_ROOT),main:sealTree(MAIN_ROOT)};
  const redRun=runParity(paths.redPrep,2);
  const postRed={prep:sealTree(SCRATCH_ROOT),target:sealTree(TARGET_ROOT),main:sealTree(MAIN_ROOT)};
  if(canonicalJson(preRed)!==canonicalJson(postRed))fail('parity-red-write');
  const redResult=parityResult('Generation33RuntimeParityRedResultV1','red-verified',
    redRun,sourceRows,redRows,failure,sha256(Buffer.from(canonicalJson(preRed))),
    sha256(Buffer.from(canonicalJson(postRed))));
  writeExclusive(path.join(CANDIDATE_ROOT,'runtime-parity-red-result.json'),
    Buffer.from(canonicalJson(redResult)));
  const preGreen={prep:sealTree(SCRATCH_ROOT),target:sealTree(TARGET_ROOT),main:sealTree(MAIN_ROOT)};
  const greenRun=runParity(paths.greenPrep,0);
  const postGreen={prep:sealTree(SCRATCH_ROOT),target:sealTree(TARGET_ROOT),main:sealTree(MAIN_ROOT)};
  if(canonicalJson(preGreen)!==canonicalJson(postGreen))fail('parity-green-write');
  const greenResult=parityResult('Generation33RuntimeParityGreenResultV1','green-verified',
    greenRun,sourceRows,greenRows,failure,sha256(Buffer.from(canonicalJson(preGreen))),
    sha256(Buffer.from(canonicalJson(postGreen))));
  writeExclusive(path.join(CANDIDATE_ROOT,'runtime-parity-green-result.json'),
    Buffer.from(canonicalJson(greenResult)));
  const manifest=candidateManifest(sourceManifest,sourceArgv,failure,redResult,greenResult);
  writeExclusive(path.join(CANDIDATE_ROOT,'program-candidate-manifest.json'),
    Buffer.from(canonicalJson(manifest)));
  const argv=argvManifest(sourceArgv,manifest);
  writeExclusive(ARGV_MANIFEST_PATH,Buffer.from(canonicalJson(argv)));
  if(canonicalJson(fs.readdirSync(CANDIDATE_ROOT).sort(compareBytes))!==canonicalJson(CHILDREN))
    fail('candidate-child-set');
  return {manifest,argv};
}
function main(){
  const command=process.argv.slice(2);
  if(command.length>1||command.length===1&&!['materialize-approval','adopt'].includes(command[0]))
    fail('builder-argv');
  if(command.length===0){
    const {manifest}=build();
    process.stdout.write(`${canonicalJson({ok:true,stage:'candidate-ready',
      manifest_sha256:manifest.manifest_sha256})}\n`);return;
  }
  assertAuthority();
  const {manifest,argv}=validateManifest();
  if(command[0]==='materialize-approval'){
    if(regularFile(LIVE_PREP).sha256!==AUTH.source_prep_sha256||
      regularFile(LIVE_EXECUTOR).sha256!==AUTH.source_executor_sha256)
      fail('approval-after-adoption');
    const approval=expectedApproval(manifest,argv);
    writeExclusive(ARGV_APPROVAL_PATH,Buffer.from(canonicalJson(approval)));
    process.stdout.write(`${canonicalJson({ok:true,stage:'approved',
      approval_sha256:approval.approval_sha256})}\n`);return;
  }
  const approval=adopt(manifest);
  process.stdout.write(`${canonicalJson({ok:true,stage:'adopted',
    approval_sha256:approval.approval_sha256,
    prep_sha256:regularFile(LIVE_PREP).sha256,
    executor_sha256:regularFile(LIVE_EXECUTOR).sha256})}\n`);
}

try{main();}catch(error){
  process.stderr.write(`${error.stack||error.message}\n`);process.exitCode=2;
}

