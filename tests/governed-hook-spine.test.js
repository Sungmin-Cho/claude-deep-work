'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {createPublicWorkflowFixture}=require('./helpers/public-workflow-fixtures.js');const plugin=path.resolve(__dirname,'..');
function hook(f,input,post=false){const config=require('../hooks/hooks.json');const event=post?'PostToolUse':'PreToolUse';const command=config.hooks[event][0].hooks[0].command;return cp.spawnSync('bash',['-c',command],{cwd:f.root,encoding:'utf8',input:JSON.stringify(input),env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,CLAUDE_PLUGIN_ROOT:plugin,DEEP_WORK_SESSION_ID:f.sessionId,CLAUDE_PROJECT_DIR:f.root,CLAUDE_TOOL_USE_TOOL_NAME:'',CLAUDE_TOOL_NAME:''}});}
test('registered actual hook blocks Spec shell writes and direct native authority edits; exact runtime passes',async t=>{const f=await createPublicWorkflowFixture(t,{checkpoint:'spec'});assert.equal(hook(f,{tool_name:'Bash',tool_input:{command:'echo bad > README.md'}}).status,2);assert.equal(hook(f,{tool_name:'Write',tool_input:{file_path:f.state,content:'forged'}}).status,2);const allowed=hook(f,{tool_name:'Bash',tool_input:{command:`node ${plugin}/scripts/deep-work-runtime.js phase continue --state ${f.state}`}});assert.equal(allowed.status,0,allowed.stdout+allowed.stderr);});
test('governed PostToolUse never upgrades state or receipts',async t=>{const f=await createPublicWorkflowFixture(t);const before=fs.readFileSync(f.state);hook(f,{tool_name:'Write',tool_input:{file_path:path.join(f.root,'README.md'),content:'GREEN'}},true);assert.deepEqual(fs.readFileSync(f.state),before);});
test('outcome source write requires current pending scope even after activation',async t=>{const f=await createPublicWorkflowFixture(t);f.cli(['slice','activate','--state',f.state,'--plan',f.planPath,'--slice','SLICE-001']);const input={tool_name:'Write',tool_input:{file_path:path.join(f.root,'README.md'),content:'New heading'}};assert.equal(hook(f,input).status,2);const authority=require('../runtime/plan-runtime.js').deriveScopedWriteAuthority({plan:f.plan,sliceId:'SLICE-001',writeClass:'production'});f.cli(['implement','write','begin','--state',f.state,'--plan',f.planPath,'--slice','SLICE-001','--class','production','--scope-sha256',authority.sha256]);const admitted=hook(f,input);assert.equal(admitted.status,0,admitted.stdout+admitted.stderr);});
test('hook-enabled Spec can deliver owned-temp bytes without a shell pipe',async t=>{
  const f=await createPublicWorkflowFixture(t,{checkpoint:'spec'});
  const created=f.cli(['temp','create','--state',f.state,'--session',f.sessionId,'--purpose','gate-results']);
  const piped=hook(f,{tool_name:'Bash',tool_input:{command:`printf '%s' '{}' | node ${plugin}/scripts/deep-work-runtime.js temp write --state ${f.state} --session ${f.sessionId} --temp-operation-id ${created.operationId} --stdin`}});
  assert.equal(piped.status,2,piped.stdout+piped.stderr);
  assert.equal(hook(f,{tool_name:'Write',tool_input:{file_path:path.join(f.workDir,'packet-ref.json'),content:'{}'}}).status,2);
  const admitted=hook(f,{tool_name:'Write',tool_input:{file_path:created.path,content:'{"complete":true}'}});
  assert.equal(admitted.status,0,admitted.stdout+admitted.stderr);
  fs.writeFileSync(created.path,'{"complete":true}');
  const adopted=f.cli(['temp','write','--state',f.state,'--session',f.sessionId,'--temp-operation-id',created.operationId]);
  assert.equal(adopted.status,'adopted');
  assert.equal(fs.readFileSync(created.path,'utf8'),'{"complete":true}');
  f.cli(['temp','remove','--state',f.state,'--session',f.sessionId,'--temp-operation-id',created.operationId,'--expected-sha256',adopted.sha256]);
  assert.equal(fs.existsSync(created.path),false);
});
