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
