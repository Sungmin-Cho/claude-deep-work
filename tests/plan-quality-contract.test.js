const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('deep-plan requires executable slice steps', () => {
  const deepPlan = readRepoFile('skills/deep-plan/SKILL.md');

  assert.ok(deepPlan.includes('failing_test'));
  assert.ok(deepPlan.includes('code_sketch'));
  assert.match(deepPlan, /S: 2-4 steps/, 'steps required for every slice size');
  assert.ok(deepPlan.includes('steps required'));
  assert.ok(deepPlan.includes('M: 3-7 steps'));
  assert.ok(deepPlan.includes('L: 5-12 steps'));
  assert.ok(!deepPlan.includes('steps: (M/L 필수, S 선택)'));
});

test('planning references reject vague task checklists', () => {
  const planningGuide = readRepoFile('skills/shared/references/planning-guide.md');
  const planTemplates = readRepoFile('skills/shared/references/plan-templates.md');
  const implementationGuide = readRepoFile('skills/shared/references/implementation-guide.md');

  assert.ok(planningGuide.includes('Exact file path'));
  assert.ok(planningGuide.includes('failing_test'));
  assert.ok(planningGuide.includes('verification_cmd'));
  assert.ok(planningGuide.includes('expected_output'));
  assert.ok(planningGuide.includes('Code sketch'));
  assert.ok(planningGuide.includes('SLICE-NNN'));
  assert.ok(planTemplates.includes('Exact file path'));
  assert.ok(planTemplates.includes('failing_test'));
  assert.ok(planTemplates.includes('verification_cmd'));
  assert.ok(planTemplates.includes('expected_output'));
  assert.ok(planTemplates.includes('Code sketch'));
  assert.ok(planTemplates.includes('SLICE-NNN'));
  assert.doesNotMatch(planningGuide, /^- \[ \] Task \d+:/m);
  assert.doesNotMatch(planTemplates, /^- \[ \] Task \d+:/m);
  assert.doesNotMatch(implementationGuide, /^- \[ \] Task \d+:/m);
  assert.doesNotMatch(implementationGuide, /Task \d+\/\d+/);
});

test('implementation guidance uses contract-impact judgment without weakening safeguards', () => {
  const implementationGuide = readRepoFile('skills/shared/references/implementation-guide.md');
  const deepImplement = readRepoFile('skills/deep-implement/SKILL.md');
  const sliceWorker = readRepoFile('agents/implement-slice-worker.md');
  const agentGuide = readRepoFile('AGENTS.md');

  assert.ok(implementationGuide.includes('### Core Principle: Plan Fidelity Preserves Evidence'));
  assert.ok(implementationGuide.includes('acceptance contract and slice receipts'));
  assert.match(
    implementationGuide,
    /changes the\s+acceptance contract, public interface, scope, or verification evidence/,
  );
  assert.ok(implementationGuide.includes('does not change those approved boundaries'));

  for (const obsoleteRule of [
    'No surprises, no creativity',
    "don't rename it to `verifyCredentials` because you think it's better",
    '**Stop immediately**',
    '**Wait** — do not proceed until the user decides how to handle it',
    '### When NOT to Improvise',
    '### When It\'s OK to Adapt',
    'Follows the plan exactly — no additions, no omissions',
  ]) {
    assert.ok(!implementationGuide.includes(obsoleteRule), `obsolete rule remains: ${obsoleteRule}`);
  }

  for (const safeguard of [
    "bug in unrelated code",
    "don't install it without asking",
    "don't modify tests without plan approval",
    '## Agent Delegation Pattern (v3.1.0)',
  ]) {
    assert.ok(implementationGuide.includes(safeguard), `mechanism safeguard missing: ${safeguard}`);
  }

  const preExecutionGuideRead =
    'Read("${CLAUDE_PLUGIN_ROOT}/skills/shared/references/implementation-guide.md")';
  assert.ok(deepImplement.includes(preExecutionGuideRead));
  assert.ok(
    deepImplement.indexOf(preExecutionGuideRead) < deepImplement.indexOf('## First Action'),
    'implementation judgment must be loaded before the first edit',
  );
  assert.ok(!deepImplement.includes('Follow the plan EXACTLY. Do not deviate.'));
  assert.match(
    deepImplement,
    /acceptance contract, public interface, scope, or verification evidence/,
  );
  assert.match(deepImplement, /local adaptation[\s\S]*document[\s\S]*verify/i);

  assert.ok(sliceWorker.includes(preExecutionGuideRead));
  assert.ok(
    sliceWorker.indexOf(preExecutionGuideRead) < sliceWorker.indexOf('# TDD Protocol'),
    'delegated implementation judgment must be loaded before the first edit',
  );
  assert.match(
    agentGuide,
    /run that worker's own protocol inline in the calling skill/,
    'Codex must retain the no-Agent inline worker fallback',
  );
  assert.ok(deepImplement.includes('**TDD mandatory**'));
  assert.ok(deepImplement.includes('**Do NOT modify files outside the active slice\'s scope**'));
  assert.ok(deepImplement.includes('verify-delegated-receipt.sh'));
  assert.match(deepImplement, /pass해야 Phase Review Gate에 도달/);
  assert.ok(sliceWorker.includes('# TDD Protocol (prompt-embedded — hook not applied)'));
  assert.ok(sliceWorker.includes('DO NOT modify files outside the union'));
  assert.ok(sliceWorker.includes('parent relies on your receipts for verification'));
  assert.ok(sliceWorker.includes('do not redispatch from this worker'));
});

