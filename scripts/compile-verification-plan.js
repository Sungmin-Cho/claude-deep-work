#!/usr/bin/env node
'use strict';

const fs=require('node:fs');const crypto=require('node:crypto');
function usage(message){const error=new Error(message);error.code='usage';throw error;}
function parseArgs(argv){const allowed=new Set(['--state-file','--spec','--plan','--capabilities-file']);const out={};
  for(let i=0;i<argv.length;i+=1){const flag=argv[i];if(!allowed.has(flag))usage(`unknown flag: ${flag}`);
    const key=flag.slice(2).replaceAll('-','_');if(Object.hasOwn(out,key))usage(`duplicate flag: ${flag}`);const value=argv[++i];
    if(!value||value.startsWith('--'))usage(`missing value: ${flag}`);out[key]=value;}
  for(const key of ['state_file','spec','plan'])if(!out[key])usage(`--${key.replaceAll('_','-')} is required`);return out;}
function bounded(io,file,max=1_048_576){const stat=io.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)
  usage(`invalid input: ${file}`);return io.readFileSync(file);}
function json(io,file){try{return JSON.parse(bounded(io,file).toString('utf8'));}catch(error){if(error instanceof SyntaxError)
    usage(`invalid JSON: ${file}`);throw error;}}
function storedObject(fields,key){const value=fields[key];if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;}catch{}
  usage(`state ${key} is required`);}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function countRows(value){try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)?parsed.length:0;}catch{return 0;}}
function compilerInput(args,deps={}){const io=deps.fs||fs;const frontmatter=require('../runtime/frontmatter.js');
  const state=frontmatter.parseFrontmatter(bounded(io,args.state_file).toString('utf8')).fields;
  const specBytes=bounded(io,args.spec);const contractRuntime=require('../runtime/contract-runtime.js');
  const specContract=contractRuntime.parseSpecMarkdown(specBytes.toString('utf8'),{path:args.spec});const specSha256=
    contractRuntime.specContractDigest(specContract);const specApprovedHash=sha256(specBytes);const planProjection=json(io,args.plan);
  if(state.spec_approved_hash!==specApprovedHash)usage('state spec approval does not match exact spec bytes');
  if(planProjection.contract_binding?.spec_contract?.spec_sha256!==specSha256||
      planProjection.contract_binding?.spec_contract?.spec_approved_hash!==specApprovedHash)
    usage('plan binding does not match exact spec bytes');
  const riskProfile=storedObject(state,'risk_profile_json');const policySnapshot=storedObject(state,'methodology_policy_json');
  const riskProfileSha256=state.risk_profile_sha256||planProjection.contract_binding?.risk_profile_sha256;
  if(!/^[0-9a-f]{64}$/.test(riskProfileSha256||'')||riskProfileSha256!==planProjection.contract_binding?.risk_profile_sha256)
    usage('authoritative risk profile digest does not match plan binding');
  const capabilities=args.capabilities_file?json(io,args.capabilities_file):{};let review={};try{review=JSON.parse(state.review_execution_json||'{}');}catch{}
  return{riskProfile,riskProfileSha256,policySnapshot,specContract,specSha256,specApprovedHash,planProjection,
    capabilities,compatibilityFacts:{created_by_version:state.created_by_version,
      spec_policy_required:state.spec_policy_required===true,risk_class:riskProfile.class||riskProfile.risk_class,
      changed_slice_count:countRows(state.changed_slices_json),rerun_slice_count:countRows(state.rerun_slices_json),
      has_v613_evidence:Boolean(review.evidence?.package_sha256)}};}
async function main(argv=process.argv.slice(2),deps={}){const stdout=deps.stdout||process.stdout,stderr=deps.stderr||process.stderr;
  try{const args=parseArgs(argv);const runtime=deps.runtime||require('../runtime/verification-policy-runtime.js');
    const plan=runtime.compileVerificationPlan(compilerInput(args,deps));const validation=runtime.validateVerificationPlan(plan);
    if(!validation.pass){stdout.write(`${JSON.stringify({pass:false,errors:validation.errors})}\n`);return 1;}
    stdout.write(`${JSON.stringify(plan)}\n`);return 0;}catch(error){stderr.write(`${error.code||'input-error'}: ${error.message}\n`);return 2;}}

if(require.main===module)main().then((code)=>{process.exitCode=code;});
module.exports={parseArgs,main,compilerInput};
