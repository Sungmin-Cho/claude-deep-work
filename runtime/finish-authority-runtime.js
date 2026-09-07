'use strict';
const fs=require('node:fs'),path=require('node:path');
const j=require('./operation-journal.js'),tx=require('./transaction-runtime.js');
function fail(code){throw Object.assign(new Error(`[${code}]`),{code});}
function same(a,b){return j.canonicalJson(a)===j.canonicalJson(b);}
function finishOperationId(kind,preconditions){return `op-${j.sha256(j.canonicalJson({kind,...preconditions}))}`;}
async function resume(projectCapability,sessionId,kind,operationId){try{return await j.resumeOperation({projectCapability,sessionId,kind,operationId});}catch(error){if(error.code==='operation-not-found')return null;throw error;}}
async function resolveFinishOperation({projectCapability,sessionId,outcome,request,captureAuthority}){
 const kind=`finish-${outcome}`,requestSha256=j.sha256(j.canonicalJson(request));
 // Historical operations remain addressable by the old stable request ID.
 const legacyId=finishOperationId(kind,request),legacy=await resume(projectCapability,sessionId,kind,legacyId);
 if(legacy)return{operationId:legacyId,preconditions:request,pending:legacy,requestSha256};
 const matches=[];
 for(const row of j.listCompletedOperations({projectCapability,sessionId,kind})){if(row.result?.request_sha256!==requestSha256)continue;
  const preconditions={...request,request_sha256:requestSha256,finish_authority:row.result.finish_authority};
  if(row.resultSha256!==j.sha256(j.canonicalJson(row.result))||row.operationId!==finishOperationId(kind,preconditions))fail('finish-authority-operation');
  matches.push({operationId:row.operationId,preconditions,pending:row,requestSha256});}
 const prefix=`deep-work.${sessionId}.op.${kind}.`,directory=path.join(projectCapability.path,'.claude');
 for(const name of fs.readdirSync(directory)){if(!name.startsWith(prefix)||!name.endsWith('.json'))continue;const operationId=name.slice(prefix.length,-5);if(!/^op-[a-f0-9]{64}$/.test(operationId))continue;
  const row=await resume(projectCapability,sessionId,kind,operationId);if(row?.stage==='completed-ledger'||row?.preconditions?.request_sha256!==requestSha256)continue;
  const preconditions=row.preconditions;if(!same({...request,request_sha256:requestSha256,finish_authority:preconditions.finish_authority},preconditions)||finishOperationId(kind,preconditions)!==operationId)fail('finish-authority-operation');
  matches.push({operationId,preconditions,pending:row,requestSha256});}
 if(matches.length>1)fail('finish-authority-ambiguous');if(matches.length)return matches[0];
 const finishAuthority=await captureAuthority(),preconditions={...request,request_sha256:requestSha256,finish_authority:finishAuthority};
 return{operationId:finishOperationId(kind,preconditions),preconditions,pending:null,requestSha256};
}
async function repositorySnapshot({stateCapability,projectCapability,fields,gitRunner}){
 const run=gitRunner||((args)=>require('./git-runtime.js').gitCapability(projectCapability).run(args));
 const read=async(args,optional=false)=>{const result=await run(args);if(!result?.ok){if(optional)return null;fail('finish-repository-snapshot');}return String(result.stdout||'').trim();};
 if(!fs.existsSync(path.join(projectCapability.path,'.git'))){if(fields.worktree_enabled)fail('finish-repository-snapshot');return{kind:'none',project_root:fs.realpathSync(projectCapability.path)};}
 const base=fields.parent_branch||fields.base_branch||null,child=fields.worktree_enabled?fields.branch:null;
 const snapshot={head:await read(['rev-parse','--verify','HEAD^{commit}']),branch:await read(['symbolic-ref','--short','HEAD'],true),
  index_sha256:j.sha256(await read(['ls-files','--stage','-z'])),origin_sha256:null,base_branch:base,base_head:base?await read(['rev-parse','--verify',`refs/heads/${base}^{commit}`]):null,
  child_branch:child,child_head:child?await read(['rev-parse','--verify',`refs/heads/${child}^{commit}`]):null,worktree_path:fields.worktree_enabled?fields.worktree_path:null};
 const origin=await read(['remote','get-url','origin'],true);snapshot.origin_sha256=origin===null?null:j.sha256(origin);
 if(snapshot.worktree_path){require('./git-runtime.js').resolveForkWorktreeCapability({projectCapability,stateCapability,sessionId:tx.sessionIdFromState(stateCapability),comparisonPath:snapshot.worktree_path});snapshot.child_source_sha256=require('./session-maintenance-runtime.js').sourceFingerprint({role:'session-state',path:stateCapability.path,projectRoot:snapshot.worktree_path}).sha256;}
 return snapshot;
}
function recordedOutcome(outcome,pending){const names=new Set((pending.stages||[]).map(row=>row.stage));return names.has('effect-recorded')||
 outcome==='publish-pr'&&names.has('pull-request-created')||outcome==='merge'&&names.has('merge-completed')||outcome==='discard'&&names.has('worktree-removed');}
