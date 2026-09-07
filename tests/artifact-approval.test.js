'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPublicWorkflowFixture}=require('./helpers/public-workflow-fixtures.js'),approval=require('../runtime/artifact-approval-runtime.js'),j=require('../runtime/operation-journal.js'),platform=require('../runtime/platform.js');
const state=f=>platform.issueProjectStateCapability(f.root,f.state,{role:'session-state'});
const make=(t,options={})=>createPublicWorkflowFixture(t,{gitFixture:'marker',...options});
function source(f){return path.join(f.workDir,'plan.md');}
function sourceJson(f){return JSON.parse(fs.readFileSync(source(f),'utf8').match(/```json\n([\s\S]*?)\n```/)[1]);}
function writePlan(f,value){fs.writeFileSync(source(f),'# Plan\n## Execution Plan\n```json\n'+JSON.stringify(value,null,2)+'\n```');}
function save(f,name,value){return f.write(path.relative(f.root,path.join(f.workDir,name)),value);}
function declaration(packet,mode='simulated'){return{schema_version:1,source:'human',identity_authenticated:false,evidence_mode:mode,bundle_sha256:packet.bundle.bundle_sha256,packet_sha256:packet.packet.packet_sha256,phases:packet.bundle.phases,confirmed:true,confirmation_reference:'explicit-test-simulation',confirmation_text:'This is an explicit simulated host confirmation, not an actual user statement.'};}
function publish(f,phases='spec,plan'){const packet=f.cli(['artifact','approval','packet-publish','--state',f.state,'--phases',phases]);const result=f.cli(['artifact','approval','publish','--state',f.state,'--packet-ref-json',save(f,'packet-ref.json',packet.ref),'--human-declaration-json',save(f,'declaration.json',declaration(packet))]);return{packet,result,ref:save(f,'approval-ref.json',result.ref)};}
function consume(f,phase,ref){return f.cli(phase==='spec'?['phase','spec','approve','--state',f.state,'--artifact',path.join(f.workDir,'spec.md'),'--at','2026-09-07T00:00:00Z',...(ref?['--approval-ref-json',ref]:[])]:['phase','approve','--state',f.state,'--phase','plan','--artifact',source(f),'--at','2026-09-07T00:00:00Z',...(ref?['--approval-ref-json',ref]:[])]);}
function tree(root){const rows=[];const visit=(rel='')=>{for(const n of fs.readdirSync(path.join(root,rel)).sort()){const p=path.join(rel,n),s=fs.lstatSync(path.join(root,p));if(s.isDirectory())visit(p);else rows.push([p,j.sha256(fs.readFileSync(path.join(root,p)))]);}};visit();return rows;}
test('public no-proof approvals reject and preview never writes or spawns a verifier',async t=>{
 const f=await make(t,{checkpoint:'authored',approvalMode:'none'});const before=tree(f.root),cp=require('node:child_process'),spawn=cp.spawnSync;cp.spawnSync=()=>{throw Error('unexpected verifier/process spawn');};let preview;
 try{preview=approval.preview({stateCapability:state(f),phases:'spec,plan'});}finally{cp.spawnSync=spawn;}
 assert.equal(preview.authoritative,false);assert.deepEqual(tree(f.root),before);assert.equal(fs.existsSync(f.planPath),false);
 assert.throws(()=>consume(f,'spec'),/artifact-approval-required/);assert.equal(f.fields().spec_approved_hash,null);
 const packet=f.cli(['artifact','approval','packet-publish','--state',f.state,'--phases','spec,plan']);
 assert.throws(()=>f.cli(['artifact','approval','publish','--state',f.state,'--packet-ref-json',save(f,'packet.json',packet.ref),'--human-declaration-json',save(f,'decl.json',declaration(packet))]),/artifact-approval-wrong-policy/);
 assert.throws(()=>f.cli(['artifact','approval','publish','--state',f.state,'--packet-ref-json',save(f,'packet.json',packet.ref),'--review-execution-refs-json',save(f,'empty.json',[])]),/artifact-approval-review-roles/);
});
test('one exact combined receipt is consumed for Spec and Plan, simulated provenance cannot satisfy LIVE',async t=>{
 const f=await make(t);const consumed=JSON.parse(f.fields().artifact_approval_consumptions_json);assert.equal(consumed.spec.ref.sha256,consumed.plan.ref.sha256);assert.equal(consumed.spec.phase,'spec');assert.equal(consumed.plan.phase,'plan');assert.equal(consumed.spec.evidence_mode,'simulated');assert.equal(consumed.spec.identity_authenticated,false);
 const project=require('../runtime/transaction-runtime.js').projectCapabilityFor(state(f));assert.equal(j.listCompletedOperations({projectCapability:project,sessionId:f.sessionId,kind:'artifact-approval-publish-v1'}).length,1);
 assert.throws(()=>approval.assertAutonomousArtifactApprovals(state(f)),/artifact-approval-autonomous-required/);
 const compliance=require('../evals/harness/treatment-compliance.js').checkCurrentTreatment({workspace:f.root,pluginRoot:path.resolve(__dirname,'..')});assert.equal(compliance.complete,false);assert.equal(compliance.reason,'artifact-approval-autonomous-required');
 fs.writeFileSync(path.join(f.root,'README.md'),'expected implementation changes');f.cli(['session','authority','validate','--state',f.state]);
});
test('missing Plan proof and a receipt naming only Spec cannot authorize Plan',async t=>{
 const f=await make(t,{checkpoint:'authored'}),p=publish(f,'spec');consume(f,'spec',p.ref);f.cli(['phase','continue','--state',f.state]);
 assert.throws(()=>consume(f,'plan'),/artifact-approval-required/);assert.throws(()=>consume(f,'plan',p.ref),/artifact-approval-phase/);assert.equal(fs.existsSync(f.planPath),false);
});
test('both consumption points bind actual pre-review source snapshots',async t=>{
 const f=await make(t,{checkpoint:'authored'}),p=publish(f),readme=path.join(f.root,'README.md'),bytes=fs.readFileSync(readme);
 fs.writeFileSync(readme,'changed before Spec');assert.throws(()=>consume(f,'spec',p.ref),/artifact-approval-source-snapshot-drift/);fs.writeFileSync(readme,bytes);consume(f,'spec',p.ref);f.cli(['phase','continue','--state',f.state]);fs.writeFileSync(readme,'changed before Plan');assert.throws(()=>consume(f,'plan',p.ref),/artifact-approval-source-snapshot-drift/);fs.writeFileSync(readme,bytes);consume(f,'plan',p.ref);
});
test('source bundle and derived-context drift invalidate reuse independently of source bytes',async t=>{
 const f=await make(t,{checkpoint:'spec'});f.cli(['phase','continue','--state',f.state]);const planBytes=fs.readFileSync(source(f));fs.appendFileSync(source(f),'\nchanged authored source');assert.throws(()=>consume(f,'plan',f.approvalRefPath),/artifact-approval-bundle-drift/);fs.writeFileSync(source(f),planBytes);
 const fm=require('../runtime/frontmatter.js'),stateBytes=fs.readFileSync(f.state,'utf8');fs.writeFileSync(f.state,fm.updateFrontmatterText(stateBytes,{review_mode_override:'dual'}));assert.throws(()=>consume(f,'plan',f.approvalRefPath),/artifact-approval-bundle-drift/);fs.writeFileSync(f.state,stateBytes);consume(f,'plan',f.approvalRefPath);
});
test('derived mechanical source emits the same executable projection modulo source-byte identity',async t=>{
 const f=await make(t,{checkpoint:'authored'}),full=approval.preview({stateCapability:state(f)}),draft=sourceJson(f);delete draft.contract_binding;delete draft.capability_facts;delete draft.outcome_environment;delete draft.replan_epoch;writePlan(f,draft);const derived=approval.preview({stateCapability:state(f)});
 const core=value=>{const p=structuredClone(value);delete p.plan_authority_sha256;delete p.contract_binding.source_plan_sha256;return p;};assert.deepEqual(core(full.projection),core(derived.projection));assert.notEqual(full.bundle.compiled_projection_sha256,derived.bundle.compiled_projection_sha256);
 const bad=sourceJson(f);bad.contract_binding={created_by_version:'99.0.0'};writePlan(f,bad);assert.throws(()=>approval.preview({stateCapability:state(f)}),/plan-derived-context-mismatch/);
});
test('runtime packet digest and exact prompt are bound; altered human declarations reject',async t=>{
 const f=await make(t,{checkpoint:'authored'}),packet=f.cli(['artifact','approval','packet-publish','--state',f.state,'--phases','spec,plan']);assert.equal(packet.review_binding.review_packet.prompt_sha256,j.sha256(packet.review_prompt));assert.equal(approval.validateReviewPacketBinding({stateCapability:state(f),binding:packet.review_binding,promptSha256:j.sha256(packet.review_prompt)}),true);
 assert.throws(()=>approval.validateReviewPacketBinding({stateCapability:state(f),binding:packet.review_binding,promptSha256:j.sha256(packet.review_prompt+'changed')}),/artifact-approval-prompt/);
 for(const patch of [{identity_authenticated:true},{bundle_sha256:'0'.repeat(64)},{phases:['plan']},{confirmed:false}])assert.throws(()=>f.cli(['artifact','approval','publish','--state',f.state,'--packet-ref-json',save(f,'packet.json',packet.ref),'--human-declaration-json',save(f,'bad-human.json',{...declaration(packet),...patch})]),/artifact-approval-human-declaration/);
});

