#!/usr/bin/env node
'use strict';

function usage(message){const error=new Error(message);error.code='usage';throw error;}
function parseArgs(argv){const allowed=new Set(['--state-file','--plan','--gate-id','--slice-id','--spec-file',
    '--adapter-plan-file','--expected','--redact-file']);const out={};const seen=new Set();
  for(let i=0;i<argv.length;i+=1){const flag=argv[i];if(!allowed.has(flag))usage(`unknown flag: ${flag}`);
    if(seen.has(flag))usage(`duplicate flag: ${flag}`);seen.add(flag);const value=argv[++i];
    if(!value||value.startsWith('--'))usage(`missing value: ${flag}`);out[flag.slice(2).replaceAll('-','_')]=value;}
  for(const key of ['state_file','plan','gate_id'])if(!out[key])usage(`--${key.replaceAll('_','-')} is required`);
  if(Boolean(out.spec_file)===Boolean(out.adapter_plan_file))usage('exactly one of --spec-file or --adapter-plan-file is required');
  if(out.spec_file&&!['must-pass','must-fail'].includes(out.expected))usage('--expected is required for --spec-file');
  if(out.adapter_plan_file&&out.expected)usage('--expected is forbidden for --adapter-plan-file');
  return out;}
function bounded(fs,file,max=1_048_576){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)usage(`invalid input: ${file}`);
  return fs.readFileSync(file,'utf8');}
function json(fs,file){try{return JSON.parse(bounded(fs,file));}catch(error){if(error instanceof SyntaxError)usage(`invalid JSON: ${file}`);throw error;}}
function productionContext(args,deps){const fs=deps.fs||require('node:fs');const frontmatter=require('../runtime/frontmatter.js');
  const state=frontmatter.parseFrontmatter(bounded(fs,args.state_file)).fields;let verificationPlan;
  try{verificationPlan=JSON.parse(state.verification_plan_json);}catch{usage('state verification_plan_json is required');}
  const plan=json(fs,args.plan);const gate=verificationPlan.gates?.find((row)=>row.id===args.gate_id);if(!gate)usage('gate not in verification plan');
  const slice=args.slice_id?plan.slices?.find((row)=>row.id===args.slice_id):null;if(args.slice_id&&!slice)usage('slice not in plan');
  const path=require('node:path'),platform=require('../runtime/platform.js');const statePath=path.resolve(args.state_file);
  const match=path.basename(statePath).match(/^deep-work\.(s-[0-9a-f]{8})\.md$/);if(!match||path.basename(path.dirname(statePath))!=='.claude')
    usage('state file must be a session state file');const projectRoot=path.dirname(path.dirname(statePath));
  const stateCapability=platform.issueProjectStateCapability(projectRoot,statePath,{role:'session-state'});
  return{fs,state,stateCapability,sessionId:match[1],verificationPlan,plan,gate,slice,cwd:projectRoot};}
async function main(argv=process.argv.slice(2),deps={}){const stdout=deps.stdout||process.stdout,stderr=deps.stderr||process.stderr;
  let exitCode=2;try{const args=parseArgs(argv);const runtime=deps.runtime||require('../runtime/evidence-runtime.js');
    const context=deps.loadContext?await deps.loadContext(args):productionContext(args,deps);let record;
    if(args.spec_file){const fs=context.fs||deps.fs||require('node:fs');const secrets=args.redact_file?bounded(fs,args.redact_file).split(/\r?\n/).filter(Boolean):[];
      const spec=json(fs,args.spec_file);if(context.gate.adapter!=='command')usage('gate adapter is not command');
      const trace=context.slice?.contract||{};const evidenceId=deps.evidenceId||`EVID-${require('node:crypto').createHash('sha256')
        .update(`${context.verificationPlan.plan_sha256}\0${args.gate_id}\0${Date.now()}`).digest('hex').slice(0,16).toUpperCase()}`;
      record=await runtime.captureCommandEvidence({evidence_id:evidenceId,gate_id:args.gate_id,verification_spec:spec,
        expected_outcome:args.expected,requirement_ids:trace.requirements||context.gate.requirement_ids,
        invariant_ids:trace.invariants||[],failure_mode_ids:trace.failure_modes||context.gate.failure_mode_ids,
        negative_test_ids:trace.negative_tests||[],redaction_policy:{exact_secret_values:secrets},cwd:context.cwd},deps.captureDeps||{});
    }else{const fs=context.fs||deps.fs||require('node:fs');const adapterPlan=runtime.validateAdapterPlan(json(fs,args.adapter_plan_file));
      if(adapterPlan.gate_id!==args.gate_id||adapterPlan.verification_plan_sha256!==context.verificationPlan.plan_sha256)
        usage('adapter plan identity mismatch');if(!deps.runAdapter)usage('adapter runner unavailable');record=await deps.runAdapter(adapterPlan,context);}
    const publish=deps.publishRecord||((value,current)=>runtime.publishAuthenticatedRecord(value,{stateCapability:current.stateCapability,
      verificationPlan:current.verificationPlan,plan:current.plan,scope:current.slice?{kind:'slice',id:current.slice.id}:
        {kind:'session',id:current.sessionId}}));const published=await publish(record,context);
    const summary={schema_version:2,evidence_id:record.evidence_id,gate_id:record.gate_id,status:record.status,
      record_sha256:require('node:crypto').createHash('sha256').update(require('../runtime/operation-journal.js').canonicalJson(
        published.record||record)).digest('hex'),session_package_ref:published.pointer?.package_ref||published.session_package_ref,
      session_package_sha256:published.pointer?.package_sha256||published.session_package_sha256,
      redaction_passed:published.summary?.redaction?.passed??record.redaction.passed};stdout.write(`${JSON.stringify(summary)}\n`);
    exitCode=record.status==='pass'?0:1;
  }catch(error){stderr.write(`${error.code||'input-error'}: ${error.message}\n`);}return exitCode;}

if(require.main===module)main().then((code)=>{process.exitCode=code;});
module.exports={parseArgs,main};
