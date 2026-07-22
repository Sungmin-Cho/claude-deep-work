'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseSpecMarkdown, validateSpecContract, specContractDigest } = require('../runtime/contract-runtime.js');
const {compilePlanProjectionV1}=require('../runtime/plan-runtime.js');
const {approveSpecSubphase,advancePhase}=require('../runtime/phase-runtime.js');
const {compileVerificationPlan}=require('../runtime/verification-policy-runtime.js');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot=path.join(repoRoot,'tests/fixtures/v6.13-spec');
function fixture(group,name){return fs.readFileSync(path.join(fixtureRoot,group,name),'utf8');}

function emitSpecFromTemplate() {
  return fs.readFileSync(path.join(repoRoot, 'skills/shared/templates/spec-template.md'), 'utf8')
    .replace('[Title]', 'Spec Contract Integration')
    .replace('[Observable behavior included in this change]', 'A Medium session emits a validated executable spec.')
    .replace('[Explicitly excluded behavior]', 'No implementation source is changed by deep-spec.')
    .replace('[One observable requirement]', 'The emitted contract is machine-validatable.')
    .replace('[Exact pass condition]', 'The contract validator returns pass true.')
    .replace('[State that must always hold]', 'The approved whole-file bytes remain digest-bound.')
    .replace('[Concrete fault or invalid input]', 'The approved spec bytes change after review.')
    .replace('[Fail-safe behavior]', 'Plan admission is denied until review is repeated.')
    .replace('[Observable signal]', 'The freshness gate reports a stale approval hash.')
    .replace('[Recovery verification or not-applicable with reason]', 'Review the current bytes and record their SHA-256.')
    .replace('[Rollback action or not-applicable with reason]', 'Restore the last approved spec bytes.')
    .replace('[Exact negative test]', 'Mutate spec.md after approval and attempt plan admission.')
    .replace('[Exact failure signal]', 'spec-approval-stale')
    .replace('[accepted/rejected behavior]', 'Legacy no-spec input is rejected for a fresh Medium session.')
    .replace('[none or exact migration]', 'Run deep-spec before phase advance.')
    .replace('[Rationale and source evidence. Do not restate the normative JSON ambiguously.]',
      'REQ-001 makes validation observable at the Spec Gate.')
    .replace('[Why the negative test and recovery evidence are sufficient.]',
      'NEG-001 proves stale reviewed bytes cannot advance.')
    .replace('[Decision, rejected alternative, reason]',
      'Use one JSON fence; Markdown tables were rejected because escaping is ambiguous.')
    .replace('- Status: PENDING', '- Status: PASS')
    .replace('- Spec digest: PENDING', `- Spec digest: ${'a'.repeat(64)}`)
    .replace('- Requirement coverage: PENDING', '- Requirement coverage: 1')
    .replace('- Failure matrix coverage: PENDING', '- Failure matrix coverage: not-applicable');
}

