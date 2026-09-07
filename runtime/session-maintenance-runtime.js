'use strict';
const fs=require('node:fs'),path=require('node:path');const platform=require('./platform.js'),tx=require('./transaction-runtime.js'),journal=require('./operation-journal.js'),workflow=require('./workflow-runtime.js'),fm=require('./frontmatter.js');
function fail(code){throw Object.assign(new Error(`[${code}]`),{code});}
function capability(state,target,missing=false){if(platform.isPathInside(path.join(state.projectRoot,'.claude'),target))return platform.issueProjectStateCapability(state.projectRoot,target,{role:'state',allowMissingLeaf:missing});const work=workflow.workDirFor(state,tx.readState(state));const session=platform.issueProjectStateCapability(state.projectRoot,work,{role:'session-work-dir',sessionStateCapability:state});return tx.issueSessionFileCapability({sessionCapability:session,candidate:target,allowMissingLeaf:missing});}
function write(cap,bytes){return cap.kind==='session-file-capability'?tx.atomicWriteSessionFile(cap,bytes):platform.atomicWriteFile(cap,bytes);}
function sourceFingerprint(state,outputs=[]){const root=state.projectRoot,id=tx.sessionIdFromState(state),rows=[];
 function walk(dir,relative=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=relative?relative+'/'+entry.name:entry.name;
 if(p==='.git'||p===`.deep-work/${id}`||p.startsWith('.claude/deep-work.')||p.startsWith('.claude/deep-work-')||outputs.some(o=>p===o||p.startsWith(o+'/')))continue;
 const full=path.join(dir,entry.name),stat=fs.lstatSync(full);if(stat.isSymbolicLink())rows.push({path:p,link:fs.readlinkSync(full)});else if(stat.isDirectory())walk(full,p);else if(stat.isFile())rows.push({path:p,sha256:journal.sha256(fs.readFileSync(full)),mode:stat.mode&511});else fail('source-special-file');}}
 walk(root);return{rows,sha256:journal.sha256(journal.canonicalJson(rows))};}
function resolveManager(name){for(const dir of (process.env.PATH||'').split(path.delimiter)){if(!dir)continue;const file=path.join(dir,name+(process.platform==='win32'?'.exe':''));try{fs.accessSync(file,fs.constants.X_OK);const actual=fs.realpathSync(file),stat=fs.statSync(actual);if(stat.isFile())return{path:actual,sha256:journal.sha256(fs.readFileSync(actual))};}catch{}}fail('environment-manager-unavailable');}
function explainEnvironment({stateCapability,manager}){if(!['npm','uv'].includes(manager))fail('environment-manager');const fields=tx.readState(stateCapability);if(fields.parked)fail('session-parked');
 require('./slice-runtime.js').assertNoPendingScopedWrite(stateCapability);const files=manager==='npm'?['package.json','package-lock.json']:['pyproject.toml','uv.lock'];
 const manifests=files.map(file=>({path:file,sha256:journal.sha256(workflow.readRegular(path.join(stateCapability.projectRoot,file)))}));
 const identity=resolveManager(manager);if(manager==='npm')identity.node={path:fs.realpathSync(process.execPath),sha256:journal.sha256(fs.readFileSync(fs.realpathSync(process.execPath))),version:process.versions.node};const args=manager==='npm'?['ci','--ignore-scripts','--no-audit','--no-fund']:['sync','--frozen','--no-install-project'];
 const outputs=manager==='npm'?['node_modules']:['.venv'];const value={schema_version:1,session_id:fields.session_id,manager,identity,args,manifests,outputs,source_sha256:sourceFingerprint(stateCapability,outputs).sha256};
 return{...value,prepared_sha256:journal.sha256('environment-preparation-v1\0'+journal.canonicalJson(value))};}
