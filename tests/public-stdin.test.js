'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {createPublicWorkflowFixture}=require('./helpers/public-workflow-fixtures.js');
test('actual CLI writes exact stdin bytes to owned temp and rejects overflow before write',async t=>{
  const f=await createPublicWorkflowFixture(t,{checkpoint:'brainstorm'});
  const create=()=>f.cli(['temp','create','--state',f.state,'--session',f.sessionId,'--purpose','artifact-input']);
  const run=(row,input)=>cp.spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/deep-work-runtime.js'),
    'temp','write','--state',f.state,'--session',f.sessionId,'--temp-operation-id',row.operationId,'--stdin'],
  {cwd:f.root,input,encoding:'utf8',env:{...process.env,DEEP_WORK_SESSION_ID:''},maxBuffer:1048576});
  const row=create(),bytes=Buffer.from([0,0xff,10,123,125]),written=run(row,bytes);
  assert.equal(written.status,0,written.stderr);assert.equal(JSON.parse(written.stdout).sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(fs.readFileSync(row.path),bytes);
  const oversized=create(),rejected=run(oversized,Buffer.alloc(1048577,1));
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/stdin-too-large/);assert.equal(fs.existsSync(oversized.path),false);
});
