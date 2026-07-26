'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');
const journal=require('./operation-journal.js');
const frontmatter=require('./frontmatter.js');
const bootstrap=require('./bootstrap-runtime.js');
const {compileImmutablePlanAuthorityV2,deriveScopedWriteAuthority}=require('./plan-runtime.js');
const {beginScopedWrite,acceptScopedWrite}=require('./slice-runtime.js');
const {transitionOrdinaryRed,publishOrdinaryRedProof,semanticDigest}=
  require('./red-proof-runtime.js');
const {runVerificationV2,buildSupervisorControl}=require('./verification-v2-runtime.js');

test('strict verification v2 exposes the governed production runner',()=>{
  assert.equal(typeof runVerificationV2,'function');
});

test('Windows verification control authenticates taskkill without entering the child environment',
  (t)=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-supervisor-control-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    fs.mkdirSync(path.join(root,'System32'));
    fs.writeFileSync(path.join(root,'System32','taskkill.exe'),'pinned-taskkill');
    const control=buildSupervisorControl({platformName:'win32',
      environment:{SystemRoot:root},fsImpl:fs,pathImpl:path});
    assert.deepEqual(Object.keys(control.values),['SystemRoot']);
    assert.deepEqual(Object.keys(control.identities.system_root).sort(),
      ['dev','ino','mode','path']);
    assert.deepEqual(Object.keys(control.identities.taskkill).sort(),
      ['dev','ino','mode','mtime_ns','path','sha256','size']);
    assert.equal(control.identities.taskkill.sha256,
      crypto.createHash('sha256').update('pinned-taskkill').digest('hex'));
    assert.deepEqual(Object.keys({LANG:'C',LC_ALL:'C',TZ:'UTC'}).sort(),
      ['LANG','LC_ALL','TZ']);
  });

function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-red-proof-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  execFileSync('git',['init','-q'],{cwd:root});
  execFileSync('git',['config','user.email','test@example.invalid'],{cwd:root});
  execFileSync('git',['config','user.name','Deep Work Test'],{cwd:root});
  fs.mkdirSync(path.join(root,'runtime'),{recursive:true});
  fs.writeFileSync(path.join(root,'runtime','a.js'),'module.exports=1;\n');
  fs.writeFileSync(path.join(root,'runtime','a.test.js'),'// base\n');
  fs.writeFileSync(path.join(root,'.gitignore'),'.claude/\n.deep-work/\n');
  execFileSync('git',['add','-A'],{cwd:root});
  execFileSync('git',['commit','-qm','base'],{cwd:root});
  const failing=["'use strict';","const test=require('node:test');",
    "const assert=require('node:assert/strict');",
    "test('expected red',()=>assert.strictEqual(1,2));",''].join('\n');
  fs.writeFileSync(path.join(root,'runtime','a.test.js'),failing);
  fs.mkdirSync(path.join(root,'.tmp-probe'));
  const probe=spawnSync(process.execPath,
    ['--no-warnings','--permission',`--allow-fs-read=${root}`,
      `--allow-fs-write=${path.join(root,'.tmp-probe')}`,'--test','--test-isolation=none',
      '--test-reporter=tap','--','runtime/a.test.js'],
    {cwd:root,env:{LANG:'C',LC_ALL:'C',TZ:'UTC'},encoding:null});
  assert.equal(probe.status,1);
  assert.equal(probe.stderr.length,0,probe.stderr.toString('utf8'));
  const event=bootstrap.parseNodeTapFailure(probe.stdout.toString('utf8'),{
    root,testPath:'runtime/a.test.js'});
  const expectedSignal={kind:'assertion',operator:'strictEqual',
    test_identity:{test_file:event.test_file,test_name:event.test_name,start_line:event.start_line},
    expected_digest:event.expected_digest,actual_digest:event.actual_digest,
    message_pattern:'Expected values to be strictly equal'};
  const spec={schema_version:2,executable:{kind:'node-toolchain',name:'node',
    supported_patches_sha256:bootstrap.BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256},
  args:['--test','--test-reporter=tap','--','runtime/a.test.js'],cwd_role:'worktree',
  timeout_ms:120000,max_output_bytes:1048576,
  environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},
  red_failure:{adapter:'node-test-tap',adapter_version:1,expected_class:'expected-failure',
    expected_signal:expectedSignal}};
  const specSha256=journal.sha256(journal.canonicalJson(spec));
  const facts={schema_version:1,authority:'reviewed-plan',destructive:false,
    external_action:false,has_backward_compat:true,has_migration:true,host_dependent:true,
    source_requirement_ids:['REQ-001'],source_slice_ids:['SLICE-002']};
  facts.facts_sha256=semanticDigest('capability-facts-v1',facts,'facts_sha256');
  const plan={schema_version:2,replan_epoch:'0'.repeat(64),
    contract_binding:{mode:'strict-spec',created_by_version:'6.14.0',
      source_plan_sha256:'1'.repeat(64),risk_profile_sha256:'2'.repeat(64),
      spec_contract:{schema_version:1,spec_id:'SPEC-RED',
        spec_sha256:'3'.repeat(64),spec_approved_hash:'4'.repeat(64)}},
    capability_facts:facts,slices:[
      {id:'SLICE-001',slice_kind:'functional',checked:false,scope_schema_version:1,
        files:['runtime/a.js','runtime/a.test.js'],write_scope:{
          failing_test:['runtime/a.test.js'],production:['runtime/a.js'],refactor:[]},
        verification_spec:spec,verification_spec_sha256:specSha256},
      {id:'SLICE-002',slice_kind:'release-verification',checked:false,
        scope_schema_version:1,files:[],write_scope:{
          failing_test:[],production:[],refactor:[]},verification_scope:['npm test'],
        release_gate_ids:['GATE-full-relevant-suite'],verification_spec:null,
        verification_spec_sha256:null},
    ]};
  plan.plan_authority_sha256=compileImmutablePlanAuthorityV2(plan).plan_authority_sha256;
  fs.writeFileSync(path.join(root,'runtime','a.test.js'),'// base\n');
  fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  const work=path.join(root,'.deep-work','s-aaaaaaaa');
  fs.mkdirSync(work,{recursive:true});
  const statePath=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');
  const verificationPlanSha256='5'.repeat(64);
  fs.writeFileSync(statePath,frontmatter.updateFrontmatterText('',{
    session_id:'s-aaaaaaaa',work_dir:'.deep-work/s-aaaaaaaa',
    current_phase:'implement',active_slice:'SLICE-001',tdd_state:'PENDING',
    verification_plan_sha256:verificationPlanSha256,risk_class:'critical'}));
  const stateCapability=platform.issueProjectStateCapability(root,statePath,{
    role:'session-state'});
  const sessionCapability=platform.issueProjectStateCapability(root,work,{
    role:'session-work-dir',sessionStateCapability:stateCapability});
  const planCapability=transaction.issueSessionFileCapability({sessionCapability,
    candidate:path.join(work,'plan.json'),allowedBasenames:['plan.json'],
    allowMissingLeaf:true,role:'locked-plan'});
  fs.writeFileSync(planCapability.path,journal.canonicalJson(plan));
  return{root,statePath,stateCapability,planCapability,plan,spec,failing,
    verificationPlanSha256};
}

