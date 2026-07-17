'use strict';

const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const platform=require('./platform.js');
const PRESET_RE=/^[a-z0-9][a-z0-9_-]{0,30}$/i;const REASONS=new Set(['setup','first-run-answers']);
const DEFAULT_KEYS=new Set(['team_mode','start_phase','tdd_mode','git','model_routing']);
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
    model_routing:['      model_routing:','        brainstorm: main','        research: sonnet','        plan: main','        implement: sonnet','        test: haiku']};
  for(const [name,preset] of Object.entries(presets)){out.push(`  ${name}:`,...preset.auto,'    interactive_each_session:',
      '      - team_mode','      - start_phase','      - tdd_mode','      - git','      - model_routing','    defaults:');
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
  fs.mkdirSync(path.dirname(profilePath),{recursive:true});const text=`version: 3\ndefault_preset: ${defaultPreset}\npresets:\n  ${defaultPreset}:\n    label: ${defaultPreset==='solo-strict'?'Solo + Strict TDD':defaultPreset}\n    description: 사용자 정의 프리셋\n    project_type: zero-base\n    cross_model_preference:\n      use_codex: false\n      use_gemini: false\n    auto_update: prompt\n    interactive_each_session:\n      - team_mode\n      - start_phase\n      - tdd_mode\n      - git\n      - model_routing\n    defaults:\n      team_mode: solo\n      start_phase: research\n      tdd_mode: strict\n      git:\n        use_worktree: false\n        use_branch: true\n      model_routing:\n        brainstorm: main\n        research: sonnet\n        plan: main\n        implement: sonnet\n        test: haiku\n`;
  durableReplace(profilePath,text,'create');
  return{created:true,default_preset:defaultPreset};}
function migrateProfileCoreUnlocked(profilePath,opts={}){if(!fs.existsSync(profilePath))return{migrated:false,reason:'not-found'};
  const text=fs.readFileSync(profilePath,'utf8');const version=readVersion(text);if(version===3)return{migrated:false,reason:'already-v3'};
  if(version!==null&&version>3)throw new Error(`알 수 없는 프로필 버전 ${version}`);const issues=detectUnsupportedV2Schema(text);
  if(issues.length)throw new Error(`v2 profile 변형 감지 — 자동 마이그레이션 거부:\n미지원 요소: ${issues.join(', ')}\n수동 이전 가이드`);
  const backup=`${profilePath}.v2-backup`;if(!fs.existsSync(backup))durableReplace(backup,text,'backup');
  const converted=v2TextToV3Text(text);durableReplace(profilePath,converted.text,'migrate');
  return{migrated:true,reason:'v2-to-v3',warnings:converted.warnings};}
function migrateProfileCore(profilePath,opts={}){return withProfileOwner(profilePath,()=>migrateProfileCoreUnlocked(profilePath,opts));}
function unquote(value){return value&&((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))?value.slice(1,-1):value;}
function loadV3Profile(profilePath,opts={}){const text=fs.readFileSync(profilePath,'utf8');if(readVersion(text)!==3)return{error:'not-v3'};
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
  return{preset_name:requested,interactive_each_session:interactive,defaults,project_type:presetLevel.project_type||null,
    cross_model_preference:presetLevel.cross_model_preference||null,auto_update:presetLevel.auto_update||null};}
function inspect(file,allowMissing=false){try{const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())fail('profile-unsafe');return stat;}
  catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}}
function migrateProfile(profileCapability,initialPreset='solo-strict'){const file=typeof profileCapability==='string'?profileCapability:profileCapability.path;
  if(!PRESET_RE.test(initialPreset))fail('profile-preset');return withProfileOwner(file,()=>{if(!inspect(file,true)){
    createV3Profile(file,initialPreset);return{created:true};}return migrateProfileCoreUnlocked(file,{initialPreset});});}
function presetNames(text){return[...text.matchAll(/^ {2}([a-z0-9][a-z0-9_-]{0,30}):\s*$/gim)].map((match)=>match[1]);}
function loadProfile(profileCapability,initialPreset){const file=typeof profileCapability==='string'?profileCapability:profileCapability.path;inspect(file);
  const text=fs.readFileSync(file,'utf8');const selected=loadV3Profile(file,{initialPreset});if(selected.error)fail('profile-load',selected.error);
  return{version:3,default_preset:(text.match(/^default_preset:\s*(\S+)/m)||[])[1]||null,
    presets:Object.fromEntries(presetNames(text).map((name)=>[name,loadV3Profile(file,{initialPreset:name})])),selected_preset:selected.preset_name,
    defaults:selected.defaults,interactive_each_session:selected.interactive_each_session};}
function scalar(value){if(typeof value==='boolean'||typeof value==='number')return String(value);if(typeof value!=='string'||/[\r\n]/.test(value))fail('profile-value');return JSON.stringify(value);}
function updateProfile(profileCapability,{reason,selectedPreset,defaults}={}){if(!REASONS.has(reason))fail('profile-reason');
  if(!PRESET_RE.test(selectedPreset||'')||!defaults||typeof defaults!=='object'||Array.isArray(defaults))fail('profile-defaults');
  for(const key of Object.keys(defaults))if(!DEFAULT_KEYS.has(key))fail('profile-default-field',key);const file=typeof profileCapability==='string'?profileCapability:profileCapability.path;
  return withProfileOwner(file,()=>{inspect(file);let text=fs.readFileSync(file,'utf8');if(readVersion(text)!==3)fail('profile-version');if(!presetNames(text).includes(selectedPreset)){
    const rows=[`  ${selectedPreset}:`,'    interactive_each_session:',...Array.from(DEFAULT_KEYS,(key)=>`      - ${key}`),'    defaults:'];
    for(const key of DEFAULT_KEYS)if(Object.hasOwn(defaults,key)){const value=defaults[key];if(value&&typeof value==='object'){
      rows.push(`      ${key}:`,...Object.keys(value).sort().map((child)=>`        ${child}: ${scalar(value[child])}`));}else rows.push(`      ${key}: ${scalar(value)}`);}text=text.replace(/\s*$/u,'\n')+rows.join('\n')+'\n';}
  text=text.replace(/^default_preset:\s*\S+\s*$/m,`default_preset: ${selectedPreset}`);durableReplace(file,text,'replace');
  return{status:'updated',selectedPreset};});}

module.exports={PRESET_RE,migrateProfileCore,migrateProfile,loadProfile,updateProfile,readVersion,
  detectUnsupportedV2Schema,v2TextToV3Text,isStaleLock,createV3Profile,loadV3Profile};
