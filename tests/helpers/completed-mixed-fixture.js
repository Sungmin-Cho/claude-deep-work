'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../..'),r=n=>require(path.join(repo,'runtime',n)),j=r('operation-journal.js');
const {createPublicWorkflowFixture,completeBuiltinOutcome}=require('./public-workflow-fixtures.js');
// Real local producers with explicit simulated-human source approvals.
// Slices complete at Test; no global review or session Finish is fabricated.
async function createCompletedMixedFixture(t){
const f=await createPublicWorkflowFixture(t,{approvalMode:'simulated-human',taskDescription:'Update README heading to New heading and change src/a.js to export 2. Verify both outcomes.',specMutator:spec=>{spec.requirements[0].statement='README heading and exported value meet their contract';spec.requirements[0].acceptance='README includes New heading and module exports 2';spec.requirements[0].evidence_gate_ids.push('GATE-outcome-verification');},method:'strict',basis:'strict-tdd-v2',initialFiles:{'src/a.js':'module.exports=1;\n','tests/.gitkeep':''},planMutator:plan=>{const spec=plan.slices[0].verification_spec;spec.red_failure.expected_signal={kind:'assertion',operator:'strictEqual',test_identity:{test_file:'tests/a.test.js',test_name:'implements contract',start_line:4},expected_digest:r('bootstrap-runtime.js').tapValueDigest(2),actual_digest:r('bootstrap-runtime.js').tapValueDigest(1),message_pattern:'implements contract'};plan.slices[0].verification_spec_sha256=j.sha256(j.canonicalJson(spec));
const outcome=require(path.join(repo,'tests/helpers/execution-fixtures.js')).makeExecutionPlanFixture().slices[0];outcome.id=outcome.contract.id='SLICE-002';plan.slices.push(outcome);
const aggregate={id:'SLICE-003',slice_kind:'release-verification',checked:false,scope_schema_version:1,files:[],write_scope:{failing_test:[],production:[],refactor:[]},verification_scope:['SLICE-001','SLICE-002'],release_gate_ids:['GATE-spec-contract'],verification_spec:null,verification_spec_sha256:null,contract:{...structuredClone(outcome.contract),id:'SLICE-003',files:[],depends_on:['SLICE-001','SLICE-002'],evidence_required:['GATE-spec-contract']}};plan.slices.push(aggregate);plan.capability_facts.source_slice_ids=['SLICE-003'];delete plan.capability_facts.facts_sha256;plan.capability_facts.facts_sha256=j.sha256('capability-facts-v1\0'+j.canonicalJson(plan.capability_facts));
}});
const args=['--state',f.state,'--plan',f.planPath,'--slice','SLICE-001'];assert.throws(()=>f.cli(['phase','continue','--state',f.state]),/phase-incomplete-receipts/);f.cli(['slice','activate',...args]);
function write(cls,file,bytes){const scope=r('plan-runtime.js').deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',writeClass:cls});const begun=f.cli(['implement','write','begin',...args,'--class',cls,'--scope-sha256',scope.sha256]);fs.writeFileSync(path.join(f.root,file),bytes);f.cli(['implement','write','accept',...args,'--operation-id',begun.operationId,'--pre-manifest-sha256',begun.preManifestSha256]);return begun;}
write('failing-test','tests/a.test.js',["'use strict';","const test=require('node:test');","const assert=require('node:assert/strict');","test('implements contract',()=>assert.strictEqual(require('../src/a.js'),2,'implements contract'));",''].join('\n'));
const red=f.cli(['verification','run-v2',...args,'--expected','must-fail']);assert.equal(red.disposition,'accepted');const trans=f.cli(['verification','red-transition',...args,'--verification-operation-id',red.operation_id,'--verification-result-sha256',red.result_sha256]);f.cli(['verification','proof-publish',...args,'--transition-operation-id',trans.operation_id]);
const prod=write('production','src/a.js','module.exports=2;\n');
const data=(name,value)=>f.write(path.relative(f.root,path.join(f.workDir,name)),value);
function green(){const g=f.cli(['verification','run-v2',...args,'--expected','must-pass']);f.cli(['implement','tdd','transition',...args,'--to','GREEN','--verification-result',path.join(f.root,g.verification_result_path),'--verification-sha256',g.verification_result_sha256,'--verification-operation-id',g.operation_id]);return {operation_id:g.operation_id,result_path:g.verification_result_path,result_sha256:g.verification_result_sha256,ledger_result_sha256:g.operation_receipt.resultSha256};}
const g=green();f.cli(['implement','tdd','transition',...args,'--to','SENSOR_RUN']);f.cli(['implement','tdd','transition',...args,'--to','SENSOR_CLEAN']);
const decision=f.cli(['implement','refactor','no-change',...args,'--green-ref-json',data('green.json',g),'--reason','no-duplication']);const post=green();f.cli(['implement','tdd','transition',...args,'--to','SENSOR_RUN']);
// Real syntax and exported-type checks; this is not a full static type analysis.
const project=r('platform.js').issueProjectStateCapability(f.root,f.root,{role:'project-root'}),state=r('platform.js').issueProjectStateCapability(f.root,f.state,{role:'session-state'}),sessionCap=r('platform.js').issueProjectStateCapability(f.root,f.workDir,{role:'session-work-dir',sessionStateCapability:state}),planCap=r('transaction-runtime.js').issueSessionFileCapability({sessionCapability:sessionCap,candidate:f.planPath,allowedBasenames:['plan.json'],role:'locked-plan'});
const context={sessionId:f.sessionId,stateCapability:state,planCapability:planCap,sliceId:'SLICE-001',afterWriteOperationId:decision.operationId};
const sr=r('sensor-runtime.js');const sensors=[];
sensors.push(await sr.runSensor({kind:'lint',processSpec:{kind:'native-executable',executable:process.execPath,args:['--check','src/a.js']},parser:'generic',budgetMs:5000,projectCapability:project,refactorContext:context}));
sensors.push(await sr.runSensor({kind:'typecheck',processSpec:{kind:'native-executable',executable:process.execPath,args:['-e',"require('node:assert/strict').equal(typeof require('./src/a.js'),'number')"]},parser:'tsc',budgetMs:15000,projectCapability:project,refactorContext:context}));
sensors.push(await sr.runReviewCheck(project,{},context));
f.cli(['implement','tdd','transition',...args,'--to','SENSOR_CLEAN','--sensor-operation-ids',JSON.stringify(sensors.map(x=>x.operationId).sort()),'--sensor-results-sha256',sr.aggregateSensorResults(sensors),'--after-write-operation-id',decision.operationId]);
const refs=sensors.map(x=>({kind:x.kind,operation_id:x.operationId,result_path:path.relative(f.root,x.resultCapability.path),result_sha256:x.resultSha256,ledger_result_sha256:x.operationReceipt.resultSha256})).sort((a,b)=>Buffer.compare(Buffer.from(j.canonicalJson([a.kind,a.operation_id])),Buffer.from(j.canonicalJson([b.kind,b.operation_id]))));
const evidence={kind:'no-refactor',decision_operation_id:decision.operationId,reason_code:'no-duplication',post_decision_green:post,sensor_results:refs,decision_sha256:null};evidence.decision_sha256=r('functional-receipt-runtime.js').semanticDigest('refactor-evidence-v1',evidence,'decision_sha256');
f.cli(['implement','slice','complete-v2',...args,'--green-ref-json',data('green.json',g),'--refactor-evidence-json',data('refactor.json',evidence)]);assert.equal(JSON.parse(fs.readFileSync(path.join(f.workDir,'receipts','SLICE-001.json'))).payload.completion_basis,'strict-tdd-v2');

// Incomplete outcome child still prevents phase continuation after strict completes.
assert.throws(()=>f.cli(['phase','continue','--state',f.state]),/phase-incomplete-receipts/);
f.plan=JSON.parse(fs.readFileSync(f.planPath));completeBuiltinOutcome(f,'SLICE-002');
const strictPublic=path.join(f.workDir,'receipts','SLICE-001.json'),saved=fs.readFileSync(strictPublic);
fs.unlinkSync(strictPublic);
assert.throws(()=>f.cli(['phase','continue','--state',f.state]),/phase-incomplete-receipts/);
f.cli(['implement','receipt-publish',...args]);assert.deepEqual(fs.readFileSync(strictPublic),saved);
const source=path.join(f.root,'src/a.js'),sourceBytes=fs.readFileSync(source);fs.writeFileSync(source,'module.exports=3;\n');
assert.throws(()=>f.cli(['phase','continue','--state',f.state]),/phase-incomplete-receipts/);fs.writeFileSync(source,sourceBytes);
f.cli(['phase','continue','--state',f.state]);assert.equal(f.fields().current_phase,'test');
const aggregateArgs=['--state',f.state,'--plan',f.planPath,'--slice','SLICE-003'];
const fields=f.fields(),inputRefs=[];
for(const [kind,value]of Object.entries({'spec-approval':{spec_approved_hash:fields.spec_approved_hash},'spec-contract':JSON.parse(fields.spec_contract_json),'spec-gate-result':JSON.parse(fields.spec_gate_result_json)})){
 const relative=`.deep-work/${f.sessionId}/release-inputs/${kind}.json`;f.write(relative,j.canonicalJson(value));inputRefs.push({kind,path:relative,sha256:j.sha256(j.canonicalJson(value)),producer_operation_id:fields.spec_approval_operation_id});
}
const base=['--state',f.state,'--plan',f.planPath];
const fact=f.cli(['release','gate','fact-publish',...base,'--checker','spec-gate-v1','--input-refs-json',data('spec-refs.json',inputRefs)]);
const storedFact=JSON.parse(fs.readFileSync(path.join(f.root,fact.facts_path)));assert.equal(storedFact.facts.failure_matrix_coverage.ratio,null);assert.match(storedFact.facts.failure_matrix_coverage.not_applicable_reason,/no failure matrix obligation/);
const gates=f.cli(['release','gate','result-publish',...base,'--fact-operation-id',fact.operation_id]);
const children=['SLICE-001','SLICE-002'].map(id=>{const raw=JSON.parse(fs.readFileSync(path.join(f.workDir,'runtime-receipts',id+'.json')));return {slice_id:id,receipt_sha256:raw.receipt_sha256,completion_operation_id:raw.completion_operation_id||raw.producer_operation_id};});
const gatePath=data('gate-refs.json',gates.gate_result_refs.filter(x=>x.gate_id==='GATE-spec-contract'));
assert.throws(()=>f.cli(['release','verification','complete',...aggregateArgs,'--gate-results-json',gatePath,'--functional-receipts-json',data('missing-child.json',children.slice(0,1))]),/release-verification-functional/);
const corrupt=structuredClone(children);corrupt[1].receipt_sha256='0'.repeat(64);
assert.throws(()=>f.cli(['release','verification','complete',...aggregateArgs,'--gate-results-json',gatePath,'--functional-receipts-json',data('stale-child.json',corrupt)]),/release-verification-functional/);
const published=f.cli(['release','verification','complete',...aggregateArgs,'--gate-results-json',gatePath,'--functional-receipts-json',data('functional-refs.json',children)]);
assert.match(published.receipt_sha256,/^[a-f0-9]{64}$/);
const aggregate=JSON.parse(fs.readFileSync(path.join(f.workDir,'receipts','SLICE-003.json')));
assert.equal(aggregate.payload.completion_basis,'release-verification');assert.equal(aggregate.payload.goal_acceptance.complete,true);assert.deepEqual(aggregate.payload.tdd,{mode:'not-applicable',state_transitions:[]});
assert.notEqual(f.fields().test_passed,true);assert.equal(f.fields().test_pass_operation_id,undefined);
const current=r('platform.js').issueProjectStateCapability(f.root,f.state,{role:'session-state'});
const governed=r('governed-context-runtime.js').loadGovernedContext({stateCapability:current});assert.equal(governed.projection.receipts.status,'complete');
assert.equal(governed.projection.evidence.status,'unknown');
const replay=f.cli(['release','verification','complete',...aggregateArgs,'--gate-results-json',gatePath,'--functional-receipts-json',data('functional-refs.json',children)]);assert.equal(replay.adopted,true);
return f;
}
module.exports={createCompletedMixedFixture};
