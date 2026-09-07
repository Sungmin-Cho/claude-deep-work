'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const {compileReviewPlan,evaluateReviewExecution}=require('../runtime/review-policy-runtime.js');

test('public review guidance resolves to the actual persisted execution route',()=>{
  const body=read('skills/shared/references/adaptive-review-protocol.md');
  assert.match(body,/review execution run/);
  assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js'));
  assert.match(body,/excluding the author.s conclusion and other reviewers/);
  assert.match(body,/Missing observed model stays unknown/);
  assert.match(body,/Preserve failed attempts/);
  for(const file of ['skills/deep-implement/SKILL.md','skills/deep-test/SKILL.md','skills/deep-finish/SKILL.md'])
    assert.ok(read(file).includes('${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md'),file);
});
test('scheduling single review does not erase High required roles and unavailable execution is not approval',()=>{
  const options={artifactKind:'slice-diff',riskClass:'high',runtime:'codex',availableChannels:{codex_cli:false,subagent:false}};
  const normal=compileReviewPlan(options),single=compileReviewPlan({...options,reviewModeOverride:'single'});
  assert.deepEqual(single.reviewers.filter(r=>r.required).map(r=>[r.role,r.tier]),normal.reviewers.filter(r=>r.required).map(r=>[r.role,r.tier]));
  assert.ok(single.degraded.unavailable_roles.includes('executability'));
  const result=evaluateReviewExecution(single,[]);assert.equal(result.decision,'pause');
});
test('phase approval references reuse current evidence without restoring direct authority writes',()=>{
  for(const file of ['skills/shared/references/phase-review-gate.md','skills/shared/references/review-approval-workflow.md']){
    const body=read(file);assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/skills/shared/references/adaptive-review-protocol.md'));
    assert.match(body,/unchanged qualifying/);assert.doesNotMatch(body,/deep-review:code-reviewer|codex:rescue|## Step 2: Auto Review/);
  }
});
