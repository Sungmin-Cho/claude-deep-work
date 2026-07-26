'use strict';

const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const platform=require('./platform.js');
const PRESET_RE=/^[a-z0-9][a-z0-9_-]{0,30}$/i;const REASONS=new Set(['setup','first-run-answers']);
const DEFAULT_KEYS=new Set(['team_mode','start_phase','tdd_mode','git','model_routing']);
const V4_DEFAULT_KEYS=new Set([...DEFAULT_KEYS,'methodology_policy']);
const KNOWN_FIELDS=new Set(['team_mode','start_phase','tdd_mode','git','git_branch','model_routing','project_type',
  'cross_model_preference','auto_update','label','description','notifications']);
function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function readVersion(text){const match=String(text).match(/^version:\s*(\d+)\s*(#.*)?$/m);return match?Number(match[1]):null;}
function detectUnsupportedV2Schema(text){const issues=[];if(/^profiles:\s*$/m.test(text))issues.push("'profiles:' block");
  if(/^active(?:_profile)?:\s/m.test(text))issues.push("'active:' field");if(/&[\w-]+/.test(text))issues.push('YAML anchor');
  if(/\*[\w-]+/.test(text))issues.push('YAML alias');if(/^\t/m.test(text))issues.push('탭 들여쓰기 사용');
  for(const line of String(text).split('\n')){if(!line.trim())continue;const indent=line.match(/^( *)/)[1].length;
    if(![0,2,4,6,8].includes(indent)){issues.push(`비정규 indent (${indent}-space) 사용`);break;}}
  for(const match of text.matchAll(/^ {4}([\w_]+):\s*(.*)$/gm))if(!KNOWN_FIELDS.has(match[1])){
    issues.push(`알 수 없는 preset 필드 '${match[1]}' — spec closed set 위반`);break;}return issues;}
function parseV2Presets(text){const lines=text.split('\n');const presets={};let current=null;
  for(let index=0;index<lines.length;index+=1){const header=lines[index].match(/^ {2}([\w-]+):\s*$/);
    if(header){current={auto:[],defaults:{}};presets[header[1]]=current;continue;}if(!current)continue;
    const field=lines[index].match(/^ {4}([\w_]+):\s*(.*)$/);if(!field)continue;const [,name,value]=field;
    const children=[];let next=index+1;while(next<lines.length&&(/^ {6,}/.test(lines[next])||!lines[next].trim())){
      if(lines[next].trim())children.push(lines[next]);next+=1;}index=next-1;
    if(name==='notifications')continue;if(['label','description','project_type','cross_model_preference','auto_update'].includes(name)){
      current.auto.push(lines[index-(next-(index+1))]||`    ${name}: ${value}`,...children);continue;}
    if(name==='git_branch'){current.defaults.git=[`      git:`,`        use_worktree: false`,`        use_branch: ${value==='true'?'true':'false'}`];continue;}
    const group=[`      ${name}:${value?` ${value}`:''}`,...children.map((line)=>`  ${line}`)];current.defaults[name]=group;
  }return presets;}
function v2TextToV3Text(text){const issues=detectUnsupportedV2Schema(text);if(issues.length)fail('profile-schema',issues.join(', '));
  const defaultPreset=(text.match(/^default_preset:\s*(\S+)/m)||[])[1]||'solo-strict';const presets=parseV2Presets(text);
  const out=['version: 3',`default_preset: ${defaultPreset}`,'presets:'];const fallback={team_mode:['      team_mode: solo'],
    start_phase:['      start_phase: research'],tdd_mode:['      tdd_mode: strict'],git:['      git:','        use_worktree: false','        use_branch: true'],
    model_routing:['      model_routing: auto']};
  for(const [name,preset] of Object.entries(presets)){out.push(`  ${name}:`,...preset.auto,'    interactive_each_session:',
      '      - team_mode','      - start_phase','      - tdd_mode','      - git','    defaults:');
    for(const key of DEFAULT_KEYS)out.push(...(preset.defaults[key]||fallback[key]));}
  return{text:out.join('\n')+'\n',warnings:[]};}
function isStaleLock(lockPath){try{const pid=Number(fs.readFileSync(lockPath,'utf8').trim());if(!Number.isFinite(pid)||pid<=0)return true;
    process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}}
const PROFILE_LOCK_OPTIONS=Object.freeze({timeoutMs:10_000,staleMs:30_000,heartbeatMs:1_000,
  processIdentity:crypto.createHash('sha256').update(`profile-runtime:${process.pid}`).digest('hex').slice(0,32)});
function withProfileOwner(profilePath,callback){const parent=path.dirname(path.resolve(profilePath));fs.mkdirSync(parent,{recursive:true});
  const stat=fs.lstatSync(parent);if(!stat.isDirectory()||stat.isSymbolicLink())fail('profile-parent');const lock=
    platform.issueExternalTargetLockCapability(profilePath);return platform.withDirectoryLock(lock,PROFILE_LOCK_OPTIONS,callback);}
function durableReplace(profilePath,text,label){const temporary=path.join(path.dirname(profilePath),
    `.${path.basename(profilePath)}.${label}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`);let renamed=false;
  try{const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temporary,profilePath);renamed=true;let dirfd;try{dirfd=fs.openSync(path.dirname(profilePath),'r');fs.fsyncSync(dirfd);}
    catch(error){if(!['EINVAL','ENOTSUP','EPERM','EISDIR'].includes(error.code))throw error;}finally{if(dirfd!==undefined)fs.closeSync(dirfd);}}
  finally{if(!renamed)try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}}
function createV3Profile(profilePath,defaultPreset='solo-strict'){if(!PRESET_RE.test(defaultPreset))throw new Error(`잘못된 프리셋 이름: ${defaultPreset} (영문/숫자/-/_만 허용, ≤31자)`);
  fs.mkdirSync(path.dirname(profilePath),{recursive:true});const text=`version: 3\ndefault_preset: ${defaultPreset}\npresets:\n  ${defaultPreset}:\n    label: ${defaultPreset==='solo-strict'?'Solo + Strict TDD':defaultPreset}\n    description: 사용자 정의 프리셋\n    project_type: zero-base\n    cross_model_preference:\n      use_codex: false\n      use_gemini: false\n    auto_update: prompt\n    interactive_each_session:\n      - team_mode\n      - start_phase\n      - tdd_mode\n      - git\n    defaults:\n      team_mode: solo\n      start_phase: research\n      tdd_mode: strict\n      git:\n        use_worktree: false\n        use_branch: true\n      model_routing: auto\n`;
  durableReplace(profilePath,text,'create');
  return{created:true,default_preset:defaultPreset};}
const V4_POLICY_LINES=Object.freeze([
  '    policy:',
  '      max_risk_without_confirmation: medium',
  '      low_risk_profile: lean',
  '      medium_risk_profile: standard',
  '      high_risk_profile: strict',
  '      critical_risk_profile: critical',
  '      preferred_review_roles:',
  '        semantic: claude',
  '        executability: codex',
  '      context:',
  '        codex_same_goal: native-compaction',
]);
function v3TextToV4Text(text){
  if(readVersion(text)!==3)fail('profile-v3-to-v4','not-v3');
  const lines=text.replace(/\s*$/u,'').split('\n');
  const presetsIndex=lines.findIndex((line)=>line==='presets:');
  if(presetsIndex<0)fail('profile-v3-to-v4','no-presets-block');
  const starts=[];
  for(let index=presetsIndex+1;index<lines.length;index++)
    if(/^ {2}[a-z0-9][a-z0-9_-]{0,30}:\s*$/i.test(lines[index]))
      starts.push(index);
  if(!starts.length)fail('profile-v3-to-v4','no-presets');
  for(let cursor=starts.length-1;cursor>=0;cursor--){
    const start=starts[cursor],end=cursor+1<starts.length?starts[cursor+1]:lines.length;
    const defaults=lines.slice(start,end).findIndex((line)=>line==='    defaults:');
    if(defaults<0)fail('profile-v3-to-v4','no-defaults');
    const defaultsStart=start+defaults;
    let defaultsEnd=end;
    for(let index=defaultsStart+1;index<end;index++)
      if(lines[index].trim()&&lines[index].match(/^( *)/)[1].length<=4){
        defaultsEnd=index;break;
      }
    const insertedMethodology=!lines.slice(defaultsStart+1,defaultsEnd).some((line)=>
      /^ {6}methodology_policy:\s*/.test(line));
    if(insertedMethodology)
      lines.splice(defaultsEnd,0,'      methodology_policy: auto');
    const adjustedEnd=end+(insertedMethodology?1:0);
    if(!lines.slice(start,adjustedEnd).some((line)=>line==='    policy:'))
      lines.splice(adjustedEnd,0,...V4_POLICY_LINES);
  }
  lines[lines.findIndex((line)=>/^version:\s*3\s*(#.*)?$/.test(line))]='version: 4';
  return lines.join('\n')+'\n';
}
function createV4Profile(profilePath,defaultPreset='solo-strict'){
  createV3Profile(profilePath,defaultPreset);
  durableReplace(profilePath,v3TextToV4Text(fs.readFileSync(profilePath,'utf8')),
    'create-v4');
  return{created:true,default_preset:defaultPreset};
}
function migrateProfileCoreUnlocked(profilePath,opts={}){if(!fs.existsSync(profilePath))return{migrated:false,reason:'not-found'};
  const text=fs.readFileSync(profilePath,'utf8');const version=readVersion(text);
  if(version===4)return{migrated:false,reason:'already-v4'};
  if(version===3){const backup=`${profilePath}.v3-backup`;
    if(!fs.existsSync(backup))durableReplace(backup,text,'backup');
    durableReplace(profilePath,v3TextToV4Text(text),'migrate');
    return{migrated:true,reason:'v3-to-v4',warnings:[]};}
  if(version!==null&&version>4)throw new Error(`알 수 없는 프로필 버전 ${version}`);const issues=detectUnsupportedV2Schema(text);
  if(issues.length)throw new Error(`v2 profile 변형 감지 — 자동 마이그레이션 거부:\n미지원 요소: ${issues.join(', ')}\n수동 이전 가이드`);
  const backup=`${profilePath}.v2-backup`;if(!fs.existsSync(backup))durableReplace(backup,text,'backup');
  const converted=v2TextToV3Text(text);durableReplace(profilePath,
    v3TextToV4Text(converted.text),'migrate');
  return{migrated:true,reason:'v2-to-v4',warnings:converted.warnings};}
function migrateProfileCore(profilePath,opts={}){return withProfileOwner(profilePath,()=>migrateProfileCoreUnlocked(profilePath,opts));}
function unquote(value){return value&&((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))?value.slice(1,-1):value;}
function parseV4Policy(lines,start,end){
  const policyIndex=lines.slice(start,end).findIndex((line)=>
    /^ {4}policy:\s*$/.test(line));
  if(policyIndex<0)fail('profile-v4-policy','missing policy');
  const policy={},allowed=new Set(['max_risk_without_confirmation',
    'low_risk_profile','medium_risk_profile','high_risk_profile',
    'critical_risk_profile','preferred_review_roles','context']);
  let index=start+policyIndex+1;
  while(index<end){
    if(!lines[index].trim()||/^\s*#/.test(lines[index])){index++;continue;}
    const scalar=lines[index].match(/^ {6}(\w+):\s*(\S+)\s*(#.*)?$/);
    if(scalar){
      if(!allowed.has(scalar[1])||Object.hasOwn(policy,scalar[1]))
        fail('profile-v4-policy',scalar[1]);
      policy[scalar[1]]=unquote(scalar[2]);index++;continue;
    }
    const block=lines[index].match(/^ {6}(preferred_review_roles|context):\s*$/);
    if(!block||Object.hasOwn(policy,block[1]))
      fail('profile-v4-policy','shape');
    const value={};index++;
    while(index<end){
      const child=lines[index].match(/^ {8}(\w+):\s*(\S+)\s*(#.*)?$/);
      if(!child)break;
      if(Object.hasOwn(value,child[1]))fail('profile-v4-policy',child[1]);
      value[child[1]]=unquote(child[2]);index++;
    }
    policy[block[1]]=value;
  }
  const exact=['max_risk_without_confirmation','low_risk_profile',
    'medium_risk_profile','high_risk_profile','critical_risk_profile',
    'preferred_review_roles','context'];
  if(Object.keys(policy).sort().join('\0')!==exact.sort().join('\0')||
      !['low','medium','high','critical'].includes(
        policy.max_risk_without_confirmation)||
      policy.low_risk_profile!=='lean'||
      policy.medium_risk_profile!=='standard'||
      policy.high_risk_profile!=='strict'||
      policy.critical_risk_profile!=='critical'||
      Object.keys(policy.preferred_review_roles).sort().join('\0')!==
        ['executability','semantic'].join('\0')||
      !['claude','codex','gemini','agy'].includes(
        policy.preferred_review_roles.semantic)||
      !['claude','codex','gemini','agy'].includes(
        policy.preferred_review_roles.executability)||
      Object.keys(policy.context).join('\0')!=='codex_same_goal'||
      policy.context.codex_same_goal!=='native-compaction')
    fail('profile-v4-policy','values');
  return policy;
}
function loadV3Profile(profilePath,opts={}){const text=fs.readFileSync(profilePath,'utf8'),
  version=readVersion(text);if(![3,4].includes(version))return{error:'not-v3-or-v4'};
  const requested=opts.initialPreset||(text.match(/^default_preset:\s*(\S+)\s*$/m)||[])[1];if(!requested)return{error:'no-default-preset'};
  if(!PRESET_RE.test(requested))return{error:'invalid-preset-name',requested_preset:requested};const lines=text.split('\n');
  const presetsIndex=lines.findIndex((line)=>/^presets:\s*$/.test(line));if(presetsIndex<0)return{error:'no-presets-block'};
  let start=-1;for(let i=presetsIndex+1;i<lines.length;i+=1){if(new RegExp(`^ {2}${requested.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}:\\s*$`).test(lines[i])){start=i;break;}
    if(lines[i].trim()&&!/^\s/.test(lines[i]))break;}if(start<0)return{error:'preset-not-found',requested_preset:requested};
  let end=lines.length;for(let i=start+1;i<lines.length;i+=1)if(lines[i].trim()&&lines[i].match(/^( *)/)[1].length<=2){end=i;break;}
  const interactive=[];const ie=lines.slice(start,end).findIndex((line)=>/^ {4}interactive_each_session:\s*$/.test(line));
  if(ie>=0)for(let i=start+ie+1;i<end;i+=1){const match=lines[i].match(/^ {6}-\s*(\S+)\s*(#.*)?$/);if(match)interactive.push(match[1]);else if(lines[i].trim()&&!/^\s{6}/.test(lines[i]))break;}
  const presetLevel={};for(let i=start+1;i<end;i+=1){const scalar=lines[i].match(/^ {4}(project_type|auto_update):\s*(\S+)\s*(#.*)?$/);
    if(scalar)presetLevel[scalar[1]]=unquote(scalar[2]);const block=lines[i].match(/^ {4}(cross_model_preference):\s*(#.*)?$/);
    if(block){const value={};for(i+=1;i<end;i+=1){const child=lines[i].match(/^ {6}(\w+):\s*(\S+)\s*(#.*)?$/);if(!child){i-=1;break;}value[child[1]]=unquote(child[2]);}presetLevel[block[1]]=value;}}
  const defaults={};const di=lines.slice(start,end).findIndex((line)=>/^ {4}defaults:\s*$/.test(line));if(di>=0){let i=start+di+1;
    while(i<end){if(/^\s*#/.test(lines[i])||!lines[i].trim()){i+=1;continue;}const scalar=lines[i].match(/^ {6}(\w+):\s*(\S+)\s*(#.*)?$/);
      if(scalar){defaults[scalar[1]]=unquote(scalar[2]);i+=1;continue;}const block=lines[i].match(/^ {6}(\w+):\s*(#.*)?$/);
      if(block){const value={};i+=1;while(i<end){const child=lines[i].match(/^ {8}(\w+):\s*(\S+)\s*(#.*)?$/);if(!child)break;value[child[1]]=unquote(child[2]);i+=1;}defaults[block[1]]=value;continue;}break;}}
  const policy=version===4?parseV4Policy(lines,start,end):null;
  return{preset_name:requested,interactive_each_session:interactive,defaults,
    project_type:presetLevel.project_type||null,
    cross_model_preference:presetLevel.cross_model_preference||null,
    auto_update:presetLevel.auto_update||null,policy};}
function inspect(file,allowMissing=false){try{const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())fail('profile-unsafe');return stat;}
  catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}}
function migrateProfile(profileCapability,initialPreset='solo-strict'){const file=typeof profileCapability==='string'?profileCapability:profileCapability.path;
  if(!PRESET_RE.test(initialPreset))fail('profile-preset');return withProfileOwner(file,()=>{if(!inspect(file,true)){
    createV4Profile(file,initialPreset);return{created:true};}return migrateProfileCoreUnlocked(file,{initialPreset});});}
function presetNames(text){return[...text.matchAll(/^ {2}([a-z0-9][a-z0-9_-]{0,30}):\s*$/gim)].map((match)=>match[1]);}
function loadProfile(profileCapability,initialPreset){const file=typeof profileCapability==='string'?profileCapability:profileCapability.path;inspect(file);
  const text=fs.readFileSync(file,'utf8'),version=readVersion(text);
  const selected=loadV3Profile(file,{initialPreset});if(selected.error)fail('profile-load',selected.error);
  return{version,compatibility_mode:version===4?'native-v4':'legacy-v3',
    default_preset:(text.match(/^default_preset:\s*(\S+)/m)||[])[1]||null,
    presets:Object.fromEntries(presetNames(text).map((name)=>[name,loadV3Profile(file,{initialPreset:name})])),selected_preset:selected.preset_name,
    defaults:selected.defaults,interactive_each_session:selected.interactive_each_session,
    policy:selected.policy};}
function scalar(value){if(typeof value==='boolean'||typeof value==='number')return String(value);if(typeof value!=='string'||/[\r\n]/.test(value))fail('profile-value');return JSON.stringify(value);}
function updateProfile(profileCapability,{reason,selectedPreset,defaults}={}){if(!REASONS.has(reason))fail('profile-reason');
  if(!PRESET_RE.test(selectedPreset||'')||!defaults||typeof defaults!=='object'||Array.isArray(defaults))fail('profile-defaults');
  for(const key of Object.keys(defaults))if(!V4_DEFAULT_KEYS.has(key))fail('profile-default-field',key);const file=typeof profileCapability==='string'?profileCapability:profileCapability.path;
  return withProfileOwner(file,()=>{inspect(file);let text=fs.readFileSync(file,'utf8');
    const version=readVersion(text);if(![3,4].includes(version))fail('profile-version');
    const keys=version===4?V4_DEFAULT_KEYS:DEFAULT_KEYS;
    if(version===3&&Object.hasOwn(defaults,'methodology_policy'))
      fail('profile-default-field','methodology_policy');
    if(!presetNames(text).includes(selectedPreset)){
    const rows=[`  ${selectedPreset}:`,'    interactive_each_session:',...Array.from(keys,(key)=>`      - ${key}`),'    defaults:'];
    for(const key of keys){const supplied=Object.hasOwn(defaults,key),
      value=supplied?defaults[key]:(key==='methodology_policy'?'auto':undefined);
      if(value!==undefined&&value&&typeof value==='object'){
        rows.push(`      ${key}:`,...Object.keys(value).sort().map((child)=>`        ${child}: ${scalar(value[child])}`));}
      else if(value!==undefined)rows.push(`      ${key}: ${scalar(value)}`);}
    if(version===4)rows.push(...V4_POLICY_LINES);
    text=text.replace(/\s*$/u,'\n')+rows.join('\n')+'\n';}
  text=text.replace(/^default_preset:\s*\S+\s*$/m,`default_preset: ${selectedPreset}`);durableReplace(file,text,'replace');
  return{status:'updated',selectedPreset};});}

module.exports={PRESET_RE,migrateProfileCore,migrateProfile,loadProfile,updateProfile,readVersion,
  detectUnsupportedV2Schema,v2TextToV3Text,v3TextToV4Text,isStaleLock,
  createV3Profile,createV4Profile,loadV3Profile};
