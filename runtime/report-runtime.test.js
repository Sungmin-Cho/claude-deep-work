'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync}=require('node:child_process');
const { readReceiptDashboard, readReceiptDetail, generateReport,exportReceipts,commitReport } = require('./report-runtime.js');
const platform=require('./platform.js');

test('receipt readers are bounded envelope-aware and sorted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-report-'));
  const receipts = path.join(dir, 'receipts'); fs.mkdirSync(receipts);
  fs.writeFileSync(path.join(receipts, 'SLICE-002.json'), JSON.stringify({payload:{slice_id:'SLICE-002',status:'complete'}}));
  fs.writeFileSync(path.join(receipts, 'SLICE-001.json'), JSON.stringify({slice_id:'SLICE-001',status:'in_progress'}));
  assert.deepEqual(readReceiptDashboard({receiptsDir:receipts}).map((row) => row.slice_id),
    ['SLICE-001','SLICE-002']);
  assert.equal(readReceiptDetail({receiptsDir:receipts,sliceId:'SLICE-002'}).status, 'complete');
  const report = generateReport({sessionId:'s-aaaaaaaa',receiptsDir:receipts});
  assert.match(report, /SLICE-001/);
  assert.match(report, /SLICE-002/);
});

test('report commit adopts an exact commit return loss without committing twice',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-report-commit-'));execFileSync('git',['init','-q',root]);
  execFileSync('git',['-C',root,'config','user.email','test@example.invalid']);execFileSync('git',['-C',root,'config','user.name','Test']);
  fs.mkdirSync(path.join(root,'.claude'));const work=path.join(root,'.deep-work','s-aaaaaaaa');fs.mkdirSync(path.join(work,'receipts'),
    {recursive:true});const statePath=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');fs.writeFileSync(statePath,
    '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\n---\n');fs.writeFileSync(
    path.join(root,'.gitignore'),'.claude/\n');const reportPath=path.join(work,'report.md');fs.writeFileSync(reportPath,'# Before\n');
  execFileSync('git',['-C',root,'add','.gitignore','.deep-work/s-aaaaaaaa/report.md']);execFileSync('git',['-C',root,'commit','-qm','base']);
  fs.writeFileSync(reportPath,'# Exact report\n');const stateCapability=()=>platform.issueProjectStateCapability(root,statePath,
    {role:'session-state'});let kill=true;await assert.rejects(()=>commitReport({stateCapability:stateCapability(),seam:(name)=>{
      if(kill&&name==='after-call-before-stage-1'){kill=false;throw new Error('lost-report-commit-return');}}}),
    /lost-report-commit-return/);const result=await commitReport({stateCapability:stateCapability()});assert.equal(result.status,'completed');
  assert.equal(execFileSync('git',['-C',root,'log','--format=%s','--grep','^deep-report: s-aaaaaaaa$'],{encoding:'utf8'})
    .trim().split('\n').filter(Boolean).length,1);assert.deepEqual(result.paths,['.deep-work/s-aaaaaaaa/report.md']);
});

test('report generation and receipt export adopt exact output return loss',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-report-output-'));fs.mkdirSync(path.join(root,'.git'));
  fs.mkdirSync(path.join(root,'.claude'));const work=path.join(root,'.deep-work','s-bbbbbbbb');const receipts=path.join(work,'receipts');
  fs.mkdirSync(receipts,{recursive:true});const statePath=path.join(root,'.claude','deep-work.s-bbbbbbbb.md');fs.writeFileSync(statePath,
    '---\nsession_id: s-bbbbbbbb\nwork_dir: .deep-work/s-bbbbbbbb\ncurrent_phase: implement\n---\n');fs.writeFileSync(
    path.join(receipts,'SLICE-001.json'),'{"slice_id":"SLICE-001","status":"complete"}\n');const state=()=>
    platform.issueProjectStateCapability(root,statePath,{role:'session-state'});for(const [name,invoke] of [['report',()=>generateReport({
      stateCapability:state(),seam:(point)=>{if(point==='after-output-write-before-stage')throw new Error('lost-report-output');}})],
    ['export',()=>exportReceipts({stateCapability:state(),format:'json',seam:(point)=>{if(point==='after-output-write-before-stage')
      throw new Error('lost-export-output');}})]])await assert.rejects(invoke,new RegExp(`lost-${name}-output`));const report=
    await generateReport({stateCapability:state()});const exported=await exportReceipts({stateCapability:state(),format:'json'});
  assert.match(fs.readFileSync(report.output,'utf8'),/SLICE-001/);assert.match(fs.readFileSync(exported.output,'utf8'),/SLICE-001/);
});