test('ordinary RED transition and proof publication authorize the exact strict production write',
  async(t)=>{
    const f=fixture(t);
    const scope=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test'});
    const begun=await beginScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test',expectedScopeSha256:scope.sha256});
    await assert.rejects(()=>runVerificationV2({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001'}),
    /pending-scoped-write/);
    fs.writeFileSync(path.join(f.root,'runtime','a.test.js'),f.failing);
    const accepted=await acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
    assert.equal(accepted.status,'accepted');
    const verification=await runVerificationV2({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001'});
    assert.equal(verification.disposition,'accepted');
    assert.deepEqual(fs.readdirSync(path.join(f.root,'.claude')).filter((name)=>
      name.includes('.verification-temp.')),[]);
    const replay=await runVerificationV2({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001'});
    assert.equal(replay.adopted,true);
    assert.deepEqual(fs.readdirSync(path.join(f.root,'.claude')).filter((name)=>
      name.includes('.verification-temp.')),[]);
    const result=JSON.parse(fs.readFileSync(path.join(f.root,
      verification.verification_result_path),'utf8'));
    const preManifestPath=path.join(f.root,...result.pre_manifest_ref.path.split('/'));
    const preManifestBytes=fs.readFileSync(preManifestPath);
    const tampered=JSON.parse(preManifestBytes);
    tampered.entries[0].sha256='f'.repeat(64);
    fs.writeFileSync(preManifestPath,journal.canonicalJson(tampered));
    await assert.rejects(()=>transitionOrdinaryRed({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      verificationOperationId:verification.operation_id,
      verificationResultSha256:verification.verification_result_sha256}),
    /verification-v2-manifest/);
    fs.writeFileSync(preManifestPath,preManifestBytes);
    const transitioned=await transitionOrdinaryRed({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      verificationOperationId:verification.operation_id,
      verificationResultSha256:verification.verification_result_sha256});
    const published=await publishOrdinaryRedProof({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      transitionOperationId:transitioned.operation_id});
    const fields=frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
    assert.equal(fields.red_proof_state,'complete');
    assert.equal(fields.red_proof_sha256,published.proof_sha256);
    const productionScope=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',
      writeClass:'production'});
    const production=await beginScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      writeClass:'production',expectedScopeSha256:productionScope.sha256});
    assert.match(production.operationId,/^op-[0-9a-f]{64}$/);
  });

test('a ledger-complete verification side effect automatically enters authenticated replan',
  async(t)=>{
    const f=fixture(t);
    const scope=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test'});
    const begun=await beginScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test',expectedScopeSha256:scope.sha256});
    fs.writeFileSync(path.join(f.root,'runtime','a.test.js'),f.failing);
    await acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
    const verification=await runVerificationV2({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      seam:(stage)=>{
        if(stage==='after-process-before-post-manifest')
          fs.writeFileSync(path.join(f.root,'runtime','a.js'),'module.exports=2;\n');
      }});
    assert.equal(verification.disposition,'rejected');
    assert.equal(verification.observed_class,'test-side-effect');
    assert.match(verification.replan_trigger_id,/^[0-9a-f]{64}$/);
    assert.match(verification.replan_epoch,/^[0-9a-f]{64}$/);
    const fields=frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
    assert.equal(fields.current_phase,'research');
    assert.equal(fields.subphase,'spec');
    assert.equal(fields.replan_required,true);
    assert.equal(fields.replan_reason,'test-side-effect');
    assert.equal(fields.tdd_state,'PENDING');
    assert.equal(fields.red_proof_state,null);
    const replay=await runVerificationV2({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001'});
    assert.equal(replay.adopted,true);
    assert.equal(replay.replan_trigger_id,verification.replan_trigger_id);
    assert.equal(replay.replan_epoch,verification.replan_epoch);
  });

test('strict scoped-write acceptance converts expanded scope into needs-replan authority',
  async(t)=>{
    const f=fixture(t);
    const scope=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test'});
    const begun=await beginScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test',expectedScopeSha256:scope.sha256});
    fs.writeFileSync(path.join(f.root,'runtime','a.test.js'),f.failing);
    fs.writeFileSync(path.join(f.root,'runtime','a.js'),'module.exports=99;\n');
    const result=await acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
    assert.equal(result.status,'needs-replan');
    assert.equal(result.observationKind,'scope-expansion');
    assert.match(result.acceptOrReplanOperationId,/^op-[0-9a-f]{64}$/);
    const fields=frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
    assert.equal(fields.replan_required,true);
    assert.equal(fields.replan_reason,'scope-expansion');
    assert.equal(fields.active_slice,null);
    assert.equal(fields.accepted_write_operation_id,null);
    const replay=await acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
    assert.equal(replay.status,'needs-replan');
    assert.equal(replay.acceptOrReplanOperationId,result.acceptOrReplanOperationId);
  });

test('strict scoped-write acceptance treats an authorized-path race as manifest divergence',
  async(t)=>{
    const f=fixture(t);
    const scope=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test'});
    const begun=await beginScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test',expectedScopeSha256:scope.sha256});
    fs.writeFileSync(path.join(f.root,'runtime','a.test.js'),f.failing);
    const result=await acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256,
      seam:(stage)=>{
        if(stage==='after-candidate-post-manifest')
          fs.appendFileSync(path.join(f.root,'runtime','a.test.js'),'// raced\n');
      }});
    assert.equal(result.status,'needs-replan');
    assert.equal(result.observationKind,'manifest-divergence');
    assert.deepEqual(result.needsReplanReceipt.affected_paths,['runtime/a.test.js']);
  });

test('accept-or-replan recovers after invalidation state write before its durable stage',
  async(t)=>{
    const f=fixture(t);
    const scope=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test'});
    const begun=await beginScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test',expectedScopeSha256:scope.sha256});
    fs.writeFileSync(path.join(f.root,'runtime','a.test.js'),f.failing);
    fs.writeFileSync(path.join(f.root,'runtime','a.js'),'module.exports=99;\n');
    let crashed=false;
    await assert.rejects(()=>acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256,
      seam:(stage)=>{
        if(!crashed&&stage==='after-invalidation-state-write-before-stage'){
          crashed=true;throw new Error('crash-after-invalidation');
        }
      }}),/crash-after-invalidation/);
    const pending=frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
    assert.equal(JSON.parse(pending.pending_scoped_write_json).stage,'accept-or-replan');
    const recovered=await acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
    assert.equal(recovered.status,'needs-replan');
    assert.equal(frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields
      .pending_scoped_write_json,null);
  });

test('accept-or-replan completes its child ledger after parent completion return loss',
  async(t)=>{
    const f=fixture(t);
    const scope=deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test'});
    const begun=await beginScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      writeClass:'failing-test',expectedScopeSha256:scope.sha256});
    fs.writeFileSync(path.join(f.root,'runtime','a.test.js'),f.failing);
    fs.writeFileSync(path.join(f.root,'runtime','a.js'),'module.exports=99;\n');
    await assert.rejects(()=>acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256,
      seam:(stage)=>{
        if(stage==='after-parent-ledger-before-child-resolution')
          throw new Error('lost-parent-result');
      }}),/lost-parent-result/);
    const recovered=await acceptScopedWrite({stateCapability:f.stateCapability,
      planCapability:f.planCapability,plan:f.plan,sliceId:'SLICE-001',
      operationId:begun.operationId,preManifestSha256:begun.preManifestSha256});
    assert.equal(recovered.status,'needs-replan');
    assert.equal(recovered.acceptOrReplanReceipt.stage,'completed-ledger');
    assert.equal(frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields
      .pending_scoped_write_json,null);
  });