test('emitted spec has no unresolved markers', () => {
  const emitted = emitSpecFromTemplate();
  assert.doesNotMatch(emitted, /\[(?:Title|Observable|Explicitly|One |Exact|State|Concrete|Fail-safe|Observable|Recovery|Rollback|accepted|none |Rationale|Why |Decision)/);
  assert.doesNotMatch(emitted, /\b(?:PENDING|TBD|TODO|FIXME|PLACEHOLDER)\b/);
  const contract = parseSpecMarkdown(emitted, { path: 'spec.md' });
  const result = validateSpecContract(contract, { riskClass: 'medium' });
  assert.equal(result.pass, true, JSON.stringify(result.errors));
  assert.equal(result.requirementCoverage.contract.ratio, 1);
});

test('Medium strict flow reaches implement only at execution coverage 1', () => {
  const contract=parseSpecMarkdown(emitSpecFromTemplate());
  contract.requirements.push({id:'REQ-002',statement:'A second observable requirement is preserved.',
    acceptance:'A slice and evidence gate cover REQ-002.',priority:'must',negative_test_ids:[],
    evidence_gate_ids:['GATE-targeted-tests']});
  const binding={schema_version:1,mode:'strict-spec',created_by_version:'6.13.0',spec_contract:{schema_version:1,
    spec_id:contract.spec_id,spec_sha256:specContractDigest(contract),spec_approved_hash:'a'.repeat(64)},
    risk_profile_sha256:'b'.repeat(64)};
  const plan=['## Spec Contract Binding','```json',JSON.stringify(binding),'```','## Slice Checklist',
    '- [ ] SLICE-001: Cover only one requirement','  - outcome: REQ-001 is covered',
    '  - files: [runtime/a.js, runtime/a.test.js]','  - depends_on: []',
    '  - integration_touchpoints: [plan admission]','  - requirements: [REQ-001]',
    '  - invariants: [INV-001]','  - failure_modes: [FM-001]',
    '  - risk: { class: medium, score: 6, triggers: [strict-admission] }',
    '  - negative_tests: [NEG-001]','  - evidence_required: [GATE-targeted-tests]',
    '  - rollback: { method: revert, verification: [GATE-recovery] }','  - review_policy: dual',
    '  - scope_expansion_trigger: [new requirement]','  - failing_test: missing projection fails',
    '  - verification_cmd: node --test runtime/a.test.js','  - expected_output: fail 0',
    '  - code_sketch: compilePlanProjectionV1()','  - spec_checklist: [REQ-001]',
    '  - contract: [coverage is exact]','  - acceptance_threshold: all','  - size: M','  - steps:',
    '    1. add the failing test','    2. add the production behavior'].join('\n');
  assert.throws(()=>compilePlanProjectionV1({planMarkdown:plan,specContract:contract,
    sliceRiskState:{'SLICE-001':{class:'medium',score:6,triggers:['strict-admission']}}}),
  /execution-requirement-coverage/);
});

test('PR4 fixture matrix covers legacy, strict admission, and stale binding', () => {
  const low=parseSpecMarkdown(fixture('low-legacy','spec.md'));
  const lowResult=validateSpecContract(low,{riskClass:'low'});
  assert.equal(lowResult.pass,true);assert.equal(lowResult.requirementCoverage.contract.ratio,null);
  assert.equal(lowResult.failureMatrixCoverage.contract.ratio,null);

  for(const [group,risk,score,triggers] of [['medium-valid','medium',6,['strict-admission']],
    ['high-valid','high',9,['failure-matrix']]]){
    const spec=parseSpecMarkdown(fixture(group,'spec.md'));const plan=fixture(group,'plan.md');
    const projection=compilePlanProjectionV1({planMarkdown:plan,specContract:spec,
      sliceRiskState:{'SLICE-001':{class:risk,score,triggers}}});
    const coverage=validateSpecContract(spec,{riskClass:risk,slices:projection.slices.map((row)=>row.contract)});
    assert.equal(coverage.pass,true,JSON.stringify(coverage.errors));
    assert.equal(coverage.requirementCoverage.execution.ratio,1);
    if(risk==='high')assert.equal(coverage.failureMatrixCoverage.execution.ratio,1);
  }

  const invalid=parseSpecMarkdown(fixture('invalid-matrix','spec.md'));
  assert.equal(validateSpecContract(invalid,{riskClass:'high'}).pass,false);
  const medium=parseSpecMarkdown(fixture('medium-valid','spec.md'));
  assert.throws(()=>compilePlanProjectionV1({planMarkdown:fixture('invalid-binding','plan.md'),specContract:medium,
    sliceRiskState:{'SLICE-001':{class:'medium',score:6,triggers:['strict-admission']}}}),/plan-binding-identity/);
});

test('High omission matrix blocks every incomplete row', () => {
  const valid=parseSpecMarkdown(fixture('high-valid','spec.md'));
  const keys=['id','trigger','affected_requirement_ids','invariant_ids','expected_behavior','detection',
    'negative_test_ids','evidence_gate_ids','recovery','rollback'];
  for(const key of keys){const candidate=structuredClone(valid);delete candidate.failure_matrix[0][key];
    const result=validateSpecContract(candidate,{riskClass:'high'});
    assert.equal(result.pass,false,`${key} omission passed`);
  }
});

test('Medium fixture reaches implement only after fresh spec and plan gates', () => {
  const contract=parseSpecMarkdown(fixture('medium-valid','spec.md'));const approvedHash='a'.repeat(64);
  const validation=validateSpecContract(contract,{riskClass:'medium'});const specSha256=specContractDigest(contract);
  const gate={schema_version:1,pass:true,spec_id:contract.spec_id,spec_sha256:specSha256,risk_class:'medium',errors:[],warnings:[],
    requirement_coverage:validation.requirementCoverage,failure_matrix_coverage:validation.failureMatrixCoverage};
  const approved=approveSpecSubphase({state:{current_phase:'research',subphase:'spec',spec_policy_required:true},
    specApprovedHash:approvedHash,specContract:contract,specGateResult:gate,at:'2026-07-22T01:00:00Z'});
  const plan=advancePhase({state:{...approved,spec_current_sha256:approvedHash},from:'research',to:'plan',
    at:'2026-07-22T01:01:00Z'});
  assert.throws(()=>advancePhase({state:plan,from:'plan',to:'implement'}),/plan-spec-gate-required/);
  const planProjection=compilePlanProjectionV1({planMarkdown:fixture('medium-valid','plan.md'),specContract:contract,
    sliceRiskState:{'SLICE-001':{class:'medium',score:6,triggers:['strict-admission']}}});
  const verificationPlan=compileVerificationPlan({riskProfile:{class:'medium'},riskProfileSha256:'b'.repeat(64),
    policySnapshot:{risk_class:'medium',profile:'standard',verification_policy:{recommended:'표준 검증'}},specContract:contract,
    specSha256,specApprovedHash:approvedHash,planProjection,capabilities:{},
    compatibilityFacts:{created_by_version:'6.13.0',spec_policy_required:true}});
  const implemented=advancePhase({state:{...plan,plan_spec_gate_result_json:'{"pass":true}',
    plan_projection_sha256:require('node:crypto').createHash('sha256').update(require('../runtime/operation-journal.js').canonicalJson(planProjection)).digest('hex'),
    plan_source_sha256:planProjection.contract_binding.source_plan_sha256,risk_profile_sha256:'b'.repeat(64),
    verification_plan_json:JSON.stringify(verificationPlan),verification_plan_sha256:verificationPlan.plan_sha256},from:'plan',to:'implement',
    at:'2026-07-22T01:02:00Z'});
  assert.equal(implemented.current_phase,'implement');
});
