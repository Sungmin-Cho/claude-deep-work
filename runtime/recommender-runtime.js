'use strict';

const MAX_TASK_BYTES=2048;const MAX_COMMITS=5;const MAX_DIRS=10;const MAX_DIR_LEN=30;
const KEYS=Object.freeze(['team_mode','start_phase','tdd_mode','git','model_routing']);
const ENUMS=Object.freeze({team_mode:['solo','team'],start_phase:['brainstorm','research','plan'],
  tdd_mode:['strict','coaching','relaxed','spike'],git:['worktree','new-branch','current-branch'],
  model_routing:['auto','default','custom']});
function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function truncateBytes(value,max=MAX_TASK_BYTES){const input=String(value||'');const buffer=Buffer.from(input);const marker=Buffer.from('[truncated]');
  if(buffer.length<=max)return input;let end=Math.max(0,max-marker.length);while(end>0&&(buffer[end]&0xc0)===0x80)end-=1;
  return `${buffer.subarray(0,end).toString('utf8')}${marker}`;}
function detectCapability({is_git=true,worktree_supported=true,team_env_set=true}={}){return {
  git_worktree:is_git&&worktree_supported,team_mode_available:team_env_set,is_git};}
function buildRecommenderInput(value={}){return {task_description:truncateBytes(value.task_description),workspace_meta:{
  git_status:value.git_status||'clean',recent_commits:(value.recent_commits||[]).slice(0,MAX_COMMITS).map(String),
  top_level_dirs:(value.top_level_dirs||[]).filter((entry)=>typeof entry==='string'&&entry&&
    !entry.includes('..')&&!entry.startsWith('/')&&!/[\\:]/.test(entry)).slice(0,MAX_DIRS)
    .map((entry)=>entry.slice(0,MAX_DIR_LEN))},ask_items:value.ask_items||[...KEYS],
  current_defaults:value.current_defaults||{},capability:value.capability||detectCapability({is_git:false,
    worktree_supported:false,team_env_set:false})};}
function parseRawRecommendation(raw){const text=String(raw);const fences=[...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const source=fences.length===1?fences[0][1]:fences.length===0?text:null;if(source===null)fail('recommendation-fences');
  try{return JSON.parse(source);}catch{fail('recommendation-json');}}
function parseRecommendation(raw,ctx={}){const fences=[...String(raw).matchAll(/```json\s*([\s\S]*?)```/g)];
  if(fences.length===0)return{ok:false,fallback_reason:'no-json-fence'};if(fences.length>1)return{ok:false,fallback_reason:'multiple-fences'};
  let data;try{data=JSON.parse(fences[0][1]);}catch(error){return{ok:false,fallback_reason:`json-parse-error: ${error.message}`};}
  for(const key of KEYS){if(!data[key]||typeof data[key].value!=='string')return{ok:false,fallback_reason:`missing key: ${key}`};
    if(typeof data[key].reason!=='string'||!data[key].reason)return{ok:false,fallback_reason:`missing reason: ${key}`};
    const allowed=key==='model_routing'?['default','custom']:ENUMS[key];if(!allowed.includes(data[key].value))return{ok:false,fallback_reason:`enum violation: ${key}=${data[key].value}`};}
  const cap=ctx.capability||{};if(cap.team_mode_available!==true&&data.team_mode.value==='team')return{ok:false,fallback_reason:'capability: team_mode unavailable (or unset)'};
  if(cap.git_worktree!==true&&data.git.value==='worktree')return{ok:false,fallback_reason:'capability: worktree unavailable (or unset)'};
  return{ok:true,data};}
function validateRecommendation(raw,capability={}){const parsed=parseRawRecommendation(raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).sort().join(',')!==[...KEYS].sort().join(','))fail('recommendation-schema');
  const flat={};for(const key of KEYS){const row=parsed[key];if(typeof row==='string'){flat[key]=row;}
    else if(row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.value==='string'&&typeof row.reason==='string'&&row.reason.trim())flat[key]=row.value;
    else fail('recommendation-schema');if(!ENUMS[key].includes(flat[key]))fail('recommendation-enum',`${key}=${flat[key]}`);}
  if(flat.git==='worktree'&&capability.git_worktree!==true)fail('recommendation-capability');
  if(flat.team_mode==='team'&&capability.team_mode_available!==true)fail('recommendation-capability');return flat;}
function capabilityToDisabled(capability,item){if(!KEYS.includes(item))throw new Error(`capabilityToDisabled: 알 수 없는 item '${item}' — 허용: ${KEYS.join(', ')}`);const out=[];
  if(item==='team_mode'&&capability.team_mode_available!==true)out.push('team');if(item==='git'){
    if(capability.git_worktree!==true)out.push('worktree');if(capability.is_git!==true)out.push('new-branch');}return out;}
function pickEffectiveDefault(defaultValue,allowed){return allowed.includes(defaultValue)?defaultValue:allowed[0]||null;}
function formatOptions({item,recommendation,default_value,enum_values,disabled_values=[]}={}){
  if(!KEYS.includes(item)||!Array.isArray(enum_values))fail('ask-options');const allowed=enum_values.filter((v)=>!disabled_values.includes(v));
  if(!allowed.length)throw new Error(`format-ask-options: ${item} 모든 enum 값이 disabled — 진행 불가`);const effective=pickEffectiveDefault(default_value,allowed);
  const rec=recommendation&&typeof recommendation==='object'?recommendation:recommendation?{value:recommendation,reason:'runtime recommendation'}:null;
  const rows=[];if(rec&&allowed.includes(rec.value)){rows.push({value:rec.value,label:rec.value===effective?
    `${rec.value} (추천 = default) — ${rec.reason}`:`${rec.value} (추천) — ${rec.reason}`});
    if(rec.value!==effective)rows.push({value:effective,label:`${effective} (default)`});}
  else rows.push({value:effective,label:`${effective} (default)`});
  for(const value of allowed)if(!rows.some((row)=>row.value===value))rows.push({value,label:value});return rows;}
function formatAskOptions({item,recommendation,default_value,enum_values,capability}={}){return formatOptions({item,
  recommendation:recommendation?{value:recommendation,reason:'runtime recommendation'}:null,default_value,enum_values,
  disabled_values:capabilityToDisabled(capability||{},item)});}

module.exports={MAX_TASK_BYTES,MAX_COMMITS,MAX_DIRS,KEYS,ENUMS,truncateBytes,detectCapability,buildRecommenderInput,
  parseRecommendation,parseRawRecommendation,validateRecommendation,capabilityToDisabled,pickEffectiveDefault,
  formatOptions,formatAskOptions};
