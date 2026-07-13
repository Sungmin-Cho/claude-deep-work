'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync}=require('node:child_process');
const { activateSlice, enterSliceSpike, setSliceModel, setExecutionOverride,
  setDelegationSnapshot, clearDelegationSnapshot, setClusterTakeover,
  clearClusterTakeover,beginScopedWrite,acceptScopedWrite,resetSlice } =
  require('./slice-runtime.js');
const { issueProjectStateCapability } = require('./platform.js');
const { parseFrontmatter } = require('./frontmatter.js');
const transaction=require('./transaction-runtime.js');
const { issueSessionFileCapability } = transaction;
const {deriveScopedWriteAuthority}=require('./plan-runtime.js');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-slice-'));
  execFileSync('git',['init','-q'],{cwd:root});
  execFileSync('git',['config','user.email','test@example.invalid'],{cwd:root});
  execFileSync('git',['config','user.name','Deep Work Test'],{cwd:root});
  fs.mkdirSync(path.join(root,'src'));fs.mkdirSync(path.join(root,'tests'));
  fs.writeFileSync(path.join(root,'src','a.js'),'module.exports=1;\n');
  fs.writeFileSync(path.join(root,'src','b.js'),'module.exports=2;\n');
  fs.writeFileSync(path.join(root,'tests','a.test.js'),'// a\n');
  fs.writeFileSync(path.join(root,'tests','b.test.js'),'// b\n');
  fs.writeFileSync(path.join(root,'.gitignore'),'.claude/\n.deep-work/\n');
  execFileSync('git',['add','-A'],{cwd:root});execFileSync('git',['commit','-qm','initial'],{cwd:root});
  fs.mkdirSync(path.join(root, '.claude'));
  const workDir = path.join(root, '.deep-work', 's-aaaaaaaa');
  const receiptsDir = path.join(workDir, 'receipts');
  fs.mkdirSync(receiptsDir, {recursive:true});
  const state = path.join(root, '.claude', 'deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(state, '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\ntdd_state: PENDING\nactive_slice: null\n---\n');
  const stateCapability = issueProjectStateCapability(root, state, {role:'session-state'});
  const sessionCapability = issueProjectStateCapability(root, workDir,
    {role:'session-work-dir',sessionStateCapability:stateCapability});
  const planCapability = issueSessionFileCapability({sessionCapability,
    candidate:path.join(workDir,'plan.json'),allowedBasenames:['plan.json'],
    allowMissingLeaf:true,role:'locked-plan'});
  const plan={schema_version:1,slices:[
    {id:'SLICE-001',checked:false,scope_schema_version:1,
      files:['src/a.js','tests/a.test.js'],write_scope:{
        failing_test:['tests/a.test.js'],production:['src/a.js'],refactor:['src/a.js']}},
    {id:'SLICE-002',checked:false,scope_schema_version:1,
      files:['src/b.js','tests/b.test.js'],write_scope:{
        failing_test:['tests/b.test.js'],production:['src/b.js'],refactor:['src/b.js']}},
  ]};
  fs.writeFileSync(planCapability.path,JSON.stringify(plan));
  const receiptsDirCapability=Object.freeze({kind:'receipts-directory',role:'receipts-directory',
    path:receiptsDir,sessionCapability,projectRoot:root});
  return {root,state,stateCapability,workDir,receiptsDir,receiptsDirCapability,
    sessionCapability,planCapability,plan};
}

test('slice reducers mutate only their declared fields', async () => {
  const f = setup();
  await activateSlice({stateCapability:f.stateCapability, plan:f.plan, sliceId:'SLICE-001'});
  let fields = parseFrontmatter(fs.readFileSync(f.state, 'utf8')).fields;
  assert.equal(fields.active_slice, 'SLICE-001');
  assert.equal(fields.tdd_state, 'PENDING');
  await enterSliceSpike({stateCapability:f.stateCapability, plan:f.plan, sliceId:'SLICE-001'});
  fields = parseFrontmatter(fs.readFileSync(f.state, 'utf8')).fields;
  assert.equal(fields.tdd_state, 'SPIKE');
});

