'use strict';

const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const platform=require('./platform.js');const frontmatter=require('./frontmatter.js');
const session=require('./session-store.js');const git=require('./git-runtime.js');const journal=require('./operation-journal.js');
const planRuntime=require('./plan-runtime.js');const slice=require('./slice-runtime.js');const phase=require('./phase-runtime.js');
const testRuntime=require('./test-runtime.js');const verification=require('./verification-runtime.js');
const artifact=require('./artifact-runtime.js');const report=require('./report-runtime.js');const sensor=require('./sensor-runtime.js');
const health=require('./health-runtime.js');const recommender=require('./recommender-runtime.js');
const profile=require('./profile-runtime.js');const flagsRuntime=require('./flags-runtime.js');const transaction=require('./transaction-runtime.js');
const {runSupervisedProcess}=require('./process-supervisor.js');

function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;error.validation=true;throw error;}
function boundedFile(file,max=1_048_576){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)fail('input-file-bounds');return fs.readFileSync(file);}
function jsonFile(file){try{return JSON.parse(boundedFile(file).toString('utf8'));}catch(error){if(error instanceof SyntaxError)fail('input-json');throw error;}}
function resolveInput(value,cwd){if(typeof value!=='string'||!value||/[\0\r\n]/.test(value))fail('input-path');return path.resolve(cwd,value);}
function projectRootFor(f,cwd){return platform.resolveProjectRoot(f['project-root']?resolveInput(f['project-root'],cwd):cwd);}
function projectCapability(f,cwd){const root=projectRootFor(f,cwd);return platform.issueProjectStateCapability(root,root,{role:'project-root'});}
function stateCapability(f,cwd,key='state'){const root=projectRootFor(f,cwd);const target=resolveInput(f[key],cwd);
  return platform.issueProjectStateCapability(root,target,{role:'session-state'});}
function stateFields(capability){platform.revalidatePathCapability(capability,'dispatcher-state');return frontmatter.parseFrontmatter(boundedFile(capability.path).toString('utf8')).fields;}
function sessionId(capability){const match=path.basename(capability.path).match(/^deep-work\.(s-[0-9a-f]{8})\.md$/);if(!match)fail('session-state-identity');return match[1];}
function sessionCapability(stateCap){const fields=stateFields(stateCap);if(typeof fields.work_dir!=='string')fail('session-work-dir');
  const target=path.join(stateCap.projectRoot,...fields.work_dir.split('/'));return platform.issueProjectStateCapability(stateCap.projectRoot,target,
    {role:'session-work-dir',sessionStateCapability:stateCap});}
function sessionFile(stateCap,file,{allowMissing=false,basenames,role='session-file'}={}){return transaction.issueSessionFileCapability({
  sessionCapability:sessionCapability(stateCap),candidate:resolveInput(file,stateCap.projectRoot),allowedBasenames:basenames,
  allowMissingLeaf:allowMissing,role});}