test('actual parsed policy and review choices drive mechanically derived Plan metadata',async t=>{
 const f=await make(t,{checkpoint:'authored',approvalMode:'none',parsedArguments:['--policy=shadow','--review=dual']}),draft=sourceJson(f);delete draft.contract_binding;delete draft.capability_facts;delete draft.replan_epoch;delete draft.outcome_environment;writePlan(f,draft);
 const result=f.cli(['artifact','approval','preview','--state',f.state,'--phases','spec,plan']);assert.equal(f.fields().methodology_policy_mode,'shadow');assert.equal(result.bundle.derivation_context.review_mode_override,'dual');assert.deepEqual(result.bundle.required_reviewers.map(r=>r.role).sort(),['executability','semantic']);assert.equal(result.projection.contract_binding.risk_profile_sha256,f.fields().risk_profile_sha256);assert.equal(result.projection.contract_binding.created_by_version,f.fields().created_by_version);
});
test('actual CLI-shaped metadata double cannot issue independent source approval',async t=>{
 const f=await make(t,{checkpoint:'authored',approvalMode:'none'}),packet=f.cli(['artifact','approval','packet-publish','--state',f.state,'--phases','spec,plan']);
 const request=require('../runtime/review-envelope-runtime.js').compileReviewRequest({artifactKind:'plan',reviewIntent:'semantic',riskClass:'low',artifactRefs:packet.artifact_refs});
 const response={verdict:'PASS',conclusions:packet.bundle.required_dimensions.map(id=>({id,conclusion:'satisfied'})),unresolved_blockers:[],findings:[]};
 const events=[{type:'thread.started',thread_id:'test-only-fake-session',model:'gpt-6-astra',reasoning_effort:'max'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(response)}},{type:'turn.completed'}];
 const script=save(f,'fake-review.cjs',`process.stdout.write(${JSON.stringify(events.map(JSON.stringify).join('\n'))});`);
 const executed=await approval.runApprovalReview({stateCapability:state(f),packetRef:packet.ref,reviewer:{role:'semantic',tier:'standard',channel:'codex-cli',model:'gpt-6-astra',effort:'max'},resolved:{executable:process.execPath,argv:[script]}});
 assert.equal(executed.execution.terminal_success,true);assert.equal(executed.execution.qualifying_independent,false);
 await assert.rejects(()=>approval.publishApproval({stateCapability:state(f),packetRef:packet.ref,reviewExecutionRefs:[executed.ref]}),/artifact-approval-independent-required/);
});

