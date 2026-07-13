'use strict';

const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');
const session=require('../../runtime/session-store.js');const git=require('../../runtime/git-runtime.js');const platform=require('../../runtime/platform.js');
const {beginOperation,resumeOperation}=require('../../runtime/operation-journal.js');
const {parseFrontmatter,updateFrontmatterText}=require('../../runtime/frontmatter.js');const {processHook}=require('./phase-guard-core.js');

let root,project,branch,head;const parentId='s-11111111';
function gitExec(args,cwd=root){return execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function statePath(id){return path.join(root,'.claude',`deep-work.${id}.md`);}
function stateCap(id){return platform.issueProjectStateCapability(root,statePath(id),{role:'session-state'});}
function readState(id){return parseFrontmatter(fs.readFileSync(statePath(id),'utf8')).fields;}
function writeParent(){const workDir=`.deep-work/${parentId}`;fs.mkdirSync(path.join(root,...workDir.split('/')),{recursive:true});
  fs.writeFileSync(statePath(parentId),`---\nschema_version: 2\nsession_id: ${parentId}\ncurrent_phase: implement\nwork_dir: ${workDir}\n`+
    `task_description: Parent task\nbranch: ${branch}\nhead_oid: ${head}\nworktree_enabled: false\n---\n`);
  fs.writeFileSync(path.join(root,'.claude','deep-work-sessions.json'),`${JSON.stringify({version:1,shared_files:[],sessions:{
    [parentId]:{pid:process.pid,task_description:'Parent task',work_dir:workDir,current_phase:'implement',file_ownership:[],
      last_activity:'2026-07-13T00:00:00Z',branch,head_oid:head,fork_generation:0}}})}\n`);}
async function fork(childId,parent=parentId,phase='plan'){return session.forkSession({projectCapability:project,parentStateCapability:stateCap(parent),
  parentSessionId:parent,childSessionId:childId,fromPhase:phase,dirtyResolution:'abort'});}

before(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'fork-integration-node-'));execFileSync('git',['init',root],{stdio:'ignore'});
  gitExec(['config','user.email','task2@example.test']);gitExec(['config','user.name','Task 2']);fs.writeFileSync(path.join(root,'README.md'),'# fixture\n');
  fs.writeFileSync(path.join(root,'.gitignore'),'.claude/\n.deep-work/\n');gitExec(['add','README.md','.gitignore']);gitExec(['commit','-m','initial']);
  branch=gitExec(['branch','--show-current']);head=gitExec(['rev-parse','HEAD']);
  fs.mkdirSync(path.join(root,'.claude'));writeParent();project=platform.issueProjectStateCapability(root,root,{role:'project-root'});});
after(()=>{if(!root)return;try{const rows=gitExec(['worktree','list','--porcelain']).split('\n').filter((line)=>line.startsWith('worktree '))
    .map((line)=>line.slice(9)).filter((candidate)=>fs.realpathSync(candidate)!==fs.realpathSync(root));for(const candidate of rows)
      execFileSync('git',['-C',root,'worktree','remove','--force',candidate],{stdio:'ignore'});}catch{}fs.rmSync(root,{recursive:true,force:true});});

test('fork lifecycle atomically publishes worktree, child registry, and parent link',async()=>{assert.deepEqual(git.NODE_AUTHORITY,
  {runtime:'node',shell:false,authority:'git-runtime-v1'});const result=await fork('s-22222222');assert.equal(result.status,'created');
  assert.ok(fs.existsSync(result.path));const registry=session.readRegistry(project);assert.equal(registry.sessions['s-22222222'].fork_parent,parentId);
  assert.equal(registry.sessions['s-22222222'].fork_generation,1);const children=JSON.parse(readState(parentId).fork_children);
  assert.deepEqual(children,[{session_id:'s-22222222',restart_phase:'plan'}]);assert.equal(readState('s-22222222').current_phase,'plan');});

test('multiple forks preserve independent generation and every parent child link',async()=>{await fork('s-33333333',parentId,'research');
  const value=session.readRegistry(project);assert.equal(value.sessions['s-22222222'].fork_generation,1);
  assert.equal(value.sessions['s-33333333'].fork_generation,1);const children=JSON.parse(readState(parentId).fork_children);
  assert.deepEqual(children.map((row)=>row.session_id),['s-22222222','s-33333333']);assert.equal(children[1].restart_phase,'research');});

test('fork chain increments generation and keeps exact parent identity',async()=>{const result=await fork('s-44444444','s-22222222','plan');
  assert.equal(result.generation,2);const row=session.readRegistry(project).sessions['s-44444444'];assert.equal(row.fork_parent,'s-22222222');
  assert.equal(row.fork_generation,2);});

