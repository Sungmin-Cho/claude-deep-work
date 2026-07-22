'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {canonicalJson}=require('./operation-journal.js');
const {compileVerificationPlan,requiredGateIds,validateVerificationPlan,computeResidualRisk}=require('./verification-policy-runtime.js');
const labels={lean:'최소 검증 (기록 전용)',standard:'표준 검증',strict:'강화 검증',critical:'전수 검증 + human gate'};
function input(risk_class,profile){return{riskProfile:{class:risk_class,score:5,triggers:[]},riskProfileSha256:'c'.repeat(64),
  policySnapshot:{risk_class,profile,verification_policy:{recommended:labels[profile]}},
  specContract:{schema_version:1,spec_id:'SPEC-POLICY',risk_class,requirements:[{id:'REQ-001'}],failure_modes:[]},
  specSha256:'a'.repeat(64),specApprovedHash:'b'.repeat(64),planProjection:{schema_version:1,
    contract_binding:{mode:'strict-spec',created_by_version:'6.13.0',source_plan_sha256:'d'.repeat(64),
      risk_profile_sha256:'c'.repeat(64),spec_contract:{spec_id:'SPEC-POLICY',spec_sha256:'a'.repeat(64),
        spec_approved_hash:'b'.repeat(64)}},slices:[]},capabilities:{},
  compatibilityFacts:{created_by_version:'6.13.0',spec_policy_required:true}};}
test('required gate sets are monotonic low through critical',()=>{const rows=[['low','lean'],['medium','standard'],['high','strict'],['critical','critical']]
  .map(([risk,profile])=>compileVerificationPlan(input(risk,profile)));for(const plan of rows)assert.equal(validateVerificationPlan(plan).pass,true);
  for(let i=1;i<rows.length;i++){const prev=new Set(rows[i-1].required_gate_ids);for(const id of prev)assert.equal(rows[i].required_gate_ids.includes(id),true,id);}
  assert.equal(requiredGateIds(rows[3],{at:'finish-pre-action'}).includes('GATE-human-ack'),true);
});

test('validator recomputes required dispositions and rejects a Critical zero-gate downgrade',()=>{
  const downgraded=structuredClone(compileVerificationPlan(input('critical','critical')));
  for(const gate of downgraded.gates)gate.disposition='advisory';
  downgraded.required_gate_ids=[];downgraded.evidence_required_gate_ids=[];
  const preimage=structuredClone(downgraded);delete preimage.plan_sha256;
  downgraded.plan_sha256=crypto.createHash('sha256').update(canonicalJson(preimage)).digest('hex');
  const result=validateVerificationPlan(downgraded);
  assert.equal(result.pass,false);assert.ok(result.errors.some((row)=>row.code==='verification-plan-disposition'));
});

test('compiler embeds durable compatibility proof and evidence accepts the exact catalog round trip',()=>{
  const plan=compileVerificationPlan(input('medium','standard'));
  assert.equal(plan.compatibility_mode,'strict-spec');
  assert.match(plan.compatibility_proof_sha256,/^[0-9a-f]{64}$/);
  assert.equal(validateVerificationPlan(JSON.parse(canonicalJson(plan))).pass,true);
  assert.doesNotThrow(()=>require('./evidence-runtime.js').validateVerificationPlan(plan));
});

test('invalid risk acceptance cannot authorize residual downgrade',()=>{
  const residual=computeResidualRisk({initialRisk:{class:'medium'},finalRisk:{class:'high'},
    evidenceSummary:{complete:true},unverifiedAreas:[{gate_id:'GATE-host-smoke',reason:'host-unverified'}],
    riskAcceptances:[{}]});
  assert.equal(residual.accepted,false);assert.ok(residual.invalid_acceptance_ids.length>0);
});
