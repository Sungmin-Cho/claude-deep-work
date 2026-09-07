'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function load(name){const bytes=fs.readFileSync(path.join(__dirname,'fixtures',name));
 return {sha256:crypto.createHash('sha256').update(bytes).digest('hex'),grammar:JSON.parse(bytes)};}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const legacy=load('node-tap-26.0.0.json'),current=load('node-tap-policy-v2.json');
freeze(legacy);freeze(current);
const LEGACY_NODE_TAP_POLICY_SHA256=legacy.sha256;
const CURRENT_NODE_TAP_POLICY_SHA256=current.sha256;
function resolveNodeTapPolicy({policySha256,nodeVersion}={}){
 const selected=policySha256===legacy.sha256?legacy:policySha256===current.sha256?current:null;
 if(!selected)return {supported:false,reason:'unknown-policy'};
 const patches=selected===legacy?[legacy.grammar.node_patch]:current.grammar.node_patches;
 if(!patches.includes(nodeVersion))return {supported:false,reason:'unsupported-node-version'};
 return {supported:true,policyId:selected===legacy?'node-test-tap-legacy-v1':current.grammar.policy_id,
  grammar:selected.grammar};
}
function assertNodeTapPolicyForSpec(spec,nodeVersion){
 const policy=resolveNodeTapPolicy({policySha256:spec?.executable?.supported_patches_sha256,nodeVersion});
 if(!policy.supported){const error=new Error(`[${policy.reason}] strict TAP capability unavailable; select a tested executable or authenticate a same-risk policy replan`);error.code=policy.reason;throw error;}
 return policy;
}
function nodeTestIsolationFlag(spec,nodeVersion){
 const policy=assertNodeTapPolicyForSpec(spec,nodeVersion);
 return policy.grammar.isolation_flags?.[nodeVersion]||'--test-isolation=none';
}
module.exports={nodeTestIsolationFlag,resolveNodeTapPolicy,assertNodeTapPolicyForSpec,LEGACY_NODE_TAP_POLICY_SHA256,CURRENT_NODE_TAP_POLICY_SHA256};
