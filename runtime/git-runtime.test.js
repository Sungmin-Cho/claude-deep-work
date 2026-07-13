'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitCapability, listWorktrees, prepareInitialRepository,
  publishPullRequestWithinOperation,stashPublish,stashApply,stashDrop,delegatedRollback } = require('./git-runtime.js');
const { issueProjectStateCapability } = require('./platform.js');
const {beginOperation}=require('./operation-journal.js');

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-git space-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');fs.writeFileSync(path.join(root,'.gitignore'),'.claude/\n.deep-work/\n');
  execFileSync('git', ['-C', root, 'add', 'a.txt','.gitignore']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'base']);
  return {root, projectCapability:issueProjectStateCapability(root, root, {role:'project-root'})};
}

test('git capability executes argv with shell false and parses worktrees', async () => {
  const {root, projectCapability} = repository();
  const calls = [];
  const git = gitCapability(projectCapability, {spawnPortable:async (spec, options) => {
    calls.push({spec, options});
    return {ok:true, exitCode:0, stdout:`worktree ${root}\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/main\n\n`, stderr:''};
  }});
  const rows = await listWorktrees(git);
  assert.equal(rows[0].path, root);
  assert.equal(calls[0].options.shell, undefined);
  assert.deepEqual(calls[0].spec.args, ['worktree','list','--porcelain']);
});

test('current-branch startup is zero mutation and authenticated', async () => {
  const {projectCapability} = repository();
  const previous=process.env.PATH;process.env.PATH='';let result;
  try{result = await prepareInitialRepository({projectCapability, sessionId:'s-1234abcd',
    mode:'current-branch'});}finally{process.env.PATH=previous;}
  assert.equal(result.mode, 'current-branch');
  assert.match(result.repositoryContext.headOid, /^[0-9a-f]{40,64}$/);
  assert.equal(result.repositoryContext.worktreePurpose, 'current');
  assert.equal(result.repositoryContext.dirty, null);
  assert.match(result.repositoryContext.dirtyManifestSha256,/^[0-9a-f]{64}$/);
});

test('current-branch manifest rejects an over-limit file before reading it',async()=>{
  const {root,projectCapability}=repository();const huge=path.join(root,'huge.bin');fs.writeFileSync(huge,'');
  fs.truncateSync(huge,1_073_741_825);await assert.rejects(()=>prepareInitialRepository({projectCapability,
    sessionId:'s-feedface',mode:'current-branch'}),/current-repository-file-limit/);
});

test('publish PR adopts push and create return loss with one side effect each', async () => {
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  const operation=await beginOperation({projectCapability,sessionId:'s-1234abcd',kind:'finish-publish-pr',
    preconditions:{sourceOperationId:`op-${'1'.repeat(64)}`,outcome:'publish-pr'}});
  const headOid='a'.repeat(40);let remoteOid=null;let pr=null;let pushCalls=0;let createCalls=0;
  const bodyPath=path.join(root,'.claude','body.md');fs.writeFileSync(bodyPath,'Exact body\n');
  const bodyCapability=issueProjectStateCapability(root,bodyPath,{role:'state'});
  const gitRunner=async(args)=>{if(args.join(' ')==='remote get-url origin')return{ok:true,stdout:'git@github.com:owner/repo.git\n',stderr:''};
    if(args[0]==='rev-parse')return{ok:true,stdout:`${headOid}\n`,stderr:''};
    if(args[0]==='symbolic-ref')return{ok:true,stdout:'feature/runtime\n',stderr:''};
    if(args[0]==='ls-remote')return{ok:true,stdout:remoteOid?`${remoteOid}\trefs/heads/feature/runtime\n`:'',stderr:''};
    if(args[0]==='push'){pushCalls++;remoteOid=headOid;return{ok:true,stdout:'pushed',stderr:''};}
    throw new Error(`unexpected git ${args.join(' ')}`);};
  const ghRunner=async(args)=>{if(args[0]==='auth')return{ok:true,stdout:'authenticated',stderr:''};
    if(args[0]==='pr'&&args[1]==='list')return{ok:true,stdout:JSON.stringify(pr?[pr]:[]),stderr:''};
    if(args[0]==='pr'&&args[1]==='create'){createCalls++;pr={number:7,id:'PR_node_7',url:'https://github.com/owner/repo/pull/7',
      title:'Exact title',body:'Exact body\n',headRefOid:headOid,headRefName:'feature/runtime',baseRefName:'main'};
      return{ok:true,stdout:`${pr.url}\n`,stderr:''};}throw new Error(`unexpected gh ${args.join(' ')}`);};
  let killPush=true;await assert.rejects(()=>publishPullRequestWithinOperation({operation,projectCapability,stateFields:{base_branch:'main'},
    titleBytes:Buffer.from('Exact title'),bodyCapability,bodyBytes:Buffer.from('Exact body\n'),gitRunner,ghRunner,
    seam:(name,context)=>{if(killPush&&name==='after-call-before-stage'&&context.kind==='remote-push'){
      killPush=false;throw new Error('lost-push-return');}}}),/lost-push-return/);
  let killCreate=true;await assert.rejects(()=>publishPullRequestWithinOperation({operation,projectCapability,stateFields:{base_branch:'main'},
    titleBytes:Buffer.from('Exact title'),bodyCapability,bodyBytes:Buffer.from('Exact body\n'),gitRunner,ghRunner,
    seam:(name,context)=>{if(killCreate&&name==='after-call-before-stage'&&context.kind==='pull-request-create'){
      killCreate=false;throw new Error('lost-pr-return');}}}),/lost-pr-return/);
  const receipt=await publishPullRequestWithinOperation({operation,projectCapability,stateFields:{base_branch:'main'},
    titleBytes:Buffer.from('Exact title'),bodyCapability,bodyBytes:Buffer.from('Exact body\n'),gitRunner,ghRunner});
  assert.equal(pushCalls,1);assert.equal(createCalls,1);assert.equal(receipt.prNumber,7);
  assert.equal(receipt.headOid,headOid);assert.equal(receipt.repository,'owner/repo');
  assert.match(receipt.titleSha256,/^[0-9a-f]{64}$/);assert.match(receipt.bodySha256,/^[0-9a-f]{64}$/);
});

