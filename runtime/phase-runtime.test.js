'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {execFileSync}=require('node:child_process');
const { transitionSliceTdd, advancePhase, completeDebug,recordPhaseReview,PHASE_GRAPH } = require('./phase-runtime.js');
const platform=require('./platform.js');const transaction=require('./transaction-runtime.js');
const {beginScopedWrite,acceptScopedWrite,completeSlice}=require('./slice-runtime.js');
const {deriveScopedWriteAuthority}=require('./plan-runtime.js');
const {runVerification}=require('./verification-runtime.js');
const {runSensor,runReviewCheck,aggregateSensorResults}=require('./sensor-runtime.js');
const {parseFrontmatter}=require('./frontmatter.js');
const artifact=require('./artifact-runtime.js');

test('phase graph is closed and skip edges are explicit', () => {
  assert.deepEqual(PHASE_GRAPH.brainstorm, ['research']);
  assert.deepEqual(PHASE_GRAPH.implement, ['test']);
  assert.throws(() => advancePhase({state:{current_phase:'research'}, from:'research', to:'test'}),
    /phase-transition/);
});

test('TDD transition table rejects proofless RED and invalid refactor completion', async () => {
  await assert.rejects(() => transitionSliceTdd({state:{tdd_state:'PENDING'}, to:'RED_VERIFIED'}),
    /verification-required/);
  await assert.rejects(() => transitionSliceTdd({state:{tdd_state:'REFACTOR_PENDING'},
    to:'SENSOR_CLEAN'}), /tdd-transition/);
});

test('debug completion atomically publishes collision-free note receipt and state',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-debug-complete-'));fs.mkdirSync(path.join(root,'.git'));
  fs.mkdirSync(path.join(root,'.claude'));const work=path.join(root,'.deep-work','s-bbbbbbbb'),receipts=path.join(work,'receipts');
  fs.mkdirSync(receipts,{recursive:true});const statePath=path.join(root,'.claude','deep-work.s-bbbbbbbb.md');fs.writeFileSync(statePath,
    '---\nsession_id: s-bbbbbbbb\nwork_dir: .deep-work/s-bbbbbbbb\ncurrent_phase: implement\ndebug_active: true\ndebug_slice: SLICE-001\n---\n');
  fs.writeFileSync(path.join(receipts,'SLICE-001.json'),'{"slice_id":"SLICE-001","status":"in_progress","debug":{}}\n');
  const note=path.join(work,'root-cause-input.md');fs.writeFileSync(note,'# Root cause\n\nExact diagnosis.\n');const args=()=>{
    const stateCapability=platform.issueProjectStateCapability(root,statePath,{role:'session-state'});const sessionCapability=
      platform.issueProjectStateCapability(root,work,{role:'session-work-dir',sessionStateCapability:stateCapability});return{stateCapability,
      receiptsDirCapability:Object.freeze({kind:'receipts-directory',role:'receipts-directory',path:receipts,sessionCapability,projectRoot:root}),
      sliceId:'SLICE-001',noteFile:note,verification:{accepted:true}};};for(const target of ['after-note-write-before-stage',
    'after-receipt-write-before-stage','after-state-write-before-stage'])await assert.rejects(()=>completeDebug({...args(),seam:(name)=>{
      if(name===target)throw new Error(target);}}),new RegExp(target));const result=await completeDebug(args());assert.equal(result.status,'completed');
  assert.equal(path.basename(result.notePath),'RC-001.md');assert.equal(fs.readFileSync(result.notePath,'utf8'),'# Root cause\n\nExact diagnosis.\n');
  const receipt=JSON.parse(fs.readFileSync(path.join(receipts,'SLICE-001.json'),'utf8'));assert.equal(receipt.debug.root_cause_note,
    'debug-log/RC-001.md');const fields=parseFrontmatter(fs.readFileSync(statePath,'utf8')).fields;assert.equal(fields.debug_active,false);
});

