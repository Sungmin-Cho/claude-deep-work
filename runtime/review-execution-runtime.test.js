'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const platform=require('./platform.js'),journal=require('./operation-journal.js');
const api=fs.existsSync(path.join(__dirname,'review-execution-runtime.js'))?require('./review-execution-runtime.js'):{};
const {compileReviewRequest}=require('./review-envelope-runtime.js');
const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
function fixture(t,body){const root=fs.mkdtempSync(path.join(os.tmpdir(),'s02-execution-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'.claude'));
 const file=path.join(root,'.claude/deep-work.s-1234abcd.md');fs.writeFileSync(file,'---\nsession_id: s-1234abcd\ncurrent_phase: plan\n---\n');fs.writeFileSync(path.join(root,'artifact.md'),'review me');fs.writeFileSync(path.join(root,'test-double.js'),body);
 return{root,stateCapability:platform.issueProjectStateCapability(root,file,{role:'session-state'}),request:compileReviewRequest({artifactKind:'plan',reviewIntent:'semantic',riskClass:'high',artifactRefs:[{path:'artifact.md',sha256:hash('review me')}]}),prompt:'review artifact',reviewer:{role:'semantic',tier:'deep',channel:'codex-cli',model:'gpt-6-astra',effort:'max'},binding:{contract_sha256:'a'.repeat(64),policy_sha256:'b'.repeat(64)},timeoutMs:2000,maxOutputBytes:65536,resolved:{executable:process.execPath,argv:[path.join(root,'test-double.js')]},env:{PATH:process.env.PATH}};
}
const events=[{type:'thread.started',thread_id:'fresh-provider-session'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify({conclusions:[{id:'REQ-ONE',conclusion:'satisfied',control_relevance:'relevant'}]})}},{type:'turn.completed',usage:{input_tokens:10}}];
test('metadata parses supported transport events, never model prose',()=>{
 assert.equal(typeof api.parseReviewOutput,'function');
 const parsed=api.parseReviewOutput({channel:'codex-cli',stdout:events.map(JSON.stringify).join('\n')});
 assert.equal(parsed.session_id,'fresh-provider-session');assert.equal(parsed.model,null);assert.equal(parsed.terminal_success,true);assert.equal(parsed.conclusions.length,1);
 const claude=api.parseReviewOutput({channel:'claude-cli',stdout:[{type:'system',subtype:'init',session_id:'fresh-c',model:'claude-fable-5-1'},{type:'result',subtype:'success',is_error:false,session_id:'fresh-c',result:'{}'}].map(JSON.stringify).join('\n')});assert.equal(claude.model,'claude-fable-5-1');assert.equal(claude.provider,'anthropic');
 const prose=api.parseReviewOutput({channel:'codex-cli',stdout:'model: gpt-6-astra\nPASS'});assert.equal(prose.model,null);assert.equal(prose.terminal_success,false);
});
test('actual supervised test double produces persisted authenticated ledger, never provider evidence',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 assert.equal(typeof api.runReviewExecution,'function');
 const input=fixture(t,`process.stdout.write(${JSON.stringify(events.map(JSON.stringify).join('\n'))})`);
 const output=await api.runReviewExecution(input);assert.equal(output.execution.evidence_kind,'test-double');assert.equal(output.execution.qualifying_independent,false);
 assert.equal(output.execution.process.exit_code,0);assert.equal(output.execution.requested_model,'gpt-6-astra');assert.equal(output.execution.observed_model,null);
 assert.equal(output.execution.effective_effort,null);assert.equal(output.execution.requested_effort,'max');assert.equal(output.execution.observed_effort,null);
 const value=api.authenticateReviewExecution({stateCapability:input.stateCapability,ref:output.ref,expected:{request_sha256:input.request.request_sha256,binding:input.binding}});assert.equal(value.execution_sha256,output.execution.execution_sha256);
 assert.throws(()=>api.authenticateReviewExecution({stateCapability:input.stateCapability,ref:output.ref,expected:{binding:{...input.binding,policy_sha256:'c'.repeat(64)}}}),/review-execution/);
 const p=path.join(input.root,output.ref.path),tampered=JSON.parse(fs.readFileSync(p));tampered.observed_model='gpt-6-astra';fs.writeFileSync(p,JSON.stringify(tampered));assert.throws(()=>api.authenticateReviewExecution({stateCapability:input.stateCapability,ref:output.ref}),/review-execution/);
});
test('failed, timed out and output-overflow processes persist but cannot authenticate success',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 assert.equal(typeof api.runReviewExecution,'function');
 for(const [body,extra] of [['process.exit(2)',{}],['setInterval(()=>{},1000)',{timeoutMs:30}],['process.stdout.write("x".repeat(100000))',{maxOutputBytes:256}]]){
 const input={...fixture(t,body),...extra},output=await api.runReviewExecution(input);
 assert.equal(output.execution.terminal_success,false);assert.throws(()=>api.authenticateReviewExecution({stateCapability:input.stateCapability,ref:output.ref}),/review-execution/);
 }
});
test('artifact changes and invented native completion reject before process execution',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 assert.equal(typeof api.runReviewExecution,'function');const input=fixture(t,'process.exit(0)');
 fs.writeFileSync(path.join(input.root,'artifact.md'),'changed');await assert.rejects(api.runReviewExecution(input),/review-execution-artifact/);
 await assert.rejects(api.runReviewExecution({...input,reviewer:{...input.reviewer,channel:'subagent'},completed:true}),/review-execution-channel/);
});
test('injected process cannot claim effective provider identity or effort; carrier bytes are bound',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 const input=fixture(t,`process.stdout.write(${JSON.stringify(events.map(JSON.stringify).join('\n'))})`);
 const {execution}=await api.runReviewExecution(input);
 assert.equal(execution.effective_model,null);assert.equal(execution.effective_effort,null);
 assert.equal(execution.command_carriers[0].sha256,hash(fs.readFileSync(path.join(input.root,'test-double.js'))));
});
test('duplicate provider sessions and metadata conflicts are never fresh independent reviews',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 const input=fixture(t,`process.stdout.write(${JSON.stringify(events.map(JSON.stringify).join('\n'))})`);
 await api.runReviewExecution(input);const second=await api.runReviewExecution(input);assert.equal(second.execution.fresh_session,false);
 const parsed=api.parseReviewOutput({channel:'codex-cli',stdout:[...events,{type:'thread.started',thread_id:'another-session'}].map(JSON.stringify).join('\n')});assert.equal(parsed.terminal_success,false);
});
test('terminal error events cannot be erased by a later completed event',()=>{
 const parsed=api.parseReviewOutput({channel:'codex-cli',stdout:[{type:'error',message:'failed'},...events].map(JSON.stringify).join('\n')});assert.equal(parsed.terminal_success,false);
});

