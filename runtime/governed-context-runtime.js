'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {canonicalJson}=require('./operation-journal.js');

const DIGEST=/^[0-9a-f]{64}$/;
const POINTS=['finish-finalize','finish-pre-action','test'];
const WARNINGS=new Set(['legacy-proof-unavailable','finding-ref-invalid',
  'receipt-envelope-invalid','evidence-pointer-stale','invalidation-active',
  'projection-input-missing']);
const BLOCKERS=new Set(['evidence-missing','evidence-invalidated','redaction-failed',
  'residual-risk-unaccepted','replan-active','authority-invalidated',
  'finding-required-unknown','receipt-invalid','gate-missing','human-ack-missing',
  'external-change-lock','compatibility-context-missing']);
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);error.code=code;throw error;}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());}
function sorted(values){return [...new Set(values||[])].sort((a,b)=>
  Buffer.compare(Buffer.from(a),Buffer.from(b)));}
function exactSorted(values){return Array.isArray(values)&&
  canonicalJson(values)===canonicalJson(sorted(values));}
function assertDigestOrNull(value){return value===null||DIGEST.test(value||'');}
function normalizePlan(value){
  const row=value||{status:'missing',plan_authority_sha256:null,
    verification_plan_sha256:null};
  if(!['current','missing','invalidated','unknown'].includes(row.status)||
      !assertDigestOrNull(row.plan_authority_sha256)||
      !assertDigestOrNull(row.verification_plan_sha256)||
      row.status!=='current'&&(row.plan_authority_sha256!==null||
        row.verification_plan_sha256!==null))
    fail('progress-plan-identity');
  return{status:row.status,plan_authority_sha256:row.plan_authority_sha256,
    verification_plan_sha256:row.verification_plan_sha256};
}
function normalizeEvidence(value){
  const row=value||{status:'unknown',required_ids:[],completed_ids:[],missing_ids:[],
    invalidated_ids:[]};
  if(!['complete','incomplete','unknown','invalidated'].includes(row.status))
    fail('progress-evidence');
  const out={status:row.status,required_ids:sorted(row.required_ids),
    completed_ids:sorted(row.completed_ids),missing_ids:sorted(row.missing_ids),
    invalidated_ids:sorted(row.invalidated_ids)};
  if(![out.required_ids,out.completed_ids,out.missing_ids,out.invalidated_ids]
    .every((values)=>exactSorted(values)))
    fail('progress-evidence');
  return out;
}
function normalizeRisk(value){
  const row=value||{status:'unknown',class:null,accepted:null,blocking_reasons:[]};
  if(!['accepted','unaccepted','unknown'].includes(row.status)||
      !['low','medium','high','critical',null].includes(row.class)||
      row.status==='unknown'&&(row.accepted!==null||row.class!==null)||
      row.status!=='unknown'&&typeof row.accepted!=='boolean')
    fail('progress-residual-risk');
  return{status:row.status,class:row.class,accepted:row.accepted,
    blocking_reasons:sorted(row.blocking_reasons)};
}
function normalizeReplan(value){
  const row=value||{status:'none',epoch:null,reason:null,trigger_id:null};
  if(!['none','active','completing','completed','unknown'].includes(row.status)||
      !assertDigestOrNull(row.epoch)||!assertDigestOrNull(row.trigger_id)||
      !(row.reason===null||typeof row.reason==='string'&&row.reason.length>0))
    fail('progress-replan');
  return{status:row.status,epoch:row.epoch,reason:row.reason,trigger_id:row.trigger_id};
}
function normalizeInvalidations(values){
  const rows=(values||[]).map((row)=>{
    const common=DIGEST.test(row?.prior_plan_authority_sha256||'')&&
      DIGEST.test(row?.trigger_id||'')&&DIGEST.test(row?.invalidation_sha256||'');
    if(!common)fail('progress-invalidation');
    if(row.scope==='slice'&&exactKeys(row,['scope','slice_id','receipt_sha256',
      'prior_plan_authority_sha256','trigger_id','invalidation_sha256'])&&
      /^SLICE-\d{3}$/.test(row.slice_id||'')&&assertDigestOrNull(row.receipt_sha256))
      return structuredClone(row);
    if(row.scope==='session-plan'&&exactKeys(row,['scope','session_id',
      'prior_plan_authority_sha256','trigger_id','invalidation_sha256'])&&
      /^s-[0-9a-f]{8}$/.test(row.session_id||''))return structuredClone(row);
    if(row.scope==='session-package'&&exactKeys(row,['scope','session_id',
      'evidence_pointer_sha256','prior_plan_authority_sha256','trigger_id',
      'invalidation_sha256'])&&/^s-[0-9a-f]{8}$/.test(row.session_id||'')&&
      DIGEST.test(row.evidence_pointer_sha256||''))return structuredClone(row);
    fail('progress-invalidation');
  });
  return rows.sort((a,b)=>Buffer.compare(Buffer.from(canonicalJson([
    a.scope,a.slice_id||a.session_id,a.invalidation_sha256])),
  Buffer.from(canonicalJson([b.scope,b.slice_id||b.session_id,b.invalidation_sha256]))));
}
function normalizeFindings(value){
  const row=value||{status:'unknown',points:[]};
  if(!['complete','open','unknown'].includes(row.status)||!Array.isArray(row.points))
    fail('progress-findings');
  const points=row.points.map((point)=>{
    if(!exactKeys(point,['point','round','open_ids','resolved_ids','unknown_ids'])||
        typeof point.point!=='string'||!Number.isSafeInteger(point.round)||point.round<1)
      fail('progress-findings');
    return{point:point.point,round:point.round,open_ids:sorted(point.open_ids),
      resolved_ids:sorted(point.resolved_ids),unknown_ids:sorted(point.unknown_ids)};
  }).sort((a,b)=>Buffer.compare(Buffer.from(canonicalJson([a.point,a.round])),
    Buffer.from(canonicalJson([b.point,b.round]))));
  return{status:row.status,points};
}
function normalizeReceipts(value){
  const statuses=new Set(['pending','red-verified','green','sensor-clean','complete',
    'needs-replan','invalidated','blocked','legacy-read-only','unknown']);
  const row=value||{status:'unknown',rows:[]};
  if(!['complete','incomplete','unknown','invalidated'].includes(row.status)||
      !Array.isArray(row.rows))fail('progress-receipts');
  const rows=row.rows.map((item)=>{
    if(!exactKeys(item,['slice_id','slice_kind','status','receipt_sha256'])||
        !/^SLICE-\d{3}$/.test(item.slice_id||'')||
        !['functional','release-verification'].includes(item.slice_kind)||
        !statuses.has(item.status)||!assertDigestOrNull(item.receipt_sha256))
      fail('progress-receipts');
    return structuredClone(item);
  }).sort((a,b)=>Buffer.compare(Buffer.from(a.slice_id),Buffer.from(b.slice_id)));
  if(new Set(rows.map((rowValue)=>rowValue.slice_id)).size!==rows.length)
    fail('progress-receipts');
  return{status:row.status,rows};
}
function blockersFor(point,context){
  if(context.noPlan)return['compatibility-context-missing','gate-missing'];
  if(context.planIdentity.status==='invalidated'||
      context.replan.status==='active'||context.replan.status==='completing')
    return sorted(['authority-invalidated','replan-active',
      ...(context.evidence.status==='invalidated'?['evidence-invalidated']:[])]);
  if(context.planMissingVerification)return['evidence-missing','gate-missing'];
  const out=[];
  {
    if(context.evidence.status==='incomplete'||context.evidence.status==='unknown')
      out.push('evidence-missing');
    if(context.evidence.status==='invalidated')out.push('evidence-invalidated');
    if(context.residualRisk.status!=='accepted')out.push('residual-risk-unaccepted');
    if(context.findings.status==='unknown')out.push('finding-required-unknown');
    if(context.receipts.status==='unknown'||context.receipts.rows.some((row)=>
      ['legacy-read-only','unknown'].includes(row.status)))out.push('receipt-invalid');
    if(context.requiredGateIds.some((id)=>!context.satisfiedGateIds.includes(id)))
      out.push('gate-missing');
    if(context.redactionFailed)out.push('redaction-failed');
    if(point!=='test'&&context.humanAckRequired&&!context.humanAckSatisfied)
      out.push('human-ack-missing');
    if(point!=='test'&&context.externalChangeLock)out.push('external-change-lock');
  }
  return sorted(out);
}
function buildProgressProjectionV1(input={}){
  const planIdentity=normalizePlan(input.plan_identity);
  const evidence=normalizeEvidence(input.evidence);
  const residualRisk=normalizeRisk(input.residual_risk);
  const replan=normalizeReplan(input.replan);
  const invalidations=normalizeInvalidations(input.invalidations);
  const findings=normalizeFindings(input.findings);
  const receipts=normalizeReceipts(input.receipts);
  const requiredByPoint=input.required_gates_by_point||Object.fromEntries(POINTS.map((point)=>
    [point,input.required_gate_ids||[]]));
  const satisfiedByPoint=input.satisfied_gates_by_point||Object.fromEntries(POINTS.map((point)=>
    [point,input.satisfied_gate_ids||[]]));
  const context={planIdentity,evidence,residualRisk,replan,findings,receipts,
    noPlan:planIdentity.status==='missing',
    planMissingVerification:planIdentity.status==='current'&&
      planIdentity.verification_plan_sha256===null,
    redactionFailed:input.redaction_failed===true,
    humanAckRequired:input.human_ack_required===true,
    humanAckSatisfied:input.human_ack_satisfied===true,
    externalChangeLock:input.external_change_lock===true};
  const admissions=POINTS.map((enforcement_point)=>{
    const requiredGateIds=sorted(requiredByPoint[enforcement_point]);
    const satisfiedGateIds=sorted(satisfiedByPoint[enforcement_point]).filter((id)=>
      requiredGateIds.includes(id));
    context.requiredGateIds=requiredGateIds;context.satisfiedGateIds=satisfiedGateIds;
    const blocking_codes=blockersFor(enforcement_point,context);
    return{enforcement_point,allowed:blocking_codes.length===0,required_gate_ids:
      requiredGateIds,satisfied_gate_ids:satisfiedGateIds,blocking_codes};
  });
  const warnings=sorted(input.warnings);
  if(warnings.some((code)=>!WARNINGS.has(code)))fail('progress-warning');
  const projection={schema_version:1,plan_identity:planIdentity,evidence,residual_risk:
    residualRisk,replan,invalidations,findings,receipts,admissions,warnings};
  validateProgressProjectionV1(projection);
  const bytes=Buffer.from(canonicalJson(projection));
  return{projection,bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function validateProgressProjectionV1(value){
  if(!exactKeys(value,['schema_version','plan_identity','evidence','residual_risk','replan',
    'invalidations','findings','receipts','admissions','warnings'])||
      value.schema_version!==1||canonicalJson(normalizePlan(value.plan_identity))!==
        canonicalJson(value.plan_identity)||
      canonicalJson(normalizeEvidence(value.evidence))!==canonicalJson(value.evidence)||
      canonicalJson(normalizeRisk(value.residual_risk))!==canonicalJson(value.residual_risk)||
      canonicalJson(normalizeReplan(value.replan))!==canonicalJson(value.replan)||
      canonicalJson(normalizeInvalidations(value.invalidations))!==
        canonicalJson(value.invalidations)||
      canonicalJson(normalizeFindings(value.findings))!==canonicalJson(value.findings)||
      canonicalJson(normalizeReceipts(value.receipts))!==canonicalJson(value.receipts)||
      !Array.isArray(value.admissions)||value.admissions.length!==3||
      canonicalJson(value.admissions.map((row)=>row.enforcement_point))!==
        canonicalJson(POINTS)||!exactSorted(value.warnings)||
      value.warnings.some((code)=>!WARNINGS.has(code)))fail('progress-projection');
  for(const row of value.admissions){
    if(!exactKeys(row,['enforcement_point','allowed','required_gate_ids',
      'satisfied_gate_ids','blocking_codes'])||!POINTS.includes(row.enforcement_point)||
        typeof row.allowed!=='boolean'||!exactSorted(row.required_gate_ids)||
        !exactSorted(row.satisfied_gate_ids)||!exactSorted(row.blocking_codes)||
        row.blocking_codes.some((code)=>!BLOCKERS.has(code))||
        row.allowed!==(row.blocking_codes.length===0))
      fail('progress-admission');
  }
  return value;
}
function selectGovernedAdmission(value,enforcementPoint){
  validateProgressProjectionV1(value);
  const row=value.admissions.find((item)=>item.enforcement_point===enforcementPoint);
  if(!row)fail('progress-enforcement-point');
  return structuredClone(row);
}
function parseStored(value,fallback,code){
  if(value===undefined||value===null||value==='')return structuredClone(fallback);
  try{return typeof value==='string'?JSON.parse(value):structuredClone(value);}
  catch{fail(code);}
}
function readBoundedCanonical(file,code,max=4_194_304){
  let stat,bytes;try{stat=fs.lstatSync(file);bytes=fs.readFileSync(file);}catch{fail(code);}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)fail(code);
  let value;try{value=JSON.parse(bytes);}catch{fail(code);}
  if(!bytes.equals(Buffer.from(canonicalJson(value))))fail(code);
  return value;
}
function receiptProjection(workDir,plan,replanActive){
  const rows=[];let unknown=false,incomplete=false;
  for(const slice of plan.slices||[]){
    const file=path.join(workDir,'receipts',`${slice.id}.json`);
    let status='pending',receiptSha256=null;
    if(fs.existsSync(file)){
      let raw;try{raw=readBoundedCanonical(file,'governed-receipt',1_048_576);}
      catch{raw=null;}
      const value=raw?.payload||raw;
      if(!value){status='unknown';unknown=true;}
      else if(value.schema_version===2&&DIGEST.test(value.receipt_sha256||'')){
        const preimage=structuredClone(value);delete preimage.receipt_sha256;
        if(crypto.createHash('sha256').update(canonicalJson(preimage)).digest('hex')!==
            value.receipt_sha256){status='unknown';unknown=true;}
        else{status=value.status==='complete'?'complete':'unknown';
          receiptSha256=value.receipt_sha256;if(status==='unknown')unknown=true;}
      }else{status='legacy-read-only';unknown=true;
        receiptSha256=DIGEST.test(value?.receipt_sha256||'')?value.receipt_sha256:null;}
    }else incomplete=true;
    if(replanActive&&status!=='pending')status='invalidated';
    rows.push({slice_id:slice.id,slice_kind:slice.slice_kind||'functional',status,
      receipt_sha256:receiptSha256});
  }
  return{status:replanActive?'invalidated':unknown?'unknown':incomplete?'incomplete':'complete',
    rows};
}
function loadGovernedContext({stateCapability}={}){
  if(!stateCapability?.path||!stateCapability.projectRoot)fail('governed-context-state');
  const transaction=require('./transaction-runtime.js');
  const frontmatter=require('./frontmatter.js');
  const fields=frontmatter.parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  const sid=transaction.sessionIdFromState(stateCapability);
  if(typeof fields.work_dir!=='string')fail('governed-context-work-dir');
  const workDir=path.join(stateCapability.projectRoot,...fields.work_dir.split('/'));
  const planPath=path.join(workDir,'plan.json');
  const warnings=[],activeReplan=fields.replan_required===true;
  let plan=null,planIdentity={status:'missing',plan_authority_sha256:null,
    verification_plan_sha256:null};
  if(fs.existsSync(planPath)){
    try{
      plan=readBoundedCanonical(planPath,'governed-plan');
      const compiled=require('./plan-runtime.js').compileImmutablePlanAuthorityV2(plan);
      if(compiled.plan_authority_sha256!==plan.plan_authority_sha256)
        fail('governed-plan-authority');
      planIdentity={status:activeReplan?'invalidated':'current',
        plan_authority_sha256:activeReplan?null:plan.plan_authority_sha256,
        verification_plan_sha256:activeReplan?null:
          (DIGEST.test(fields.verification_plan_sha256||'')?
            fields.verification_plan_sha256:null)};
    }catch{plan=null;planIdentity={status:'unknown',plan_authority_sha256:null,
      verification_plan_sha256:null};warnings.push('projection-input-missing');}
  }else warnings.push('projection-input-missing');
  let verificationPlan=null;
  if(plan&&planIdentity.status==='current'&&planIdentity.verification_plan_sha256){
    const candidate=parseStored(fields.verification_plan_json,null,'governed-verification-plan');
    const policy=require('./verification-policy-runtime.js');
    if(candidate&&policy.validateVerificationPlan(candidate).pass&&
        candidate.plan_sha256===planIdentity.verification_plan_sha256&&
        candidate.plan_authority_sha256===plan.plan_authority_sha256)
      verificationPlan=candidate;
    else{planIdentity.verification_plan_sha256=null;warnings.push('projection-input-missing');}
  }
  const replan=activeReplan?{status:'active',
    epoch:DIGEST.test(fields.active_replan_epoch_id||'')?fields.active_replan_epoch_id:null,
    reason:typeof fields.replan_reason==='string'?fields.replan_reason:null,
    trigger_id:DIGEST.test(fields.active_replan_trigger_id||'')?
      fields.active_replan_trigger_id:null}:
    {status:'none',epoch:null,reason:null,trigger_id:null};
  const storedInvalidations=parseStored(fields.replan_invalidations_json,[],
    'governed-invalidations');
  const invalidations=storedInvalidations.map((row)=>{
    const copy=structuredClone(row);delete copy.schema_version;return copy;});
  if(activeReplan)warnings.push('invalidation-active');
  let evidence={status:'unknown',required_ids:[],completed_ids:[],missing_ids:[],
    invalidated_ids:[]},satisfied=[],evidenceSummary=null;
  if(verificationPlan){
    evidence.required_ids=sorted(verificationPlan.evidence_required_gate_ids);
    try{
      const review=parseStored(fields.review_execution_json,{},'governed-review-state');
      const evidenceRuntime=require('./evidence-runtime.js');
      const pkg=evidenceRuntime.loadCommittedPackage(workDir,review.evidence,verificationPlan);
      if(pkg){
        const summary=evidenceRuntime.evaluateEvidenceCompleteness(pkg,verificationPlan,
          {artifactRoot:workDir});
        evidenceSummary=summary;
        satisfied=sorted(summary.satisfied_gate_ids);
        evidence={status:summary.complete?'complete':'incomplete',
          required_ids:sorted(verificationPlan.evidence_required_gate_ids),
          completed_ids:satisfied,missing_ids:sorted(summary.missing_gate_ids),
          invalidated_ids:[]};
        if(!summary.redaction.passed)warnings.push('evidence-pointer-stale');
      }else warnings.push('projection-input-missing');
    }catch{evidence.status='invalidated';evidence.invalidated_ids=
      sorted(evidence.required_ids);warnings.push('evidence-pointer-stale');}
  }else if(plan)warnings.push('projection-input-missing');
  let residualRisk={status:'unknown',class:null,accepted:null,blocking_reasons:[]};
  if(plan&&evidenceSummary){
    try{
      const riskProfile=parseStored(fields.risk_profile_json,null,'governed-risk');
      if(!riskProfile||journalDigest(riskProfile)!==
          plan.contract_binding?.risk_profile_sha256)fail('governed-risk');
      const initialRisk=riskProfile.provisional||riskProfile.initial||riskProfile;
      const finalRisk=riskProfile.authoritative||riskProfile.final||riskProfile;
      const acceptances=parseStored(fields.risk_acceptances_json,[],
        'governed-risk-acceptances');
      const computed=require('./verification-policy-runtime.js').computeResidualRisk({
        initialRisk,finalRisk,evidenceSummary,
        unverifiedAreas:evidenceSummary.unverified_areas,
        riskAcceptances:acceptances});
      residualRisk={status:computed.accepted?'accepted':'unaccepted',
        class:computed.class,accepted:computed.accepted,blocking_reasons:sorted([
          ...computed.reasons,...computed.invalid_acceptance_ids.map((id)=>
            `invalid-acceptance:${id}`)])};
    }catch{warnings.push('projection-input-missing');}
  }else warnings.push('projection-input-missing');
  const findingLoaded=awaitFindingProjection({stateCapability,plan,fields,workDir});
  const findings=findingLoaded.projection;
  warnings.push(...findingLoaded.warnings);
  const receipts=plan?receiptProjection(workDir,plan,activeReplan):
    {status:'unknown',rows:[]};
  if(receipts.status==='unknown')warnings.push('receipt-envelope-invalid');
  if(receipts.rows.some((row)=>row.status==='legacy-read-only'))
    warnings.push('legacy-proof-unavailable');
  const policy=require('./verification-policy-runtime.js');
  const requiredByPoint=Object.fromEntries(POINTS.map((point)=>[point,verificationPlan?
    policy.requiredGateIds(verificationPlan,{at:point==='test'?'test':'finish'}):[]]));
  const satisfiedByPoint=Object.fromEntries(POINTS.map((point)=>[point,satisfied]));
  const built=buildProgressProjectionV1({plan_identity:planIdentity,evidence,
    residual_risk:residualRisk,replan,invalidations,findings,receipts,
    required_gates_by_point:requiredByPoint,satisfied_gates_by_point:satisfiedByPoint,
    warnings:sorted(warnings),human_ack_required:verificationPlan?.risk_class==='critical',
    human_ack_satisfied:fields.governed_human_ack_satisfied===true,
    external_change_lock:fields.external_change_lock===true,
    redaction_failed:warnings.includes('evidence-pointer-stale')});
  return{...built,plan,verificationPlan,sessionId:sid,workDir};
}

function awaitFindingProjection(input){
  return require('./finding-ref-runtime.js').loadFindingProjection(input);
}
function journalDigest(value){
  return require('./operation-journal.js').sha256(canonicalJson(value));
}

module.exports={buildProgressProjectionV1,validateProgressProjectionV1,
  selectGovernedAdmission,loadGovernedContext};