test('phase review atomically publishes exact files and state authority',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-phase-review-'));fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
  const work=path.join(root,'.deep-work','s-cccccccc');fs.mkdirSync(work,{recursive:true});const statePath=path.join(root,'.claude',
    'deep-work.s-cccccccc.md');fs.writeFileSync(statePath,'---\nsession_id: s-cccccccc\nwork_dir: .deep-work/s-cccccccc\n'+
    'current_phase: plan\nphase_review: "{}"\nplan_review_retries: 2\n---\n');const structural=path.join(work,'input-structural.json'),
    markdown=path.join(work,'input-structural.md'),adversarial=path.join(work,'input-adversarial.json');fs.writeFileSync(structural,
    '{"result":"APPROVE","issues":[]}\n');fs.writeFileSync(markdown,'# Plan review\n\nApproved.\n');fs.writeFileSync(adversarial,
    '{"result":"APPROVE","risks":[]}\n');const args=()=>({stateCapability:platform.issueProjectStateCapability(root,statePath,
      {role:'session-state'}),phase:'plan',structuralJsonFile:structural,structuralMdFile:markdown,adversarialJsonFile:adversarial});
  for(const target of ['after-json-write-before-stage','after-markdown-write-before-stage','after-adversarial-write-before-stage',
    'after-state-write-before-stage'])await assert.rejects(()=>recordPhaseReview({...args(),seam:(name)=>{if(name===target)
      throw new Error(target);}}),new RegExp(target));const result=await recordPhaseReview(args());assert.equal(result.status,'completed');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work,'plan-review.json'),'utf8')),{issues:[],result:'APPROVE'});
  assert.equal(fs.readFileSync(path.join(work,'plan-review.md'),'utf8'),'# Plan review\n\nApproved.\n');assert.deepEqual(JSON.parse(
    fs.readFileSync(path.join(work,'adversarial-review.json'),'utf8')),{result:'APPROVE',risks:[]});const fields=
    parseFrontmatter(fs.readFileSync(statePath,'utf8')).fields;assert.equal(fields.plan_review_retries,0);assert.equal(JSON.parse(
      fields.phase_review).plan.result,'APPROVE');
});

function refactorFixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-refactor-'));
  execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['config','user.email','test@example.invalid'],{cwd:root});
  execFileSync('git',['config','user.name','Deep Work Test'],{cwd:root});fs.mkdirSync(path.join(root,'src'));
  fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'src','a.js'),'module.exports=1;\n');
  fs.writeFileSync(path.join(root,'tests','a.test.js'),'// test\n');
  const verifier=path.join(root,'verify.js');fs.writeFileSync(verifier,"require('./src/a.js'); process.stdout.write('ok\\n');\n");
  execFileSync('git',['add','-A'],{cwd:root});execFileSync('git',['commit','-qm','initial'],{cwd:root});
  fs.mkdirSync(path.join(root,'.claude'));const workDir=path.join(root,'.deep-work','s-aaaaaaaa');fs.mkdirSync(workDir,{recursive:true});
  const statePath=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');fs.writeFileSync(statePath,
    '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\nactive_slice: SLICE-001\ntdd_state: SENSOR_CLEAN\nfresh_sensor_required: false\n---\n');
  const stateCapability=platform.issueProjectStateCapability(root,statePath,{role:'session-state'});
  const sessionCapability=platform.issueProjectStateCapability(root,workDir,{role:'session-work-dir',sessionStateCapability:stateCapability});
  const planCapability=transaction.issueSessionFileCapability({sessionCapability,candidate:path.join(workDir,'plan.json'),
    allowedBasenames:['plan.json'],allowMissingLeaf:true,role:'locked-plan'});
  const spec={schema_version:1,executable:{kind:'node',value:'node'},args:['verify.js'],cwd_role:'active-worktree',
    timeout_ms:5000,max_output_bytes:4096};
  const plan={schema_version:1,slices:[{id:'SLICE-001',checked:false,scope_schema_version:1,
    files:['src/a.js','tests/a.test.js'],write_scope:{failing_test:['tests/a.test.js'],production:['src/a.js'],
      refactor:['src/a.js']},verification_spec:spec}]};fs.writeFileSync(planCapability.path,JSON.stringify(plan));
  return{root,statePath,stateCapability,sessionCapability,planCapability,plan,spec};}