const reviewAnswer={verdict:'PASS',conclusions:[{id:'REQ-ONE',conclusion:'satisfied'}],unresolved_blockers:[],findings:[]};
const claudeResult=text=>JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:'review-session',result:text});
test('final structured review survives explanatory prose around one JSON fence',()=>{
 const text='I checked the exact source.\n\n```json\n'+JSON.stringify(reviewAnswer,null,2)+'\n```\nNo source was modified.';
 assert.deepEqual(api.parseReviewOutput({channel:'claude-cli',stdout:claudeResult(text)}).response,reviewAnswer);
});
test('multiple structured review blocks cannot choose a convenient PASS',()=>{
 const text='```json\n'+JSON.stringify({...reviewAnswer,verdict:'FAIL'})+'\n```\n```json\n'+JSON.stringify(reviewAnswer)+'\n```';
 assert.equal(api.parseReviewOutput({channel:'claude-cli',stdout:claudeResult(text)}).response,null);
});
test('an earlier parseable answer cannot override a missing final review',()=>{
 const earlier={type:'assistant',message:{content:[{type:'text',text:JSON.stringify(reviewAnswer)}]}};
 assert.equal(api.parseReviewOutput({channel:'claude-cli',stdout:JSON.stringify(earlier)+'\n'+claudeResult('Review could not be completed.')}).response,null);
 const messages=[{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(reviewAnswer)}},{type:'item.completed',item:{type:'agent_message',text:'Final review unavailable.'}},{type:'turn.completed'}];
 assert.equal(api.parseReviewOutput({channel:'codex-cli',stdout:messages.map(JSON.stringify).join('\n')}).response,null);
});
test('an explicit contradictory outer verdict is not discarded around a JSON result',()=>{
 const text='verdict: FAIL\n```json\n'+JSON.stringify(reviewAnswer)+'\n```';
 assert.equal(api.parseReviewOutput({channel:'claude-cli',stdout:claudeResult(text)}).response,null);
});
