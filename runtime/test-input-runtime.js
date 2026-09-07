'use strict';
const j=require('./operation-journal.js'),tx=require('./transaction-runtime.js');
function fail(code){throw Object.assign(new Error(`[${code}]`),{code});}
function operationId({sessionId,sourceOperationId,at,verificationPlanSha256}){
 if(!Number.isFinite(Date.parse(at)))fail('test-time');
 return `op-${j.sha256(j.canonicalJson({authority:'owned-test-input-v1',sessionId,sourceOperationId,at,verificationPlanSha256}))}`;
}
async function loadOwnedTestInput({stateCapability,sessionCapability,sourceOperationId,at,verificationPlanSha256}){
 const sessionId=tx.sessionIdFromState(stateCapability),projectCapability=tx.projectCapabilityFor(stateCapability);
 const source=await j.resumeOperation({projectCapability,sessionId,kind:'owned-temp',operationId:sourceOperationId});
 const written=source.stages?.find(row=>row.stage==='written')?.details?.owned;
 if(source.preconditions?.purpose!=='gate-results'||!/^op-[a-f0-9]{64}$/.test(sourceOperationId||'')||!/^([a-f0-9]{64})$/.test(written?.sha256||''))fail('test-owned-input');
 const id=operationId({sessionId,sourceOperationId,at,verificationPlanSha256});
 const consumed=source.stages?.find(row=>row.stage==='consumed')?.details?.owned;
 if(consumed&&consumed.consumerOperationId!==id)fail('test-owned-input-consumer');
 let pending;try{pending=await j.resumeOperation({projectCapability,sessionId,kind:'test-pass',operationId:id});}catch(error){if(error.code!=='operation-not-found')throw error;}
 let gateResults;
 if(pending?.stage==='completed-ledger'){
  if(pending.resultSha256!==j.sha256(j.canonicalJson(pending.result)))fail('test-owned-input-ledger');
  const cached=pending.result.test_input;
  if(cached?.source_operation_id!==sourceOperationId||cached.sha256!==written.sha256)fail('test-owned-input-ledger');
  gateResults=cached.gate_results;
 }else{
  const cached=pending?.stages?.find(row=>row.stage==='report-written')?.details?.owned;
  if(cached){if(cached.source_operation_id!==sourceOperationId||cached.sha256!==written.sha256)fail('test-owned-input-ledger');gateResults=cached.gate_results;}
  else{const value=await require('./artifact-runtime.js').prepareOwnedTempForOperation({sessionCapability,sourceOperationId,purpose:'gate-results'});if(value.bytes.length>1048576||value.sha256!==written.sha256)fail('test-owned-input');try{gateResults=JSON.parse(value.bytes);}catch{fail('gate-results-json');}}
 }
 return{gateResults,operationId:id,completed:pending?.stage==='completed-ledger'?pending:null,source:{sessionCapability,source_operation_id:sourceOperationId,sha256:written.sha256}};
}
async function consumeOwnedTestInput(operation,source,gateResults){
 const owned={source_operation_id:source.source_operation_id,sha256:source.sha256,gate_results:gateResults};
 await operation.recordStage('report-written',{owned});
 await require('./artifact-runtime.js').consumeOwnedTempForOperation({sessionCapability:source.sessionCapability,sourceOperationId:source.source_operation_id,purpose:'gate-results',consumerOperationId:operation.operationId,expectedDigest:source.sha256,adoptWithoutRead:true});
}
module.exports={loadOwnedTestInput,consumeOwnedTestInput,operationId};