function stateForPlan(f,cwd){if(f.state)return stateCapability(f,cwd);const root=projectRootFor(f,cwd);const target=resolveInput(f.plan,cwd);
  const relative=path.relative(root,target).split(path.sep).join('/');const match=relative.match(/^\.deep-work\/(s-[0-9a-f]{8})\/(?:plan\.json|plan\.md)$/);
  if(!match)fail('plan-session-route');return platform.issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${match[1]}.md`),{role:'session-state'});}
function readPlan(f,cwd){const state=stateForPlan(f,cwd);const cap=sessionFile(state,f.plan,{basenames:['plan.json','plan.md'],role:'locked-plan'});
  const bytes=transaction.readSessionFile(cap);let value;try{value=JSON.parse(bytes);}catch{fail('plan-structured-json');}return{state,cap,value};}
function receiptsCapability(stateCap,provided){const sessionCap=sessionCapability(stateCap);const expected=path.join(sessionCap.path,'receipts');
  if(provided&&path.resolve(provided)!==expected)fail('receipts-route');fs.mkdirSync(expected,{recursive:true});return Object.freeze({kind:'receipts-directory',
    role:'receipts-directory',path:expected,sessionCapability:sessionCap,projectRoot:stateCap.projectRoot});}
function identifyOwnedInput(stateCap,file,expectedPurpose){const sessionCap=sessionCapability(stateCap);const target=resolveInput(file,stateCap.projectRoot);
  const relative=path.relative(sessionCap.path,target).split(path.sep).join('/');const match=relative.match(/^\.tmp\/(op-[0-9a-f]{32,64})\/([^/]+)\.tmp$/);
  if(!match||match[2]!==expectedPurpose)fail('owned-temp-purpose');const found=artifact.resolveOwnedTemp({sessionCapability:sessionCap,operationId:match[1]});
  if(found.purpose!==expectedPurpose||found.capability.path!==target)fail('owned-temp-purpose');return{sessionCapability:sessionCap,...found};}
function ownedInputIdentity(stateCap,file,expectedPurpose){const sessionCap=sessionCapability(stateCap);const target=resolveInput(file,
    stateCap.projectRoot);const relative=path.relative(sessionCap.path,target).split(path.sep).join('/');const match=relative.match(
    /^\.tmp\/(op-[0-9a-f]{32,64})\/([^/]+)\.tmp$/);if(!match||match[2]!==expectedPurpose)fail('owned-temp-purpose');
  return{sessionCapability:sessionCap,operationId:match[1],purpose:expectedPurpose,path:target};}
async function ownedInput(stateCap,file,expectedPurpose,consumerOperationId){const identified=identifyOwnedInput(stateCap,file,expectedPurpose);
  return artifact.consumeOwnedTempForOperation({sessionCapability:identified.sessionCapability,sourceOperationId:identified.operationId,
    purpose:expectedPurpose,consumerOperationId});}
function safeRemoveTree(root,target){const resolved=path.resolve(target);if(!platform.isPathInside(root,resolved)||resolved===root)fail('remove-route');
  if(fs.existsSync(resolved)){const stat=fs.lstatSync(resolved);if(stat.isSymbolicLink())fail('remove-link');fs.rmSync(resolved,{recursive:true,force:false});}return{removed:resolved};}
function hash(value){return crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:journal.canonicalJson(value)).digest('hex');}
function derivedOperationId(label,value){return `op-${hash({label,value})}`;}
function routeLock(project,label,rank=transaction.RANKS.target){let name=`deep-work.route.${hash(label)}.lock`;
  if(label==='repository')name='deep-work.git.lock';else if(label==='registry')name='deep-work-sessions.json.lock';
  else if(/^session:s-[0-9a-f]{8}$/.test(label))name=`deep-work.${label.slice(8)}.rank-operation.lock`;
  return{rank,capability:platform.issueProjectStateCapability(project.path,path.join(project.path,'.claude',name),
    {allowMissingLeaf:true,role:'lock'})};}
function stateForOwnedInput(cwd,file,expectedPurpose){const root=platform.resolveProjectRoot(cwd);const target=resolveInput(file,cwd);
  const relative=path.relative(root,target).split(path.sep).join('/');const escaped=expectedPurpose.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=relative.match(new RegExp(`^\\.deep-work\\/(s-[0-9a-f]{8})\\/\\.tmp\\/(op-[0-9a-f]{32,64})\\/${escaped}\\.tmp$`));
  if(!match)fail('owned-temp-route',expectedPurpose);const state=platform.issueProjectStateCapability(root,
    path.join(root,'.claude',`deep-work.${match[1]}.md`),{role:'session-state'});const identified=identifyOwnedInput(state,target,expectedPurpose);
  if(identified.operationId!==match[2])fail('owned-temp-route',expectedPurpose);return{state,...identified};}
async function reviewerProcess(engine){const toolchain=await platform.issueNodeToolchainCapability({nodeExecutable:process.execPath,
  home:os.homedir(),environment:{...process.env}});const request=engine==='codex'
    ?{package:'@openai/codex',bin:'codex',args:['exec','--sandbox','read-only','-']}
    :{package:'@google/gemini-cli',bin:'gemini',args:['--approval-mode','plan']};
  return platform.resolveNodePackageBin(toolchain,request);}

async function enforceDispatcherPhase({entry,f,cwd}={}){
  if(!entry||!Array.isArray(entry.allowedPhases)||entry.allowedPhases.length===0)fail('dispatcher-phase-contract');
  if(entry.allowedPhases.length===1&&entry.allowedPhases[0]==='standalone')return;
  const state=f.state?stateCapability(f,cwd):f.plan?stateForPlan(f,cwd):null;
  if(!state)fail('dispatcher-phase-state',entry.id);
  return transaction.withRankedLocks([{rank:transaction.RANKS.state,capability:transaction.stateLock(state)}],()=>{
    const current=transaction.readState(state).current_phase;
    let expected=null;
    if(entry.id==='phase advance')expected=f.from;
    else if(f.phase&&['phase begin','phase complete','phase approve','phase rerun','phase review record'].includes(entry.id))expected=f.phase;
    if(expected!==null&&current!==expected)fail('dispatcher-phase',`${entry.id}:${current}!=${expected}`);
    if(!entry.allowedPhases.includes(current))fail('dispatcher-phase',`${entry.id}:${current}`);
    return Object.freeze({phase:current,statePath:state.path});
  });
}

function buildDispatcherHandlers(){const handlers=new Map();const on=(id,fn)=>{if(handlers.has(id))fail('handler-duplicate',id);handlers.set(id,fn);};
  on('session context',({f,cwd})=>session.resolveSessionContext({cwd,sessionId:f.session}));
  on('git capability',({f,cwd})=>{const project=projectCapability(f,cwd);return{kind:'git-capability',projectRoot:project.path,shell:false};});
  on('git changed',async({f,cwd})=>{const project=projectCapability(f,cwd);return transaction.withRankedLocks([
    routeLock(project,'repository',transaction.RANKS.repository)],async()=>{const cap=git.gitCapability(project);const args=['diff','--name-only',f.base,'--'];
      if(f['paths-json'])args.push(...jsonFile(resolveInput(f['paths-json'],cwd)));const result=await cap.run(args);
      if(!result.ok)fail('git-changed',result.stderr);return{paths:result.stdout.split(/\r?\n/).filter(Boolean)
        .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))};});});
  on('temp create',async({f,cwd})=>{const state=stateCapability(f,cwd);if(sessionId(state)!==f.session)fail('session-state-identity');
    const result=await artifact.createOwnedTemp({sessionCapability:sessionCapability(state),purpose:f.purpose});return{
      operationId:result.operationId,purpose:result.purpose,path:result.path};});
  on('temp write',({f,cwd,stdin})=>{const state=stateCapability(f,cwd);if(sessionId(state)!==f.session)fail('session-state-identity');const work=sessionCapability(state);
    const resolved=artifact.resolveOwnedTemp({sessionCapability:work,operationId:f['temp-operation-id']});return artifact.writeOwnedTemp({sessionCapability:work,
      operationId:resolved.operationId,purpose:resolved.purpose},f.stdin?stdin:boundedFile(resolveInput(f.stdin,cwd)));});
  on('temp remove',({f,cwd})=>{const state=stateCapability(f,cwd);if(sessionId(state)!==f.session)fail('session-state-identity');const work=sessionCapability(state);
    const resolved=artifact.resolveOwnedTemp({sessionCapability:work,operationId:f['temp-operation-id']});return artifact.removeOwnedTemp({sessionCapability:work,
      operationId:resolved.operationId,purpose:resolved.purpose,expectedSha256:f['expected-sha256']});});
  on('session registry read',({f,cwd})=>session.readRegistry(projectCapability(f,cwd)));
  on('session registry own',({f,cwd})=>{const state=stateCapability(f,cwd);return session.registerFileOwnership({sessionId:f.session,stateCapability:state,portablePath:f.path});});
  on('session registry touch',({f,cwd})=>session.updateLastActivity({sessionId:f.session,stateCapability:stateCapability(f,cwd),at:f.at}));
  on('session registry phase',({f,cwd})=>session.updateRegistryPhase({sessionId:f.session,stateCapability:stateCapability(f,cwd),phase:f.phase,at:f.at}));
  on('session pointer select',({f,cwd})=>{const context=session.resolveSessionContext({cwd,sessionId:f.session});
    const project=platform.issueProjectStateCapability(context.projectRoot,context.projectRoot,{role:'project-root'});
    return session.selectSessionPointer({projectCapability:project,sessionId:f.session,stateCapability:context.stateCapability});});
  on('session repository prepare',({f,cwd})=>session.prepareSessionRepository({projectCapability:projectCapability(f,cwd),sessionId:f.session,mode:f.mode,
    task:boundedFile(resolveInput(f['task-file'],cwd)).toString('utf8'),defaults:jsonFile(resolveInput(f['defaults-json'],cwd)),
    profile:f['profile-json']?jsonFile(resolveInput(f['profile-json'],cwd)):{},baseRef:f['base-ref']||'HEAD'}));
  on('session fork',async({f,cwd})=>{const parent=stateCapability({state:session.resolveSessionContext({cwd,sessionId:f.parent}).stateCapability.path},cwd);
    const child=session.generateSessionId();return session.forkSession({projectCapability:projectCapability(f,cwd),parentStateCapability:parent,
      parentSessionId:f.parent,childSessionId:child,fromPhase:f['from-phase'],dirtyResolution:f['dirty-resolution']});});
  for(const outcome of ['merge','publish-pr','keep','discard'])on(`session finish ${outcome}`,async({f,cwd})=>{
    const state=stateCapability(f,cwd);if(sessionId(state)!==f.session)fail('session-state-identity');
    return session.withFinishTransaction({sessionId:f.session,stateCapability:state,outcome},async({projectCapability:project,caps})=>{
      const source=ownedInputIdentity(state,f['receipt-payload'],'receipt-payload');const identities=[source];
      if(outcome==='publish-pr')identities.push(ownedInputIdentity(state,f['title-file'],'pr-title'),
        ownedInputIdentity(state,f['body-file'],'pr-body'));const preconditions={sourceOperationId:source.operationId,
        sources:identities.map((row)=>({purpose:row.purpose,operationId:row.operationId})),
        dirtyResolution:f['dirty-resolution']||null,outcome};const operation=await journal.beginOperation({projectCapability:project,
        sessionId:f.session,kind:`finish-${outcome}`,preconditions});let pending=await journal.resumeOperation({projectCapability:project,
        operationId:operation.operationId,sessionId:f.session,kind:`finish-${outcome}`});let prepared=pending.stages?.find(
        (row)=>row.stage==='temp-prepared')?.details?.owned;if(!prepared){const rows=[];for(const identity of identities){const value=
          await artifact.prepareOwnedTempForOperation({sessionCapability:identity.sessionCapability,sourceOperationId:identity.operationId,
            purpose:identity.purpose});rows.push({purpose:identity.purpose,sourceOperationId:identity.operationId,sha256:value.sha256,
            bytesBase64:value.bytes.toString('base64')});}prepared={sources:rows};await journal.recordOperationStage(operation,
          'temp-prepared',{owned:prepared});}if(!prepared||!Array.isArray(prepared.sources)||prepared.sources.length!==identities.length)
        fail('finish-temp-prepared');const values=new Map();for(let index=0;index<identities.length;index++){const identity=identities[index];
        const row=prepared.sources[index];if(row?.purpose!==identity.purpose||row.sourceOperationId!==identity.operationId||
            !/^[0-9a-f]{64}$/.test(row.sha256||'')||typeof row.bytesBase64!=='string')fail('finish-temp-prepared');const bytes=
          Buffer.from(row.bytesBase64,'base64');if(bytes.toString('base64')!==row.bytesBase64||hash(bytes)!==row.sha256)
          fail('finish-temp-prepared');values.set(row.purpose,{...row,bytes});}pending=await journal.resumeOperation({projectCapability:project,
        operationId:operation.operationId,sessionId:f.session,kind:`finish-${outcome}`});if(!pending.stages?.some(
        (row)=>row.stage==='temp-consumed')){for(const identity of identities){const row=values.get(identity.purpose);await artifact
            .consumeOwnedTempForOperation({sessionCapability:identity.sessionCapability,sourceOperationId:identity.operationId,
              purpose:identity.purpose,consumerOperationId:operation.operationId,expectedDigest:row.sha256,adoptWithoutRead:true});}
        await journal.recordOperationStage(operation,'temp-consumed',{owned:{sources:prepared.sources.map(
          ({purpose,sourceOperationId,sha256})=>({purpose,sourceOperationId,sha256}))}});}const payload=values.get('receipt-payload');
      let title=values.get('pr-title')||null,body=values.get('pr-body')||null;if(body){const bodyTarget=path.join(source.sessionCapability.path,
          '.operation-results',operation.operationId,'pull-request-body.md');const bodyCapability=transaction.issueSessionFileCapability({
          sessionCapability:source.sessionCapability,candidate:bodyTarget,allowedBasenames:['pull-request-body.md'],allowMissingLeaf:true,
          role:'pull-request-body'});if(fs.existsSync(bodyTarget)){if(Buffer.compare(fs.readFileSync(bodyTarget),body.bytes)!==0)
            fail('finish-pr-body-adoption');}else transaction.atomicWriteSessionFile(bodyCapability,body.bytes);await journal.recordOperationStage(
          operation,'remote-body-written',{owned:{path:bodyTarget,sha256:body.sha256}});body={...body,capability:bodyCapability};}
      let remoteReceipt=null,repositoryReceipt=null;
      if(outcome==='publish-pr')remoteReceipt=await git.publishPullRequestWithinOperation({operation,projectCapability:project,
        stateFields:stateFields(state),titleBytes:title.bytes,bodyCapability:body.capability,bodyBytes:body.bytes});
      if(outcome==='merge')repositoryReceipt=await git.finishMergeWithinOperation({operation,projectCapability:project,
        stateCapability:state,stateFields:stateFields(state),dirtyResolution:f['dirty-resolution']||'abort'});
      if(outcome==='discard')repositoryReceipt=await git.finishDiscardWithinOperation({operation,projectCapability:project,
        stateCapability:state,stateFields:stateFields(state),force:Boolean(f.force)});
      const finishState=await session.finalizeWithinFinishOperation({operation,sessionId:f.session,
        stateCapability:state,outcome,locksHeld:true,caps});
      let authored;try{authored=JSON.parse(payload.bytes.toString('utf8'));}catch{fail('finish-payload-json');}
      if(!authored||typeof authored!=='object'||Array.isArray(authored))fail('finish-payload-json');const finalizedPayload={...authored,finish_outcome:outcome,
        source_temp_sha256:payload.sha256,...(title?{title_sha256:title.sha256,body_sha256:body.sha256,
          remote_receipt:remoteReceipt}:{}),...(repositoryReceipt?{repository_receipt:repositoryReceipt}:{})};
      const published=artifact.publishFinalizedReceipt({sessionCapability:sessionCapability(state),operation,kind:`finish-${outcome}`,
        sourceTempDigest:payload.sha256,payload:finalizedPayload});await journal.recordOperationStage(operation,'result-published',
        {owned:{path:published.path,sha256:published.sha256}});const receipt=await journal.completeOperation(operation,{status:'completed',
        outcome,sourceTempDigest:payload.sha256,finalizedBytesDigest:published.sha256,remoteCalls:0,
        finishState,...(remoteReceipt?{remoteReceipt}:{}),...(repositoryReceipt?{repositoryReceipt}:{})});
      return{status:'completed',outcome,operationId:operation.operationId,producerReceipt:published.producerReceipt,
        resultCapability:published.resultCapability,resultPath:published.path,resultSha256:published.sha256,operationReceipt:receipt};});});
  on('session cleanup scan',({f,cwd})=>{const project=projectCapability(f,cwd);return transaction.withRankedLocks([
    routeLock(project,'repository',transaction.RANKS.repository),routeLock(project,'registry',transaction.RANKS.registry)],
    ()=>git.scanCleanupCandidates({projectCapability:project,registry:session.readRegistry(project)}));});
  on('session cleanup remove',({f,cwd})=>{const project=projectCapability(f,cwd);const state=stateCapability(f,cwd);
    return session.cleanupSession({projectCapability:project,sessionId:f.session,stateCapability:state,
      worktreeCapability:git.resolveForkWorktreeCapability({projectCapability:project,stateCapability:state,sessionId:f.session,
        comparisonPath:resolveInput(f.worktree,cwd)}),force:Boolean(f.force)});});
  on('session cache-clear',({f,cwd})=>{const project=projectCapability(f,cwd),target=path.join(project.path,'.deep-suite-cache',f.session);
    return transaction.withRankedLocks([routeLock(project,`session:${f.session}`,transaction.RANKS.session),
      routeLock(project,`cache:${target}`,transaction.RANKS.target)],()=>safeRemoveTree(project.path,target));});
  on('session initialize',({f,cwd})=>session.initializeSession({task:boundedFile(resolveInput(f['task-file'],cwd)).toString('utf8'),
    flags:jsonFile(resolveInput(f['flags-json'],cwd)),profile:jsonFile(resolveInput(f['profile-json'],cwd))}));
  on('session state migrate-schema',({f,cwd})=>session.migrateKnownSessionSchema({stateCapability:stateCapability(f,cwd),sessionId:f.session}));
  on('session execution set',({f,cwd})=>slice.setExecutionOverride({stateCapability:stateCapability(f,cwd),value:f.mode==='auto'?null:f.mode}));
  on('session state migrate-model-routing',({f,cwd})=>slice.migrateModelRouting({stateCapability:stateCapability(f,cwd)}));
  on('session recovery worktree',({f,cwd})=>session.recoverSessionWorktree({stateCapability:stateCapability(f,cwd),sessionId:f.session}));
  on('session finalize',({f,cwd})=>session.finalizeSession({stateCapability:stateCapability(f,cwd),sessionId:f.session,finishedAt:f['finished-at']}));
  on('phase begin',({f,cwd})=>phase.beginPhase({stateCapability:stateCapability(f,cwd),phase:f.phase,at:f.at}));
  on('phase complete',({f,cwd})=>phase.completePhase({stateCapability:stateCapability(f,cwd),phase:f.phase,
    result:jsonFile(resolveInput(f['result-json'],cwd)),at:f.at}));
  on('phase approve',({f,cwd})=>phase.approvePhase({stateCapability:stateCapability(f,cwd),phase:f.phase,
    artifactSha256:hash(boundedFile(resolveInput(f.artifact,cwd))),at:f.at}));
  on('phase advance',({f,cwd})=>phase.advancePhase({stateCapability:stateCapability(f,cwd),from:f.from,to:f.to,at:f.at}));
  on('phase rerun',({f,cwd})=>phase.rerunPhase({stateCapability:stateCapability(f,cwd),phase:f.phase,
    affectedSlices:f['affected-slices-json']?jsonFile(resolveInput(f['affected-slices-json'],cwd)):[]}));
  on('implement delegation set',({f,cwd})=>{const bound=readPlan(f,cwd);return slice.setDelegationSnapshot({stateCapability:bound.state,
    planCapability:bound.cap,plan:bound.value,assignment:jsonFile(resolveInput(f['assignment-json'],cwd)),snapshot:f.snapshot});});
  on('implement delegation clear',({f,cwd})=>slice.clearDelegationSnapshot({stateCapability:stateCapability(f,cwd),snapshot:f.snapshot}));
  on('implement write begin',({f,cwd})=>{const bound=readPlan(f,cwd);return slice.beginScopedWrite({stateCapability:bound.state,planCapability:bound.cap,
    plan:bound.value,sliceId:f.slice,writeClass:f.class,clusterId:f.cluster,expectedScopeSha256:f['scope-sha256']});});
  on('implement write accept',({f,cwd})=>{const bound=readPlan(f,cwd);return slice.acceptScopedWrite({stateCapability:bound.state,
    planCapability:bound.cap,plan:bound.value,
    sliceId:f.slice,operationId:f['operation-id'],preManifestSha256:f['pre-manifest-sha256']});});
  on('implement tdd transition',({f,cwd})=>{const bound=readPlan(f,cwd);return phase.transitionSliceTdd({stateCapability:bound.state,sliceId:f.slice,to:f.to,
    planCapability:bound.cap,plan:bound.value,
    verificationResult:f['verification-result']?jsonFile(resolveInput(f['verification-result'],cwd)):undefined,verificationSha256:f['verification-sha256'],
    verificationOperationId:f['verification-operation-id'],sensorOperationIds:f['sensor-operation-ids']?JSON.parse(f['sensor-operation-ids']):undefined,
    sensorResultsSha256:f['sensor-results-sha256'],afterWriteOperationId:f['after-write-operation-id']});});
  on('implement slice complete',({f,cwd})=>{const bound=readPlan(f,cwd);const input=identifyOwnedInput(bound.state,f['receipt-payload'],'receipt-payload');
    return slice.completeSlice({stateCapability:bound.state,planCapability:bound.cap,plan:bound.value,receiptsDirCapability:receiptsCapability(bound.state,f['receipts-dir']),
      sliceId:f.slice,receiptTemp:{sourceOperationId:input.operationId,purpose:'receipt-payload',sessionCapability:input.sessionCapability}});});
  on('implement override set',async({f,cwd})=>{const state=stateCapability(f,cwd);const source=identifyOwnedInput(state,f['reason-file'],'reason');
    const consumed=await ownedInput(state,f['reason-file'],'reason',derivedOperationId('implement-override-set',{
      session:sessionId(state),slice:f.slice,sourceOperationId:source.operationId}));return phase.setTddOverride({stateCapability:state,
      sliceId:f.slice,reason:consumed.bytes.toString('utf8')});});
  on('implement override clear',({f,cwd})=>phase.clearTddOverride({stateCapability:stateCapability(f,cwd),sliceId:f.slice}));
  on('implement takeover set',({f,cwd})=>{const bound=readPlan(f,cwd);return slice.setClusterTakeover({stateCapability:bound.state,
    planCapability:bound.cap,plan:bound.value,receiptsDirCapability:receiptsCapability(bound.state,resolveInput(f['receipts-dir'],cwd)),
    clusterId:boundedFile(resolveInput(f['cluster-file'],cwd)).toString('utf8').trim(),delegationSnapshot:f['delegation-snapshot']});});
  on('implement takeover clear',({f,cwd})=>{const bound=readPlan(f,cwd);return slice.clearClusterTakeover({stateCapability:bound.state,
    planCapability:bound.cap,plan:bound.value,receiptsDirCapability:receiptsCapability(bound.state,resolveInput(f['receipts-dir'],cwd)),
    clusterId:boundedFile(resolveInput(f['cluster-file'],cwd)).toString('utf8').trim(),delegationSnapshot:f['delegation-snapshot']});});
  on('verification migrate-spec',async({f,cwd})=>{const bound=readPlan(f,cwd);const spec=verification.validateVerificationSpec(jsonFile(resolveInput(f['spec-json'],cwd)));
    const prePlanSha256=hash(bound.value);const list=f.scope==='slice'?bound.value.slices:bound.value.quality_gates;
    const row=list.find((item)=>item.id===f.id);if(!row)fail('verification-plan-id');row.verification_spec=spec;
    const operation=await journal.beginOperation({projectCapability:transaction.projectCapabilityFor(bound.state),
      sessionId:sessionId(bound.state),kind:'verification-spec-migrate',preconditions:{scope:f.scope,id:f.id,
        planSha256:prePlanSha256,specSha256:hash(spec)}});transaction.atomicWriteSessionFile(bound.cap,journal.canonicalJson(bound.value));
    await journal.recordOperationStage(operation,'plan-written',{owned:{planSha256:hash(bound.value)}});
    const receipt=await journal.completeOperation(operation,{status:'migrated',scope:f.scope,id:f.id,specSha256:hash(spec),
      planSha256:hash(bound.value)});return{status:'migrated',scope:f.scope,id:f.id,specSha256:hash(spec),operationId:operation.operationId,receipt};});
  on('verification run',({f,cwd})=>{const bound=readPlan(f,cwd);return verification.runVerification({stateCapability:bound.state,planCapability:bound.cap,
    plan:bound.value,sliceId:f.slice,gateId:f['gate-id'],spec:jsonFile(resolveInput(f['spec-json'],cwd)),expectedOutcome:f.expected,cwd:bound.state.projectRoot});});
  on('test pass',({f,cwd})=>testRuntime.recordTestPass({stateCapability:stateCapability(f,cwd),gateResults:jsonFile(resolveInput(f['gate-results-json'],cwd)),at:f.at}));
  on('test retry',({f,cwd})=>{const bound=readPlan(f,cwd);return testRuntime.recordTestRetry({stateCapability:bound.state,planCapability:bound.cap,plan:bound.value,
    receiptsDirCapability:receiptsCapability(bound.state,f['receipts-dir']),failedSlices:jsonFile(resolveInput(f['failed-slices-json'],cwd)),at:f.at});});
  on('test exhaust',({f,cwd})=>{const bound=readPlan(f,cwd);return testRuntime.recordTestExhaustion({stateCapability:bound.state,planCapability:bound.cap,plan:bound.value,
    receiptsDirCapability:receiptsCapability(bound.state,f['receipts-dir']),failedSlices:jsonFile(resolveInput(f['failed-slices-json'],cwd)),at:f.at});});
  on('mutation round begin',({f,cwd})=>testRuntime.beginMutationRound({stateCapability:stateCapability(f,cwd),round:Number(f.round),survived:jsonFile(resolveInput(f['survived-json'],cwd))}));
  on('mutation round end',({f,cwd})=>testRuntime.endMutationRound({stateCapability:stateCapability(f,cwd),round:Number(f.round),verification:jsonFile(resolveInput(f['verification-json'],cwd))}));
  on('mutation record',({f,cwd})=>testRuntime.recordMutationResult({stateCapability:stateCapability(f,cwd),result:jsonFile(resolveInput(f['result-json'],cwd))}));
  on('debug enter',({f,cwd})=>phase.enterDebug({stateCapability:stateCapability(f,cwd),sliceId:f.slice}));
  on('debug complete',({f,cwd})=>{const state=stateCapability(f,cwd);return phase.completeDebug({stateCapability:state,
    receiptsDirCapability:receiptsCapability(state,f['receipts-dir']),sliceId:f.slice,noteFile:resolveInput(f['note-file'],cwd),
    verification:jsonFile(resolveInput(f['verification-json'],cwd))});});
  on('debug exit',({f,cwd})=>phase.exitDebug({stateCapability:stateCapability(f,cwd),verification:jsonFile(resolveInput(f['verification-json'],cwd))}));
  on('phase review record',({f,cwd})=>phase.recordPhaseReview({stateCapability:stateCapability(f,cwd),phase:f.phase,structuralJsonFile:resolveInput(f['structural-json'],cwd),
    structuralMdFile:resolveInput(f['structural-md'],cwd),adversarialJsonFile:f['adversarial-json']?resolveInput(f['adversarial-json'],cwd):undefined}));
  on('artifact publish',async({f,cwd})=>{const state=stateCapability(f,cwd);const source=identifyOwnedInput(state,f.input,'artifact-input');
    const consumerOperationId=derivedOperationId('artifact-publish',{session:sessionId(state),sourceOperationId:source.operationId,
      kind:f.kind,slice:f.slice||null,area:f.area||null,iteration:f.iteration||null});
    const input=await ownedInput(state,f.input,'artifact-input',consumerOperationId);return artifact.publishArtifact({sessionCapability:sessionCapability(state),
      kind:f.kind,inputCapability:input.capability,sliceId:f.slice,area:f.area,iteration:f.iteration?Number(f.iteration):undefined});});
  on('analysis drift record',({f,cwd})=>slice.mutateState(stateCapability(f,cwd),()=>({fidelity_score:Number(boundedFile(resolveInput(f['score-file'],cwd)).toString('utf8').trim()),
    drift_report_sha256:hash(boundedFile(resolveInput(f.report,cwd)))})));
  on('receipt dashboard',({f,cwd})=>report.readReceiptDashboard({receiptsDir:receiptsCapability(stateCapability(f,cwd)).path}));
  on('receipt view',({f,cwd})=>report.readReceiptDetail({receiptsDir:receiptsCapability(stateCapability(f,cwd)).path,sliceId:f.slice}));
  on('receipt export',({f,cwd})=>report.exportReceipts({stateCapability:stateCapability(f,cwd),format:f.format}));
  on('history list',({f,cwd})=>report.readSessionHistory(resolveInput(f['project-root'],cwd)));
  on('report generate',({f,cwd})=>report.generateReport({stateCapability:stateCapability(f,cwd)}));
  on('git report commit',({f,cwd})=>report.commitReport({stateCapability:stateCapability(f,cwd)}));
  on('slice activate',({f,cwd})=>{const bound=readPlan(f,cwd);return slice.activateSlice({stateCapability:bound.state,plan:bound.value,sliceId:f.slice});});
  on('slice spike',({f,cwd})=>slice.enterSliceSpike({stateCapability:stateCapability(f,cwd),plan:{slices:[{id:f.slice,checked:false}]},sliceId:f.slice}));
  on('slice reset',({f,cwd})=>{const bound=readPlan(f,cwd);return slice.resetSlice({stateCapability:bound.state,planCapability:bound.cap,plan:bound.value,
    receiptsDirCapability:receiptsCapability(bound.state,f['receipts-dir']),sliceId:f.slice});});
  on('slice model',({f,cwd})=>slice.setSliceModel({stateCapability:stateCapability(f,cwd),sliceId:f.slice,model:f.model}));
  on('git delegated rollback',({f,cwd})=>{const state=stateCapability(f,cwd);const fields=stateFields(state);
    if(fields.delegation_snapshot!==f.snapshot)fail('delegated-rollback-snapshot');return git.delegatedRollback({
      projectCapability:projectCapability(f,cwd),stateCapability:state,receiptsDirCapability:receiptsCapability(state,f['receipts-dir']),
      sessionId:sessionId(state),snapshotOid:f.snapshot,userChoice:'redelegate'});});
  on('git stash publish',({f,cwd})=>git.stashPublish({projectCapability:projectCapability(f,cwd),sessionId:f.session,purpose:f.purpose,includeUntracked:Boolean(f['include-untracked'])}));
  on('git stash apply',({f,cwd})=>git.stashApply({projectCapability:projectCapability(f,cwd),sessionId:f.session,operationId:f['operation-id']}));
  on('git stash drop',({f,cwd})=>git.stashDrop({projectCapability:projectCapability(f,cwd),sessionId:f.session,operationId:f['operation-id']}));
  on('review run',async({f,cwd})=>{const source=stateForOwnedInput(cwd,f['prompt-file'],'review-prompt');
    const consumerOperationId=derivedOperationId('review-run',{session:sessionId(source.state),sourceOperationId:source.operationId,
      engine:f.engine,timeoutMs:Number(f['timeout-ms']),mode:f.mode});const prompt=await ownedInput(source.state,f['prompt-file'],
      'review-prompt',consumerOperationId);const resolved=await reviewerProcess(f.engine);const result=await runSupervisedProcess({
      executable:resolved.executable,args:resolved.argv},{cwd:source.state.projectRoot,timeoutMs:Number(f['timeout-ms']),maxOutputBytes:1048576,
      env:{...process.env},input:prompt.bytes});return{engine:f.engine,exitCode:result.exitCode,stdout:result.stdout,stderr:result.stderr,
      promptSha256:prompt.sha256,consumerOperationId};});
  on('sensor detect',({f,cwd})=>{const project=projectCapability(f,cwd);let registry=jsonFile(path.resolve(__dirname,'..','sensors','registry.json'));if(registry.$schema==='sensor-registry-v1')registry=sensor.migrateRegistryV1(registry);return sensor.detectSensors(project,registry);});
  on('sensor run',({f,cwd})=>sensor.runSensor({kind:f.kind,processSpec:jsonFile(resolveInput(f['process-spec-json'],cwd)),parser:f.parser,budgetMs:Number(f['budget-ms']),projectRoot:cwd,
    refactorContext:f.state?{sessionId:f.session,stateCapability:stateCapability(f,cwd),planCapability:sessionFile(stateCapability(f,cwd),f.plan),sliceId:f.slice,afterWriteOperationId:f['after-write-operation-id']}:undefined}));
  on('sensor review-check',({f,cwd})=>{const state=f.state?stateCapability(f,cwd):null;return sensor.runReviewCheck(
    projectCapability({...f,'project-root':f['project-root']},cwd),{topology:f.topology,
      changedFiles:f['changed-files-json']?jsonFile(resolveInput(f['changed-files-json'],cwd)):[]},state?{
      sessionId:f.session,stateCapability:state,planCapability:sessionFile(state,f.plan,{basenames:['plan.json','plan.md'],role:'locked-plan'}),
      sliceId:f.slice,afterWriteOperationId:f['after-write-operation-id']}:undefined);});
  on('topology detect',({f,cwd})=>health.detectTopology(resolveInput(f['project-root'],cwd)));
  on('health fitness-proposal',({f,cwd})=>health.generateFitnessProposal(resolveInput(f['project-root'],cwd)));
  on('health check',({f,cwd})=>{const project=projectCapability({...f,'project-root':f['project-root']},cwd);return transaction.withRankedLocks([
    routeLock(project,'health-check',transaction.RANKS.target)],()=>health.runHealthCheck({projectRoot:project.path,
      skipAudit:Boolean(f['skip-audit']),fitnessFile:f['fitness-file']&&resolveInput(f['fitness-file'],cwd)}));});
  on('health research-state',({f,cwd})=>{const state=stateCapability(f,cwd);const next=health.writeResearchHealthState(stateFields(state),jsonFile(resolveInput(f['report-json'],cwd)));
    return slice.mutateState(state,()=>({topology:next.topology,health_report:JSON.stringify(next.health_report),fitness_baseline:JSON.stringify(next.fitness_baseline),
      unresolved_required_issues:next.unresolved_required_issues}));});
  on('capability detect',()=>recommender.detectCapability({}));
  on('recommender input',({f,cwd})=>recommender.buildRecommenderInput(jsonFile(resolveInput(f['input-json'],cwd))));
  on('recommender validate',({f,cwd})=>recommender.validateRecommendation(boundedFile(resolveInput(f['result-file'],cwd)).toString('utf8'),jsonFile(resolveInput(f['capability-json'],cwd))));
  on('ask options',({f,cwd})=>recommender.formatAskOptions(jsonFile(resolveInput(f['input-json'],cwd))));
  on('profile migrate',({f,cwd})=>profile.migrateProfile(resolveInput(f['profile-file'],cwd),f['initial-preset']));
  on('profile load',({f,cwd})=>profile.loadProfile(resolveInput(f['profile-file'],cwd),f['initial-preset']));
  on('profile update',({f,cwd})=>profile.updateProfile(resolveInput(f['profile-file'],cwd),{reason:f.reason,
    selectedPreset:f.preset,defaults:jsonFile(resolveInput(f['defaults-json'],cwd))}));
  on('flags parse',({f,cwd})=>flagsRuntime.parseFlags(jsonFile(resolveInput(f['arguments-json'],cwd))));
  return handlers;}

module.exports={buildDispatcherHandlers,enforceDispatcherPhase,
  helpers:{projectCapability,stateCapability,sessionCapability,sessionFile,readPlan,receiptsCapability,jsonFile}};