test('model and execution values use closed enums and auto is never stored', async () => {
  const f = setup();
  await setSliceModel({stateCapability:f.stateCapability, sliceId:'SLICE-001', model:'opus'});
  await setExecutionOverride({stateCapability:f.stateCapability, value:null});
  const fields = parseFrontmatter(fs.readFileSync(f.state, 'utf8')).fields;
  assert.match(fields.model_overrides_json, /opus/);
  assert.equal(fields.execution_override, null);
  assert.throws(() => setExecutionOverride({stateCapability:f.stateCapability, value:'auto'}),
    /execution-override/);
});

test('atomic state reducers participate in the global rank context',async()=>{
  const f=setup();const outer=issueProjectStateCapability(f.root,path.join(f.root,'.claude','outer-target.lock'),
    {allowMissingLeaf:true,role:'lock'});await transaction.withRankedLocks([{rank:transaction.RANKS.target,capability:outer}],async()=>{
    await assert.rejects(()=>setExecutionOverride({stateCapability:f.stateCapability,value:'inline'}),/lock-rank-inversion/);
  });
});

test('SPIKE reset stashes once and adopts plan receipt and state writes',async()=>{
  const f=setup();fs.writeFileSync(f.state,fs.readFileSync(f.state,'utf8').replace('tdd_state: PENDING','tdd_state: SPIKE')
    .replace('active_slice: null','active_slice: SLICE-001'));f.plan.slices[0].checked=true;
  fs.writeFileSync(f.planCapability.path,JSON.stringify(f.plan));const receiptPath=path.join(f.receiptsDir,'SLICE-001.json');
  fs.writeFileSync(receiptPath,JSON.stringify({schema_version:'1.0',session_id:'s-aaaaaaaa',plan_sha256:'a'.repeat(64),
    slice_id:'SLICE-001',status:'complete',tdd_state:'SPIKE',tdd:{red:true},changes:{files_modified:['src/a.js'],lines_added:1,
      lines_removed:0},verification:{passed:true},spec_compliance:{ok:true},code_review:{ok:true},debug:{note:'old'},
    timestamp:'2026-07-13T00:00:00Z'}));fs.writeFileSync(path.join(f.root,'src','a.js'),'spike edit\n');
  const args=()=>{const stateCapability=issueProjectStateCapability(f.root,f.state,{role:'session-state'});const sessionCapability=
      issueProjectStateCapability(f.root,f.workDir,{role:'session-work-dir',sessionStateCapability:stateCapability});return{stateCapability,planCapability:
      issueSessionFileCapability({sessionCapability,candidate:f.planCapability.path,allowedBasenames:['plan.json'],role:'locked-plan'}),
      plan:JSON.parse(fs.readFileSync(f.planCapability.path,'utf8')),receiptsDirCapability:Object.freeze({kind:'receipts-directory',
        role:'receipts-directory',path:f.receiptsDir,sessionCapability,projectRoot:f.root}),sliceId:'SLICE-001'};};
  for(const target of ['after-plan-write-before-stage',
    'after-receipt-write-before-stage','after-state-write-before-stage'])await assert.rejects(()=>resetSlice({...args(),seam:(name)=>{
      if(name===target)throw new Error(target);}}),new RegExp(target));const result=await resetSlice(args());assert.equal(result.status,'reset');
  assert.equal(execFileSync('git',['stash','list'],{cwd:f.root,encoding:'utf8'}).trim().split('\n').filter(Boolean).length,1);
  assert.equal(fs.readFileSync(path.join(f.root,'src','a.js'),'utf8'),'module.exports=1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.planCapability.path,'utf8')).slices[0].checked,false);const receipt=JSON.parse(
    fs.readFileSync(receiptPath,'utf8'));assert.equal(receipt.status,'in_progress');assert.equal(receipt.tdd_state,'PENDING');
  assert.deepEqual(receipt.changes,{files_modified:[],lines_added:0,lines_removed:0});assert.equal(receipt.session_id,'s-aaaaaaaa');
  const fields=parseFrontmatter(fs.readFileSync(f.state,'utf8')).fields;assert.equal(fields.active_slice,'SLICE-001');
  assert.equal(fields.tdd_state,'PENDING');
});