test('refactor proof chain authenticates write, verification, contextual sensors, and crash adoption', async () => {
  const f=refactorFixture();const authority=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',writeClass:'refactor'});
  const write=await beginScopedWrite({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,
    sliceId:'SLICE-001',writeClass:'refactor',expectedScopeSha256:authority.sha256});
  fs.writeFileSync(path.join(f.root,'src','a.js'),'module.exports = 1;\n');
  const accepted=await acceptScopedWrite({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
    operationId:write.operationId,preManifestSha256:write.preManifestSha256});
  assert.equal(parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields.tdd_state,'REFACTOR_PENDING');
  const verification=await runVerification({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,sliceId:'SLICE-001',expectedOutcome:'must-pass',spec:f.spec,cwd:f.root});
  await assert.rejects(()=>transitionSliceTdd({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,sliceId:'SLICE-001',to:'GREEN',verificationResult:verification.result,
    verificationSha256:verification.resultSha256,verificationOperationId:verification.operationId,
    seam:(name)=>{if(name==='after-state-write-before-stage')throw new Error('kill-transition');}}),/kill-transition/);
  assert.equal(parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields.tdd_state,'GREEN');
  await transitionSliceTdd({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,
    sliceId:'SLICE-001',to:'GREEN',verificationResult:verification.result,
    verificationSha256:verification.resultSha256,verificationOperationId:verification.operationId});
  await assert.rejects(()=>transitionSliceTdd({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,sliceId:'SLICE-001',to:'GREEN',verificationResult:verification.result,
    verificationSha256:verification.resultSha256,verificationOperationId:verification.operationId}),
  /verification-result-replay|verification-write-state/);
  await transitionSliceTdd({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,
    sliceId:'SLICE-001',to:'SENSOR_RUN'});
  const context={sessionId:'s-aaaaaaaa',stateCapability:f.stateCapability,planCapability:f.planCapability,
    sliceId:'SLICE-001',afterWriteOperationId:accepted.operationId};
  const worker=path.resolve(__dirname,'..','tests','fixtures','verification-process-worker.js');
  const lint=await runSensor({kind:'lint',processSpec:{kind:'native-executable',executable:process.execPath,
    args:[worker,'pass']},parser:'generic-line',budgetMs:2000,projectCapability:
      platform.issueProjectStateCapability(f.root,f.root,{role:'project-root'}),refactorContext:context});
  const typecheck=await runSensor({kind:'typecheck',processSpec:{kind:'native-executable',executable:process.execPath,
    args:[worker,'pass']},parser:'generic-line',budgetMs:2000,projectCapability:
      platform.issueProjectStateCapability(f.root,f.root,{role:'project-root'}),refactorContext:context});
  const review=await runReviewCheck(platform.issueProjectStateCapability(f.root,f.root,{role:'project-root'}),{},context);
  const rows=[lint,typecheck,review].sort((a,b)=>Buffer.compare(Buffer.from(a.operationId),Buffer.from(b.operationId)));
  const digest=aggregateSensorResults(rows);
  await assert.rejects(()=>transitionSliceTdd({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,sliceId:'SLICE-001',to:'SENSOR_CLEAN',sensorOperationIds:rows.slice(0,2).map((row)=>row.operationId),
    sensorResultsSha256:aggregateSensorResults(rows.slice(0,2)),afterWriteOperationId:accepted.operationId}),
  /sensor-result-incomplete/);
  await assert.rejects(()=>transitionSliceTdd({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,sliceId:'SLICE-001',to:'SENSOR_CLEAN',sensorOperationIds:rows.map((row)=>row.operationId),
    sensorResultsSha256:digest,afterWriteOperationId:accepted.operationId,
    seam:(name)=>{if(name==='after-state-write-before-stage')throw new Error('kill-sensor-cycle');}}),/kill-sensor-cycle/);
  await transitionSliceTdd({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,
    sliceId:'SLICE-001',to:'SENSOR_CLEAN',sensorOperationIds:rows.map((row)=>row.operationId),
    sensorResultsSha256:digest,afterWriteOperationId:accepted.operationId});
  const final=parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
  assert.equal(final.tdd_state,'SENSOR_CLEAN');assert.equal(final.fresh_sensor_required,false);
  assert.match(final.sensor_cycle_operation_id,/^op-/);assert.equal(final.sensor_results_sha256,digest);
  const freshState=platform.issueProjectStateCapability(f.root,f.statePath,{role:'session-state'});
  const freshSession=platform.issueProjectStateCapability(f.root,f.sessionCapability.path,
    {role:'session-work-dir',sessionStateCapability:freshState});
  const freshPlan=transaction.issueSessionFileCapability({sessionCapability:freshSession,candidate:f.planCapability.path,
    allowedBasenames:['plan.json'],role:'locked-plan'});
  const receiptsDir=path.join(freshSession.path,'receipts');fs.mkdirSync(receiptsDir);
  const receiptsDirCapability=Object.freeze({kind:'receipts-directory',role:'receipts-directory',path:receiptsDir,
    sessionCapability:freshSession,projectRoot:f.root});const authored={slice_id:'SLICE-001',status:'complete',
    tdd_state:'SENSOR_CLEAN',sensor_results_sha256:digest};
  const temp=await artifact.createOwnedTemp({sessionCapability:freshSession,purpose:'receipt-payload'});
  await artifact.writeOwnedTemp({sessionCapability:freshSession,operationId:temp.operationId,
    purpose:'receipt-payload'},Buffer.from(JSON.stringify(authored)));
  const completionArgs={stateCapability:freshState,planCapability:freshPlan,plan:f.plan,
    receiptsDirCapability,sliceId:'SLICE-001',receiptTemp:{sourceOperationId:temp.operationId,
      purpose:'receipt-payload',sessionCapability:freshSession}};
  await assert.rejects(()=>completeSlice({...completionArgs,seam:(name)=>{if(name==='after-receipt-write')
    throw new Error('kill-slice-receipt');}}),/kill-slice-receipt/);
  const completed=await completeSlice({...completionArgs,stateCapability:
    platform.issueProjectStateCapability(f.root,f.statePath,{role:'session-state'})});
  assert.equal(completed.status,'complete');assert.equal(JSON.parse(fs.readFileSync(freshPlan.path,'utf8')).slices[0].checked,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(receiptsDir,'SLICE-001.json'),'utf8')).slice_id,'SLICE-001');
  const completedState=parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
  assert.equal(completedState.active_slice,null);assert.equal(completedState.tdd_state,'PENDING');
});