test('fork lifecycle adopts every Git and store return-loss seam and prunes artifacts by restart phase',async()=>{
  const parentWork=path.join(root,'.deep-work',parentId);for(const [name,bytes] of [['brainstorm.md','b'],['research.md','r'],
    ['plan.md','p'],['test-results.md','t']])fs.writeFileSync(path.join(parentWork,name),bytes);const child='s-77777777';
  const attempt=(target)=>session.forkSession({projectCapability:project,parentStateCapability:stateCap(parentId),parentSessionId:parentId,
    childSessionId:child,fromPhase:'plan',dirtyResolution:'abort',seam:(name)=>{if(name===target)throw new Error(`lost:${target}`);}});
  for(const target of ['after-call-before-stage','after-child-state-write-before-stage','after-artifacts-copy-before-stage',
    'after-snapshot-write-before-stage','after-registry-write-before-stage','after-parent-link-write-before-stage'])
    await assert.rejects(()=>attempt(target),new RegExp(`lost:${target}`));const result=await attempt(null);assert.equal(result.status,'created');
  const childWork=path.join(root,'.deep-work',child);assert.equal(fs.readFileSync(path.join(childWork,'brainstorm.md'),'utf8'),'b');
  assert.equal(fs.readFileSync(path.join(childWork,'research.md'),'utf8'),'r');assert.equal(fs.existsSync(path.join(childWork,'plan.md')),false);
  assert.equal(fs.existsSync(path.join(childWork,'test-results.md')),false);assert.ok(fs.existsSync(path.join(childWork,'fork-snapshot.json')));
  assert.equal(gitExec(['worktree','list','--porcelain']).split('\n').filter((line)=>line.startsWith('worktree ')&&
    line.includes('-wt-fork-77777777')).length,1);
});

test('cleanup removes one selected idle fork, registry entry, pointer, worktree, and branch',async()=>{const id='s-33333333';
  const cap=stateCap(id);const text=fs.readFileSync(cap.path,'utf8');platform.atomicWriteFile(cap,updateFrontmatterText(text,{current_phase:'idle'}));
  await session.updateRegistryPhase({sessionId:id,stateCapability:stateCap(id),phase:'idle',at:'2026-07-13T01:00:00Z'});session.writePointer(project,id);
  const worktree=git.resolveForkWorktreeCapability({projectCapability:project,stateCapability:stateCap(id),sessionId:id,
    comparisonPath:readState(id).worktree_path});const removedPath=worktree.path;const removedBranch=worktree.branch;
  const result=await session.cleanupSession({projectCapability:project,sessionId:id,stateCapability:stateCap(id),worktreeCapability:worktree});
  assert.equal(result.result.status,'removed');assert.equal(session.readRegistry(project).sessions[id],undefined);assert.equal(session.readPointer(project),null);
  assert.equal(fs.existsSync(removedPath),false);assert.throws(()=>gitExec(['show-ref','--verify',`refs/heads/${removedBranch}`]));});

test('cleanup adopts worktree, branch, registry, parent-link, and pointer return loss',async()=>{const id='s-77777777';
  const cap=stateCap(id);platform.atomicWriteFile(cap,updateFrontmatterText(fs.readFileSync(cap.path,'utf8'),{current_phase:'idle'}));
  await session.updateRegistryPhase({sessionId:id,stateCapability:stateCap(id),phase:'idle',at:'2026-07-13T02:00:00Z'});
  session.writePointer(project,id);const worktree=git.resolveForkWorktreeCapability({projectCapability:project,stateCapability:stateCap(id),
    sessionId:id,comparisonPath:readState(id).worktree_path});const invoke=(target)=>session.cleanupSession({projectCapability:project,
    sessionId:id,stateCapability:stateCap(id),worktreeCapability:worktree,seam:(name)=>{if(name===target)throw new Error(`lost:${target}`);}});
  for(const target of ['worktree-after-call-before-stage','branch-after-call-before-stage','after-branch-delete-before-stage',
    'after-registry-write-before-stage','after-parent-unlink-write-before-stage','after-pointer-clear-before-stage'])
    await assert.rejects(()=>invoke(target),new RegExp(`lost:${target}`));const receipt=await invoke(null);assert.equal(receipt.result.status,'removed');
  assert.equal(session.readRegistry(project).sessions[id],undefined);assert.equal(session.readPointer(project),null);
  assert.equal(JSON.parse(readState(parentId).fork_children).some((row)=>row.session_id===id),false);
  assert.equal(fs.existsSync(worktree.path),false);assert.throws(()=>gitExec(['show-ref','--verify',`refs/heads/${worktree.branch}`]));
});

