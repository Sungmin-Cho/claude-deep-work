'use strict';

const {test,beforeEach,afterEach}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const session=require('../../runtime/session-store.js');const git=require('../../runtime/git-runtime.js');const platform=require('../../runtime/platform.js');

let root,project;function setup(){root=fs.mkdtempSync(path.join(os.tmpdir(),'fork-utils-node-'));fs.mkdirSync(path.join(root,'.git'));
  fs.mkdirSync(path.join(root,'.claude'));project=platform.issueProjectStateCapability(root,root,{role:'project-root'});}
function cleanup(){if(root)fs.rmSync(root,{recursive:true,force:true});root=null;}
function registry(sessions){return{version:1,shared_files:[],sessions};}
beforeEach(setup);afterEach(cleanup);

test('fork validation is a shell-free closed registry operation',()=>{assert.equal(session.NODE_AUTHORITY.shell,false);
  assert.throws(()=>session.validateForkTarget(registry({'s-aaaaaaaa':{current_phase:'idle',file_ownership:[]}}),'s-aaaaaaaa'),/fork-parent-idle/);
  assert.throws(()=>session.validateForkTarget(registry({}),'s-aaaaaaaa'),/fork-parent-missing/);
  assert.equal(session.validateForkTarget(registry({'s-aaaaaaaa':{current_phase:'implement',file_ownership:[]}}),'s-aaaaaaaa').current_phase,'implement');});

test('fork generation preserves zero, child, and three-generation warning data',()=>{assert.equal(session.getForkGeneration(
  registry({'s-aaaaaaaa':{current_phase:'implement',file_ownership:[]}}),'s-aaaaaaaa'),0);
  assert.equal(session.getForkGeneration(registry({'s-bbbbbbbb':{current_phase:'plan',fork_parent:'s-aaaaaaaa',fork_generation:1,file_ownership:[]}}),'s-bbbbbbbb'),1);
  assert.equal(session.getForkGeneration(registry({'s-cccccccc':{current_phase:'plan',fork_generation:3,file_ownership:[]}}),'s-cccccccc'),3);});

test('fork registry reducers remain internal lifecycle stages',()=>{assert.equal(session.registerForkSession,undefined);
  assert.equal(session.removeForkSession,undefined);assert.equal(session.removeSessionOwnership,undefined);});

test('raw-string Git inputs fail before any Git process authority is constructed',async()=>{let calls=0;const original=git.gitCapability;
  try{git.gitCapability=()=>{calls++;throw new Error('must not run');};await assert.rejects(()=>git.createFork({projectCapability:project,
    parentSessionId:'s-aaaaaaaa',childSessionId:'s-bbbbbbbb',parentStateCapability:path.join(root,'.claude','deep-work.s-aaaaaaaa.md')}),
    /fork-parent-capability/);assert.equal(calls,0);}finally{git.gitCapability=original;}});

test('managed fork capability allows only the exact sibling/session/branch tuple',()=>{const parentBranch='main';const sessionId='s-bbbbbbbb';
  const expected=path.join(path.dirname(root),`${path.basename(root)}-wt-fork-bbbbbbbb`);const branch='main-fork-bbbbbbbb';
  const cap=platform.issueForkWorktreeCapability({projectRoot:root,candidate:expected,sessionId,parentBranch,branch,allowMissingLeaf:true});
  assert.equal(cap.path,path.join(fs.realpathSync(path.dirname(root)),path.basename(expected)));assert.equal(cap.purpose,'fork-session');
  for(const input of [
    {candidate:`${root}-evil`,sessionId,parentBranch,branch},
    {candidate:path.join(path.dirname(root),`${path.basename(root)}-wt-fork-aaaaaaaa`),sessionId,parentBranch,branch},
    {candidate:expected,sessionId,parentBranch,branch:'wrong-fork-bbbbbbbb'},
    {candidate:expected,sessionId:'s-aaaaaaaa',parentBranch,branch},
  ])assert.throws(()=>platform.issueForkWorktreeCapability({projectRoot:root,...input,allowMissingLeaf:true}),/managed-worktree-(shape|branch)/);});

test('fork sibling symlink and post-issuance swap are rejected',()=>{const sessionId='s-cccccccc',parentBranch='main',branch='main-fork-cccccccc';
  const expected=path.join(path.dirname(root),`${path.basename(root)}-wt-fork-cccccccc`);const outside=fs.mkdtempSync(path.join(os.tmpdir(),'fork-outside-'));
  try{fs.symlinkSync(outside,expected,'dir');assert.throws(()=>platform.issueForkWorktreeCapability({projectRoot:root,candidate:expected,
      sessionId,parentBranch,branch,allowMissingLeaf:true}),/path-capability|managed-worktree|link/);fs.unlinkSync(expected);
    const cap=platform.issueForkWorktreeCapability({projectRoot:root,candidate:expected,sessionId,parentBranch,branch,allowMissingLeaf:true});
    fs.symlinkSync(outside,expected,'dir');assert.throws(()=>platform.revalidatePathCapability(cap,'git-worktree-add'),/path-capability|managed-worktree|link/);
  }finally{try{fs.unlinkSync(expected);}catch{}fs.rmSync(outside,{recursive:true,force:true});}});