async function prepareEnvironment({stateCapability,preparedDigest}){return workflow.withWorkflowLock(stateCapability,async()=>{let descriptor;
 for(const manager of ['npm','uv']){try{const candidate=explainEnvironment({stateCapability,manager});if(candidate.prepared_sha256===preparedDigest)descriptor=candidate;}catch{}}
 if(!descriptor)fail('environment-prepared-drift');const fields=tx.readState(stateCapability),project=tx.projectCapabilityFor(stateCapability);
 const operation=await journal.beginOperation({projectCapability:project,sessionId:fields.session_id,kind:'environment-preparation-v1',preconditions:descriptor});
 
 const control=path.join(workflow.workDirFor(stateCapability,fields),'.environment',operation.operationId);for(const name of ['home','tmp','cache'])fs.mkdirSync(path.join(control,name),{recursive:true});
 const environment={PATH:process.env.PATH||'',HOME:path.join(control,'home'),TMPDIR:path.join(control,'tmp'),LANG:'C',LC_ALL:'C',TZ:'UTC',npm_config_cache:path.join(control,'cache'),npm_config_update_notifier:'false',UV_CACHE_DIR:path.join(control,'cache'),UV_PYTHON_DOWNLOADS:'never'};
 const result=await require('./process-supervisor.js').runSupervisedProcess({executable:descriptor.identity.node?.path||descriptor.identity.path,args:descriptor.identity.node?[descriptor.identity.path,...descriptor.args]:descriptor.args},{cwd:stateCapability.projectRoot,env:environment,timeoutMs:300000,maxOutputBytes:1048576,rawOutput:true});
 await journal.recordOperationStage(operation,'process-completed',{owned:{exit_code:result.exitCode,stdout_sha256:journal.sha256(result.stdout),stderr_sha256:journal.sha256(result.stderr)}});
 const sourceAfter=sourceFingerprint(stateCapability,descriptor.outputs).sha256,drift=sourceAfter!==descriptor.source_sha256;
 const receipt={schema_version:1,session_id:fields.session_id,operation_id:operation.operationId,prepared_sha256:descriptor.prepared_sha256,manager:descriptor.manager,source_before:descriptor.source_sha256,source_after:sourceAfter,status:drift?'needs-replan':result.exitCode===0&&!result.timedOut&&!result.outputOverflow?'prepared':'failed',exit_code:result.exitCode};
 const target=path.join(workflow.workDirFor(stateCapability,fields),`environment-${operation.operationId}.json`);write(capability(stateCapability,target,true),journal.canonicalJson(receipt));
 if(fields.plan_bound_once===true||drift)write(stateCapability,fm.updateFrontmatterText(fs.readFileSync(stateCapability.path,'utf8'),{replan_required:true,replan_reason:drift?'environment-source-drift':'dependency-identity-change'}));
 await journal.recordOperationStage(operation,'result-published',{owned:{path:target,sha256:journal.sha256(journal.canonicalJson(receipt))}});await journal.completeOperation(operation,receipt);return receipt;});}
function maintenanceLocks(state){const root=state.projectRoot,locks=workflow.workflowLocks(state),p=name=>platform.issueProjectStateCapability(root,path.join(root,'.claude',name),{role:'lock',allowMissingLeaf:true});
 return [locks[0],locks[1],{rank:tx.RANKS.pointer,capability:p('deep-work-current-session.lock')},{rank:tx.RANKS.registry,capability:p('deep-work-sessions.json.lock')},locks[2]];}
