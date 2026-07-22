'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync}=require('node:child_process');
const {
  generateSessionId,
  resolveSessionContext,
  readPointer,
  writePointer,
  readRegistry,
  checkFileOwnership,
  registerFileOwnership,
  selectSessionPointer,
  detectStaleSessions,
  finalizeWithinFinishOperation,
  prepareSessionRepository,
  recoverSessionWorktree,
  buildSessionState,
  migrateKnownSessionSchema,
} = require('./session-store.js');
const { issueProjectStateCapability } = require('./platform.js');
const {beginOperation}=require('./operation-journal.js');
const {parseFrontmatter}=require('./frontmatter.js');
const transaction=require('./transaction-runtime.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-session-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.claude'));
  const projectCapability = issueProjectStateCapability(root, root, {role:'project-root'});
  return {root, projectCapability};
}
function gitFixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-session-git space-'));execFileSync('git',['init','-q',root]);
  execFileSync('git',['-C',root,'config','user.email','test@example.com']);execFileSync('git',['-C',root,'config','user.name','Test']);
  fs.writeFileSync(path.join(root,'.gitignore'),'.claude/\n.deep-work/\n');fs.writeFileSync(path.join(root,'a.txt'),'a\n');
  execFileSync('git',['-C',root,'add','.gitignore','a.txt']);execFileSync('git',['-C',root,'commit','-qm','base']);
  fs.mkdirSync(path.join(root,'.claude'));return{root,projectCapability:issueProjectStateCapability(root,root,{role:'project-root'})};}

test('new and migrated session state normalize the spec subphase contract', async () => {
  const state=buildSessionState({sessionId:'s-aaaaaaaa',task:'spec state',repositoryContext:{
    repositoryMode:'current-branch',branch:'main',headOid:'a'.repeat(40)}});
  assert.equal(state.created_by_version,'6.13.0');assert.equal(state.subphase,null);
  assert.equal(state.spec_policy_required,null);assert.equal(state.spec_approved_hash,null);
  assert.equal(state.spec_contract_json,null);assert.equal(state.spec_gate_result_json,null);

  const {root}=fixture();const file=path.join(root,'.claude','deep-work.s-bbbbbbbb.md');
  fs.writeFileSync(file,'---\nschema_version: 2\nsession_id: s-bbbbbbbb\ncurrent_phase: research\n---\n');
  const result=await migrateKnownSessionSchema({stateCapability:issueProjectStateCapability(root,file,{role:'session-state'}),
    sessionId:'s-bbbbbbbb'});const fields=parseFrontmatter(fs.readFileSync(file,'utf8')).fields;
  assert.equal(result.status,'migrated');assert.equal(fields.subphase,null);
  assert.equal(fields.spec_policy_required,null);assert.equal(fields.spec_contract_json,null);
});

test('session ids and context precedence are deterministic', () => {
  const {root, projectCapability} = fixture();
  assert.match(generateSessionId(), /^s-[0-9a-f]{8}$/);
  writePointer(projectCapability, 's-bbbbbbbb');
  fs.writeFileSync(path.join(root, '.claude', 'deep-work.s-aaaaaaaa.md'),
    '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\n---\n');
  const context = resolveSessionContext({cwd:root, env:{DEEP_WORK_SESSION_ID:'s-aaaaaaaa'}});
  assert.equal(context.sessionId, 's-aaaaaaaa');
  assert.equal(context.legacy, false);
  assert.equal(readPointer(projectCapability), 's-bbbbbbbb');
});

