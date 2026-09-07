'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const optional=require('node:fs').existsSync(require('node:path').join(__dirname,'continuation-policy-runtime.js'))?require('./continuation-policy-runtime.js'):{};
const capabilities=require('./model-capabilities.js');
const d='a'.repeat(64);
test('continuation preference is bounded intent data, never external authorization',()=>{
 assert.equal(typeof optional.validateContinuationPreference,'function');
 const value={schema_version:1,mode:'autonomous',task_sha256:d,project_root:'/tmp/project',source:'user-explicit'};
 assert.deepEqual(optional.validateContinuationPreference(value),value);
 assert.throws(()=>optional.validateContinuationPreference({...value,external_authorized:true}));
 assert.throws(()=>optional.validateContinuationPreference({...value,mode:'approve-all'}));
 assert.throws(()=>optional.validateContinuationPreference({...value,project_root:'relative'}));
});
test('reuse is exact qualifying execution with distinct observed sessions',()=>{
 assert.equal(typeof optional.reusableReviewIdentity,'function');
 const reviewer={role:'semantic',model:'gpt-6-astra',tier:'deep',channel:'codex-cli',session_id:'fresh-1',provider:'openai'};
 const expected={request_sha256:d,artifact_sha256:d,contract_sha256:d,policy_sha256:d,reviewers:[reviewer]};
 const actual={...expected,terminal_success:true,unresolved_blockers:[],reviewers:[{...reviewer}]};
 assert.equal(optional.reusableReviewIdentity({expected,actual}),true);
 for(const change of [{terminal_success:false},{unresolved_blockers:['blocker']},{artifact_sha256:'b'.repeat(64)},{reviewers:[{...reviewer,tier:'standard'}]},{reviewers:[{...reviewer,session_id:null}]},{reviewers:[reviewer,{...reviewer,role:'executability'}]}])assert.equal(optional.reusableReviewIdentity({expected,actual:{...actual,...change}}),false);
});
test('execution mode preserves explicit inline/main and adaptive current host',()=>{
 assert.equal(capabilities.resolveExecutionMode({}).mode,'inline');
 assert.equal(capabilities.resolveExecutionMode({explicitModel:'main'}).mode,'inline');
 assert.equal(capabilities.resolveExecutionMode({explicitMode:'inline',explicitModel:'gpt-6-astra'}).mode,'inline');
 assert.equal(capabilities.resolveExecutionMode({explicitModel:'gpt-6-astra'}).mode,'delegate');
 assert.equal(capabilities.resolveExecutionMode({teamMode:'team'}).mode,'delegate');
});
test('approval reuse preference cannot carry approval tokens or implicit external permission',()=>{
 assert.deepEqual(optional.validateArtifactApprovalPolicy({schema_version:1,mode:'reuse-exact-review',source:'user-explicit',task_sha256:d,project_root:'/tmp/project'}),{schema_version:1,mode:'reuse-exact-review',source:'user-explicit',task_sha256:d,project_root:'/tmp/project'});
 assert.throws(()=>optional.validateArtifactApprovalPolicy({schema_version:1,mode:'auto-approve',source:'user-explicit',task_sha256:d,project_root:'/tmp/project'}));
});
