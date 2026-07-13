'use strict';

const {test,beforeEach,afterEach}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const session=require('../../runtime/session-store.js');const {issueProjectStateCapability}=require('../../runtime/platform.js');

let root,project;const worker=path.resolve(__dirname,'..','..','tests','fixtures','registry-worker.js');
function setup(){root=fs.mkdtempSync(path.join(os.tmpdir(),'rmw-node-'));fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
  project=issueProjectStateCapability(root,root,{role:'project-root'});seed();}
function cleanup(){if(root)fs.rmSync(root,{recursive:true,force:true});root=null;}
function seed(){const sessions={};for(const id of ['s-aaaaaaaa','s-bbbbbbbb']){sessions[id]={pid:process.pid,task_description:id,
  work_dir:`.deep-work/${id}`,current_phase:'plan',file_ownership:[],last_activity:'2020-01-01T00:00:00Z'};
  fs.mkdirSync(path.join(root,'.deep-work',id),{recursive:true});fs.writeFileSync(path.join(root,'.claude',`deep-work.${id}.md`),
    `---\nsession_id: ${id}\nwork_dir: .deep-work/${id}\ncurrent_phase: plan\n---\n`);}fs.writeFileSync(path.join(root,'.claude','deep-work-sessions.json'),
    `${JSON.stringify({version:1,shared_files:[],sessions})}\n`);}
function state(id){return issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${id}.md`),{role:'session-state'});}
function run(args,env={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[worker,root,...args],{env:{...process.env,...env}});let stderr='';
  child.stderr.on('data',(chunk)=>stderr+=chunk);child.on('close',(code)=>code===0?resolve():reject(Object.assign(new Error(stderr),{code})));});}
async function waitFor(file){const deadline=Date.now()+5000;while(Date.now()<deadline){if(fs.existsSync(file))return;await new Promise((r)=>setTimeout(r,10));}
  throw new Error(`timeout waiting for ${file}`);}

beforeEach(setup);afterEach(cleanup);

test('registry RMW uses only public typed reducers without self-deadlock',async()=>{assert.equal(session.NODE_AUTHORITY.shell,false);
  assert.equal(session.mutateRegistry,undefined);const cap=state('s-aaaaaaaa');await session.registerFileOwnership({sessionId:'s-aaaaaaaa',
    stateCapability:cap,pathCapability:issueProjectStateCapability(root,path.join(root,'.claude','p'),{allowMissingLeaf:true}),portablePath:'src/a.ts'});
  await session.updateRegistryPhase({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),phase:'implement',at:'2026-07-13T00:00:00Z'});
  await session.updateLastActivity({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),at:'2026-07-13T00:00:01Z'});
  const row=session.readRegistry(project).sessions['s-aaaaaaaa'];assert.deepEqual(row.file_ownership,['src/a.ts']);assert.equal(row.current_phase,'implement');});

test('N concurrent ownership writers preserve every path',async()=>{const files=Array.from({length:5},(_,i)=>`dir${i}/공백-${i}.ts`);
  await Promise.all(files.map((file)=>run(['own','s-aaaaaaaa',file])));assert.deepEqual(session.readRegistry(project).sessions['s-aaaaaaaa'].file_ownership,
    [...files].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));});

test('concurrent ownership mutations preserve both sessions',async()=>{await Promise.all([
  run(['own','s-aaaaaaaa','src/공백 a.js']),run(['own','s-bbbbbbbb','src/공백 b.js'])]);const value=session.readRegistry(project);
  assert.deepEqual(value.sessions['s-aaaaaaaa'].file_ownership,['src/공백 a.js']);assert.deepEqual(value.sessions['s-bbbbbbbb'].file_ownership,['src/공백 b.js']);});

test('registry mutation stays bound to explicit session across pointer drift',async()=>{session.writePointer(project,'s-aaaaaaaa');
  const pause=fs.mkdtempSync(path.join(os.tmpdir(),'rmw-pause-'));const pending=run(['touch','s-aaaaaaaa','2026-07-13T00:00:00Z'],{REGISTRY_PAUSE_DIR:pause});
  await waitFor(path.join(pause,'locked'));session.writePointer(project,'s-bbbbbbbb');fs.writeFileSync(path.join(pause,'resume'),'go');
  await assert.rejects(pending,/registry-pointer-drift/);const value=session.readRegistry(project);assert.equal(value.sessions['s-aaaaaaaa'].last_activity,'2020-01-01T00:00:00Z');
  assert.equal(value.sessions['s-bbbbbbbb'].last_activity,'2020-01-01T00:00:00Z');fs.rmSync(pause,{recursive:true,force:true});});

test('default registry publication is lock-bounded and private unlocked helpers stay private',()=>{fs.unlinkSync(path.join(root,'.claude','deep-work-sessions.json'));
  assert.equal(session.readRegistryUnlocked,undefined);assert.equal(session.readRegistry(project).version,1);
  assert.ok(fs.existsSync(path.join(root,'.claude','deep-work-sessions.json')));});