function registryPaths(state){return{registry:path.join(state.projectRoot,'.claude','deep-work-sessions.json'),pointer:path.join(state.projectRoot,'.claude','deep-work-current-session')};}
function assertNoProcess(state){const dir=path.join(state.projectRoot,'.claude'),id=tx.sessionIdFromState(state);for(const name of fs.readdirSync(dir)){if(!name.startsWith(`deep-work.${id}.`)||!name.endsWith('.json')||name.includes('completed-operations'))continue;let row;try{row=JSON.parse(workflow.readRegular(path.join(dir,name)));}catch{continue;}if(row.operationId&&/review-execution-run|outcome-check-run|verification-run|sensor-run|environment-preparation/.test(row.kind||''))fail('session-owned-process-pending');}}
async function parkSession({stateCapability,sessionId,seam}){return tx.withRankedLocks(maintenanceLocks(stateCapability),async()=>{
 const text=fs.readFileSync(stateCapability.path,'utf8'),fields=fm.parseFrontmatter(text).fields;if(fields.session_id!==sessionId)fail('session-state-identity');if(fields.parked===true){const ref=JSON.parse(fields.archive_ref),archive=workflow.readRegular(path.join(stateCapability.projectRoot,ref.path));if(journal.sha256(archive)!==ref.sha256)fail('session-archive-authority');const operation={projectCapability:tx.projectCapabilityFor(stateCapability),sessionId,kind:'session-park-v1',operationId:ref.producer_operation_id};const prior=await journal.resumeOperation(operation);if(prior.stage==='completed-ledger'){if(prior.result?.ref?.sha256!==ref.sha256)fail('session-archive-authority');return{status:'parked',archive_ref:ref};}if(prior.preconditions.state_sha256!==ref.sha256||sourceFingerprint(stateCapability).sha256!==prior.preconditions.source_sha256)fail('session-park-replay-drift');const paths=registryPaths(stateCapability),registry=JSON.parse(workflow.readRegular(paths.registry));delete registry.sessions[sessionId];write(capability(stateCapability,paths.registry),JSON.stringify(registry)+'\n');if(fs.existsSync(paths.pointer)&&fs.readFileSync(paths.pointer,'utf8').trim()===sessionId)fs.unlinkSync(paths.pointer);await journal.recordOperationStage(operation,'state-written',{owned:ref});await journal.recordOperationStage(operation,'registry-written',{owned:{session_id:sessionId}});await journal.completeOperation(operation,{status:'parked',ref,source_sha256:prior.preconditions.source_sha256,registry_row:prior.preconditions.registry_row});return{status:'parked',archive_ref:ref};}
 require('./slice-runtime.js').assertNoPendingScopedWrite(stateCapability);assertNoProcess(stateCapability);const fingerprint=sourceFingerprint(stateCapability),paths=registryPaths(stateCapability),registry=JSON.parse(workflow.readRegular(paths.registry)),row=registry.sessions[sessionId];if(!row)fail('registry-session-missing');
 const operation=await journal.beginOperation({projectCapability:tx.projectCapabilityFor(stateCapability),sessionId,kind:'session-park-v1',preconditions:{state_sha256:journal.sha256(text),source_sha256:fingerprint.sha256,registry_row:row}});
 const archive=path.join(workflow.workDirFor(stateCapability,fields),`parked-${operation.operationId}.md`),ref={path:path.relative(stateCapability.projectRoot,archive).split(path.sep).join('/'),sha256:journal.sha256(text),producer_operation_id:operation.operationId};
 write(capability(stateCapability,archive,true),text);await journal.recordOperationStage(operation,'archive-written',{owned:ref});
 write(stateCapability,fm.updateFrontmatterText('',{schema_version:fields.schema_version,session_id:sessionId,created_by_version:fields.created_by_version,current_phase:'idle',work_dir:fields.work_dir,parked:true,archive_ref:journal.canonicalJson(ref)}));await journal.recordOperationStage(operation,'state-written',{owned:ref});seam?.('after-state-written');
 delete registry.sessions[sessionId];write(capability(stateCapability,paths.registry),JSON.stringify(registry)+'\n');if(fs.existsSync(paths.pointer)&&fs.readFileSync(paths.pointer,'utf8').trim()===sessionId)fs.unlinkSync(paths.pointer);
 await journal.recordOperationStage(operation,'registry-written',{owned:{session_id:sessionId}});await journal.completeOperation(operation,{status:'parked',ref,source_sha256:fingerprint.sha256,registry_row:row});return{status:'parked',archive_ref:ref};});}
