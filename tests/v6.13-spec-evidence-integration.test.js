'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const runtime=require('../runtime/evidence-runtime.js');
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/v6.13-evidence/verification-plan-minimal.json'),'utf8'));
test('release blocker finds zero raw secret bytes across persistent surfaces',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-evidence-'));
  const secret='sentinel-v6.13-never-persist';const record=await runtime.captureCommandEvidence({evidence_id:'EVID-COMMAND',
    gate_id:plan.evidence_required_gate_ids[0],verification_spec:{schema_version:1,executable:{kind:'node',value:'node'},args:['x'],
      cwd_role:'active-worktree',timeout_ms:1000,max_output_bytes:4096},expected_outcome:'must-pass',requirement_ids:['REQ-001'],
      invariant_ids:[],failure_mode_ids:[],negative_test_ids:[],redaction_policy:{exact_secret_values:[secret]}},
    {runner:async()=>({exitCode:0,stdout:secret,stderr:'',durationMs:1})});
  const ref=runtime.publishRedactedEvidenceArtifactUnderLock({projectRoot:root,record});const bytes=fs.readFileSync(path.join(root,ref.artifact_ref),'utf8');
  assert.doesNotMatch(bytes,new RegExp(secret));assert.match(bytes,/<REDACTED:exact-secret>/);
});
test('verification plan rejects concrete authority, gate and coverage corruption',()=>{
  const {validateVerificationPlan}=require('../runtime/verification-policy-runtime.js');
  assert.equal(validateVerificationPlan(plan).pass,true);
  const mutations=[
    ['stale digest', p=>{p.plan_sha256='0'.repeat(64);} ],
    ['unknown gate', p=>{p.gates[0].id='GATE-invented';}],
    ['missing required gate', p=>{p.required_gate_ids.pop();}],
    ['duplicate gate', p=>{p.gates.push(structuredClone(p.gates[0]));}],
    ['wrong risk authority', p=>{p.risk_profile_sha256='f'.repeat(64);}],
    ['missing evidence gate', p=>{p.evidence_required_gate_ids.pop();}],
    ['wrong schema type', p=>{p.schema_version='2';}],
    ['unbound requirement', p=>{p.gates[0].requirement_ids=['REQ-FOREIGN'];}],
  ];
  for(const [name,mutate] of mutations){const candidate=structuredClone(plan);mutate(candidate);
    assert.equal(validateVerificationPlan(candidate).pass,false,name);}
});