test('publish PR checks provider auth before pushing', async () => {
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  const operation=await beginOperation({projectCapability,sessionId:'s-1234abcd',kind:'finish-publish-pr',preconditions:{auth:'missing'}});
  const bodyPath=path.join(root,'.claude','body.md');fs.writeFileSync(bodyPath,'body');const bodyCapability=
    issueProjectStateCapability(root,bodyPath,{role:'state'});let pushed=false;
  const gitRunner=async(args)=>{if(args[0]==='remote')return{ok:true,stdout:'git@github.com:owner/repo.git\n',stderr:''};
    if(args[0]==='rev-parse')return{ok:true,stdout:`${'b'.repeat(40)}\n`,stderr:''};
    if(args[0]==='symbolic-ref')return{ok:true,stdout:'feature\n',stderr:''};if(args[0]==='push')pushed=true;
    return{ok:true,stdout:'',stderr:''};};
  await assert.rejects(()=>publishPullRequestWithinOperation({operation,projectCapability,stateFields:{base_branch:'main'},
    titleBytes:Buffer.from('title'),bodyCapability,bodyBytes:Buffer.from('body'),gitRunner,
    ghRunner:async()=>({ok:false,stdout:'',stderr:'not logged in'})}),/pull-request-auth/);
  assert.equal(pushed,false);
});

test('stash workflow has terminal no-change and adopts push, apply, and drop return loss', async () => {
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  const clean=await stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'fork',includeUntracked:true});
  assert.equal(clean.result,'nothing-to-stash');assert.equal(clean.stashObjectId,null);
  fs.writeFileSync(path.join(root,'a.txt'),'changed\n');fs.writeFileSync(path.join(root,'new file.txt'),'new\n');
  let kill=true;await assert.rejects(()=>stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'slice-reset',
    includeUntracked:true,seam:(name)=>{if(kill&&name==='after-call-before-stage'){kill=false;throw new Error('lost-stash-return');}}}),
  /lost-stash-return/);
  const published=await stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'slice-reset',includeUntracked:true});
  assert.equal(published.result,'published');assert.match(published.stashObjectId,/^[0-9a-f]{40,64}$/);
  assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'a\n');assert.equal(fs.existsSync(path.join(root,'new file.txt')),false);
  let killApply=true;await assert.rejects(()=>stashApply({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId,
    seam:(name)=>{if(killApply&&name==='after-call-before-stage'){killApply=false;throw new Error('lost-apply-return');}}}),
  /lost-apply-return/);
  const applied=await stashApply({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId});
  assert.equal(applied.status,'applied');assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'changed\n');
  assert.equal(fs.readFileSync(path.join(root,'new file.txt'),'utf8'),'new\n');
  let killDrop=true;await assert.rejects(()=>stashDrop({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId,
    seam:(name)=>{if(killDrop&&name==='after-call-before-stage'){killDrop=false;throw new Error('lost-drop-return');}}}),
  /lost-drop-return/);
  const dropped=await stashDrop({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId});
  assert.equal(dropped.status,'dropped');assert.equal(execFileSync('git',['stash','list'],{cwd:root,encoding:'utf8'}),'');
});

