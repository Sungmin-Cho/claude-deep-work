'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..'),r=name=>require(path.join(repo,'runtime',name));const {createPublicWorkflowFixture}=require(path.join(repo,'tests/helpers/public-workflow-fixtures.js'));
const cap=f=>r('platform.js').issueProjectStateCapability(f.root,f.state,{role:'session-state'});
const park=f=>f.cli(['session','park','--state',f.state,'--session',f.sessionId]);const restore=f=>f.cli(['session','restore','--state',f.state,'--session',f.sessionId]);
test('unchanged source restore does not replace a genuinely selected second session',async t=>{
 const f=await createPublicWorkflowFixture(t,{checkpoint:'research',gitFixture:'marker'}),before=r('session-maintenance-runtime.js').sourceFingerprint(cap(f)).sha256;park(f);
 const second=f.cli(['session','initialize','--task-file',path.join(f.root,'task.txt'),'--flags-json',path.join(f.root,'flags.json'),'--profile-json',path.join(f.root,'profile.json')]);f.cli(['session','repository','prepare','--session',second.sessionId,'--mode','current-branch','--task-file',path.join(f.root,'task.txt'),'--defaults-json',path.join(f.root,'defaults.json')]);
 assert.equal(r('session-maintenance-runtime.js').sourceFingerprint(cap(f)).sha256,before);const pointer=path.join(f.root,'.claude/deep-work-current-session');assert.equal(fs.readFileSync(pointer,'utf8').trim(),second.sessionId);
 let error,result;try{result=restore(f);}catch(e){error=e;}console.log(JSON.stringify({case:'selected-second-session',first:f.sessionId,second:second.sessionId,result,error:error?.message,pointer_after:fs.readFileSync(pointer,'utf8').trim()}));
 assert.match(error?.message||'',/session-restore-pointer-conflict/);assert.equal(fs.readFileSync(pointer,'utf8').trim(),second.sessionId);
});
test('pending unchanged restore rechecks reader after downgrade before restoring registry or pointer',async t=>{
 const f=await createPublicWorkflowFixture(t,{checkpoint:'research',gitFixture:'marker'});fs.writeFileSync(f.state,r('frontmatter.js').updateFrontmatterText(fs.readFileSync(f.state,'utf8'),{created_by_version:'7.5.0'}));park(f);
 const workflow=r('workflow-runtime.js'),original=workflow.currentVersion;workflow.currentVersion=()=> '7.5.0';try{await assert.rejects(()=>r('session-maintenance-runtime.js').restoreSession({stateCapability:cap(f),sessionId:f.sessionId,seam:point=>{if(point==='after-state-written')throw Error('controlled-return-loss');}}),/controlled-return-loss/);}finally{workflow.currentVersion=original;}
 const pointer=path.join(f.root,'.claude/deep-work-current-session');assert.equal(fs.existsSync(pointer),false);let error,result;try{result=restore(f);}catch(e){error=e;}console.log(JSON.stringify({case:'downgraded-pending-reader',actual_reader:original(),archived_writer:'7.5.0',result,error:error?.message,pointer_created:fs.existsSync(pointer)}));
 assert.match(error?.message||'',/session-reader-unavailable/);assert.equal(fs.existsSync(pointer),false);
});

test('tampered pending restore cannot mutate registry before journal authentication',async t=>{
 const f=await createPublicWorkflowFixture(t,{checkpoint:'research',gitFixture:'marker'});park(f);
 await assert.rejects(()=>r('session-maintenance-runtime.js').restoreSession({stateCapability:cap(f),sessionId:f.sessionId,seam:point=>{if(point==='after-state-written')throw Error('controlled-return-loss');}}),/controlled-return-loss/);
 const control=path.join(f.root,'.claude'),file=fs.readdirSync(control).find(n=>n.startsWith(`deep-work.${f.sessionId}.op.session-restore-v1.`)&&n.endsWith('.json'));
 assert.ok(file);const target=path.join(control,file),record=JSON.parse(fs.readFileSync(target));record.preconditions.injected='not-a-runtime-precondition';fs.writeFileSync(target,JSON.stringify(record));
 const pointer=path.join(control,'deep-work-current-session'),registry=path.join(control,'deep-work-sessions.json'),before=fs.readFileSync(registry);
 assert.throws(()=>restore(f));assert.equal(fs.existsSync(pointer),false);assert.deepEqual(fs.readFileSync(registry),before);
});
