#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cp=require('node:child_process');
const {runEvalProcess}=require('./process.js');
const {grade}=require('./grade.js');
const seal=require('./cohort-seal.js');
const ROOT=path.resolve(__dirname,'../..');
const digest=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(root,folders){const rows=[];
  function walk(relative){const file=path.join(root,relative),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink())throw Error(`eval-symlink:${relative}`);
    if(stat.isDirectory())for(const name of fs.readdirSync(file).sort())walk(path.join(relative,name));
    else if(stat.isFile())rows.push({path:relative.split(path.sep).join('/'),sha256:digest(fs.readFileSync(file))});
    else throw Error(`eval-special-file:${relative}`);}
  for(const folder of folders)walk(folder);return rows;}
function candidateIdentity(root=ROOT){return inventory(root,['runtime','scripts','hooks','skills','agents','templates','tests',
  '.claude-plugin/plugin.json','.codex-plugin/plugin.json','package.json','AGENTS.md','CLAUDE.md','README.md','README.ko.md','assumptions.json','health','sensors','schemas','evals/harness']);}
function plans(manifest){return manifest.tasks.filter(t=>t.live).flatMap(task=>manifest.models.flatMap(model=>
  manifest.variants.map(variant=>({id:`${task.id}--${model}--${variant}`,task,model,variant}))));}
function promptFor(row,pluginRoot){
  const common=`${row.task.task}\nWork only in this exact checkout and current branch; do not create another worktree. No external product actions or network requests except model inference/review needed by the workflow; no git push/PR/merge. `+
    'Use the current model inline. Internal reversible work is authorized; finish the task and verify it without repeated approval questions. '+
    'Preserve unrelated files. End with a literal line goal-complete:true or goal-complete:false.\n';
  if(row.variant==='baseline')return common;
  if(row.variant==='minimal')return common+'State the intended outcome, keep changes within the task, and verify observable acceptance conditions before concluding.\n';
  return common+`Use the actual deep-work plugin: read ${path.join(pluginRoot,'skills/deep-work/SKILL.md')} `+
    `and its explicitly anchored references from plugin root ${pluginRoot}. Run its public workflow with adaptive method, `+
    'current-branch repository mode, authorized internal continuation and Finish keep. Do not substitute a shortened custom workflow.\n';
}
function parseOutput(stdout){const events=[];for(const line of stdout.split('\n')){try{events.push(JSON.parse(line));}catch{}}
  const finals=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text||'');
  const final=finals.at(-1)||'',m=final.match(/(?:^|\n)goal-complete:(true|false)\s*$/);
  const thread=events.find(e=>e.type==='thread.started'),turn=events.findLast(e=>e.type==='turn.completed');
  // Only provider metadata events qualify identity; arbitrary message prose does not.
  const identity=events.find(e=>e.type==='session_meta'&&typeof e.payload?.model==='string');
  return {claim:m?m[1]==='true':null,final_text:final,session_id:thread?.thread_id||null,
    observed_model:identity?.payload.model||null,usage:turn?.usage||null,cost:null};}