test('delegation publication persists the exact Git snapshot and clears only a matching snapshot', async () => {
  const f=setup();const snapshot='a'.repeat(40);
  const assignment={schema_version:1,clusters:[{id:'C1',slices:['SLICE-001','SLICE-002']}]};
  const fresh=()=>{const stateCapability=issueProjectStateCapability(f.root,f.state,{role:'session-state'});const sessionCapability=
    issueProjectStateCapability(f.root,f.workDir,{role:'session-work-dir',sessionStateCapability:stateCapability});return{stateCapability,
      planCapability:issueSessionFileCapability({sessionCapability,candidate:f.planCapability.path,allowedBasenames:['plan.json'],role:'locked-plan'})};};
  let kill=true;await assert.rejects(()=>setDelegationSnapshot({...fresh(),
    plan:f.plan,assignment,snapshot,seam:(name)=>{if(kill&&name==='after-delegation-write-before-stage'){
      kill=false;throw new Error('lost-delegation-write');}}}),/lost-delegation-write/);kill=true;await assert.rejects(()=>setDelegationSnapshot({
    ...fresh(),plan:f.plan,assignment,
    snapshot,seam:(name)=>{if(kill&&name==='after-state-write-before-stage'){kill=false;throw new Error('lost-delegation-state');}}}),
    /lost-delegation-state/);const published=await setDelegationSnapshot({...fresh(),plan:f.plan,assignment,snapshot});
  let fields=parseFrontmatter(fs.readFileSync(f.state,'utf8')).fields;
  assert.equal(fields.delegation_snapshot,snapshot);
  assert.equal(fields.delegation_operation_id,published.operationId);
  assert.equal(fields.delegation_sha256,published.sha256);
  assert.equal(fs.readFileSync(path.join(f.workDir,'delegation-scope.json'),'utf8'),
    JSON.stringify({clusters:[{id:'C1',slices:['SLICE-001','SLICE-002']}],
      plan_sha256:published.planSha256,schema_version:1})+'\n');
  const before=fs.readFileSync(f.state);
  await assert.rejects(()=>clearDelegationSnapshot({stateCapability:fresh().stateCapability,
    snapshot:'b'.repeat(40)}),/delegation-snapshot-mismatch/);
  assert.deepEqual(fs.readFileSync(f.state),before);
  await clearDelegationSnapshot({stateCapability:fresh().stateCapability,snapshot});
  fields=parseFrontmatter(fs.readFileSync(f.state,'utf8')).fields;
  assert.equal(fields.delegation_snapshot,null);
  assert.equal(fields.delegation_operation_id,null);
  assert.equal(fields.delegation_sha256,null);
  assert.equal(fields.current_phase,'implement');
});

test('cluster takeover authenticates plan, delegation scope, snapshot, and exact receipts', async () => {
  const f=setup();const snapshot='c'.repeat(40);
  await setDelegationSnapshot({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,assignment:{schema_version:1,clusters:[{id:'C1',slices:['SLICE-001','SLICE-002']}]},snapshot});
  const writeReceipt=(sliceId,value)=>fs.writeFileSync(path.join(f.receiptsDir,`${sliceId}.json`),
    JSON.stringify({slice_id:sliceId,cluster_id:'C1',...value}));
  writeReceipt('SLICE-001',{status:'complete',git_before_slice:snapshot,git_after_slice:'d'.repeat(40)});
  const before=fs.readFileSync(f.state);
  await assert.rejects(()=>setClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:'e'.repeat(40)}),/takeover-snapshot-mismatch/);
  assert.deepEqual(fs.readFileSync(f.state),before);
  let result=await setClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot});
  assert.equal(result.active_cluster_takeover,'C1');
  result=await setClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot});
  assert.equal(result.active_cluster_takeover,'C1');
  await assert.rejects(()=>clearClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot}),/takeover-receipt-incomplete/);
  writeReceipt('SLICE-002',{status:'complete',git_before_slice:'d'.repeat(40),git_after_slice:'f'.repeat(40)});
  result=await clearClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot});
  assert.equal(result.active_cluster_takeover,null);
  result=await clearClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot});
  assert.equal(result.active_cluster_takeover,null);
});

