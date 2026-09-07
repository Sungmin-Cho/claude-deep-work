const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parseSpecMarkdown,validateSpecContract}=require('../runtime/contract-runtime.js');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('both shipped plan examples preview against actual session context without hand-authored metadata',async t=>{
  const {createPublicWorkflowFixture}=require('./helpers/public-workflow-fixtures.js');
  for(const file of ['plan-template-existing.md','plan-template-zerobase.md']){
    const f=await createPublicWorkflowFixture(t,{checkpoint:'authored',approvalMode:'none',gitFixture:'marker'});
    const source=read(`skills/shared/templates/${file}`),planSource=path.join(f.workDir,'plan.md');
    fs.writeFileSync(planSource,source);const before=fs.readFileSync(f.state);
    const preview=f.cli(['artifact','approval','preview','--state',f.state,'--phases','spec,plan']);
    const plan=preview.projection;assert.equal(plan.schema_version,3);
    const slice=plan.slices[0];assert.equal(slice.slice_kind,'functional');
    assert.equal(slice.change_kind,'non-functional');assert.equal(slice.execution_basis,'outcome-v1');
    assert.deepEqual(slice.write_scope.failing_test,[]);assert.ok(slice.oracle_controls.length>0);
    assert.ok(plan.contract_binding.source_plan_sha256);assert.deepEqual(fs.readFileSync(f.state),before);
    assert.equal(fs.existsSync(f.planPath),false,'preview cannot publish executable approval');
    fs.writeFileSync(planSource,source.replace('"strict_required_slice_ids": []','"strict_required_slice_ids": ["SLICE-001"]'));
    assert.throws(()=>f.cli(['artifact','approval','preview','--state',f.state,'--phases','spec,plan']),/execution-basis-required/);
  }
});
test('compact shipped Spec is executable at its observed Low risk',()=>{
  const source=read('skills/shared/templates/spec-template.md');
  assert.equal((source.match(/```json spec-contract/g)||[]).length,1);
  const spec=parseSpecMarkdown(source);const result=validateSpecContract(spec,{riskClass:'low'});
  assert.equal(result.pass,true,JSON.stringify(result.errors));
  assert.ok(spec.requirements.length);assert.deepEqual(spec.invariants,[]);
  assert.equal(validateSpecContract(spec,{riskClass:'medium'}).pass,false,'Low example cannot satisfy stronger risk by relabeling the caller');
});
test('implementation entries load contained judgment guidance and preserve runtime ownership',()=>{
  for(const file of ['skills/deep-implement/SKILL.md','agents/implement-slice-worker.md']){
    const body=read(file);assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/skills/shared/references/implementation-guide.md'));
    assert.doesNotMatch(body,/Follow the plan EXACTLY|TDD mandatory|No surprises, no creativity/);
  }
  const guide=read('skills/shared/references/implementation-guide.md');
  assert.match(guide,/journalled replan/);assert.match(guide,/Strict slices.*RED\/proof\/GREEN/);
  assert.match(guide,/Outcome slices.*positive and counterexample/);
  assert.match(guide,/single session has one active slice and one write window/);
});
