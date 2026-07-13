'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {issueProjectStateCapability}=require('./platform.js');
const {withRankedLocks,journaledStateMutation,RANKS}=require('./transaction-runtime.js');

function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-rank-'));fs.mkdirSync(path.join(root,'.git'));
  fs.mkdirSync(path.join(root,'.claude'));return {root};}
function lock(root,name){return issueProjectStateCapability(root,path.join(root,'.claude',`${name}.lock`),
  {allowMissingLeaf:true,role:'lock'});}

test('rank protocol rejects inversion and permits 5 through 70 ordering',async()=>{
  const {root}=setup();const seen=[];
  assert.deepEqual({repository:RANKS.repository,session:RANKS.session,journal:RANKS.journal,pointer:RANKS.pointer,
    registry:RANKS.registry,state:RANKS.state,pending:RANKS.pending,target:RANKS.target},
  {repository:5,session:10,journal:20,pointer:30,registry:40,state:50,pending:60,target:70});
  await withRankedLocks([{rank:RANKS.git,capability:lock(root,'git')},{rank:RANKS.state,capability:lock(root,'state')},
    {rank:RANKS.artifact,capability:lock(root,'artifact')}],async()=>{seen.push('held');
      await assert.rejects(()=>withRankedLocks([{rank:RANKS.git,capability:lock(root,'late-git')}],async()=>{}),/lock-rank-inversion/);});
  assert.deepEqual(seen,['held']);
});

test('same-rank locks require canonical UTF-8 path order',async()=>{
  const {root}=setup();const a=lock(root,'a');const b=lock(root,'b');
  await withRankedLocks([{rank:RANKS.target,capability:a},{rank:RANKS.target,capability:b}],async()=>{});
  await assert.rejects(()=>withRankedLocks([{rank:RANKS.target,capability:b},
    {rank:RANKS.target,capability:a}],async()=>{}),/lock-rank-tie-order/);
});

test('two workers taking the same ranked locks serialize without lost writes',async()=>{
  const {root}=setup();const worker=path.resolve(__dirname,'..','tests','fixtures','rank-lock-worker.js');
  const run=(id)=>new Promise((resolve,reject)=>{const cp=spawn(process.execPath,[worker,root,id]);let stderr='';
    cp.stderr.on('data',(d)=>stderr+=d);cp.on('close',(code)=>code===0?resolve():reject(new Error(stderr)));});
  await Promise.all([run('a'),run('b')]);
  const rows=fs.readFileSync(path.join(root,'.claude','rank-results.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map((row)=>row.id).sort(),['a','b']);
});

test('journaled state mutation adopts exact post-write bytes without rerunning the reducer',async()=>{
  const {root}=setup();const file=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(file,'---\nsession_id: s-aaaaaaaa\ncurrent_phase: implement\ncount: 0\n---\nbody\n');let calls=0;
  const invoke=(seam)=>journaledStateMutation({stateCapability:issueProjectStateCapability(root,file,{role:'session-state'}),
    kind:'phase-checkpoint',preconditions:{action:'increment'},seam,reducer:(state)=>{calls+=1;return{count:Number(state.count)+1};}});
  await assert.rejects(()=>invoke((name)=>{if(name==='after-state-write-before-stage')throw new Error('lost-return');}),/lost-return/);
  const result=await invoke();assert.equal(result.count,1);assert.equal(calls,1);
});

test('journaled state mutation rejects foreign bytes after its prepared stage',async()=>{
  const {root}=setup();const file=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(file,'---\nsession_id: s-aaaaaaaa\ncurrent_phase: implement\ncount: 0\n---\n');
  const invoke=(seam)=>journaledStateMutation({stateCapability:issueProjectStateCapability(root,file,{role:'session-state'}),
    kind:'phase-checkpoint',preconditions:{action:'foreign'},seam,reducer:(state)=>({count:Number(state.count)+1})});
  await assert.rejects(()=>invoke((name)=>{if(name==='before-state-write'){fs.appendFileSync(file,'foreign\n');throw new Error('stop');}}),/stop/);
  await assert.rejects(()=>invoke(),/transaction-state-diverged/);
});