function assertRestoreCompatibility(fields,workDir){
 const parse=value=>{if(typeof value!=='string'||!/^\d+\.\d+\.\d+$/.test(value))fail('session-reader-unavailable');return value.split('.').map(Number);};
 const current=parse(workflow.currentVersion()),writer=parse(fields.created_by_version);const newer=writer.some((n,i)=>n>current[i]&&writer.slice(0,i).every((v,j)=>v===current[j]));
 if(newer)fail('session-reader-unavailable');if(![1,2].includes(fields.schema_version))fail('session-schema-unavailable');
 if(fields.methodology_policy_json)try{require('./policy-runtime.js').validateMethodologyAuthority(JSON.parse(fields.methodology_policy_json));}catch{fail('session-policy-unavailable');}
 const planPath=path.join(workDir,'plan.json');if(fs.existsSync(planPath)){const plan=JSON.parse(workflow.readRegular(planPath));if(![1,2,3].includes(plan.schema_version))fail('session-plan-schema-unavailable');
  if(plan.contract_binding?.created_by_version){const version=parse(plan.contract_binding.created_by_version);if(version.some((n,i)=>n>current[i]&&version.slice(0,i).every((v,j)=>v===current[j])))fail('session-reader-unavailable');}
  require('./plan-runtime.js').validatePlanScopeV1(plan);for(const slice of plan.slices||[])if(slice.verification_spec?.schema_version===2){const policy=require('./node-tap-policy.js').resolveNodeTapPolicy({policySha256:slice.verification_spec.executable.supported_patches_sha256,nodeVersion:process.versions.node});if(policy.reason==='unknown-policy')fail('session-policy-unavailable');}}
 if(fields.verification_plan_json&&!require('./verification-policy-runtime.js').validateVerificationPlan(JSON.parse(fields.verification_plan_json)).pass)fail('session-verification-schema-unavailable');
 for(const dir of ['receipts','runtime-receipts']){const target=path.join(workDir,dir);if(!fs.existsSync(target))continue;for(const name of fs.readdirSync(target)){if(!/^SLICE-\d{3}\.json$/.test(name))continue;const value=JSON.parse(workflow.readRegular(path.join(target,name)));if(value.envelope){if(value.schema_version!=='1.0'||!['1.0','1.1'].includes(value.envelope.schema?.version)||value.payload?.schema_version!==value.envelope.schema.version)fail('session-receipt-schema-unavailable');}else if(![1,2,3,'1.0'].includes(value.schema_version))fail('session-receipt-schema-unavailable');}}
}
async function restorePreplanSourceDrift({stateCapability,sessionId,ref,bytes,parking,source,operation,seam}){
 const original=fm.parseFrontmatter(bytes.toString()).fields;if(original.plan_bound_once!==false||original.plan_approved||original.verification_plan_json||original.plan_projection_sha256)fail('session-restore-prior-plan-ambiguous');
 const project=tx.projectCapabilityFor(stateCapability),paths=registryPaths(stateCapability),pointer=fs.existsSync(paths.pointer)?fs.readFileSync(paths.pointer,'utf8').trim():null;if(pointer&&pointer!==sessionId)fail('session-restore-pointer-conflict');
 if(!operation)operation=await journal.beginOperation({projectCapability:project,sessionId,kind:'session-restore-v1',preconditions:{mode:'pre-plan-source-drift',ref,source_sha256:source.sha256,prior_source_sha256:parking.result.source_sha256}});
 const pending=await journal.resumeOperation(operation);if(pending.stage==='completed-ledger')return{status:'review-required',adopted:true};if(source.sha256!==pending.preconditions.source_sha256)fail('session-restore-replay-source-drift');
 const next=fm.updateFrontmatterText(bytes.toString(),{parked:false,archive_ref:journal.canonicalJson(ref),restore_operation_id:operation.operationId,restore_state:'review-required',current_phase:'research',active_slice:null,tdd_state:'PENDING',replan_required:false,spec_completed_at:null,spec_approved_hash:null,spec_contract_json:null,spec_gate_result_json:null,test_passed:false,test_pass_operation_id:null,review_execution_json:'{}',finished_at:null,finish_outcome:null});
 const current=fs.readFileSync(stateCapability.path,'utf8');if(tx.readState(stateCapability).parked===true)write(stateCapability,next);else if(current!==next)fail('session-restore-state-drift');seam?.('after-restore-replan-state');
 await journal.recordOperationStage(operation,'state-written',{owned:{ref,post_state_sha256:journal.sha256(next)}});const registry=JSON.parse(workflow.readRegular(paths.registry)),row={...parking.result.registry_row,current_phase:'research'};if(registry.sessions[sessionId]&&journal.canonicalJson(registry.sessions[sessionId])!==journal.canonicalJson(row))fail('registry-session-exists');registry.sessions[sessionId]=row;write(capability(stateCapability,paths.registry),JSON.stringify(registry)+'\n');write(capability(stateCapability,paths.pointer,true),sessionId+'\n');await journal.recordOperationStage(operation,'registry-written',{owned:{session_id:sessionId}});await journal.completeOperation(operation,{status:'review-required',ref,source_sha256:source.sha256,post_state_sha256:journal.sha256(next)});return{status:'review-required'};
}
async function restoreSourceDrift({stateCapability,sessionId,ref,bytes,parking,source,operation,seam}){
 const fields=fm.parseFrontmatter(bytes.toString()).fields,work=workflow.workDirFor(stateCapability,tx.readState(stateCapability));assertRestoreCompatibility(fields,work);
 if(fields.plan_bound_once!==true)return restorePreplanSourceDrift({stateCapability,sessionId,ref,bytes,parking,source,operation,seam});
 const plan=JSON.parse(workflow.readRegular(path.join(work,'plan.json'))),project=tx.projectCapabilityFor(stateCapability),paths=registryPaths(stateCapability);
 const pointer=fs.existsSync(paths.pointer)?fs.readFileSync(paths.pointer,'utf8').trim():null;if(pointer&&pointer!==sessionId)fail('session-restore-pointer-conflict');
 if(!operation)operation=await journal.beginOperation({projectCapability:project,sessionId,kind:'session-restore-v1',preconditions:{mode:'source-drift',ref,source_sha256:source.sha256,prior_source_sha256:parking.result.source_sha256,plan_authority_sha256:plan.plan_authority_sha256}});
 const pending=await journal.resumeOperation(operation);if(pending.stage==='completed-ledger')return{status:'replan-required',adopted:true,replan_epoch:pending.result.replan_epoch};
 if(source.sha256!==pending.preconditions.source_sha256)fail('session-restore-replay-source-drift');
 const prepared=await require('./replan-runtime.js').prepareRestoreReplanAuthority({stateCapability,plan,restoreOperationId:operation.operationId});
 if(tx.readState(stateCapability).parked===true){const patch={...prepared.statePatch,restore_state:'replan-pending',current_phase:'spec',active_slice:null,tdd_state:'PENDING',replan_required:true,active_replan_trigger_id:prepared.trigger.trigger_id,active_replan_epoch_id:null,active_replan_epoch_json:null,test_passed:false,spec_completed_at:null,spec_approved_hash:null,spec_contract_json:null,plan_approved:null,verification_plan_json:null,verification_plan_sha256:null};write(stateCapability,fm.updateFrontmatterText(bytes.toString(),patch));seam?.('after-restore-replan-state');}
 const recovery=await require('./replan-runtime.js').recordPreparedReplan({stateCapability,plan,sliceId:null,prepared,_lockHeld:true});seam?.('after-restore-replan-epoch');
 await journal.recordOperationStage(operation,'state-written',{owned:{ref,replan_epoch:recovery.replan_epoch}});
 const registry=JSON.parse(workflow.readRegular(paths.registry)),row={...parking.result.registry_row,current_phase:'spec'};if(registry.sessions[sessionId]&&journal.canonicalJson(registry.sessions[sessionId])!==journal.canonicalJson(row))fail('registry-session-exists');registry.sessions[sessionId]=row;write(capability(stateCapability,paths.registry),JSON.stringify(registry)+'\n');write(capability(stateCapability,paths.pointer,true),sessionId+'\n');
 await journal.recordOperationStage(operation,'registry-written',{owned:{session_id:sessionId}});const result={status:'replan-required',ref,replan_epoch:recovery.replan_epoch,source_sha256:source.sha256,post_state_sha256:journal.sha256(fs.readFileSync(stateCapability.path))};await journal.completeOperation(operation,result);return{status:result.status,replan_epoch:result.replan_epoch};
}

