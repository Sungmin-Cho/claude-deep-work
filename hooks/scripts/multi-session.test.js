'use strict';

const {describe,it,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const session=require('../../runtime/session-store.js');const platform=require('../../runtime/platform.js');

let root,project;
function setup(){root=fs.mkdtempSync(path.join(os.tmpdir(),'ms-node-'));fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
  project=platform.issueProjectStateCapability(root,root,{role:'project-root'});}
function cleanup(){if(root)fs.rmSync(root,{recursive:true,force:true});root=null;}
function registryPath(){return path.join(root,'.claude','deep-work-sessions.json');}
function statePath(id){return path.join(root,'.claude',`deep-work.${id}.md`);}
function seed(sessions,shared=[]){fs.writeFileSync(registryPath(),`${JSON.stringify({version:1,shared_files:shared,sessions})}\n`);
  for(const [id,row] of Object.entries(sessions)){fs.mkdirSync(path.join(root,...(row.work_dir||`.deep-work/${id}`).split('/')),{recursive:true});
    fs.writeFileSync(statePath(id),`---\nsession_id: ${id}\nwork_dir: ${row.work_dir||`.deep-work/${id}`}\ncurrent_phase: ${row.current_phase||'implement'}\n---\n`);}}
function state(id){return platform.issueProjectStateCapability(root,statePath(id),{role:'session-state'});}
function pathCap(name='ownership-path'){return platform.issueProjectStateCapability(root,path.join(root,'.claude',name),{allowMissingLeaf:true});}

it('declares one shell-free Node authority and keeps internal registry reducers private',()=>{
  assert.deepEqual(session.NODE_AUTHORITY,{runtime:'node',shell:false,authority:'session-store-v1'});
  assert.match(session.generateSessionId(),/^s-[0-9a-f]{8}$/);assert.equal(session.registerSession,undefined);
  assert.equal(session.unregisterSession,undefined);assert.equal(session.mutateRegistry,undefined);
});

describe('context, pointer, and registry capabilities',()=>{beforeEach(setup);afterEach(cleanup);
  it('uses explicit/env then pointer then legacy precedence',()=>{seed({'s-aaaaaaaa':{pid:process.pid,file_ownership:[]}});
    session.writePointer(project,'s-bbbbbbbb');assert.equal(session.resolveSessionContext({cwd:root,env:{DEEP_WORK_SESSION_ID:'s-aaaaaaaa'}}).sessionId,'s-aaaaaaaa');
    assert.equal(session.resolveSessionContext({cwd:root,env:{}}).sessionId,'s-bbbbbbbb');fs.unlinkSync(path.join(root,'.claude','deep-work-current-session'));
    assert.equal(session.resolveSessionContext({cwd:root,env:{}}).legacy,true);});
  it('round-trips a pointer and creates the default registry under the lock',()=>{session.writePointer(project,'s-aabb1122');
    assert.equal(session.readPointer(project),'s-aabb1122');const value=session.readRegistry(project);assert.equal(value.version,1);
    assert.ok(value.shared_files.includes('package.json'));assert.deepEqual(value.sessions,{});assert.ok(fs.existsSync(registryPath()));});
});

describe('explicit ownership and activity reducers',()=>{beforeEach(()=>{setup();seed({
  's-aaaaaaaa':{pid:process.pid,task_description:'mine',work_dir:'.deep-work/s-aaaaaaaa',current_phase:'implement',file_ownership:[],last_activity:'2020-01-01T00:00:00Z'},
  's-bbbbbbbb':{pid:process.pid,task_description:'other',work_dir:'.deep-work/s-bbbbbbbb',current_phase:'plan',file_ownership:['src/db/**','src/models/user.ts'],last_activity:'2020-01-01T00:00:00Z'},
},['package.json','*.config.js']);});afterEach(cleanup);
  it('preserves shared/unowned access and reports the blocking owner',()=>{assert.equal(session.checkFileOwnership({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),pathCapability:pathCap(),portablePath:'package.json'}).allowed,true);
    assert.equal(session.checkFileOwnership({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),pathCapability:pathCap(),portablePath:'jest.config.js'}).allowed,true);
    assert.equal(session.checkFileOwnership({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),pathCapability:pathCap(),portablePath:'src/free.js'}).allowed,true);
    const blocked=session.checkFileOwnership({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),pathCapability:pathCap(),portablePath:'src/db/query.js'});
    assert.deepEqual(blocked,{allowed:false,owner:'s-bbbbbbbb',taskDescription:'other'});});
  it('deduplicates ownership and promotes three direct siblings to one glob',async()=>{for(const file of ['src/auth/a.js','src/auth/b.js','src/auth/c.js','src/auth/c.js'])
    await session.registerFileOwnership({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),pathCapability:pathCap(),portablePath:file});
    assert.deepEqual(session.readRegistry(project).sessions['s-aaaaaaaa'].file_ownership,['src/auth/**']);});
  it('updates only the explicit session activity and phase',async()=>{await session.updateLastActivity({sessionId:'s-aaaaaaaa',stateCapability:state('s-aaaaaaaa'),at:'2026-07-13T00:00:00Z'});
    await session.updateRegistryPhase({sessionId:'s-bbbbbbbb',stateCapability:state('s-bbbbbbbb'),phase:'research',at:'2026-07-13T00:00:01Z'});
    const value=session.readRegistry(project);assert.equal(value.sessions['s-aaaaaaaa'].last_activity,'2026-07-13T00:00:00Z');
    assert.equal(value.sessions['s-bbbbbbbb'].current_phase,'research');});
});

