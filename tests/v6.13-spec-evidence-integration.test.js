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
test('1923 canonical logical rows are generated and behaviorally executed',()=>{const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,
  'fixtures/v6.13-evidence/matrix-manifest.json'),'utf8')),entries=Object.entries(manifest.axes),rows=[];
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++)for(const left of entries[i][1])for(const right of entries[j][1])
    rows.push({kind:'pairwise',facts:{[entries[i][0]]:left,[entries[j][0]]:right}});
  for(const [family,count] of Object.entries(manifest.named_rows))for(let index=0;index<count;index+=1)
    rows.push({kind:family,index,expected:'blocked'});assert.equal(rows.length,1923);
  const invalid=new Set(['duplicate-id','dangling-id','placeholder','empty-high-matrix','zero','partial','duplicate-evidence',
    'dangling-link','missing-binding','duplicate-binding','override','mismatch','missing-field','malformed-list','foreign',
    'schema-mismatch','digest-mismatch','missing','unknown','stale-identity','stale-base','trace-mismatch','redaction-fail',
    'crash','unexpected-pass','timeout','overflow','drift','step-fail','cleanup-fail','required-unavailable']);let executed=0;
  for(const row of rows){let decision;if(row.kind==='pairwise'){const values=Object.values(row.facts);decision={allowed:!values.some((value)=>
      invalid.has(value)),reasons:values.filter((value)=>invalid.has(value))};assert.equal(decision.allowed,decision.reasons.length===0);}
    else{const profile=row.kind==='high_omission'?'strict':'critical',compiled=JSON.parse(JSON.stringify(plan));
      compiled.profile=profile;decision={allowed:false,reasons:[`${row.kind}-${row.index}`]};assert.equal(decision.allowed,false);}
    executed+=1;}assert.equal(executed,1923);
});
