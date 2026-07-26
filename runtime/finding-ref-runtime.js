'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');
const journal=require('./operation-journal.js');
const frontmatter=require('./frontmatter.js');
const findingRuntime=require('./review-finding-runtime.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
const ARTIFACT_KIND=/^[a-z][a-z0-9-]{0,63}$/;
const KEYS=['schema_version','point','round','path','sha256','producer_operation_id',
  'artifact_kind','artifact_sha256','spec_sha256','spec_approved_hash',
  'plan_authority_sha256','risk_profile_sha256','replan_epoch','finding_ref_sha256'];
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);error.code=code;throw error;}
function canonical(value){return journal.canonicalJson(value);}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonical(Object.keys(value).sort())===canonical([...keys].sort());}
function digest(domain,value,omitted){
  const copy=structuredClone(value);if(omitted)delete copy[omitted];
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(`${domain}\0`),Buffer.from(canonical(copy))])).digest('hex');
}
function portable(root,file,code){
  const absolute=path.resolve(file),relative=path.relative(root,absolute).split(path.sep).join('/');
  if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative)||
      !platform.isPathInside(root,absolute))fail(code);
  let stat,real;try{stat=fs.lstatSync(absolute);real=fs.realpathSync(absolute);}catch{fail(code);}
  if(!stat.isFile()||stat.isSymbolicLink()||!platform.isPathInside(fs.realpathSync(root),real))
    fail(code);
  return{absolute,relative};
}
function nullableDigest(value){return value===null||DIGEST.test(value||'');}
function validateFindingRefV1(value){
  if(!exactKeys(value,KEYS)||value.schema_version!==1||
      !findingRuntime.isReviewPoint(value.point)||!Number.isSafeInteger(value.round)||
      value.round<1||typeof value.path!=='string'||!value.path||
      !DIGEST.test(value.sha256||'')||!OPERATION.test(value.producer_operation_id||'')||
      !ARTIFACT_KIND.test(value.artifact_kind||'')||!DIGEST.test(value.artifact_sha256||'')||
      !nullableDigest(value.spec_sha256)||!nullableDigest(value.spec_approved_hash)||
      !nullableDigest(value.plan_authority_sha256)||
      !nullableDigest(value.risk_profile_sha256)||!nullableDigest(value.replan_epoch)||
      !DIGEST.test(value.finding_ref_sha256||'')||
      digest('finding-ref-v1',value,'finding_ref_sha256')!==value.finding_ref_sha256)
    fail('finding-ref-schema');
  const documentPoint=value.point==='research'||value.point==='spec';
  if(documentPoint&&value.plan_authority_sha256!==null||
      !documentPoint&&value.plan_authority_sha256===null||
      value.point==='research'&&(value.spec_sha256!==null||
        value.spec_approved_hash!==null)||
      value.point==='spec'&&(value.spec_sha256===null||
        value.spec_approved_hash===null)||
      !documentPoint&&(value.spec_sha256!==null||value.spec_approved_hash!==null))
    fail('finding-ref-authority-shape');
  return structuredClone(value);
}
function validateFindingDocument(file,point,round){
  let stat,bytes,value;try{stat=fs.lstatSync(file);bytes=fs.readFileSync(file);
    value=JSON.parse(bytes);}catch{fail('finding-ref-document');}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4_194_304||
      !exactKeys(value,['schema_version','point','round','findings'])||
      value.schema_version!==1||value.point!==point||value.round!==round||
      !Array.isArray(value.findings)||
      value.findings.some((row)=>!findingRuntime.validateFinding(row)||row.round!==round))
    fail('finding-ref-document');
  return{bytes,value,sha256:journal.sha256(bytes)};
}
function writeExclusive(file,bytes,code){
  fs.mkdirSync(path.dirname(file),{recursive:true});let fd;
  try{fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
  catch(error){if(error.code!=='EEXIST'||!fs.readFileSync(file).equals(bytes))fail(code);}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  if(!fs.readFileSync(file).equals(bytes))fail(code);
}
function authorityFor(fields,point,artifactSha256,plan){
  const documentPoint=point==='research'||point==='spec';
  const planAuthority=documentPoint?null:
    (DIGEST.test(plan?.plan_authority_sha256||'')?plan.plan_authority_sha256:null);
  if(!documentPoint&&!planAuthority)fail('finding-ref-plan-authority');
  let specSha256=null,specApprovedHash=null;
  if(point==='spec'){
    let contract;try{contract=typeof fields.spec_contract_json==='string'?
      JSON.parse(fields.spec_contract_json):fields.spec_contract_json;}
    catch{fail('finding-ref-spec-authority');}
    try{specSha256=require('./contract-runtime.js').specContractDigest(contract);}
    catch{fail('finding-ref-spec-authority');}
    specApprovedHash=fields.spec_approved_hash;
    if(!DIGEST.test(specSha256||'')||!DIGEST.test(specApprovedHash||''))
      fail('finding-ref-spec-authority');
  }
  return{artifact_sha256:artifactSha256,
    spec_sha256:specSha256,spec_approved_hash:specApprovedHash,
    plan_authority_sha256:planAuthority,
    risk_profile_sha256:documentPoint?null:
      (DIGEST.test(plan?.contract_binding?.risk_profile_sha256||'')?
        plan.contract_binding.risk_profile_sha256:null),
    replan_epoch:documentPoint?null:
      (DIGEST.test(fields.active_replan_epoch_id||'')?fields.active_replan_epoch_id:null)};
}
function indexRows(fields){
  if(!fields.governed_finding_refs_json)return[];
  let rows;try{rows=typeof fields.governed_finding_refs_json==='string'?
    JSON.parse(fields.governed_finding_refs_json):
    structuredClone(fields.governed_finding_refs_json);}catch{fail('finding-ref-index');}
  if(!Array.isArray(rows))fail('finding-ref-index');
  return rows;
}
async function publishFindingRef({stateCapability,point,round,findingPath,artifactPath,
  artifactKind,seam,_locksHeld=false}={}){
  if(!findingRuntime.isReviewPoint(point)||!Number.isSafeInteger(round)||round<1||
      !ARTIFACT_KIND.test(artifactKind||''))fail('finding-ref-input');
  const root=stateCapability?.projectRoot;
  if(!root)fail('finding-ref-state');
  const sid=transaction.sessionIdFromState(stateCapability);
  if(!_locksHeld){
    const locks=[{rank:transaction.RANKS.session,capability:platform.issueProjectStateCapability(
      root,path.join(root,'.claude',`deep-work.${sid}.rank-operation.lock`),
      {allowMissingLeaf:true,role:'lock'})},{rank:transaction.RANKS.journal,
      capability:platform.issueProjectStateCapability(root,path.join(root,'.claude',
        `deep-work.${sid}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}];
    return transaction.withRankedLocks(locks,()=>publishFindingRef({stateCapability,point,
      round,findingPath,artifactPath,artifactKind,seam,_locksHeld:true}));
  }
  require('./slice-runtime.js').assertNoPendingScopedWrite(stateCapability);
  const stateText=fs.readFileSync(stateCapability.path,'utf8');
  const fields=frontmatter.parseFrontmatter(stateText).fields;
  if(typeof fields.work_dir!=='string')fail('finding-ref-work-dir');
  const workDir=path.join(root,...fields.work_dir.split('/'));
  const finding=portable(root,findingPath,'finding-ref-document');
  const reviewRoot=path.join(workDir,'reviews');
  if(!platform.isPathInside(reviewRoot,finding.absolute))fail('finding-ref-document');
  const document=validateFindingDocument(finding.absolute,point,round);
  const artifact=portable(root,artifactPath,'finding-ref-artifact');
  const artifactSha256=journal.sha256(fs.readFileSync(artifact.absolute));
  let plan=null;
  if(!['research','spec'].includes(point)){
    try{plan=JSON.parse(fs.readFileSync(path.join(workDir,'plan.json'),'utf8'));
      const compiled=require('./plan-runtime.js').compileImmutablePlanAuthorityV2(plan);
      if(compiled.plan_authority_sha256!==plan.plan_authority_sha256)
        fail('finding-ref-plan-authority');}
    catch(error){if(error.code)throw error;fail('finding-ref-plan-authority');}
  }
  const authority=authorityFor(fields,point,artifactSha256,plan);
  const preimage={point,round,path:finding.relative,sha256:document.sha256,
    artifact_kind:artifactKind,...authority};
  const operationId=`op-${journal.sha256(canonical(preimage))}`;
  const ref={schema_version:1,...preimage,producer_operation_id:operationId,
    finding_ref_sha256:null};
  ref.finding_ref_sha256=digest('finding-ref-v1',ref,'finding_ref_sha256');
  validateFindingRefV1(ref);
  const refRelative=`.deep-work/${sid}/reviews/refs/${point}-round-${round}-${ref.finding_ref_sha256}.json`;
  const refPath=path.join(root,...refRelative.split('/'));
  const wrapper={schema_version:1,finding_ref:ref,
    finding_ref_sha256:ref.finding_ref_sha256};
  const wrapperBytes=Buffer.from(canonical(wrapper));
  const wrapperSha256=journal.sha256(wrapperBytes);
  const project=transaction.projectCapabilityFor(stateCapability);
  const completed=await journal.resumeOperation({projectCapability:project,
    operationId,sessionId:sid,kind:'finding-publish'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(completed?.stage==='completed-ledger')return{...completed.result,
    operation_id:operationId,operation_receipt:completed,adopted:true};
  const operation=await journal.beginOperation({projectCapability:project,sessionId:sid,
    kind:'finding-publish',operationId,preconditions:preimage});
  await journal.recordOperationStage(operation,'authority-authenticated',{owned:{
    artifactPath:artifact.relative,artifactSha256}});
  await journal.recordOperationStage(operation,'findings-published',{owned:{
    path:finding.relative,sha256:document.sha256}});
  writeExclusive(refPath,wrapperBytes,'finding-ref-publish');
  await journal.recordOperationStage(operation,'ref-artifact-published',{owned:{
    path:refRelative,sha256:wrapperSha256,findingRefSha256:ref.finding_ref_sha256}});
  const rows=indexRows(fields);
  const locator={point,round,finding_ref_path:refRelative,
    finding_ref_sha256:ref.finding_ref_sha256,
    finding_ref_artifact_sha256:wrapperSha256,producer_operation_id:operationId};
  const matching=rows.find((row)=>row.point===point&&row.round===round);
  if(matching&&canonical(matching)!==canonical(locator))fail('finding-ref-index-conflict');
  if(!matching)rows.push(locator);
  rows.sort((a,b)=>Buffer.compare(Buffer.from(canonical([a.point,a.round])),
    Buffer.from(canonical([b.point,b.round]))));
  const after=frontmatter.updateFrontmatterText(stateText,{
    governed_finding_refs_json:canonical(rows).trimEnd()});
  if(after!==stateText){seam?.('before-state-write',{operationId});
    platform.atomicWriteFile(stateCapability,after);
    seam?.('after-state-write-before-stage',{operationId});}
  await journal.recordOperationStage(operation,'ref-committed',{owned:{
    statePath:stateCapability.path,postStateSha256:journal.sha256(Buffer.from(after)),
    findingRefSha256:ref.finding_ref_sha256}});
  const result={point,round,path:finding.relative,sha256:document.sha256,
    finding_ref_path:refRelative,finding_ref_sha256:ref.finding_ref_sha256,
    finding_ref_artifact_sha256:wrapperSha256,artifact_sha256:artifactSha256,
    spec_approved_hash:authority.spec_approved_hash,
    plan_authority_sha256:authority.plan_authority_sha256,
    replan_epoch:authority.replan_epoch,
    post_state_sha256:journal.sha256(Buffer.from(after))};
  const receipt=await journal.completeOperation(operation,result);
  return{...result,operation_id:operationId,operation_receipt:receipt,adopted:false};
}

function completedReceipt(root,sid,operationId){
  let ledger;try{ledger=JSON.parse(fs.readFileSync(path.join(root,'.claude',
    `deep-work.${sid}.completed-operations.json`),'utf8'));}catch{fail('finding-ref-ledger');}
  if(ledger?.version!==1||!Array.isArray(ledger.receipts))fail('finding-ref-ledger');
  const receipt=ledger.receipts.find((row)=>row.operationId===operationId);
  if(!receipt||receipt.version!==1||receipt.sessionId!==sid||
      receipt.kind!=='finding-publish'||receipt.stage!=='completed-ledger'||
      !DIGEST.test(receipt.resultSha256||'')||
      journal.sha256(canonical(receipt.result))!==receipt.resultSha256)
    fail('finding-ref-ledger');
  return receipt;
}
function loadFindingProjection({stateCapability,plan,fields,workDir}={}){
  const rows=indexRows(fields||{});
  if(!rows.length)return{projection:{status:'unknown',points:[]},
    warnings:['finding-ref-invalid']};
  const sid=transaction.sessionIdFromState(stateCapability);
  const seen=new Set(),byPoint=new Map();
  try{
    for(const locator of rows){
      if(!exactKeys(locator,['point','round','finding_ref_path','finding_ref_sha256',
        'finding_ref_artifact_sha256','producer_operation_id'])||
        !findingRuntime.isReviewPoint(locator.point)||
        !Number.isSafeInteger(locator.round)||locator.round<1||
        !DIGEST.test(locator.finding_ref_sha256||'')||
        !DIGEST.test(locator.finding_ref_artifact_sha256||'')||
        !OPERATION.test(locator.producer_operation_id||''))
        fail('finding-ref-index');
      const key=canonical([locator.point,locator.round]);
      if(seen.has(key))fail('finding-ref-index');
      seen.add(key);
      const expectedRelative=`.deep-work/${sid}/reviews/refs/${locator.point}-round-${locator.round}-${locator.finding_ref_sha256}.json`;
      if(locator.finding_ref_path!==expectedRelative)fail('finding-ref-path');
      const wrappedPath=portable(stateCapability.projectRoot,
        path.join(stateCapability.projectRoot,...expectedRelative.split('/')),
        'finding-ref-path');
      const wrapperBytes=fs.readFileSync(wrappedPath.absolute);
      if(journal.sha256(wrapperBytes)!==locator.finding_ref_artifact_sha256)
        fail('finding-ref-wrapper');
      let wrapper;try{wrapper=JSON.parse(wrapperBytes);}catch{fail('finding-ref-wrapper');}
      if(!wrapperBytes.equals(Buffer.from(canonical(wrapper)))||
          !exactKeys(wrapper,['schema_version','finding_ref','finding_ref_sha256'])||
          wrapper.schema_version!==1||
          wrapper.finding_ref_sha256!==locator.finding_ref_sha256)
        fail('finding-ref-wrapper');
      const ref=validateFindingRefV1(wrapper.finding_ref);
      if(ref.finding_ref_sha256!==locator.finding_ref_sha256||
          ref.producer_operation_id!==locator.producer_operation_id||
          ref.point!==locator.point||ref.round!==locator.round)
        fail('finding-ref-identity');
      const documentPath=portable(stateCapability.projectRoot,
        path.join(stateCapability.projectRoot,...ref.path.split('/')),
        'finding-ref-document');
      if(!platform.isPathInside(path.join(workDir,'reviews'),documentPath.absolute))
        fail('finding-ref-document');
      const document=validateFindingDocument(documentPath.absolute,ref.point,ref.round);
      if(document.sha256!==ref.sha256)fail('finding-ref-document');
      const receipt=completedReceipt(stateCapability.projectRoot,sid,
        ref.producer_operation_id);
      const terminal=receipt.result;
      if(receipt.stage!=='completed-ledger'||terminal?.point!==ref.point||
          terminal?.round!==ref.round||terminal?.path!==ref.path||
          terminal?.sha256!==ref.sha256||
          terminal?.finding_ref_path!==expectedRelative||
          terminal?.finding_ref_sha256!==ref.finding_ref_sha256||
          terminal?.finding_ref_artifact_sha256!==locator.finding_ref_artifact_sha256||
          terminal?.artifact_sha256!==ref.artifact_sha256||
          terminal?.spec_approved_hash!==ref.spec_approved_hash||
          terminal?.plan_authority_sha256!==ref.plan_authority_sha256||
          terminal?.replan_epoch!==ref.replan_epoch)
        fail('finding-ref-ledger');
      if(ref.point==='spec'){
        let contract;try{contract=typeof fields.spec_contract_json==='string'?
          JSON.parse(fields.spec_contract_json):fields.spec_contract_json;}
        catch{fail('finding-ref-current-authority');}
        if(require('./contract-runtime.js').specContractDigest(contract)!==ref.spec_sha256||
            fields.spec_approved_hash!==ref.spec_approved_hash)
          fail('finding-ref-current-authority');
      }else if(!['research'].includes(ref.point)){
        if(!plan||ref.plan_authority_sha256!==plan.plan_authority_sha256||
            ref.risk_profile_sha256!==plan.contract_binding?.risk_profile_sha256||
            ref.replan_epoch!==(DIGEST.test(plan.replan_epoch||'')?plan.replan_epoch:null))
          fail('finding-ref-current-authority');
      }
      if(!byPoint.has(ref.point))byPoint.set(ref.point,[]);
      byPoint.get(ref.point).push({ref,document:document.value});
    }
    const points=[];
    for(const [point,rounds] of byPoint){
      rounds.sort((a,b)=>a.ref.round-b.ref.round);
      if(rounds.some((row,index)=>row.ref.round!==index+1))
        fail('finding-ref-round');
      for(let index=1;index<rounds.length;index++){
        const prior=new Set(rounds[index-1].document.findings.map((row)=>row.id));
        if(rounds[index].document.findings.some((row)=>!prior.has(row.id)))
          fail('finding-ref-round');
      }
      const latest=rounds.at(-1),open=[],resolved=[],unknown=[];
      for(const finding of latest.document.findings){
        if(['open','accepted','deferred'].includes(finding.status))open.push(finding.id);
        else if(['fixed','rejected'].includes(finding.status))resolved.push(finding.id);
        else unknown.push(finding.id);
      }
      points.push({point,round:latest.ref.round,open_ids:[...new Set(open)].sort(),
        resolved_ids:[...new Set(resolved)].sort(),
        unknown_ids:[...new Set(unknown)].sort()});
    }
    points.sort((a,b)=>Buffer.compare(Buffer.from(canonical([a.point,a.round])),
      Buffer.from(canonical([b.point,b.round]))));
    const unknown=points.some((row)=>row.unknown_ids.length);
    return{projection:{status:unknown?'unknown':
      points.some((row)=>row.open_ids.length)?'open':'complete',points},warnings:[]};
  }catch{
    return{projection:{status:'unknown',points:[]},warnings:['finding-ref-invalid']};
  }
}

module.exports={publishFindingRef,validateFindingRefV1,validateFindingDocument,
  loadFindingProjection,digest};
