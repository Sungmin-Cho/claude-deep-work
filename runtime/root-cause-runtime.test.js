'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const rootCause=require('./root-cause-runtime.js');
const journal=require('./operation-journal.js');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');
const frontmatter=require('./frontmatter.js');

function observation({operation='1',slice='SLICE-001',root='a'}={}){
  return{schema_version:1,source_kind:'verification-result',
    source_operation_id:`op-${operation.length===64?operation:
      operation.repeat(64)}`,slice_id:slice,
    failure_class:'assertion',normalized_signal_sha256:'b'.repeat(64),
    contract_trace_sha256:'c'.repeat(64),root_cause_sha256:root.repeat(64)};
}
function ledger(){
  return rootCause.emptyRootCauseLedger({sessionId:'s-aaaaaaaa',
    planAuthoritySha256:'d'.repeat(64),replanEpoch:'e'.repeat(64)});
}

test('RootCauseLedgerV1 assigns a stable sequence and adopts the same producer fact',
  ()=>{
    const first=rootCause.insertRootCause({ledger:ledger(),
      observation:observation(),sourceResultSha256:'f'.repeat(64)});
    assert.equal(first.entry.record_sequence,1);
    assert.equal(first.ledger.next_record_sequence,2);
    assert.equal(first.qualification,null);
    const replay=rootCause.insertRootCause({ledger:first.ledger,
      observation:observation(),sourceResultSha256:'f'.repeat(64)});
    assert.equal(replay.adopted,true);
    assert.equal(replay.ledger.ledger_sha256,first.ledger.ledger_sha256);
  });

test('the earliest later distinct root creates one immutable pending qualification',
  ()=>{
    const first=rootCause.insertRootCause({ledger:ledger(),
      observation:observation({operation:'1',root:'a'}),
      sourceResultSha256:'1'.repeat(64)});
    const same=rootCause.insertRootCause({ledger:first.ledger,
      observation:observation({operation:'2',root:'a'}),
      sourceResultSha256:'2'.repeat(64)});
    assert.equal(same.qualification,null);
    const distinct=rootCause.insertRootCause({ledger:same.ledger,
      observation:observation({operation:'3',root:'d'}),
      sourceResultSha256:'3'.repeat(64)});
    assert.match(distinct.pending_derivation.operation_id,/^op-[0-9a-f]{64}$/);
    assert.equal(distinct.qualification.entries.length,3);
    assert.deepEqual(rootCause.validateQualification(distinct.qualification),
      distinct.qualification);
    assert.throws(()=>rootCause.validateQualification({
      ...distinct.qualification,next_record_sequence:99}),
    /root-cause-qualification/);
    assert.deepEqual(distinct.pending_derivation.qualifying_observation_ids,
      [first.entry.observation_id,distinct.entry.observation_id].sort());
    const later=rootCause.insertRootCause({ledger:distinct.ledger,
      observation:observation({operation:'4',root:'e'}),
      sourceResultSha256:'4'.repeat(64)});
    assert.equal(later.qualification,null);
    assert.equal(later.ledger.repeated_derivations.length,1);
  });

test('qualification is isolated by slice and retained beyond the 32-entry cap',()=>{
  let current=ledger(),qualified;
  for(let index=1;index<=34;index++){
    const digest=index.toString(16).padStart(64,'0');
    const result=rootCause.insertRootCause({ledger:current,
      observation:observation({operation:digest,slice:
        index<3?'SLICE-001':'SLICE-002',root:index===2?'d':'a'}),
      sourceResultSha256:digest});
    current=result.ledger;if(result.qualification)qualified=result;
  }
  assert.ok(qualified);
  assert.ok(current.entries.length>=32);
  for(const id of qualified.pending_derivation.qualifying_observation_ids)
    assert.equal(current.entries.some((row)=>row.observation_id===id),true);
});

test('debug-root producers publish an authenticated ledger and one pending derivation',
  async(t)=>{
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),
      'dw-root-cause-record-')));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
    const sessionId='s-aaaaaaaa',work=path.join(root,'.deep-work',sessionId),
      debugDir=path.join(work,'debug-log');
    fs.mkdirSync(debugDir,{recursive:true});
    const statePath=path.join(root,'.claude',`deep-work.${sessionId}.md`);
    fs.writeFileSync(statePath,frontmatter.updateFrontmatterText('',{
      session_id:sessionId,work_dir:`.deep-work/${sessionId}`,
      current_phase:'implement'}));
    const stateCapability=platform.issueProjectStateCapability(root,statePath,
      {role:'session-state'}),project=
      transaction.projectCapabilityFor(stateCapability),
      plan={plan_authority_sha256:'d'.repeat(64),
        replan_epoch:'e'.repeat(64)};
    async function debugProducer(index,bytes){
      const operationId=`op-${String(index).repeat(64)}`,
        notePath=path.join(debugDir,`RC-${String(index).padStart(3,'0')}.md`);
      fs.writeFileSync(notePath,bytes);
      const operation=await journal.beginOperation({projectCapability:project,
        sessionId,kind:'debug-complete',operationId,
        preconditions:{index}});
      for(const stage of ['stores-prepared','note-written','receipt-written',
        'state-written'])await journal.recordOperationStage(operation,stage,{
        owned:{index}});
      await journal.completeOperation(operation,{status:'completed',
        sliceId:'SLICE-001',notePath,
        noteSha256:journal.sha256(bytes),receiptSha256:
          String(index+2).repeat(64),stateSha256:String(index+3).repeat(64)});
      return operationId;
    }
    const firstOperation=await debugProducer(1,Buffer.from('root one\n'));
    const first=await rootCause.recordRootCause({stateCapability,plan,
      sourceKind:'debug-root',sourceOperationId:firstOperation});
    assert.equal(first.record_sequence,1);
    assert.equal(first.pending_repeated_operation_id,null);
    const secondOperation=await debugProducer(2,Buffer.from('root two\n'));
    const second=await rootCause.recordRootCause({stateCapability,plan,
      sourceKind:'debug-root',sourceOperationId:secondOperation});
    assert.equal(second.record_sequence,2);
    assert.match(second.pending_repeated_operation_id,/^op-[0-9a-f]{64}$/);
    const fields=frontmatter.parseFrontmatter(
      fs.readFileSync(statePath,'utf8')).fields,
      stored=rootCause.validateRootCauseLedger(JSON.parse(
        fields.root_cause_ledger_json));
    assert.equal(stored.repeated_derivations[0].status,'pending');
    assert.equal(fs.existsSync(path.join(root,
      ...stored.repeated_derivations[0].qualification_path.split('/'))),true);
    const replay=await rootCause.recordRootCause({stateCapability,plan,
      sourceKind:'debug-root',sourceOperationId:firstOperation});
    assert.equal(replay.adopted,true);
  });