function hasCallIntent(pending){return(pending.stages||[]).some(row=>/^before-call(?:-\d+)?$/.test(row.stage));}
function readOnlyCall({transport,args}){if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))return false;if(transport==='gh')return args[0]==='auth'&&args[1]==='status'||args[0]==='pr'&&args[1]==='list';
 let a=args;if(a[0]==='-C')a=a.slice(2);return['rev-parse','show-ref','show','status','diff','ls-files','ls-remote','check-ref-format'].includes(a[0])||a[0]==='symbolic-ref'&&a[1]==='--short'&&a.length===3||a[0]==='remote'&&a[1]==='get-url'||a[0]==='worktree'&&a[1]==='list';}
function cleanupCall(outcome,{transport,args}){if(transport!=='git')return false;let a=args;if(a[0]==='-C')a=a.slice(2);return['merge','discard'].includes(outcome)&&(a[0]==='worktree'&&a[1]==='remove'||a[0]==='branch'&&['-d','-D'].includes(a[1]));}
function ownedBaseSwitch(pending,expected,current){const inspection=pending.stages?.find(row=>row.stage==='finish-inspected')?.details?.owned;
 if(!inspection||inspection.currentBranch===inspection.baseBranch||expected.branch!==inspection.currentBranch)return false;
 if(current.branch!==inspection.baseBranch||current.head!==inspection.baseHead)return false;
 return pending.stages.some(row=>row.stage==='before-call-0'&&row.details?.owned?.args?.[0]==='switch');}
function normalizedRepository(current,expected,pending,projectCapability,sessionId){const result=structuredClone(current),inspection=pending.stages?.find(row=>row.stage==='finish-inspected')?.details?.owned;
 if(ownedBaseSwitch(pending,expected,result)){result.branch=expected.branch;result.head=expected.head;result.index_sha256=expected.index_sha256;}
 if(inspection?.childDirty&&result.child_branch===expected.child_branch){const own=j.listCompletedOperations({projectCapability,sessionId,kind:'fork-precommit'}).filter(row=>row.result?.parentOperationId===pending.operationId&&row.result?.parent===expected.child_head&&row.result?.commitOid===result.child_head&&row.resultSha256===j.sha256(j.canonicalJson(row.result)));if(own.length===1)result.child_head=expected.child_head;}
 return result;
}
async function verifyAuthority({expected,current,pending,projectCapability,sessionId}){const a={...current},b={...expected};a.repository=normalizedRepository(a.repository,b.repository,pending,projectCapability,sessionId);
 if(ownedBaseSwitch(pending,b.repository,current.repository))a.source_sha256=b.source_sha256;
 if(!same(a,b))fail('finish-pre-action-authority-drift');}