test('plan templates expose worker handoff and verification plan', () => {
  const existingTemplate = readRepoFile('skills/shared/templates/plan-template-existing.md');
  const zeroBaseTemplate = readRepoFile('skills/shared/templates/plan-template-zerobase.md');

  for (const template of [existingTemplate, zeroBaseTemplate]) {
    assert.ok(template.includes('Worker Handoff'));
    assert.ok(template.includes('Verification Plan'));
    assert.ok(template.includes('depends_on'));
    assert.ok(template.includes('failing_test'));
    assert.ok(template.includes('verification_cmd'));
    assert.ok(template.includes('expected_output'));
    assert.ok(template.includes('code_sketch'));
    assert.match(template, /^\s+- steps:/m);
  }
});

test('spec-governed templates require every research 7.2 field', () => {
  const surfaces = [
    readRepoFile('skills/deep-plan/SKILL.md'),
    readRepoFile('skills/shared/templates/plan-template-existing.md'),
    readRepoFile('skills/shared/templates/plan-template-zerobase.md'),
  ];
  for (const surface of surfaces) {
    assert.ok(surface.includes('Spec Contract Binding'));
    for (const field of ['outcome', 'integration_touchpoints', 'requirements', 'invariants',
      'failure_modes', 'risk', 'negative_tests', 'evidence_required', 'rollback',
      'review_policy', 'scope_expansion_trigger']) {
      assert.match(surface, new RegExp(`\\b${field}\\b`), `${field} missing`);
    }
  }
  assert.doesNotMatch(surfaces[0], /plan\.md 포맷은 변경하지 않는다/);
});

test('deep-spec owns the canonical executable spec template', () => {
  const deepSpec = readRepoFile('skills/deep-spec/SKILL.md');
  const template = readRepoFile('skills/shared/templates/spec-template.md');

  assert.match(deepSpec, /^name: deep-spec$/m);
  assert.match(deepSpec, /^user-invocable: true$/m);
  assert.match(deepSpec, /medium\|high\|critical.*mandatory/i);
  assert.match(deepSpec, /current_phase.*spec/);
  assert.match(deepSpec, /legacy[\s\S]*current_phase: research/);
  assert.match(deepSpec, /validate-spec-contract\.js/);
  assert.match(deepSpec, /document review/i);
  assert.match(deepSpec, /spec_approved_hash/);
  assert.match(deepSpec, /current spec\.md bytes/i);
  assert.match(deepSpec, /unresolved marker/i);
  assert.match(template, /^# Executable Spec:/m);
  assert.equal((template.match(/```json spec-contract/g) || []).length, 1);
});

test('PR4 strict-spec wiring and fixtures remain discoverable', () => {
  const orchestrator=readRepoFile('skills/deep-work-orchestrator/SKILL.md');
  assert.match(orchestrator,/current_phase: spec/);
  assert.match(orchestrator,/legacy `current_phase: research \+ subphase: spec`/);
  assert.match(orchestrator,/Skill\("deep-spec", args=ARGS\)/);
  assert.match(orchestrator,/phase advance --from spec --to plan/);
  for(const file of ['low-legacy/spec.md','medium-valid/spec.md','medium-valid/plan.md','high-valid/spec.md',
    'high-valid/plan.md','invalid-matrix/spec.md','invalid-binding/plan.md']){
    assert.doesNotThrow(()=>readRepoFile(`tests/fixtures/v6.13-spec/${file}`));
  }
});

test('plan review-gate enforces v6.7 mandatory slice contract', () => {
  const reviewGate = readRepoFile('skills/shared/references/review-gate.md');

  // testability dimension must require all three fields together (no "권장" / "recommended" for expected_output)
  assert.match(reviewGate, /testability.*failing_test.*verification_cmd.*expected_output/);
  assert.doesNotMatch(reviewGate, /expected_output은 권장/);
  assert.doesNotMatch(reviewGate, /expected_output is recommended/i);

  // v6.7 mandatory section + reference to the contract test
  assert.ok(reviewGate.includes('v6.7+ 필수 슬라이스 계약'),
    'review-gate.md must declare the v6.7+ mandatory slice contract');
  assert.ok(reviewGate.includes('tests/plan-quality-contract.test.js'),
    'review-gate.md must reference the contract test that enforces this');

  // Legacy v5.8 fallback wording (which made expected_output absence a non-issue)
  // must be gone — it contradicts the contract.
  assert.doesNotMatch(reviewGate, /expected_output.*부재는 감점하지 않음/,
    'legacy v5.8 fallback "expected_output absence does not deduct" must be removed');
  assert.doesNotMatch(reviewGate, /하위 호환성 \(v5\.8\)/,
    'legacy v5.8 backward-compat block must be removed');

  // Narrow exceptions are still acknowledged
  assert.match(reviewGate, /인라인 plan.*skip/,
    'inline-plan exception must remain (no plan artifact to review)');
  assert.match(reviewGate, /legacy\/resume/,
    'legacy/resume exception must remain (narrow, verdict-neutral)');
});