function invocationFor(row,manifest,output,pluginRoot){
  if(manifest.sandbox!=='workspace-write'||typeof manifest.network_access!=='boolean')throw Error('eval-sandbox-policy');
  const workspace=path.join(output,row.id,'workspace');
  const prompt=promptFor(row,pluginRoot);
  const args=['exec','--approve-for-me','--disable','hooks','--disable','plugin_hooks','-c','plugins."deep-work@claude-deep-suite".enabled=false','-m',row.model,'-c',`model_reasoning_effort=${manifest.effort}`,
    '-c',`sandbox_workspace_write.network_access=${manifest.network_access}`,'--json','--skip-git-repo-check','-C',workspace,'-'];
  return{id:row.id,model:row.model,variant:row.variant,task:row.task.id,
    prompt_sha256:digest(prompt),argv:args,argv_sha256:digest(seal.canonical(args)),
    sandbox:{mode:'workspace-write',configuration:'approve-for-me-cli-default',enforcement:'unobserved',network_access:manifest.network_access,approval:'approve-for-me',host_hooks:'disabled',cached_deep_work:'disabled'}};
}
function currentSeal({output,codexExecutable,env=process.env,pluginRoot=ROOT,expected}){
  pluginRoot=fs.realpathSync(pluginRoot);output=fs.realpathSync(output);
  const manifest=JSON.parse(fs.readFileSync(path.join(pluginRoot,'evals/harness/manifest.json')));
  return seal.buildSeal({root:pluginRoot,output,manifest,candidate:candidateIdentity(pluginRoot),executable:codexExecutable,env,expected,
    attempts:plans(manifest).map(row=>invocationFor(row,manifest,output,pluginRoot))});
}
function freeze(output,{codexExecutable,env=process.env,pluginRoot=ROOT}={}){
  if(!path.isAbsolute(output))throw Error('eval-output-path');
  fs.mkdirSync(output,{recursive:true});const file=path.join(output,'frozen.json');
  const previous=fs.existsSync(file)?seal.validateSeal(JSON.parse(fs.readFileSync(file))):null;
  const value=currentSeal({output,codexExecutable,env,pluginRoot,expected:previous});
  if(previous){seal.compareSeals(previous,value);return previous;}
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});return value;
}
function readFrozen(output){return seal.validateSeal(JSON.parse(fs.readFileSync(path.join(output,'frozen.json'))));}
async function gradeAfterTermination({termination,workspace,oracle,processResult,claim,grader=grade}){
  return termination.confirmed===true?grader({workspace,oracle,processResult,claim}):
    {product_pass:false,task_complete:false,false_completion:null,claim,reason:'termination-unconfirmed'};
}
function unavailableReceipt({dir,id,frozen,reason}){
  const receipt={schema_version:2,id,status:'unavailable',finished_at:new Date().toISOString(),
    cohort_sha256:frozen?.cohort_sha256||null,candidate_sha256:frozen?.candidate_sha256||null,
    candidate_unchanged:false,cohort_unchanged:false,unavailable_reasons:[reason],process:null,
    grading:{product_pass:false,task_complete:false,false_completion:null,claim:null,reason:'cohort-unavailable'}};
  fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
async function runAttempt({output,id,codexExecutable,env=process.env,pluginRoot=ROOT}){
  if(!path.isAbsolute(output)||typeof id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,180}$/.test(id))throw Error('eval-attempt-input');
  fs.mkdirSync(output,{recursive:true});output=fs.realpathSync(output);const dir=path.join(output,id);fs.mkdirSync(dir);
  let frozen,row,invocation,childEnv;
  try{
    frozen=readFrozen(output);childEnv=seal.normalizedEnvironment(env);
    codexExecutable=codexExecutable||frozen.cli.path;
    seal.compareSeals(frozen,currentSeal({output,codexExecutable,env:childEnv,pluginRoot,expected:frozen}));
    row=plans(frozen.manifest).find(r=>r.id===id);if(!row)throw Error('eval-attempt-id');
    invocation=invocationFor(row,frozen.manifest,output,fs.realpathSync(pluginRoot));
    if(seal.canonical(invocation)!==seal.canonical(frozen.attempts.find(a=>a.id===id)))throw Error('eval-invocation-drift');
  }catch(error){return unavailableReceipt({dir,id,frozen,reason:error.code||(/^eval-[a-z-]+$/.test(error.message)?error.message:'eval-cohort-unavailable')});}
  const workspace=path.join(dir,'workspace');let prompt,args,prepared;
  try{fs.mkdirSync(workspace);
  fs.cpSync(path.join(pluginRoot,'evals/harness/task-fixtures',row.task.id),workspace,{recursive:true,dereference:false});
  cp.execFileSync('git',['init','--quiet'],{cwd:workspace,env:childEnv});
  cp.execFileSync('git',['-c','user.name=Harness Eval','-c','user.email=harness-eval@localhost','add','--','.'],{cwd:workspace,env:childEnv});
  cp.execFileSync('git',['-c','user.name=Harness Eval','-c','user.email=harness-eval@localhost','commit','--quiet','-m','Frozen task fixture'],{cwd:workspace,env:childEnv});
  prompt=promptFor(row,fs.realpathSync(pluginRoot));args=invocation.argv;fs.writeFileSync(path.join(dir,'prompt.txt'),prompt);
  prepared={schema_version:2,id,requested_model:row.model,variant:row.variant,candidate_sha256:frozen.candidate_sha256,
    cohort_sha256:frozen.cohort_sha256,prompt_sha256:invocation.prompt_sha256,cli:frozen.cli,
    argv:args,argv_sha256:invocation.argv_sha256,sandbox:invocation.sandbox,timeout_ms:frozen.manifest.timeout_ms,started_at:new Date().toISOString(),
    environment:seal.environmentIdentity(childEnv),host:{platform:process.platform,node:process.versions.node},status:'running'};
  fs.writeFileSync(path.join(dir,'prepared.json'),JSON.stringify(prepared,null,2)+'\n');
  }catch{return unavailableReceipt({dir,id,frozen,reason:'eval-attempt-setup-unavailable'});}
  // Recheck immediately before model execution, using the exact environment that
  // will be passed to the child. Never create another seal during an attempt.
  try{seal.compareSeals(frozen,currentSeal({output,codexExecutable,env:childEnv,pluginRoot,expected:frozen}));}
  catch(error){return unavailableReceipt({dir,id,frozen,reason:error.code||'eval-cohort-drift'});}
  let result,termination_confirmed=false,termination={confirmed:false,
    scope:'root-group-and-observed-descendants',descendant_discovery:'sampled',
    unobserved_descendants:'unknown',reasons:['supervision-unavailable']};
  try{const supervised=await runEvalProcess({executable:frozen.cli.path,args},{cwd:workspace,env:childEnv,input:prompt,
    timeoutMs:frozen.manifest.timeout_ms,maxOutputBytes:8388608});
    result=supervised.result;termination=supervised.termination;termination_confirmed=termination.confirmed===true;}
  catch(error){result={ok:false,error:{code:error.code||'eval-process-error',message:error.message},stdout:'',stderr:''};}
  fs.writeFileSync(path.join(dir,'stdout.jsonl'),result.stdout||'');fs.writeFileSync(path.join(dir,'stderr.txt'),result.stderr||'');
  const parsed=parseOutput(result.stdout||'');let oracle;
  let cohort_unchanged=true;
  try{seal.compareSeals(frozen,readFrozen(output));seal.compareSeals(frozen,currentSeal({output,codexExecutable,env:seal.normalizedEnvironment(env),pluginRoot,expected:frozen}));}
  catch{cohort_unchanged=false;}
  if(cohort_unchanged){try{oracle=JSON.parse(fs.readFileSync(path.join(pluginRoot,'evals/harness/oracles',`${row.task.id}.json`)));}catch{cohort_unchanged=false;}}
  let grading=cohort_unchanged?await gradeAfterTermination({termination,workspace,oracle,processResult:result,claim:parsed.claim}):
    {product_pass:false,task_complete:false,false_completion:null,claim:parsed.claim,reason:'cohort-drift'};
  if(cohort_unchanged){try{seal.compareSeals(frozen,readFrozen(output));seal.compareSeals(frozen,currentSeal({output,codexExecutable,env:seal.normalizedEnvironment(env),pluginRoot,expected:frozen}));}catch{cohort_unchanged=false;grading={...grading,task_complete:false,reason:'cohort-drift'};}}
  let treatment_compliance=row.variant==='current'?(cohort_unchanged?require('./treatment-compliance.js').checkCurrentTreatment({workspace,pluginRoot}):{status:'unavailable',complete:false,reason:'cohort-drift'}):{status:'not-applicable',complete:null};
  if(row.variant==='current'){const product=grading;grading={...product,product_task_complete:product.task_complete,product_false_completion:product.false_completion,task_complete:product.task_complete&&treatment_compliance.complete===true,false_completion:parsed.claim===true&&!(product.task_complete&&treatment_compliance.complete===true)};}
  const receipt={...prepared,status:cohort_unchanged?'finished':'unavailable',finished_at:new Date().toISOString(),termination_confirmed,termination,
    process:{ok:result.ok,exit_code:result.exitCode??null,timed_out:result.timedOut??null,
      output_overflow:result.outputOverflow??null,error:result.error||null,duration_ms:result.durationMs??null},
    output_sha256:digest(result.stdout||''),...parsed,grading,treatment_compliance,candidate_unchanged:cohort_unchanged,cohort_unchanged,
    unavailable_reasons:cohort_unchanged?[]:['eval-cohort-drift']};
  fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
if(require.main===module){const [action,output,id,executable]=process.argv.slice(2);
  if(!output||!path.isAbsolute(output))throw Error('usage: run.js freeze ABS_OUTPUT ABS_CODEX | attempt ABS_OUTPUT ATTEMPT_ID [ABS_CODEX]');
  Promise.resolve(action==='freeze'?freeze(output,{codexExecutable:id}):action==='attempt'?runAttempt({output,id,codexExecutable:executable}):Promise.reject(Error('eval-action')))
    .then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});}
module.exports={plans,promptFor,parseOutput,freeze,runAttempt,inventory,candidateIdentity,invocationFor,currentSeal,gradeAfterTermination};