test('cluster takeover rejects object state, changed plan, and receipt identity without rewriting state', async () => {
  const f=setup();const snapshot='1'.repeat(40);
  await setDelegationSnapshot({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,assignment:{schema_version:1,clusters:[{id:'C1',slices:['SLICE-001','SLICE-002']}]},snapshot});
  fs.writeFileSync(path.join(f.receiptsDir,'SLICE-001.json'),JSON.stringify({slice_id:'SLICE-002',
    cluster_id:'C1',status:'blocked',git_before_slice:snapshot,git_after_slice:'2'.repeat(40)}));
  let before=fs.readFileSync(f.state);
  await assert.rejects(()=>setClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot}),/takeover-receipt-identity/);
  assert.deepEqual(fs.readFileSync(f.state),before);
  fs.unlinkSync(path.join(f.receiptsDir,'SLICE-001.json'));
  const changed=structuredClone(f.plan);changed.slices[0].files.push('src/foreign.js');
  before=fs.readFileSync(f.state);
  await assert.rejects(()=>setClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:changed,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot}),/plan-scope/);
  assert.deepEqual(fs.readFileSync(f.state),before);
  const text=fs.readFileSync(f.state,'utf8').replace('active_slice: null',
    'active_slice: null\nactive_cluster_takeover: "{foreign}"');
  fs.writeFileSync(f.state,text);before=fs.readFileSync(f.state);
  await assert.rejects(()=>setClusterTakeover({stateCapability:f.stateCapability,
    planCapability:f.planCapability,plan:f.plan,receiptsDirCapability:f.receiptsDirCapability,
    clusterId:'C1',delegationSnapshot:snapshot}),/takeover-state-scalar/);
  assert.deepEqual(fs.readFileSync(f.state),before);
});

test('accepted refactor write alone enters REFACTOR_PENDING and binds an immutable cycle', async () => {
  const f=setup();
  fs.writeFileSync(f.state,fs.readFileSync(f.state,'utf8')
    .replace('tdd_state: PENDING','tdd_state: SENSOR_CLEAN')
    .replace('active_slice: null','active_slice: SLICE-001'));
  const authority=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',writeClass:'refactor'});
  const begun=await beginScopedWrite({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,sliceId:'SLICE-001',writeClass:'refactor',expectedScopeSha256:authority.sha256});
  fs.writeFileSync(path.join(f.root,'src','a.js'),'module.exports = 1;\n');
  const accepted=await acceptScopedWrite({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,
    sliceId:'SLICE-001',operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
  assert.equal(accepted.status,'accepted');
  const fields=parseFrontmatter(fs.readFileSync(f.state,'utf8')).fields;
  assert.equal(fields.tdd_state,'REFACTOR_PENDING');
  assert.equal(fields.fresh_sensor_required,true);
  const cycle=JSON.parse(fields.refactor_cycle);
  assert.equal(cycle.writeOperationId,begun.operationId);
  assert.equal(cycle.writeReceiptSha256,accepted.receiptSha256);
  assert.equal(cycle.verificationOperationId,null);
});

test('refactor accept adopts an exact receipt after interruption before state publication', async () => {
  const f=setup();fs.writeFileSync(f.state,fs.readFileSync(f.state,'utf8')
    .replace('tdd_state: PENDING','tdd_state: SENSOR_CLEAN')
    .replace('active_slice: null','active_slice: SLICE-001'));
  const authority=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',writeClass:'refactor'});
  const begun=await beginScopedWrite({stateCapability:f.stateCapability,planCapability:f.planCapability,
    plan:f.plan,sliceId:'SLICE-001',writeClass:'refactor',expectedScopeSha256:authority.sha256});
  fs.writeFileSync(path.join(f.root,'src','a.js'),'module.exports = 1;\n');
  await assert.rejects(()=>acceptScopedWrite({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,
    sliceId:'SLICE-001',operationId:begun.operationId,preManifestSha256:begun.preManifestSha256,
    seam:(name)=>{if(name==='after-receipt-write')throw new Error('kill-after-receipt');}}),/kill-after-receipt/);
  assert.equal(parseFrontmatter(fs.readFileSync(f.state,'utf8')).fields.tdd_state,'SENSOR_CLEAN');
  const adopted=await acceptScopedWrite({stateCapability:f.stateCapability,planCapability:f.planCapability,plan:f.plan,
    sliceId:'SLICE-001',operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
  assert.equal(adopted.status,'accepted');
  assert.equal(parseFrontmatter(fs.readFileSync(f.state,'utf8')).fields.tdd_state,'REFACTOR_PENDING');
});