test('stash no-change excludes ignored and non-included untracked files', async () => {
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  fs.appendFileSync(path.join(root,'.gitignore'),'ignored.txt\n');execFileSync('git',['add','.gitignore'],{cwd:root});
  execFileSync('git',['commit','-qm','ignore'],{cwd:root});fs.writeFileSync(path.join(root,'ignored.txt'),'ignored');
  fs.writeFileSync(path.join(root,'untracked.txt'),'untracked');const result=await stashPublish({projectCapability,
    sessionId:'s-1234abcd',purpose:'fork',includeUntracked:false});assert.equal(result.result,'nothing-to-stash');
  assert.equal(fs.existsSync(path.join(root,'ignored.txt')),true);assert.equal(fs.existsSync(path.join(root,'untracked.txt')),true);
});

test('stash apply preserves staged, unstaged, and untracked groups while retaining runtime state', async () => {
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  fs.writeFileSync(path.join(root,'a.txt'),'staged\n');execFileSync('git',['add','a.txt'],{cwd:root});
  fs.writeFileSync(path.join(root,'a.txt'),'staged\nunstaged\n');fs.writeFileSync(path.join(root,'new.txt'),'new\n');
  const published=await stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'fork',includeUntracked:true});
  assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'a\n');assert.equal(fs.existsSync(path.join(root,'new.txt')),false);
  assert.equal(fs.existsSync(path.join(root,'.claude','deep-work.s-1234abcd.completed-operations.json')),true);
  const applied=await stashApply({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId});
  assert.equal(applied.status,'applied');assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'staged\nunstaged\n');
  assert.equal(fs.readFileSync(path.join(root,'new.txt'),'utf8'),'new\n');
  assert.match(execFileSync('git',['diff','--cached','--','a.txt'],{cwd:root,encoding:'utf8'}),/\+staged/);
  assert.match(execFileSync('git',['diff','--','a.txt'],{cwd:root,encoding:'utf8'}),/\+unstaged/);
  await stashDrop({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId});
});

test('stash push uses the exact argv and authenticates spaces, Unicode, and newline filenames',async()=>{
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  fs.writeFileSync(path.join(root,'a.txt'),'tracked\n');fs.writeFileSync(path.join(root,'한 글\nname.txt'),'bytes\n');
  const cap=gitCapability(projectCapability);const calls=[];const gitRunner=async(args)=>{calls.push(args);return cap.run(args);};
  const published=await stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'fork',includeUntracked:true,gitRunner});
  assert.deepEqual(calls.find((args)=>args[0]==='stash'&&args[1]==='push'),
    ['stash','push','--include-untracked','--message',published.marker]);
  assert.equal(published.preState.ignoredPolicy,'exclude-standard');assert.match(published.objectManifestSha256,/^[0-9a-f]{64}$/);
  await stashApply({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId});
  assert.equal(fs.readFileSync(path.join(root,'한 글\nname.txt'),'utf8'),'bytes\n');
  await stashDrop({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId});
});

test('stash publication bounds unknown-return retries and never reclassifies dirty state as no-change',async()=>{
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  fs.writeFileSync(path.join(root,'a.txt'),'dirty\n');const cap=gitCapability(projectCapability);let pushes=0;
  const gitRunner=async(args)=>{if(args[0]==='stash'&&args[1]==='push'){pushes++;return{ok:true,stdout:'pretend',stderr:''};}
    return cap.run(args);};let crash=true;
  await assert.rejects(()=>stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'fork',includeUntracked:false,gitRunner,
    seam:(name)=>{if(crash&&name==='after-call-before-stage'){crash=false;throw new Error('unknown-return-1');}}}),/unknown-return-1/);
  crash=true;await assert.rejects(()=>stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'fork',includeUntracked:false,
    gitRunner,seam:(name)=>{if(crash&&name==='after-call-before-stage'){crash=false;throw new Error('unknown-return-2');}}}),/unknown-return-2/);
  await assert.rejects(()=>stashPublish({projectCapability,sessionId:'s-1234abcd',purpose:'fork',includeUntracked:false,gitRunner}),
    /stash-publication-ambiguous/);assert.equal(pushes,2);assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'dirty\n');
});

test('stash apply records conflicts without dropping or retrying the owned stash',async()=>{
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  fs.writeFileSync(path.join(root,'a.txt'),'stashed\n');const published=await stashPublish({projectCapability,
    sessionId:'s-1234abcd',purpose:'fork',includeUntracked:false});fs.writeFileSync(path.join(root,'a.txt'),'foreign\n');
  execFileSync('git',['add','a.txt'],{cwd:root});execFileSync('git',['commit','-qm','foreign'],{cwd:root});
  await assert.rejects(()=>stashApply({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId}),
    /stash-apply-conflict/);const before=execFileSync('git',['stash','list'],{cwd:root,encoding:'utf8'});
  await assert.rejects(()=>stashApply({projectCapability,sessionId:'s-1234abcd',operationId:published.operationId}),
    /stash-apply-conflict-pending/);assert.equal(execFileSync('git',['stash','list'],{cwd:root,encoding:'utf8'}),before);
});