test('changed Plan after Spec approval can reopen sources, reapprove, and consume a fresh exact bundle',async t=>{
 const f=await make(t,{checkpoint:'spec'});f.cli(['phase','continue','--state',f.state]);const before=fs.readFileSync(source(f));fs.appendFileSync(source(f),'\nReviewed correction');assert.throws(()=>consume(f,'plan',f.approvalRefPath),/artifact-approval-bundle-drift/);
 const changed=fs.readFileSync(source(f));f.cli(['artifact','approval','reopen','--state',f.state]);assert.equal(f.fields().current_phase,'spec');assert.equal(f.fields().artifact_approval_consumptions_json,null);assert.deepEqual(fs.readFileSync(source(f)),changed);assert.notDeepEqual(changed,before);
 assert.equal(f.cli(['session','authority','validate','--state',f.state]).status,'source-review-reopened');const fresh=publish(f);assert.notEqual(fresh.result.ref.sha256,f.approval.ref.sha256);consume(f,'spec',fresh.ref);f.cli(['phase','continue','--state',f.state]);consume(f,'plan',fresh.ref);f.cli(['phase','continue','--state',f.state]);assert.equal(f.fields().current_phase,'implement');assert.throws(()=>f.cli(['artifact','approval','reopen','--state',f.state]),/dispatcher-phase|artifact-approval-reopen-phase/);
});

test('fresh V3 source approval cannot downgrade to legacy source syntax',async t=>{
 const f=await make(t,{checkpoint:'spec'});f.cli(['phase','continue','--state',f.state]);fs.writeFileSync(source(f),'# legacy plan source');
 assert.throws(()=>consume(f,'plan'),/artifact-approval-execution-v3-required/);
});
