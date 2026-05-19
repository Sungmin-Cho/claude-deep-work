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