test('stash drop rejects an owned entry moved by a foreign stash',async()=>{
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  fs.writeFileSync(path.join(root,'a.txt'),'owned\n');const published=await stashPublish({projectCapability,
    sessionId:'s-1234abcd',purpose:'fork',includeUntracked:false});fs.writeFileSync(path.join(root,'a.txt'),'foreign\n');
  execFileSync('git',['stash','push','-m','foreign'],{cwd:root});await assert.rejects(()=>stashDrop({projectCapability,
    sessionId:'s-1234abcd',operationId:published.operationId}),/stash-drop-identity/);
  assert.match(execFileSync('git',['stash','list'],{cwd:root,encoding:'utf8'}),new RegExp(published.operationId));
});

test('stash fails closed when runtime state is not ignored',async()=>{
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});
  fs.rmSync(path.join(root,'.gitignore'));fs.writeFileSync(path.join(root,'a.txt'),'dirty\n');await assert.rejects(()=>stashPublish({
    projectCapability,sessionId:'s-1234abcd',purpose:'fork',includeUntracked:true}),/stash-runtime-unignored/);
  assert.equal(execFileSync('git',['stash','list'],{cwd:root,encoding:'utf8'}),'');
});

test('delegated rollback adopts reset and receipt deletion return loss exactly once',async()=>{
  const {root,projectCapability}=repository();fs.mkdirSync(path.join(root,'.claude'),{recursive:true});const sessionId='s-1234abcd';
  const snapshot=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();const work=path.join(root,'.deep-work',sessionId);
  const receipts=path.join(work,'receipts');fs.mkdirSync(receipts,{recursive:true});const statePath=path.join(root,'.claude',
    `deep-work.${sessionId}.md`);fs.writeFileSync(statePath,`---\nsession_id: ${sessionId}\nwork_dir: .deep-work/${sessionId}\n`+
    `current_phase: implement\ndelegation_snapshot: ${snapshot}\n---\n`);const stateCapability=issueProjectStateCapability(root,statePath,
    {role:'session-state'});const sessionCapability=issueProjectStateCapability(root,work,
    {role:'session-work-dir',sessionStateCapability:stateCapability});const receiptsDirCapability=Object.freeze({kind:'receipts-directory',
    role:'receipts-directory',path:receipts,sessionCapability,projectRoot:root});fs.writeFileSync(path.join(receipts,'SLICE-001.json'),
    '{"slice_id":"SLICE-001","status":"complete"}\n');fs.writeFileSync(path.join(receipts,'notes.txt'),'preserve\n');
  fs.writeFileSync(path.join(root,'a.txt'),'delegated\n');execFileSync('git',['add','a.txt'],{cwd:root});execFileSync('git',
    ['commit','-qm','delegated'],{cwd:root});const native=gitCapability(projectCapability);let resets=0;const gitRunner=async(args)=>{
    if(args[0]==='reset')resets+=1;return native.run(args);};let kill=true;await assert.rejects(()=>delegatedRollback({projectCapability,
    stateCapability,receiptsDirCapability,sessionId,snapshotOid:snapshot,userChoice:'redelegate',gitRunner,seam:(name)=>{
      if(kill&&name==='after-call-before-stage'){kill=false;throw new Error('lost-reset-return');}}}),/lost-reset-return/);
  kill=true;await assert.rejects(()=>delegatedRollback({projectCapability,stateCapability,receiptsDirCapability,sessionId,
    snapshotOid:snapshot,userChoice:'redelegate',gitRunner,seam:(name)=>{if(kill&&name==='after-receipt-remove-before-stage'){
      kill=false;throw new Error('lost-receipt-return');}}}),/lost-receipt-return/);const result=await delegatedRollback({projectCapability,
    stateCapability,receiptsDirCapability,sessionId,snapshotOid:snapshot,userChoice:'redelegate',gitRunner});
  assert.equal(result.status,'rolled-back');assert.equal(resets,1);assert.equal(execFileSync('git',['rev-parse','HEAD'],{
    cwd:root,encoding:'utf8'}).trim(),snapshot);assert.equal(fs.existsSync(path.join(receipts,'SLICE-001.json')),false);
  assert.equal(fs.readFileSync(path.join(receipts,'notes.txt'),'utf8'),'preserve\n');
});
