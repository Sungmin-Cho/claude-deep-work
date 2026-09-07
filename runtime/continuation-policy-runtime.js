'use strict';
const path=require('node:path');
const {canonicalJson}=require('./operation-journal.js');
const DIGEST=/^[a-f0-9]{64}$/;
function fail(code){const error=new Error(`[${code}]`);error.code=code;throw error;}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());}
function validateContinuationPreference(value){
 if(!exact(value,['schema_version','mode','task_sha256','project_root','source'])||value.schema_version!==1||
   !['autonomous','interactive'].includes(value.mode)||!DIGEST.test(value.task_sha256||'')||
   typeof value.project_root!=='string'||!path.isAbsolute(value.project_root)||
   value.source!=='user-explicit')fail('continuation-preference');
 return structuredClone(value);
}
function validateArtifactApprovalPolicy(value){
 if(!exact(value,['schema_version','mode','source','task_sha256','project_root'])||value.schema_version!==1||
   !['explicit-gates','reuse-exact-review'].includes(value.mode)||value.source!=='user-explicit'||
   !DIGEST.test(value.task_sha256||'')||typeof value.project_root!=='string'||!path.isAbsolute(value.project_root))fail('artifact-approval-policy');
 return structuredClone(value);
}
function reusableReviewIdentity({expected,actual}={}){
 if(!expected||!actual||actual.terminal_success!==true||!Array.isArray(actual.unresolved_blockers)||actual.unresolved_blockers.length)return false;
 for(const key of ['request_sha256','artifact_sha256','contract_sha256','policy_sha256'])
   if(!DIGEST.test(expected[key]||'')||actual[key]!==expected[key])return false;
 // Additional binding fields are exact too (for example recovery/dependency identity).
 for(const key of Object.keys(expected).filter(k=>k!=='reviewers'))if(canonicalJson(expected[key])!==canonicalJson(actual[key]))return false;
 const required=expected.reviewers,rows=actual.reviewers;
 if(!Array.isArray(required)||!required.length||!Array.isArray(rows)||rows.length!==required.length)return false;
 const keys=['role','model','tier','channel','session_id','provider'];
 if(rows.some(r=>!r||keys.some(k=>typeof r[k]!=='string'||!r[k])||r.provider==='unknown'||r.model==='unknown'||
   !['light','standard','deep'].includes(r.tier)||!['subagent','codex-cli','claude-cli','gemini-cli'].includes(r.channel)))return false;
 if(new Set(rows.map(r=>r.session_id)).size!==rows.length||new Set(rows.map(r=>r.role)).size!==rows.length)return false;
 return required.every(want=>rows.some(row=>keys.every(key=>want[key]===row[key])));
}
module.exports={validateContinuationPreference,validateArtifactApprovalPolicy,reusableReviewIdentity};