test('finish merge adopts the exact merge, worktree removal, and branch deletion',async()=>{const id='s-88888888';const child=await fork(id);
  fs.writeFileSync(path.join(child.path,'merged.txt'),'merged\n');gitExec(['add','merged.txt'],child.path);gitExec(['commit','-m','child'],child.path);
  const state=stateCap(id);const operation=await beginOperation({projectCapability:project,sessionId:id,kind:'finish-merge',
    preconditions:{outcome:'merge',dirtyResolution:'abort'}});let kill=true;await assert.rejects(()=>git.finishMergeWithinOperation({operation,
    projectCapability:project,stateCapability:state,stateFields:readState(id),dirtyResolution:'abort',seam:(name,context)=>{
      if(kill&&name==='after-call-before-stage'&&context.kind==='merge'){kill=false;throw new Error('lost-merge-return');}}}),/lost-merge-return/);
  kill=true;await assert.rejects(()=>git.finishMergeWithinOperation({operation,projectCapability:project,stateCapability:state,
    stateFields:readState(id),dirtyResolution:'abort',seam:(name)=>{if(kill&&name==='worktree-after-call-before-stage'){
      kill=false;throw new Error('lost-merge-worktree-return');}}}),/lost-merge-worktree-return/);
  const adopted=await resumeOperation({projectCapability:project,operationId:operation.operationId,sessionId:id,kind:'finish-merge'});
  assert.equal(adopted.stages.some((row)=>row.stage==='after-call-before-stage-1'&&row.details.owned.adopted===true),true);
  assert.equal(adopted.stages.some((row)=>row.stage==='after-stage-1'),true);
  kill=true;await assert.rejects(()=>git.finishMergeWithinOperation({operation,projectCapability:project,stateCapability:state,
    stateFields:readState(id),dirtyResolution:'abort',seam:(name)=>{if(kill&&name==='branch-after-call-before-stage'){
      kill=false;throw new Error('lost-merge-branch-return');}}}),/lost-merge-branch-return/);
  const result=await git.finishMergeWithinOperation({operation,projectCapability:project,stateCapability:state,stateFields:readState(id),
    dirtyResolution:'abort'});assert.equal(result.status,'merged');assert.equal(fs.readFileSync(path.join(root,'merged.txt'),'utf8'),'merged\n');
  assert.equal(fs.existsSync(child.path),false);assert.throws(()=>gitExec(['show-ref','--verify',`refs/heads/${child.branch}`]));
});

test('finish discard requires force for dirty work and adopts exact removal',async()=>{const id='s-99999999';const child=await fork(id);
  fs.writeFileSync(path.join(child.path,'dirty.txt'),'dirty\n');const rejected=await beginOperation({projectCapability:project,sessionId:id,
    kind:'finish-discard',preconditions:{outcome:'discard',force:false}});await assert.rejects(()=>git.finishDiscardWithinOperation({operation:rejected,
    projectCapability:project,stateCapability:stateCap(id),stateFields:readState(id),force:false}),/finish-discard-dirty/);
  const operation=await beginOperation({projectCapability:project,sessionId:id,kind:'finish-discard',
    preconditions:{outcome:'discard',force:true}});let kill=true;await assert.rejects(()=>git.finishDiscardWithinOperation({operation,
    projectCapability:project,stateCapability:stateCap(id),stateFields:readState(id),force:true,seam:(name)=>{
      if(kill&&name==='worktree-after-call-before-stage'){kill=false;throw new Error('lost-discard-worktree-return');}}}),
    /lost-discard-worktree-return/);kill=true;await assert.rejects(()=>git.finishDiscardWithinOperation({operation,projectCapability:project,
    stateCapability:stateCap(id),stateFields:readState(id),force:true,seam:(name)=>{if(kill&&name==='branch-after-call-before-stage'){
      kill=false;throw new Error('lost-discard-branch-return');}}}),/lost-discard-branch-return/);const result=await git.finishDiscardWithinOperation({
    operation,projectCapability:project,stateCapability:stateCap(id),stateFields:readState(id),force:true});assert.equal(result.status,'discarded');
  assert.equal(fs.existsSync(child.path),false);assert.throws(()=>gitExec(['show-ref','--verify',`refs/heads/${child.branch}`]));
});