async function mergeRollbackSnapshot({stateCapability,projectCapability,gitRunner}){
 const run=gitRunner||((args)=>require('./git-runtime.js').gitCapability(projectCapability).run(args));
 const read=async args=>{const result=await run(args);if(!result?.ok)fail('finish-rollback-snapshot-unavailable');return String(result.stdout||'');};
 const head=(await read(['rev-parse','--verify','HEAD^{commit}'])).trim(),mergeHead=(await read(['rev-parse','--verify','MERGE_HEAD'])).trim(),branch=(await read(['symbolic-ref','--short','HEAD'])).trim();
 if(!/^[a-f0-9]{40,64}$/.test(head)||!/^[a-f0-9]{40,64}$/.test(mergeHead)||!branch)fail('finish-rollback-snapshot-unavailable');
 return{schema_version:1,project_root:fs.realpathSync(projectCapability.path),head,merge_head:mergeHead,branch,index_sha256:j.sha256(await read(['ls-files','--stage','-z'])),status_sha256:j.sha256(await read(['status','--porcelain=v1','-z'])),source_sha256:require('./session-maintenance-runtime.js').sourceFingerprint(stateCapability).sha256};
}
async function authorizeOwnedMergeAbort({operation,pending,expected,captureRollback}){
 const inspected=pending.stages?.find(row=>row.stage==='finish-inspected')?.details?.owned;
 const intent=pending.stages?.find(row=>row.stage==='before-call-1')?.details?.owned;
 const conflict=pending.stages?.find(row=>row.stage==='merge-conflict')?.details?.owned;
 const observed=conflict?.rollback_authority;
 if(pending.kind!=='finish-merge'||recordedOutcome('merge',pending)||!expected||typeof captureRollback!=='function'||inspected?.status!=='managed-worktree'||!intent||!observed||observed.operation_id!==operation.operationId)fail('finish-rollback-authority-required');
 const args=['merge','--no-ff','-m',`deep-work merge: ${operation.sessionId}`,inspected.branch];
 if(!same(intent.args,args)||intent.baseHead!==inspected.baseHead||expected.repository.base_head!==inspected.baseHead||expected.repository.child_branch!==inspected.branch)fail('finish-rollback-identity');
 let expectedChild=expected.repository.child_head;
 const own=j.listCompletedOperations({projectCapability:operation.projectCapability,sessionId:operation.sessionId,kind:'fork-precommit'}).filter(row=>row.result?.parentOperationId===operation.operationId&&row.result?.parent===expectedChild&&row.result?.commitOid===intent.childHead&&row.resultSha256===j.sha256(j.canonicalJson(row.result)));
 if(intent.childHead!==expectedChild&&own.length!==1)fail('finish-rollback-identity');
 const snapshot=observed.snapshot;
 if(snapshot?.schema_version!==1||snapshot.project_root!==fs.realpathSync(operation.projectCapability.path)||snapshot.head!==inspected.baseHead||snapshot.merge_head!==intent.childHead||snapshot.branch!==inspected.baseBranch||snapshot.status_sha256!==conflict.statusSha256)fail('finish-rollback-identity');
 const current=await captureRollback();if(!same(snapshot,current))fail('finish-rollback-authority-drift');
}
async function preEffectGuard({operation,outcome,prepared,captureAuthority,legacyGit,captureRollback}){
 const {projectCapability,sessionId}=operation;let pending=await j.resumeOperation({...operation});
 const bound=pending.preconditions?.finish_authority;if(bound&&!same(prepared.finish_authority,bound)||!bound&&prepared.finish_authority!==undefined)fail('finish-authority-prepared');
 let expected=bound||pending.stages?.find(row=>row.stage==='gate-checked')?.details?.owned?.finish_authority;
 const verify=async()=>{const current=await captureAuthority();if(!expected){if(current.governed_projection_sha256!==prepared.projection_sha256||!same(legacyGit(),prepared.git))fail('finish-pre-action-authority-drift');expected=current;await j.recordOperationStage(operation,'gate-checked',{owned:{finish_authority:expected,legacy_revalidated:true}});}await verifyAuthority({expected,current,pending,projectCapability,sessionId});};
 if(!recordedOutcome(outcome,pending)&&!hasCallIntent(pending))await verify();
 return async call=>{if(readOnlyCall(call))return;pending=await j.resumeOperation({...operation});
  if(outcome==='merge'&&call.transport==='git'&&same(call.args,['merge','--abort']))return authorizeOwnedMergeAbort({operation,pending,expected,captureRollback});
  if(recordedOutcome(outcome,pending)){if(!cleanupCall(outcome,call))fail('finish-effect-already-recorded');return;}
  await verify();
 };
}
module.exports={mergeRollbackSnapshot,authorizeOwnedMergeAbort,resolveFinishOperation,repositorySnapshot,preEffectGuard,recordedOutcome,readOnlyCall,verifyAuthority,finishOperationId};
