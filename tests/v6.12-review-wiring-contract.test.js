'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const lines = (text) => text.split(/\r?\n/).length;
const BANNER = /> v6\.12: 실행 계약은 adaptive-review-protocol\.md \+ review-policy-runtime\.js가 정본/;

test('adaptive review protocol owns the complete runtime execution order', () => {
  const protocol = read('skills/shared/references/adaptive-review-protocol.md');
  const calls = ['compileReviewPlan', 'reviewers 실행', 'evaluateReviewExecution',
    'normalizeFinding', 'verdictFromFindings', 'writeFindings'];
  let cursor = -1;
  for (const call of calls) {
    const next = protocol.indexOf(call, cursor + 1);
    assert.ok(next > cursor, `${call} must appear in canonical execution order`);
    cursor = next;
  }
  assert.match(protocol, /blind[\s\S]*round 1[\s\S]*입력 격리/i);
  assert.match(protocol, /round 2[\s\S]*open finding ID[\s\S]*수정 diff/i);
  assert.match(protocol, /adjudication/);
  assert.match(protocol, /degraded[\s\S]*evaluateReviewExecution/);
  assert.match(protocol, /Critical[\s\S]*human[ -]gate[\s\S]*external_change_lock/i);
});

test('four legacy review documents are bounded canonical shims', () => {
  const shims = {
    'skills/shared/references/review-gate.md': 230,
    'skills/shared/references/phase-review-gate.md': 70,
    'skills/shared/references/review-approval-workflow.md': 100,
    'skills/deep-phase-review/SKILL.md': 110,
  };
  for (const [file, maxLines] of Object.entries(shims)) {
    const body = read(file);
    assert.match(body, BANNER, `${file} needs the canonical banner`);
    assert.ok(lines(body) <= maxLines, `${file} must be reduced to a shim`);
  }

  const approval = read('skills/shared/references/review-approval-workflow.md');
  assert.doesNotMatch(approval, /## Step 2: Auto Review|deep-review:code-reviewer|codex:rescue/);
  assert.match(approval, /## Step 4:[\s\S]*## Step 5:[\s\S]*## Step 6:/);
  assert.match(approval, /approved_hash/);
});

test('review consumer skills invoke the unified policy and finding sequence', () => {
  for (const file of ['skills/deep-implement/SKILL.md', 'skills/deep-test/SKILL.md']) {
    const body = read(file);
    assert.match(body, /adaptive-review-protocol\.md/);
    assert.match(body, /compileReviewPlan[\s\S]*evaluateReviewExecution[\s\S]*normalizeFinding[\s\S]*verdictFromFindings[\s\S]*writeFindings/,
      `${file} must document the runtime call order`);
  }
  const orchestrator = read('skills/deep-work-orchestrator/SKILL.md');
  assert.match(orchestrator, /adaptive-review-protocol\.md/);
  assert.match(orchestrator, /compileReviewPlan/);
});

test('slice review preserves stage crosswalk, blockers, blind delegation, and findings', () => {
  const implement = read('skills/deep-implement/SKILL.md');
  const worker = read('agents/implement-slice-worker.md');
  assert.match(implement, /Stage\s*1[\s\S]*semantic[\s\S]*Stage\s*2[\s\S]*executability/i);
  assert.match(implement, /High\/Critical[\s\S]*Stage\s*2[\s\S]*blocker[\s\S]*(?:차단|BLOCK)/i);
  assert.match(implement, /blind[\s\S]*입력 격리/);
  assert.match(implement, /writeFindings/);
  assert.match(implement, /reviewer\.model[\s\S]*reviewer\.effort[\s\S]*deep-work-runtime\.js[\s\S]*review run/,
    'Stage 2 must pass the compiled reviewer model and effort through the dispatcher review route');
  assert.match(worker, /writeFindings/);
  assert.match(worker, /findings_ref/);
});

test('canonical protocol defines the codex-cli dispatcher execution contract', () => {
  const protocol = read('skills/shared/references/adaptive-review-protocol.md');
  assert.match(protocol, /reviewer\.channel[\s\S]*codex-cli[\s\S]*deep-work-runtime\.js[\s\S]*review run/);
  assert.match(protocol, /--model[\s\S]*reviewer\.model[\s\S]*--effort[\s\S]*reviewer\.effort/);
  assert.match(protocol, /effort_applied[\s\S]*fallback_used/);
});

test('finding readers and finish gate use the canonical runtime functions', () => {
  assert.match(read('skills/deep-status/SKILL.md'), /readFindings/);
  assert.match(read('skills/deep-resume/SKILL.md'), /readFindings/);
  const finish = read('skills/deep-finish/SKILL.md');
  assert.match(finish, /finishGateAllowed/);
  assert.match(finish, /external_change_lock[\s\S]*(?:PR|merge|push)[\s\S]*missing_acks/i);
});