test('finish merge journals and adopts dirty precommit add and commit',async()=>{const id='s-aaaaaaa1';const child=await fork(id);
  fs.writeFileSync(path.join(child.path,'dirty-merge.txt'),'dirty merge\n');const operation=await beginOperation({projectCapability:project,
    sessionId:id,kind:'finish-merge',preconditions:{outcome:'merge',dirtyResolution:'commit'}});let target='fork-precommit-add';
  const invoke=()=>git.finishMergeWithinOperation({operation,projectCapability:project,stateCapability:stateCap(id),stateFields:readState(id),
    dirtyResolution:'commit',seam:(name,context)=>{if(name==='precommit-after-call-before-stage'&&context.kind===target){
      const killed=target;target=target==='fork-precommit-add'?'fork-precommit-commit':null;throw new Error(`lost:${killed}`);}}});
  await assert.rejects(invoke,/lost:fork-precommit-add/);await assert.rejects(invoke,/lost:fork-precommit-commit/);const result=await invoke();
  assert.equal(result.status,'merged');assert.equal(fs.readFileSync(path.join(root,'dirty-merge.txt'),'utf8'),'dirty merge\n');
});

test('finish merge aborts an interrupted conflict back to the exact base',async()=>{const id='s-bbbbbbb1';const child=await fork(id);
  fs.writeFileSync(path.join(child.path,'README.md'),'child conflict\n');gitExec(['add','README.md'],child.path);gitExec(['commit','-m','child conflict'],child.path);
  fs.writeFileSync(path.join(root,'README.md'),'base conflict\n');gitExec(['add','README.md']);gitExec(['commit','-m','base conflict']);
  const base=gitExec(['rev-parse','HEAD']);const operation=await beginOperation({projectCapability:project,sessionId:id,kind:'finish-merge',
    preconditions:{outcome:'merge',dirtyResolution:'abort'}});let kill=true;await assert.rejects(()=>git.finishMergeWithinOperation({operation,
    projectCapability:project,stateCapability:stateCap(id),stateFields:readState(id),dirtyResolution:'abort',seam:(name,context)=>{
      if(kill&&name==='after-call-before-stage'&&context.kind==='merge'&&context.ok===false){kill=false;throw new Error('lost-conflict-return');}}}),
    /lost-conflict-return/);const result=await git.finishMergeWithinOperation({operation,projectCapability:project,stateCapability:stateCap(id),
    stateFields:readState(id),dirtyResolution:'abort'});assert.equal(result.status,'manual-resolution');assert.equal(result.reason,'merge-conflict');
  assert.equal(gitExec(['rev-parse','HEAD']),base);assert.equal(fs.existsSync(child.path),true);assert.equal(fs.existsSync(path.join(root,'.git','MERGE_HEAD')),false);
});

test('artifacts-only fork blocks Implement/Test while worktree and non-fork modes retain access',()=>{for(const toolName of ['Write','Edit','Bash']){
  const result=processHook({action:'pre',toolName,toolInput:toolName==='Bash'?{command:'echo x > src/main.js'}:{file_path:'src/main.js'},
    state:{current_phase:'implement',fork_mode:'artifacts-only',tdd_mode:'relaxed',tdd_state:'RED_VERIFIED',active_slice:'SLICE-001',slice_files:['src/main.js']}});
  assert.equal(result.decision,'block',toolName);}assert.equal(processHook({action:'pre',toolName:'Bash',toolInput:{command:'npm test'},
    state:{current_phase:'test',fork_mode:'artifacts-only'}}).decision,'block');for(const phase of ['brainstorm','research','plan'])assert.equal(
      processHook({action:'pre',toolName:'Bash',toolInput:{command:'cat README.md'},state:{current_phase:phase,fork_mode:'artifacts-only'}}).decision,'allow');
  for(const fork_mode of ['worktree',undefined])assert.equal(processHook({action:'pre',toolName:'Bash',toolInput:{command:'cat README.md'},
    state:{current_phase:'implement',fork_mode,tdd_mode:'relaxed',tdd_state:'RED_VERIFIED'}}).decision,'allow');});

test('idle and nonexistent parents fail before Git mutation',async()=>{const before=gitExec(['worktree','list','--porcelain']);
  await assert.rejects(()=>fork('s-55555555','s-33333333'),/registry-session-missing|fork-parent/);
  await assert.rejects(()=>session.forkSession({projectCapability:project,parentStateCapability:stateCap(parentId),parentSessionId:parentId,
    childSessionId:'s-66666666',fromPhase:'idle'}),/fork-phase/);assert.equal(gitExec(['worktree','list','--porcelain']),before);});
