'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const platform=require('./platform.js');const transaction=require('./transaction-runtime.js');
const journal=require('./operation-journal.js');const frontmatter=require('./frontmatter.js');
function fail(code){throw Object.assign(new Error(`[${code}]`),{code});}
function readJson(value,code){try{return typeof value==='string'?JSON.parse(value):value;}catch{fail(code);}}
function currentVersion(){const root=fs.realpathSync(path.resolve(__dirname,'..'));const file=fs.realpathSync(path.join(root,'.claude-plugin/plugin.json'));if(!file.startsWith(root+path.sep))fail('plugin-root-containment');return JSON.parse(fs.readFileSync(file)).version;}
function reserveM3RunId(seed,at){const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';let n=BigInt(at?Date.parse(at):Date.now()),prefix='';for(let i=0;i<10;i++){prefix=alphabet[Number(n%32n)]+prefix;n/=32n;}return prefix+[...(seed?crypto.createHash('sha256').update(seed).digest().subarray(0,16):crypto.randomBytes(16))].map(b=>alphabet[b%32]).join('');}
function workflowLocks(stateCapability){const root=stateCapability.projectRoot,id=transaction.sessionIdFromState(stateCapability);return [
 {rank:transaction.RANKS.session,capability:platform.issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${id}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
 {rank:transaction.RANKS.journal,capability:platform.issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${id}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
 {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}];}
function withWorkflowLock(stateCapability,callback){return transaction.withRankedLocks(workflowLocks(stateCapability),callback);}
function workDirFor(stateCapability,fields){if(fields.work_dir!==`.deep-work/${transaction.sessionIdFromState(stateCapability)}`)fail('session-work-dir');const work=path.join(stateCapability.projectRoot,fields.work_dir);platform.issueProjectStateCapability(stateCapability.projectRoot,work,{role:'session-work-dir',sessionStateCapability:stateCapability});return work;}
function readRegular(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4194304)fail('workflow-artifact');return fs.readFileSync(file);}
function loadExecutionContext({stateCapability,planCapability,sliceId}={}){
 const fields=transaction.readState(stateCapability);if(fields.parked===true)fail('session-parked');if(fields.replan_required===true)fail('execution-replan-required');
 const workDir=workDirFor(stateCapability,fields),planPath=path.join(workDir,'plan.json');
 if(planCapability){transaction.revalidateSessionFile(planCapability);if(planCapability.path!==planPath)fail('execution-plan-path');}
 const bytes=readRegular(planPath),plan=JSON.parse(bytes),runtime=require('./plan-runtime.js');
 if(bytes.toString()!==journal.canonicalJson(plan))fail('execution-plan-bytes');
 const compiled=runtime.compileImmutablePlanAuthority(plan);if(compiled.plan_authority_sha256!==plan.plan_authority_sha256)fail('execution-plan-authority');
 const approval=readJson(fields.plan_approved,'execution-plan-approval');
 if(!approval||typeof approval!=='object'||fields.plan_bound_once!==true&&plan.schema_version===3)fail('execution-plan-approval');
 const verificationPlan=readJson(fields.verification_plan_json,'execution-verification-plan');
 if(!require('./verification-policy-runtime.js').validateVerificationPlan(verificationPlan).pass||verificationPlan.plan_sha256!==fields.verification_plan_sha256||verificationPlan.plan_authority_sha256!==plan.plan_authority_sha256)fail('execution-verification-plan');
 const source=readRegular(path.join(workDir,'plan.md')),specBytes=readRegular(path.join(workDir,'spec.md'));
 if(journal.sha256(source)!==plan.contract_binding.source_plan_sha256||journal.sha256(source)!==approval.artifact_sha256||journal.sha256(specBytes)!==fields.spec_approved_hash||verificationPlan.spec_approved_hash!==fields.spec_approved_hash)fail('execution-source-drift');
 const policy=require('./policy-runtime.js').validateMethodologyAuthority(readJson(fields.methodology_policy_json,'execution-policy'));
 if(policy.policy_sha256!==verificationPlan.methodology_policy_sha256)fail('execution-policy-drift');
 const spec=require('./contract-runtime.js').parseSpecMarkdown(specBytes.toString(),{path:path.join(workDir,'spec.md')});
 if(require('./contract-runtime.js').specContractDigest(spec)!==verificationPlan.spec_sha256)fail('execution-spec-drift');
 const producer=journal.lookupCompletedOperation({projectCapability:transaction.projectCapabilityFor(stateCapability),sessionId:transaction.sessionIdFromState(stateCapability),operationId:approval.approval_operation_id,kind:'phase-approval'});
 if(!producer||producer.stage!=='completed-ledger'||producer.resultSha256!==journal.sha256(journal.canonicalJson(producer.result)))fail('execution-approval-producer');
 if(plan.schema_version===3&&journal.canonicalJson(producer.result.approval_binding)!==journal.canonicalJson({artifact_sha256:approval.artifact_sha256,plan_projection_sha256:fields.plan_projection_sha256,source_plan_sha256:fields.plan_source_sha256,verification_plan_sha256:fields.verification_plan_sha256,plan_authority_sha256:plan.plan_authority_sha256}))fail('execution-approval-binding');
 if(plan.schema_version===3){require('./artifact-approval-runtime.js').assertConsumption(stateCapability,'spec');require('./artifact-approval-runtime.js').assertConsumption(stateCapability,'plan');}
 const slice=sliceId?plan.slices.find(s=>s.id===sliceId):null;if(sliceId&&!slice)fail('execution-slice');
 return {plan,fields,verificationPlan,slice,workDir};
}
function earlySessionAuthority({stateCapability}){
 const reopened=require('./artifact-approval-runtime.js').reopenedAuthority(stateCapability);if(reopened)return reopened;
 const fields=transaction.readState(stateCapability);if(fields.parked===true)return{governed:true,status:'parked',archive_ref:fields.archive_ref};
 const major=Number(String(fields.created_by_version||'0').split('.')[0]);if(major<7)return null;
 if(fields.methodology_policy_json)require('./policy-runtime.js').validateMethodologyAuthority(readJson(fields.methodology_policy_json,'session-policy'));
 const early=['brainstorm','research','spec','plan'].includes(fields.current_phase);const workDir=workDirFor(stateCapability,fields);
 const history=fields.plan_bound_once===true||Boolean(fields.plan_approved||fields.plan_projection_sha256||fields.plan_source_sha256||fields.verification_plan_json||fields.verification_plan_sha256)||fs.existsSync(path.join(workDir,'plan.json'));
 if(history&&fields.plan_bound_once===false)fail('prior-plan-authority');
 if(early&&!history){if(fields.plan_bound_once!==false){const ops=journal.listCompletedOperations({projectCapability:transaction.projectCapabilityFor(stateCapability),sessionId:transaction.sessionIdFromState(stateCapability)});
 const prior=ops.some(row=>['phase-approval','functional-slice-complete-v2','outcome-slice-complete-v1','replan-trigger-record'].includes(row.kind));
 if(prior||!ops.some(row=>row.kind==='initial-repository-prepare'&&row.result?.status==='prepared'))fail('prior-plan-authority-ambiguous');}return{governed:true,status:'pre-plan',phase:fields.current_phase};}
 if(early&&history&&(!fields.plan_approved||!fs.existsSync(path.join(workDir,'plan.json')))&&fields.replan_required!==true)fail('prior-plan-authority');
 return null;
}
async function continuePhase({stateCapability,at}={}){return withWorkflowLock(stateCapability,async()=>{
 const fields=transaction.readState(stateCapability),phase=require('./phase-runtime.js'),from=fields.current_phase,to=phase.PHASE_GRAPH[from]?.[0];
 if(!to)fail('phase-transition');require('./slice-runtime.js').assertNoPendingScopedWrite(stateCapability);
 if(fields.parked===true)fail('session-parked');
 if(from==='plan')loadExecutionContext({stateCapability});
 if(from==='implement'){
  const loaded=require('./governed-context-runtime.js').loadGovernedContext({stateCapability});
  if(loaded.plan?.schema_version===3){
   // Release aggregates are produced in Test. Enter only after every source-writing
   // child has an authenticated current publication; Test still requires all rows.
   const current=loadExecutionContext({stateCapability});
   const required=current.plan.slices.filter(row=>row.slice_kind==='functional');
   const rows=loaded.projection.receipts.rows;
   if(required.some(slice=>rows.find(row=>row.slice_id===slice.id&&
       row.slice_kind==='functional')?.status!=='complete'))fail('phase-incomplete-receipts');
  }else if(loaded.projection.receipts.status!=='complete')fail('phase-incomplete-receipts');
 }
 let specCurrentSha256;if(from==='spec'){if(!fields.spec_completed_at||!fields.spec_contract_json||!fields.spec_approved_hash)fail('spec-approval-required');if(require('./artifact-approval-runtime.js').required(stateCapability))require('./artifact-approval-runtime.js').assertConsumption(stateCapability,'spec');specCurrentSha256=journal.sha256(readRegular(path.join(workDirFor(stateCapability,fields),'spec.md')));if(specCurrentSha256!==fields.spec_approved_hash)fail('spec-approval-stale');}
 const next=phase.advancePhase({state:{...fields,...(specCurrentSha256?{spec_current_sha256:specCurrentSha256}:{})},from,to,at});
 const operation=await journal.beginOperation({projectCapability:transaction.projectCapabilityFor(stateCapability),sessionId:transaction.sessionIdFromState(stateCapability),kind:'phase-checkpoint',preconditions:{action:'continue',from,to,stateSha256:journal.sha256(fs.readFileSync(stateCapability.path))}});
 const text=frontmatter.updateFrontmatterText(fs.readFileSync(stateCapability.path,'utf8'),next);platform.atomicWriteFile(stateCapability,text);
 await journal.recordOperationStage(operation,'state-written',{owned:{postStateSha256:journal.sha256(text)}});await journal.completeOperation(operation,{from,to,postStateSha256:journal.sha256(text)});return{from,to};
 });}
module.exports={currentVersion,reserveM3RunId,workflowLocks,withWorkflowLock,loadExecutionContext,earlySessionAuthority,continuePhase,workDirFor,readRegular};