test('registry ownership keeps explicit sessions and promotes three siblings', async () => {
  const {root, projectCapability} = fixture();
  const registry = readRegistry(projectCapability);
  assert.equal(registry.version, 1);
  assert.ok(registry.shared_files.includes('package.json'));
  fs.writeFileSync(path.join(root, '.claude', 'deep-work-sessions.json'), `${JSON.stringify({
    version:1, shared_files:registry.shared_files, sessions:{
      's-aaaaaaaa':{pid:process.pid,task_description:'A',work_dir:'.deep-work/s-aaaaaaaa',
        current_phase:'implement',file_ownership:[],last_activity:'2026-07-13T00:00:00Z'},
      's-bbbbbbbb':{pid:process.pid,task_description:'B',work_dir:'.deep-work/s-bbbbbbbb',
        current_phase:'implement',file_ownership:[],last_activity:'2026-07-13T00:00:00Z'},
    },
  })}\n`);
  const state = path.join(root, '.claude', 'deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(state, '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\n---\n');
  const stateCapability = issueProjectStateCapability(root, state, {role:'session-state'});
  const stateB = path.join(root, '.claude', 'deep-work.s-bbbbbbbb.md');
  fs.writeFileSync(stateB, '---\nsession_id: s-bbbbbbbb\nwork_dir: .deep-work/s-bbbbbbbb\ncurrent_phase: implement\n---\n');
  const stateCapabilityB = issueProjectStateCapability(root, stateB, {role:'session-state'});
  for (const file of ['src/a.js','src/b.js','src/c.js']) {
    await registerFileOwnership({sessionId:'s-aaaaaaaa', stateCapability,
      pathCapability:issueProjectStateCapability(root, path.join(root, '.claude', file.replaceAll('/', '_')),
        {allowMissingLeaf:true}) , portablePath:file});
  }
  assert.deepEqual(readRegistry(projectCapability).sessions['s-aaaaaaaa'].file_ownership,
    ['src/**']);
  assert.equal(checkFileOwnership({sessionId:'s-bbbbbbbb', stateCapability:stateCapabilityB,
    pathCapability:issueProjectStateCapability(root, path.join(root, '.claude', 'x'),
      {allowMissingLeaf:true}), portablePath:'src/new.js'}).allowed, false);
});

test('stale detection treats EPERM owners as alive', () => {
  const registry = {version:1, shared_files:[], sessions:{
    's-aaaaaaaa':{pid:111,last_activity:'2020-01-01T00:00:00Z'},
    's-bbbbbbbb':{pid:222,last_activity:'2020-01-01T00:00:00Z'},
  }};
  const stale = detectStaleSessions(registry, {now:Date.parse('2026-07-13T00:00:00Z'),
    kill(pid) { const error = new Error(); error.code = pid === 111 ? 'EPERM' : 'ESRCH'; throw error; }});
  assert.deepEqual(stale.map((entry) => entry.sessionId), ['s-bbbbbbbb']);
});

test('finish store finalization adopts state and registry return loss', async () => {
  const {root,projectCapability}=fixture();const sessionId='s-aaaaaaaa';
  const state=path.join(root,'.claude',`deep-work.${sessionId}.md`);fs.writeFileSync(state,
    '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\n---\n');
  fs.writeFileSync(path.join(root,'.claude','deep-work-sessions.json'),JSON.stringify({version:1,shared_files:[],sessions:{
    [sessionId]:{pid:process.pid,task_description:'finish',work_dir:'.deep-work/s-aaaaaaaa',current_phase:'implement',
      file_ownership:[],last_activity:'2026-07-13T00:00:00Z'}}}));
  writePointer(projectCapability,sessionId);
  const operation=await beginOperation({projectCapability,sessionId,kind:'finish-keep',preconditions:{outcome:'keep'}});
  const cap=()=>issueProjectStateCapability(root,state,{role:'session-state'});
  await assert.rejects(()=>finalizeWithinFinishOperation({operation,sessionId,stateCapability:cap(),outcome:'keep',
    seam:(name)=>{if(name==='after-state-write-before-stage')throw new Error('lost-state-return');}}),/lost-state-return/);
  assert.equal(parseFrontmatter(fs.readFileSync(state,'utf8')).fields.current_phase,'idle');
  await assert.rejects(()=>finalizeWithinFinishOperation({operation,sessionId,stateCapability:cap(),outcome:'keep',
    seam:(name)=>{if(name==='after-registry-write-before-stage')throw new Error('lost-registry-return');}}),/lost-registry-return/);
  const result=await finalizeWithinFinishOperation({operation,sessionId,stateCapability:cap(),outcome:'keep'});
  assert.equal(result.outcome,'keep');assert.equal(readRegistry(projectCapability).sessions[sessionId],undefined);
  const fields=parseFrontmatter(fs.readFileSync(state,'utf8')).fields;
  assert.equal(fields.finish_operation_id,operation.operationId);assert.equal(fields.finish_outcome,'keep');
  assert.equal(readPointer(projectCapability),null);
});

test('registry mutation and pointer selection enter their declared ranks before store access',async()=>{
  const {root,projectCapability}=fixture();const sessionId='s-aaaaaaaa';const state=path.join(root,'.claude',`deep-work.${sessionId}.md`);
  fs.mkdirSync(path.join(root,'.deep-work',sessionId),{recursive:true});fs.writeFileSync(state,
    '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\n---\n');
  fs.writeFileSync(path.join(root,'.claude','deep-work-sessions.json'),`${JSON.stringify({version:1,shared_files:[],sessions:{
    [sessionId]:{pid:process.pid,task_description:'ranked',work_dir:'.deep-work/s-aaaaaaaa',current_phase:'implement',
      file_ownership:[],last_activity:'2026-07-13T00:00:00Z'}}})}\n`);const stateCapability=issueProjectStateCapability(root,state,{role:'session-state'});
  await transaction.withRankedLocks([{rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}],async()=>{
    await assert.rejects(()=>registerFileOwnership({sessionId,stateCapability,portablePath:'src/a.js'}),/lock-rank-inversion/);
    await assert.rejects(()=>selectSessionPointer({projectCapability,sessionId,stateCapability}),/lock-rank-inversion/);
  });
});

test('initial new-branch repository transaction adopts every repository and store return-loss seam',async()=>{
  const {root,projectCapability}=gitFixture();const base=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const invoke=(target)=>prepareSessionRepository({projectCapability,sessionId:'s-1234abcd',mode:'new-branch',task:'exact task',
    seam:(name)=>{if(name===target)throw new Error(`lost:${target}`);}});
  await assert.rejects(()=>invoke('repository-after-call-before-stage'),/lost:repository-after-call-before-stage/);
  await assert.rejects(()=>invoke('after-state-write-before-stage'),/lost:after-state-write-before-stage/);
  await assert.rejects(()=>invoke('after-registry-write-before-stage'),/lost:after-registry-write-before-stage/);
  await assert.rejects(()=>invoke('after-pointer-write-before-stage'),/lost:after-pointer-write-before-stage/);
  const result=await invoke(null);assert.equal(result.repositoryContext.branch,'deep-work-1234abcd');
  assert.equal(result.repositoryContext.headOid,base);assert.equal(readPointer(projectCapability),'s-1234abcd');
  const stateFields=parseFrontmatter(fs.readFileSync(result.stateCapability.path,'utf8')).fields;
  assert.equal(stateFields.repository_mode,'new-branch');assert.equal(stateFields.worktree_enabled,false);
  assert.equal(stateFields.worktree_path,null);
  assert.equal(readRegistry(projectCapability).sessions['s-1234abcd'].branch,'deep-work-1234abcd');
  assert.equal(execFileSync('git',['branch','--list','deep-work-1234abcd'],{cwd:root,encoding:'utf8'}).trim(),
    '* deep-work-1234abcd');
});

test('initial worktree transaction adopts a created exact sibling and rejects dirty new-branch startup',async()=>{
  const {root,projectCapability}=gitFixture();let kill=true;const run=()=>prepareSessionRepository({projectCapability,
    sessionId:'s-abcdef12',mode:'worktree',task:'worktree task',seam:(name)=>{if(kill&&name==='repository-after-call-before-stage'){
      kill=false;throw new Error('lost-worktree-return');}}});await assert.rejects(run,/lost-worktree-return/);const result=await run();
  assert.equal(result.repositoryContext.worktreePurpose,'initial-session');assert.equal(path.basename(result.repositoryContext.worktreePath),
    `${path.basename(root)}-wt-abcdef12`);const listed=execFileSync('git',['worktree','list','--porcelain'],{cwd:root,encoding:'utf8'});
  assert.match(listed,/branch refs\/heads\/deep-work-abcdef12/);
  const initial=parseFrontmatter(fs.readFileSync(result.stateCapability.path,'utf8')).fields;
  assert.equal(initial.repository_mode,'worktree');assert.equal(initial.worktree_enabled,true);
  assert.equal(initial.worktree_path,result.repositoryContext.worktreePath);
  const recovered=await recoverSessionWorktree({stateCapability:result.stateCapability,sessionId:'s-abcdef12'});
  assert.equal(recovered.worktreeCapability.purpose,'initial-session');assert.equal(recovered.worktreePath,initial.worktree_path);
  execFileSync('git',['worktree','remove','--force',initial.worktree_path],{cwd:root});const beforeMissing={...initial};
  fs.symlinkSync(path.join(root,'missing-worktree-target'),initial.worktree_path,'dir');const unsafeBytes=fs.readFileSync(
    result.stateCapability.path);await assert.rejects(()=>recoverSessionWorktree({stateCapability:result.stateCapability,
      sessionId:'s-abcdef12'}),/(recovery-worktree-unsafe|path-capability-link)/);assert.deepEqual(fs.readFileSync(result.stateCapability.path),unsafeBytes);
  fs.unlinkSync(initial.worktree_path);
  const missing=await recoverSessionWorktree({stateCapability:result.stateCapability,sessionId:'s-abcdef12'});
  const afterMissing=parseFrontmatter(fs.readFileSync(result.stateCapability.path,'utf8')).fields;
  assert.equal(missing.status,'disabled-missing');assert.equal(afterMissing.worktree_enabled,false);
  assert.equal(afterMissing.worktree_path,beforeMissing.worktree_path);
  assert.deepEqual(Object.keys(afterMissing).filter((key)=>JSON.stringify(afterMissing[key])!==JSON.stringify(beforeMissing[key])),
    ['worktree_enabled']);
  const dirty=gitFixture();fs.writeFileSync(path.join(dirty.root,'a.txt'),'dirty\n');await assert.rejects(()=>prepareSessionRepository({
    projectCapability:dirty.projectCapability,sessionId:'s-deadbeef',mode:'new-branch',task:'dirty'}),/initial-repository-precondition/);
  assert.equal(execFileSync('git',['branch','--list','deep-work-deadbeef'],{cwd:dirty.root,encoding:'utf8'}),'');
});

test('two initial worktree starters serialize repository and registry publication without lost sessions',async()=>{
  const {projectCapability}=gitFixture();const [a,b]=await Promise.all([
    prepareSessionRepository({projectCapability,sessionId:'s-11111111',mode:'worktree',task:'one'}),
    prepareSessionRepository({projectCapability,sessionId:'s-22222222',mode:'worktree',task:'two'}),
  ]);assert.notEqual(a.repositoryContext.worktreePath,b.repositoryContext.worktreePath);
  assert.deepEqual(Object.keys(readRegistry(projectCapability).sessions).sort(),['s-11111111','s-22222222']);
  assert.ok(['s-11111111','s-22222222'].includes(readPointer(projectCapability)));
});

test('non-Git current-branch startup records a zero-Git repository context',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-session-none-'));fs.mkdirSync(path.join(root,'.claude'));
  const projectCapability=issueProjectStateCapability(root,root,{role:'project-root'});const old=process.env.PATH;process.env.PATH='';
  try{const result=await prepareSessionRepository({projectCapability,sessionId:'s-33333333',mode:'current-branch',task:'none'});
    assert.equal(result.repositoryContext.noRepository,true);assert.equal(result.repositoryContext.headOid,null);
  }finally{process.env.PATH=old;}
});