function assertRestorePointerAvailable(stateCapability,sessionId){
 const paths=registryPaths(stateCapability);
 const selected=fs.existsSync(paths.pointer)?workflow.readRegular(paths.pointer).toString().trim():null;
 if(selected&&selected!==sessionId)fail('session-restore-pointer-conflict');
 return paths;
}
function assertRestoredPlanAuthority(stateCapability,fields){
 if(fields.plan_bound_once!==true||fields.replan_required===true)return;
 const work=workflow.workDirFor(stateCapability,fields),plan=JSON.parse(workflow.readRegular(path.join(work,'plan.json'))),verification=JSON.parse(fields.verification_plan_json);
 if(!require('./verification-policy-runtime.js').validateVerificationPlan(verification).pass||verification.plan_sha256!==fields.verification_plan_sha256||require('./plan-runtime.js').compileImmutablePlanAuthority(plan).plan_authority_sha256!==verification.plan_authority_sha256||journal.sha256(workflow.readRegular(path.join(work,'spec.md')))!==verification.spec_approved_hash||journal.sha256(workflow.readRegular(path.join(work,'plan.md')))!==verification.source_plan_sha256)fail('session-restore-authority-drift');
}
async function resumeUnchangedRestore({stateCapability,sessionId,fields}){
 const digest=journal.sha256(fs.readFileSync(stateCapability.path)),project=tx.projectCapabilityFor(stateCapability);
 const completed=journal.listCompletedOperations({projectCapability:project,sessionId,kind:'session-restore-v1'}).find(row=>row.result?.ref?.sha256===digest);
 if(completed){assertRestoreCompatibility(fields,workflow.workDirFor(stateCapability,fields));return{status:'restored',adopted:true};}
 const control=path.join(stateCapability.projectRoot,'.claude');
 const pending=fs.readdirSync(control).filter(name=>name.startsWith(`deep-work.${sessionId}.op.session-restore-v1.`)&&name.endsWith('.json')).map(name=>{const value=JSON.parse(workflow.readRegular(path.join(control,name)));if(name!==`deep-work.${sessionId}.op.session-restore-v1.${value.operationId}.json`||value.sessionId!==sessionId||value.kind!=='session-restore-v1')fail('session-restore-operation-authority');return value;}).filter(row=>row.preconditions?.ref?.sha256===digest);
 if(pending.length!==1)fail('session-not-parked');
 const prior=pending[0],ref=prior.preconditions.ref,park=journal.lookupCompletedOperation({projectCapability:project,sessionId,operationId:ref.producer_operation_id,kind:'session-park-v1'});
 if(park?.result?.ref?.sha256!==digest||park.result.ref.path!==ref.path)fail('session-archive-authority');
 const preconditions={ref,source_sha256:park.result.source_sha256};
 if(journal.canonicalJson(prior.preconditions)!==journal.canonicalJson(preconditions))fail('session-restore-operation-authority');
 if(sourceFingerprint(stateCapability).sha256!==preconditions.source_sha256)fail('session-restore-source-drift-replan-required');
 assertRestoreCompatibility(fields,workflow.workDirFor(stateCapability,fields));
 assertRestoredPlanAuthority(stateCapability,fields);
 const paths=assertRestorePointerAvailable(stateCapability,sessionId),registry=JSON.parse(workflow.readRegular(paths.registry));
 if(registry.sessions[sessionId]&&journal.canonicalJson(registry.sessions[sessionId])!==journal.canonicalJson(park.result.registry_row))fail('registry-session-exists');
 // Re-admit the exact existing journal before the first registry/pointer write.
 // resumeOperation alone returns pending JSON and does not validate its shape.
 const operation=await journal.beginOperation({projectCapability:project,sessionId,kind:'session-restore-v1',operationId:prior.operationId,preconditions});
 registry.sessions[sessionId]=park.result.registry_row;
 write(capability(stateCapability,paths.registry),JSON.stringify(registry)+'\n');write(capability(stateCapability,paths.pointer,true),sessionId+'\n');
 await journal.recordOperationStage(operation,'state-written',{owned:ref});await journal.recordOperationStage(operation,'registry-written',{owned:{session_id:sessionId}});
 await journal.completeOperation(operation,{status:'restored',ref});return{status:'restored',adopted:true};
}
async function restoreSession({stateCapability,sessionId,seam}){
 return tx.withRankedLocks(maintenanceLocks(stateCapability),async()=>{
  const fields=tx.readState(stateCapability);if(fields.session_id!==sessionId)fail('session-state-identity');
  if(fields.restore_operation_id){
   const operation={projectCapability:tx.projectCapabilityFor(stateCapability),sessionId,kind:'session-restore-v1',operationId:fields.restore_operation_id},pending=await journal.resumeOperation(operation),ref=pending.stage==='completed-ledger'?pending.result.ref:pending.preconditions.ref,bytes=workflow.readRegular(path.join(stateCapability.projectRoot,ref.path)),parking=journal.lookupCompletedOperation({projectCapability:tx.projectCapabilityFor(stateCapability),sessionId,operationId:ref.producer_operation_id,kind:'session-park-v1'});
   if(journal.sha256(bytes)!==ref.sha256||parking?.result?.ref?.sha256!==ref.sha256)fail('session-archive-authority');
   assertRestoreCompatibility(fm.parseFrontmatter(bytes.toString()).fields,workflow.workDirFor(stateCapability,fields));
   return restoreSourceDrift({stateCapability,sessionId,ref,bytes,parking,source:sourceFingerprint(stateCapability),operation,seam});
  }
  if(fields.parked!==true)return resumeUnchangedRestore({stateCapability,sessionId,fields});
  const ref=JSON.parse(fields.archive_ref),archivePath=path.join(stateCapability.projectRoot,ref.path);capability(stateCapability,archivePath);const bytes=workflow.readRegular(archivePath);
  const producer=journal.lookupCompletedOperation({projectCapability:tx.projectCapabilityFor(stateCapability),sessionId,operationId:ref.producer_operation_id,kind:'session-park-v1'});
  if(journal.sha256(bytes)!==ref.sha256||producer?.result?.ref?.sha256!==ref.sha256||producer?.result?.ref?.path!==ref.path)fail('session-archive-authority');
  const restored=fm.parseFrontmatter(bytes.toString()).fields;assertRestoreCompatibility(restored,workflow.workDirFor(stateCapability,fields));assertRestoredPlanAuthority(stateCapability,restored);
  const source=sourceFingerprint(stateCapability);if(source.sha256!==producer.result.source_sha256)return restoreSourceDrift({stateCapability,sessionId,ref,bytes,parking:producer,source,seam});
  const paths=assertRestorePointerAvailable(stateCapability,sessionId),registry=JSON.parse(workflow.readRegular(paths.registry));if(registry.sessions[sessionId])fail('registry-session-exists');
  const operation=await journal.beginOperation({projectCapability:tx.projectCapabilityFor(stateCapability),sessionId,kind:'session-restore-v1',preconditions:{ref,source_sha256:source.sha256}});
  write(stateCapability,bytes);await journal.recordOperationStage(operation,'state-written',{owned:ref});seam?.('after-state-written');
  registry.sessions[sessionId]=producer.result.registry_row;write(capability(stateCapability,paths.registry),JSON.stringify(registry)+'\n');write(capability(stateCapability,paths.pointer,true),sessionId+'\n');
  await journal.recordOperationStage(operation,'registry-written',{owned:{session_id:sessionId}});await journal.completeOperation(operation,{status:'restored',ref});return{status:'restored'};
 });
}
function downgradeCheck({projectRoot,targetVersion}){if(!/^\d+\.\d+\.\d+$/.test(targetVersion))fail('target-version');const target=targetVersion.split('.').map(Number),dir=path.join(projectRoot,'.claude'),active=[],parked=[];
 for(const name of fs.readdirSync(dir)){if(!/^deep-work\.s-[0-9a-f]{8}\.md$/.test(name))continue;const fields=fm.parseFrontmatter(workflow.readRegular(path.join(dir,name)).toString()).fields;const version=String(fields.created_by_version||'0.0.0').split('.').map(Number);const newer=version.some((n,i)=>n>target[i]&&version.slice(0,i).every((v,j)=>v===target[j]));if(newer)(fields.parked?parked:active).push({session_id:fields.session_id,created_by_version:fields.created_by_version,retained:true,readable:false});}
 return{allowed:active.length===0,target_version:targetVersion,active,parked};}
module.exports={explainEnvironment,prepareEnvironment,parkSession,restoreSession,downgradeCheck,sourceFingerprint};
