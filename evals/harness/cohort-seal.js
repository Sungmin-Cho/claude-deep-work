'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const VOLATILE=new Set(['PWD','OLDPWD','SHLVL','_','DEEP_WORK_SESSION_ID']);
function fail(code){throw Object.assign(new Error(code),{code});}
function canonical(value){if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`;return JSON.stringify(value);}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function normalizedEnvironment(env){const result={};for(const key of Object.keys(env).sort())if(!VOLATILE.has(key)){if(typeof env[key]!=='string')fail('eval-environment-type');result[key]=env[key];}return result;}
function environmentIdentity(env){return{sha256:digest(canonical(env)),keys:Object.keys(env).sort(),excluded_keys:[...VOLATILE].sort(),credential_values:'not-recorded',credential_store:{status:'unobserved',note:'OS keychain and credential-store contents are not copied or hashed'}};}
function fileIdentity(file,{optional=false}={}){let stat;try{stat=fs.statSync(file);}catch(e){if(optional&&e.code==='ENOENT')return{present:false,path:path.resolve(file),sha256:null};fail('eval-seal-file');}if(!stat.isFile())fail('eval-seal-file');return{present:true,path:fs.realpathSync(file),sha256:digest(fs.readFileSync(file))};}
function executableIdentity(executable,env){if(typeof executable!=='string'||!path.isAbsolute(executable))fail('eval-codex-executable');const file=fileIdentity(executable);const result=cp.spawnSync(file.path,['--version'],{env,encoding:'utf8',timeout:5000,maxBuffer:4096});
 if(result.status!==0||result.signal||result.error)fail('eval-codex-version');const version=(result.stdout||'').trim();if(!/^[A-Za-z][A-Za-z0-9_-]*[ \t]+v?\d+\.\d+\.\d+(?:[-+.][A-Za-z0-9.-]+)?$/.test(version))fail('eval-codex-version');
 if(digest(fs.readFileSync(file.path))!==file.sha256)fail('eval-codex-drift');return{path:file.path,sha256:file.sha256,version};}
function userConfigIdentity(env){const home=env.CODEX_HOME||(env.HOME?path.join(env.HOME,'.codex'):null);if(!home||!path.isAbsolute(home))fail('eval-user-config-root');return fileIdentity(path.join(home,'config.toml'),{optional:true});}
function buildSeal({root,output,manifest,candidate,executable,env,attempts,expected}){
 const normalized=normalizedEnvironment(env);
 const inputs={schema_version:2,root:fs.realpathSync(root),output:fs.realpathSync(output),manifest,candidate,candidate_sha256:digest(canonical(candidate)),manifest_sha256:digest(canonical(manifest)),package_lock:fileIdentity(path.join(root,'package-lock.json'),{optional:true}),user_config:userConfigIdentity(normalized),environment:environmentIdentity(normalized),host_context:require('./host-context.js').hostContextIdentity({root,output,env:normalized,attempts}),attempts};
 if(typeof executable!=='string'||!path.isAbsolute(executable))fail('eval-codex-executable');
 const binary=fileIdentity(executable);
 if(expected){const prior={...expected};delete prior.cli;delete prior.cohort_sha256;
  if(canonical(prior)!==canonical(inputs)||expected.cli?.path!==binary.path||expected.cli?.sha256!==binary.sha256)fail('eval-cohort-drift');}
 // Reject changed bytes/other known inputs before invoking even --version.
 const content={...inputs,cli:executableIdentity(executable,normalized)};
 return{...content,cohort_sha256:digest(canonical(content))};
}
function validateSeal(seal){if(seal?.schema_version!==2)fail('eval-cohort-version');const content={...seal};delete content.cohort_sha256;if(seal.cohort_sha256!==digest(canonical(content)))fail('eval-cohort-digest');if(!Array.isArray(seal.attempts)||new Set(seal.attempts.map(r=>r.id)).size!==seal.attempts.length)fail('eval-cohort-attempts');return seal;}
function compareSeals(expected,actual){validateSeal(expected);validateSeal(actual);if(expected.cohort_sha256!==actual.cohort_sha256)fail('eval-cohort-drift');return true;}
module.exports={canonical,digest,normalizedEnvironment,environmentIdentity,fileIdentity,executableIdentity,userConfigIdentity,buildSeal,validateSeal,compareSeals};
