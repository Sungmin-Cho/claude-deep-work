'use strict';

const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');
const path=require('node:path');const {parseArgs,main}=require('./capture-command-evidence.js');

test('capture CLI rejects shell text and conflicting command modes',()=>{
  assert.throws(()=>parseArgs(['--command','npm test']),/unknown flag/);
  const base=['--state-file','s','--plan','p','--gate-id','GATE-x'];
  assert.throws(()=>parseArgs([...base,'--spec-file','a','--adapter-plan-file','b','--expected','must-pass']),/exactly one/);
  assert.throws(()=>parseArgs([...base,'--spec-file','a']),/--expected/);
  assert.throws(()=>parseArgs([...base,'--adapter-plan-file','b','--expected','must-pass']),/forbidden/);
});

test('capture CLI rejects shell text and emits no command output',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-evidence-cli-'));const specFile=path.join(root,'spec.json');
  fs.writeFileSync(specFile,JSON.stringify({schema_version:1,executable:{kind:'node',value:'node'},args:['-e','ignored'],
    cwd_role:'active-worktree',timeout_ms:5000,max_output_bytes:4096}));let stdout='',stderr='';const sentinel='dw-redaction-secret-6.13';
  const redactFile=path.join(root,'redact.txt');fs.writeFileSync(redactFile,`${sentinel}\n`);
  const code=await main(['--state-file','state','--plan','plan','--gate-id','GATE-command','--spec-file',specFile,
    '--expected','must-pass','--redact-file',redactFile],{stdout:{write:value=>{stdout+=value;}},stderr:{write:value=>{stderr+=value;}},evidenceId:'EVID-CLI-0001',
    loadContext:async()=>({fs,verificationPlan:{plan_sha256:'a'.repeat(64)},gate:{id:'GATE-command',adapter:'command',
      requirement_ids:[],failure_mode_ids:[]},slice:null}),captureDeps:{runner:async()=>({exitCode:0,stdout:sentinel,stderr:'',durationMs:1})},
    publishRecord:async(record)=>{assert.doesNotMatch(JSON.stringify(record),new RegExp(sentinel));return({schema_version:2,evidence_id:record.evidence_id,gate_id:record.gate_id,status:record.status,
      record_sha256:'b'.repeat(64),session_package_ref:'evidence/packages/x.json',session_package_sha256:'c'.repeat(64),
      redaction_passed:record.redaction.passed});}});
  assert.equal(code,0,stderr);assert.doesNotMatch(stdout,new RegExp(sentinel));const parsed=JSON.parse(stdout);
  assert.equal(parsed.evidence_id,'EVID-CLI-0001');assert.equal(parsed.status,'pass');
});
