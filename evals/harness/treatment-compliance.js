'use strict';
const fs=require('node:fs'),path=require('node:path');
function checkCurrentTreatment({workspace,pluginRoot}){
 try{
  const runtime=name=>require(path.join(pluginRoot,'runtime',name));const platform=runtime('platform.js'),tx=runtime('transaction-runtime.js'),j=runtime('operation-journal.js');
  const directory=path.join(workspace,'.claude');const sessions=fs.readdirSync(directory).filter(name=>/^deep-work\.s-[a-f0-9]{8}\.md$/.test(name));if(sessions.length!==1)throw Error('treatment-session-count');
  const state=platform.issueProjectStateCapability(workspace,path.join(directory,sessions[0]),{role:'session-state'}),fields=tx.readState(state);
  const approvals=runtime('artifact-approval-runtime.js').assertAutonomousArtifactApprovals(state);
  if(fields.current_phase!=='idle'||fields.finish_outcome!=='keep'||typeof fields.finished_at!=='string')throw Error('treatment-keep-incomplete');
  const loaded=runtime('governed-context-runtime.js').loadGovernedContext({stateCapability:state});
  if(loaded.plan?.schema_version!==3||!runtime('governed-context-runtime.js').selectGovernedAdmission(loaded.projection,'finish-finalize').allowed)throw Error('treatment-current-authority');
  const producer=j.lookupCompletedOperation({projectCapability:tx.projectCapabilityFor(state),sessionId:fields.session_id,kind:'finish-keep',operationId:fields.finish_operation_id});
  if(producer?.stage!=='completed-ledger'||producer.resultSha256!==j.sha256(j.canonicalJson(producer.result))||producer.result?.status!=='completed'||producer.result.outcome!=='keep')throw Error('treatment-finish-producer');
  const relative=`${fields.work_dir}/session-receipt.json`,bytes=runtime('completion-receipt-runtime.js').regular(workspace,relative),wrapped=JSON.parse(bytes);
  require(path.join(pluginRoot,'hooks/scripts/wrap-receipt-envelope.js')).validatePayloadV11('session-receipt',wrapped.payload);
  if(producer.result.publication.path!==relative||producer.result.publication.sha256!==j.sha256(bytes)||j.canonicalJson(producer.result.wrapped)!==j.canonicalJson(wrapped)||wrapped.envelope?.producer!=='deep-work'||wrapped.envelope?.artifact_kind!=='session-receipt'||wrapped.envelope?.schema?.name!=='session-receipt'||wrapped.envelope?.run_id!==fields.session_m3_run_id||wrapped.payload.session_id!==fields.session_id||wrapped.payload.outcome!=='keep'||wrapped.payload.goal_acceptance.complete!==true)throw Error('treatment-finish-publication');
  return{status:'complete',complete:true,session_id:fields.session_id,outcome:'keep',approval_refs:approvals.map(r=>({phase:r.phase,ref:r.ref,source:r.source,evidence_mode:r.evidence_mode})),session_receipt:{path:relative,sha256:j.sha256(bytes),producer_operation_id:fields.finish_operation_id}};
 }catch(error){return{status:'incomplete',complete:false,reason:error.code||(/^[-a-z]+$/.test(error.message)?error.message:'treatment-authority-unavailable')};}
}
module.exports={checkCurrentTreatment};
