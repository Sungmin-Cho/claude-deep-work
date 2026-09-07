'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createPublicWorkflowFixture}=require('./helpers/public-workflow-fixtures.js');const j=require('../runtime/operation-journal.js'),scopeRuntime=require('../runtime/plan-runtime.js');
test('public strict V3 captures actual failing test, authenticates RED and admits production only after proof',async t=>{
 const f=await createPublicWorkflowFixture(t,{method:'strict',basis:'strict-tdd-v2',initialFiles:{'src/a.js':'module.exports=1;\n','tests/.gitkeep':''},planMutator:plan=>{const spec=plan.slices[0].verification_spec;spec.red_failure.expected_signal={kind:'assertion',operator:'strictEqual',test_identity:{test_file:'tests/a.test.js',test_name:'implements contract',start_line:4},expected_digest:require('../runtime/bootstrap-runtime.js').tapValueDigest(2),actual_digest:require('../runtime/bootstrap-runtime.js').tapValueDigest(1),message_pattern:'implements contract'};plan.slices[0].verification_spec_sha256=j.sha256(j.canonicalJson(spec));}});
 const args=['--state',f.state,'--plan',f.planPath,'--slice','SLICE-001'];f.cli(['slice','activate',...args]);
 const authority=scopeRuntime.deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',writeClass:'failing-test'});
 const begun=f.cli(['implement','write','begin',...args,'--class','failing-test','--scope-sha256',authority.sha256]);
 fs.writeFileSync(path.join(f.root,'tests/a.test.js'),["'use strict';","const test=require('node:test');","const assert=require('node:assert/strict');","test('implements contract',()=>assert.strictEqual(require('../src/a.js'),2,'implements contract'));",''].join('\n'));
 f.cli(['implement','write','accept',...args,'--operation-id',begun.operationId,'--pre-manifest-sha256',begun.preManifestSha256]);
 const red=f.cli(['verification','run-v2',...args,'--expected','must-fail']);
 assert.equal(red.disposition,'accepted',JSON.stringify(red));
 const transition=f.cli(['verification','red-transition',...args,'--verification-operation-id',red.operation_id,'--verification-result-sha256',red.result_sha256]);
 f.cli(['verification','proof-publish',...args,'--transition-operation-id',transition.transitionOperationId||transition.operation_id||transition.operationId]);
 assert.equal(f.fields().tdd_state,'RED_VERIFIED');assert.match(f.fields().red_proof_sha256,/^[a-f0-9]{64}$/);
 const production=scopeRuntime.deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',writeClass:'production'});
 const admitted=f.cli(['implement','write','begin',...args,'--class','production','--scope-sha256',production.sha256]);assert.match(admitted.operationId,/^op-/);
});