describe('stale and legacy behavior',()=>{beforeEach(setup);afterEach(cleanup);
  it('treats EPERM as alive and ESRCH as stale',()=>{const value={version:1,shared_files:[],sessions:{
    's-aaaaaaaa':{pid:111,last_activity:'2020-01-01T00:00:00Z',file_ownership:[]},
    's-bbbbbbbb':{pid:222,last_activity:'2020-01-01T00:00:00Z',file_ownership:[]}}};
    const rows=session.detectStaleSessions(value,{now:Date.parse('2026-07-13T00:00:00Z'),kill(pid){const error=new Error();error.code=pid===111?'EPERM':'ESRCH';throw error;}});
    assert.deepEqual(rows.map((row)=>row.sessionId),['s-bbbbbbbb']);});
  it('migrates an active legacy state, registers it, and leaves idle legacy bytes untouched',()=>{const legacy=path.join(root,'.claude','deep-work.local.md');
    fs.writeFileSync(legacy,'---\ncurrent_phase: implement\ntask_description: Legacy\n---\n');const id=session.migrateLegacyState(project);
    assert.match(id,/^s-[0-9a-f]{8}$/);assert.equal(fs.existsSync(legacy),false);assert.ok(session.readRegistry(project).sessions[id]);
    fs.writeFileSync(legacy,'---\ncurrent_phase: idle\n---\n');assert.equal(session.migrateLegacyState(project),null);assert.ok(fs.existsSync(legacy));});
});

describe('project-state link defenses',()=>{afterEach(cleanup);
  for(const target of ['project .claude','pointer','registry','state','lock','snapshot'])it(`rejects a ${target} symlink before mutation`,async()=>{setup();
    const outside=fs.mkdtempSync(path.join(os.tmpdir(),'ms-outside-'));const outsideFile=path.join(outside,'foreign');fs.writeFileSync(outsideFile,'{}');
    try{if(target==='project .claude'){fs.rmSync(path.join(root,'.claude'),{recursive:true});fs.symlinkSync(outside,path.join(root,'.claude'),'dir');
        assert.throws(()=>session.readRegistry(project),/path-capability|link|outside/);return;}
      const names={pointer:'deep-work-current-session',registry:'deep-work-sessions.json',state:'deep-work.s-aaaaaaaa.md',
        lock:'deep-work-sessions.json.lock',snapshot:'snapshot.json'};const candidate=path.join(root,'.claude',names[target]);
      fs.symlinkSync(target==='lock'?outside:outsideFile,candidate,target==='lock'?'dir':'file');
      if(target==='pointer')assert.throws(()=>session.readPointer(project),/path-capability|link|outside/);
      else if(target==='registry')assert.throws(()=>session.readRegistry(project),/path-capability|link|outside/);
      else assert.throws(()=>platform.issueProjectStateCapability(root,candidate,{role:target==='lock'?'lock':target==='state'?'session-state':'state'}),/path-capability|link|outside/);
    }finally{fs.rmSync(outside,{recursive:true,force:true});}});
});
