'use strict';

const crypto=require('node:crypto');
const {canonicalJson}=require('./operation-journal.js');

const DIGEST=/^[0-9a-f]{64}$/;
const RUNTIMES=['claude','codex','unknown'];
const ALLOWED_REASONS=Object.freeze(['alternative-experiment',
  'independent-review','parallel-slice','recovery','security-isolation']);
const STRATEGIES=Object.freeze({codex:'native-compaction',
  claude:'host-continuation',unknown:'same-session'});

function fail(code='context-policy'){const error=new Error(`[${code}]`);
  error.code=code;throw error;}
function digest(value){return crypto.createHash('sha256')
  .update(canonicalJson(value)).digest('hex');}
function exactKeys(value,keys){return value&&typeof value==='object'&&
  !Array.isArray(value)&&canonicalJson(Object.keys(value).sort())===
  canonicalJson([...keys].sort());}
function checkpoint(value={}){
  const lastSpec=value.last_spec_hash??null,lastPlan=value.last_plan_hash??null;
  const findings=[...new Set(value.open_findings||[])].sort((a,b)=>
    Buffer.compare(Buffer.from(a),Buffer.from(b)));
  const active=value.active_slice??null;
  if(![lastSpec,lastPlan].every((item)=>item===null||DIGEST.test(item))||
      !Array.isArray(value.open_findings||[])||
      findings.some((item)=>typeof item!=='string'||item.length<1||
        item.length>128)||!(active===null||/^SLICE-\d{3}$/.test(active)))
    fail();
  return{last_spec_hash:lastSpec,last_plan_hash:lastPlan,
    open_findings:findings,active_slice:active};
}
function compileContextPolicy({runtime='unknown',checkpoint:inputCheckpoint={}}={}){
  if(!RUNTIMES.includes(runtime))fail();
  const policy={schema_version:1,authority:'context-policy-v1',runtime,
    same_goal_strategy:STRATEGIES[runtime],
    task_creation:{automatic:false,allowed_reasons:[...ALLOWED_REASONS]},
    checkpoint:checkpoint(inputCheckpoint)};
  policy.policy_sha256=digest(policy);return policy;
}
function validateContextPolicy(value){
  if(!exactKeys(value,['schema_version','authority','runtime',
    'same_goal_strategy','task_creation','checkpoint','policy_sha256'])||
      value.schema_version!==1||value.authority!=='context-policy-v1'||
      !RUNTIMES.includes(value.runtime)||
      value.same_goal_strategy!==STRATEGIES[value.runtime]||
      !exactKeys(value.task_creation,['automatic','allowed_reasons'])||
      value.task_creation.automatic!==false||
      canonicalJson(value.task_creation.allowed_reasons)!==
        canonicalJson(ALLOWED_REASONS)||
      canonicalJson(value.checkpoint)!==canonicalJson(checkpoint(value.checkpoint))||
      !DIGEST.test(value.policy_sha256||''))fail();
  const preimage=structuredClone(value);delete preimage.policy_sha256;
  if(digest(preimage)!==value.policy_sha256)fail();
  return structuredClone(value);
}
function decideTaskCreation(policy,{requested=false,reason=null}={}){
  const checked=validateContextPolicy(policy);
  if(requested!==true)return{allowed:false,reason:'automatic-disabled'};
  if(!checked.task_creation.allowed_reasons.includes(reason))
    return{allowed:false,reason:'reason-not-allowed'};
  return{allowed:true,reason};
}

module.exports={ALLOWED_REASONS,compileContextPolicy,validateContextPolicy,
  decideTaskCreation};
