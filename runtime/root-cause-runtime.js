'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const journal=require('./operation-journal.js');
const frontmatter=require('./frontmatter.js');
const platform=require('./platform.js');
const transaction=require('./transaction-runtime.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);
  error.code=code;throw error;}
function canonical(value){return journal.canonicalJson(value);}
function exactKeys(value,keys){return value&&typeof value==='object'&&
  !Array.isArray(value)&&canonical(Object.keys(value).sort())===
    canonical([...keys].sort());}
function byteCompare(left,right){return Buffer.compare(Buffer.from(left),
  Buffer.from(right));}
function sortedUnique(values,validator){
  return Array.isArray(values)&&values.every(validator)&&
    new Set(values).size===values.length&&canonical(values)===
      canonical([...values].sort(byteCompare));
}
function semanticDigest(domain,value,omitted){
  const copy=structuredClone(value);if(omitted)delete copy[omitted];
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(`${domain}\0`),Buffer.from(canonical(copy))])).digest('hex');
}
function digestExcluding(value,key){
  const copy=structuredClone(value);delete copy[key];
  return journal.sha256(canonical(copy));
}

function validateRootCauseObservation(value){
  if(!exactKeys(value,['schema_version','source_kind','source_operation_id',
      'slice_id','failure_class','normalized_signal_sha256',
      'contract_trace_sha256','root_cause_sha256'])||
      value.schema_version!==1||
      !['verification-result','debug-root'].includes(value.source_kind)||
      !OPERATION.test(value.source_operation_id||'')||
      !/^SLICE-\d{3}$/.test(value.slice_id||'')||
      typeof value.failure_class!=='string'||!value.failure_class||
      ![value.normalized_signal_sha256,value.contract_trace_sha256,
        value.root_cause_sha256].every((row)=>DIGEST.test(row||'')))
    fail('root-cause-observation');
  return structuredClone(value);
}
function entryObservationId(value){
  const copy=structuredClone(value);delete copy.observation_id;
  delete copy.record_sequence;
  return semanticDigest('root-cause-observation-v1',copy);
}
function validateEntry(value){
  if(!exactKeys(value,['observation_id','record_sequence','slice_id',
      'source_kind','source_operation_id','source_result_sha256',
      'root_cause_sha256','normalized_signal_sha256',
      'contract_trace_sha256'])||!DIGEST.test(value.observation_id||'')||
      !Number.isSafeInteger(value.record_sequence)||value.record_sequence<1||
      !/^SLICE-\d{3}$/.test(value.slice_id||'')||
      !['verification-result','debug-root'].includes(value.source_kind)||
      !OPERATION.test(value.source_operation_id||'')||
      ![value.source_result_sha256,value.root_cause_sha256,
        value.normalized_signal_sha256,value.contract_trace_sha256]
        .every((row)=>DIGEST.test(row||''))||
      entryObservationId(value)!==value.observation_id)
    fail('root-cause-entry');
  return structuredClone(value);
}
function validateDerivation(value){
  if(!exactKeys(value,['slice_id','operation_id','qualification_path',
      'qualification_ledger_sha256','qualifying_observation_ids',
      'observation_path','observation_sha256','status'])||
      !/^SLICE-\d{3}$/.test(value.slice_id||'')||
      !OPERATION.test(value.operation_id||'')||
      typeof value.qualification_path!=='string'||
      !value.qualification_path.endsWith(
        `qualification-${value.qualification_ledger_sha256}.json`)||
      !DIGEST.test(value.qualification_ledger_sha256||'')||
      !sortedUnique(value.qualifying_observation_ids,
        (row)=>DIGEST.test(row))||
      value.qualifying_observation_ids.length!==2||
      !['pending','completed'].includes(value.status)||
      (value.status==='pending'?
        value.observation_path!==null||value.observation_sha256!==null:
        typeof value.observation_path!=='string'||!value.observation_path||
          !DIGEST.test(value.observation_sha256||'')))
    fail('root-cause-derivation');
  return structuredClone(value);
}
function ledgerDigest(value){return digestExcluding(value,'ledger_sha256');}
function validateRootCauseLedger(value){
  if(!exactKeys(value,['schema_version','session_id','plan_authority_sha256',
      'replan_epoch','next_record_sequence','entries','repeated_derivations',
      'ledger_sha256'])||value.schema_version!==1||
      !/^s-[0-9a-f]{8}$/.test(value.session_id||'')||
      !DIGEST.test(value.plan_authority_sha256||'')||
      !DIGEST.test(value.replan_epoch||'')||
      !Number.isSafeInteger(value.next_record_sequence)||
      value.next_record_sequence<1||!Array.isArray(value.entries)||
      canonical(value.entries)!==canonical([...value.entries].sort((a,b)=>
        byteCompare(a.observation_id,b.observation_id)))||
      !Array.isArray(value.repeated_derivations)||
      canonical(value.repeated_derivations)!==canonical(
        [...value.repeated_derivations].sort((a,b)=>
          byteCompare(a.slice_id,b.slice_id)))||
      !DIGEST.test(value.ledger_sha256||''))
    fail('root-cause-ledger');
  const entries=value.entries.map(validateEntry),derivations=
    value.repeated_derivations.map(validateDerivation);
  if(new Set(entries.map((row)=>row.observation_id)).size!==entries.length||
      new Set(entries.map((row)=>row.record_sequence)).size!==entries.length||
      new Set(derivations.map((row)=>row.slice_id)).size!==derivations.length||
      entries.some((row)=>row.record_sequence>=value.next_record_sequence)||
      ledgerDigest(value)!==value.ledger_sha256)
    fail('root-cause-ledger');
  return structuredClone(value);
}
function emptyRootCauseLedger({sessionId,planAuthoritySha256,replanEpoch}={}){
  const value={schema_version:1,session_id:sessionId,
    plan_authority_sha256:planAuthoritySha256,replan_epoch:replanEpoch,
    next_record_sequence:1,entries:[],repeated_derivations:[],
    ledger_sha256:null};
  value.ledger_sha256=ledgerDigest(value);
  return validateRootCauseLedger(value);
}
function qualificationDigest(value){
  return semanticDigest('root-cause-qualification-v1',value,
    'qualification_ledger_sha256');
}
function validateQualification(value){
  if(!exactKeys(value,['schema_version','session_id',
      'plan_authority_sha256','replan_epoch','next_record_sequence',
      'slice_id','qualifying_observation_ids','entries',
      'repeated_derivations','qualification_ledger_sha256'])||
      value.schema_version!==1||!/^s-[0-9a-f]{8}$/.test(value.session_id||'')||
      !DIGEST.test(value.plan_authority_sha256||'')||
      !DIGEST.test(value.replan_epoch||'')||
      !Number.isSafeInteger(value.next_record_sequence)||
      value.next_record_sequence<2||!/^SLICE-\d{3}$/.test(value.slice_id||'')||
      !sortedUnique(value.qualifying_observation_ids,(row)=>DIGEST.test(row))||
      value.qualifying_observation_ids.length!==2||
      !Array.isArray(value.entries)||canonical(value.entries)!==
        canonical([...value.entries].sort((a,b)=>
          byteCompare(a.observation_id,b.observation_id)))||
      !Array.isArray(value.repeated_derivations)||canonical(
        value.repeated_derivations)!==canonical(
        [...value.repeated_derivations].sort((a,b)=>
          byteCompare(a.slice_id,b.slice_id)))||
      !DIGEST.test(value.qualification_ledger_sha256||'')||
      qualificationDigest(value)!==value.qualification_ledger_sha256)
    fail('root-cause-qualification');
  const entries=value.entries.map(validateEntry);
  value.repeated_derivations.map(validateDerivation);
  if(new Set(entries.map((row)=>row.observation_id)).size!==entries.length||
      Math.max(...entries.map((row)=>row.record_sequence))!==
        value.next_record_sequence-1)
    fail('root-cause-qualification');
  const pair=selectPair(entries,value.slice_id);
  if(!pair||canonical(pair.map((row)=>row.observation_id).sort(byteCompare))!==
      canonical(value.qualifying_observation_ids))
    fail('root-cause-qualification');
  return structuredClone(value);
}
function repeatedOperationId(value){
  return `op-${semanticDigest('repeated-root-cause-derive-v1',value)}`;
}
function selectPair(entries,sliceId){
  const rows=entries.filter((row)=>row.slice_id===sliceId)
    .sort((a,b)=>a.record_sequence-b.record_sequence);
  if(rows.length<2)return null;
  const first=rows[0],second=rows.find((row)=>
    row.record_sequence>first.record_sequence&&
    row.root_cause_sha256!==first.root_cause_sha256);
  return second?[first,second]:null;
}
function retainEntries(entries,derivations){
  const retained=new Set([...entries].sort((a,b)=>
    b.record_sequence-a.record_sequence).slice(0,32)
    .map((row)=>row.observation_id));
  for(const row of derivations.filter((item)=>item.status==='pending'))
    for(const id of row.qualifying_observation_ids)retained.add(id);
  return entries.filter((row)=>retained.has(row.observation_id))
    .sort((a,b)=>byteCompare(a.observation_id,b.observation_id));
}
function insertRootCause({ledger,observation,sourceResultSha256}={}){
  const current=validateRootCauseLedger(ledger),source=
    validateRootCauseObservation(observation);
  if(!DIGEST.test(sourceResultSha256||''))fail('root-cause-source');
  const duplicate=current.entries.find((row)=>
    row.source_kind===source.source_kind&&
    row.source_operation_id===source.source_operation_id&&
    row.source_result_sha256===sourceResultSha256&&
    row.root_cause_sha256===source.root_cause_sha256);
  if(duplicate)return{ledger:current,entry:duplicate,qualification:null,
    pending_derivation:null,adopted:true};
  const entry={observation_id:null,
    record_sequence:current.next_record_sequence,slice_id:source.slice_id,
    source_kind:source.source_kind,
    source_operation_id:source.source_operation_id,
    source_result_sha256:sourceResultSha256,
    root_cause_sha256:source.root_cause_sha256,
    normalized_signal_sha256:source.normalized_signal_sha256,
    contract_trace_sha256:source.contract_trace_sha256};
  entry.observation_id=entryObservationId(entry);validateEntry(entry);
  const entries=[...current.entries,entry].sort((a,b)=>
    byteCompare(a.observation_id,b.observation_id));
  const derivations=structuredClone(current.repeated_derivations);
  let qualification=null,pending=null;
  if(!derivations.some((row)=>row.slice_id===entry.slice_id)){
    const pair=selectPair(entries,entry.slice_id);
    if(pair){
      const ids=pair.map((row)=>row.observation_id).sort(byteCompare);
      qualification={schema_version:1,session_id:current.session_id,
        plan_authority_sha256:current.plan_authority_sha256,
        replan_epoch:current.replan_epoch,
        next_record_sequence:current.next_record_sequence+1,
        slice_id:entry.slice_id,qualifying_observation_ids:ids,
        entries:structuredClone(entries),
        repeated_derivations:structuredClone(derivations),
        qualification_ledger_sha256:null};
      qualification.qualification_ledger_sha256=
        qualificationDigest(qualification);
      validateQualification(qualification);
      const preimage={session_id:current.session_id,
        plan_authority_sha256:current.plan_authority_sha256,
        replan_epoch:current.replan_epoch,
        qualification_ledger_sha256:
          qualification.qualification_ledger_sha256,
        slice_id:entry.slice_id,qualifying_observation_ids:ids};
      pending={slice_id:entry.slice_id,
        operation_id:repeatedOperationId(preimage),
        qualification_path:`.deep-work/${current.session_id}/root-causes/`+
          `qualification-${qualification.qualification_ledger_sha256}.json`,
        qualification_ledger_sha256:
          qualification.qualification_ledger_sha256,
        qualifying_observation_ids:ids,observation_path:null,
        observation_sha256:null,status:'pending'};
      validateDerivation(pending);derivations.push(pending);
      derivations.sort((a,b)=>byteCompare(a.slice_id,b.slice_id));
    }
  }
  const updated={...structuredClone(current),
    next_record_sequence:current.next_record_sequence+1,
    entries:retainEntries(entries,derivations),
    repeated_derivations:derivations,ledger_sha256:null};
  updated.ledger_sha256=ledgerDigest(updated);
  return{ledger:validateRootCauseLedger(updated),entry,
    qualification,pending_derivation:pending,adopted:false};
}
function validateRepeatedRootCauseObservation(value){
  if(!exactKeys(value,['schema_version','qualification_path',
      'qualification_ledger_sha256','slice_id',
      'qualifying_observation_ids','qualifying_root_cause_sha256s'])||
      value.schema_version!==1||typeof value.qualification_path!=='string'||
      !value.qualification_path.endsWith(
        `qualification-${value.qualification_ledger_sha256}.json`)||
      !DIGEST.test(value.qualification_ledger_sha256||'')||
      !/^SLICE-\d{3}$/.test(value.slice_id||'')||
      !sortedUnique(value.qualifying_observation_ids,
        (row)=>DIGEST.test(row))||
      !sortedUnique(value.qualifying_root_cause_sha256s,
        (row)=>DIGEST.test(row))||
      value.qualifying_observation_ids.length!==2||
      value.qualifying_root_cause_sha256s.length!==2)
    fail('repeated-root-cause-observation');
  return structuredClone(value);
}
function writeExclusive(file,value,code){
  const bytes=Buffer.from(canonical(value));fs.mkdirSync(path.dirname(file),
    {recursive:true});let fd;
  try{fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|
    fs.constants.O_WRONLY,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
  catch(error){if(error.code!=='EEXIST'||!fs.readFileSync(file).equals(bytes))
    fail(code);}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  if(!fs.readFileSync(file).equals(bytes))fail(code);
  return journal.sha256(bytes);
}
function parseStoredLedger(fields,{sessionId,planAuthoritySha256,replanEpoch}){
  if(fields.root_cause_ledger_json===undefined||
      fields.root_cause_ledger_json===null||
      fields.root_cause_ledger_json==='')
    return emptyRootCauseLedger({sessionId,planAuthoritySha256,replanEpoch});
  let value;try{value=JSON.parse(fields.root_cause_ledger_json);}
  catch{fail('root-cause-ledger-state');}
  const ledger=validateRootCauseLedger(value);
  if(ledger.session_id!==sessionId||
      ledger.plan_authority_sha256!==planAuthoritySha256||
      ledger.replan_epoch!==replanEpoch||
      fields.root_cause_ledger_sha256!==ledger.ledger_sha256)
    fail('root-cause-ledger-state');
  return ledger;
}
async function authenticateDebugRoot({stateCapability,plan,sourceOperationId}){
  const sessionId=transaction.sessionIdFromState(stateCapability),
    project=transaction.projectCapabilityFor(stateCapability),
    receipt=await journal.resumeOperation({projectCapability:project,
      operationId:sourceOperationId,sessionId,kind:'debug-complete'});
  const result=receipt.result;
  if(receipt.stage!=='completed-ledger'||!exactKeys(result,
      ['status','sliceId','notePath','noteSha256','receiptSha256',
        'stateSha256'])||result.status!=='completed'||
      !/^SLICE-\d{3}$/.test(result.sliceId||'')||
      !DIGEST.test(result.noteSha256||'')||
      ![result.receiptSha256,result.stateSha256].every((row)=>DIGEST.test(row)))
    fail('root-cause-debug-source');
  const workDir=path.join(stateCapability.projectRoot,'.deep-work',sessionId),
    expectedParent=path.join(workDir,'debug-log'),physical=fs.realpathSync(
      result.notePath);
  if(path.dirname(physical)!==expectedParent||
      !/^RC-\d{3}\.md$/.test(path.basename(physical)))fail('root-cause-debug-source');
  const stat=fs.lstatSync(physical),bytes=fs.readFileSync(physical);
  if(!stat.isFile()||stat.isSymbolicLink()||
      journal.sha256(bytes)!==result.noteSha256)fail('root-cause-debug-source');
  const contractTraceSha256=semanticDigest('root-cause-contract-trace-v1',{
    plan_authority_sha256:plan.plan_authority_sha256,
    replan_epoch:plan.replan_epoch,slice_id:result.sliceId});
  return{observation:validateRootCauseObservation({schema_version:1,
    source_kind:'debug-root',source_operation_id:sourceOperationId,
    slice_id:result.sliceId,failure_class:'debug-root',
    normalized_signal_sha256:semanticDigest('debug-root-signal-v1',{
      note_sha256:result.noteSha256}),
    contract_trace_sha256:contractTraceSha256,
    root_cause_sha256:result.noteSha256}),
  sourceResultSha256:receipt.resultSha256,sourceReceipt:receipt};
}
async function authenticateVerificationRoot({stateCapability,planCapability,
  plan,sourceOperationId}){
  if(!planCapability)fail('root-cause-verification-source');
  const sessionId=transaction.sessionIdFromState(stateCapability),
    project=transaction.projectCapabilityFor(stateCapability),
    receipt=await journal.resumeOperation({projectCapability:project,
      operationId:sourceOperationId,sessionId,kind:'verification-run-v2'}),
    result=receipt.result;
  if(receipt.stage!=='completed-ledger'||!exactKeys(result,
      ['session_id','slice_id','result_path','result_sha256','disposition',
        'observed_class','scope_disposition'])||result.session_id!==sessionId||
      !/^SLICE-\d{3}$/.test(result.slice_id||'')||
      !DIGEST.test(result.result_sha256||''))
    fail('root-cause-verification-source');
  const authenticated=await require('./verification-v2-runtime.js')
    .authenticateVerificationV2({stateCapability,planCapability,plan,
      sliceId:result.slice_id,operationId:sourceOperationId,
      resultSha256:result.result_sha256}),verification=
      authenticated.verification,classification=verification.classification;
  if(classification.normalized_signal===null||
      !DIGEST.test(classification.diagnostic_event_sha256||''))
    fail('root-cause-verification-source');
  const normalizedSignalSha256=journal.sha256(
    canonical(classification.normalized_signal)),
    contractTraceSha256=semanticDigest('root-cause-contract-trace-v1',{
      plan_authority_sha256:plan.plan_authority_sha256,
      replan_epoch:plan.replan_epoch,slice_id:result.slice_id,
      verification_plan_sha256:verification.verification_plan_sha256,
      spec_sha256:verification.spec_sha256});
  return{observation:validateRootCauseObservation({schema_version:1,
    source_kind:'verification-result',
    source_operation_id:sourceOperationId,slice_id:result.slice_id,
    failure_class:classification.observed_class,
    normalized_signal_sha256:normalizedSignalSha256,
    contract_trace_sha256:contractTraceSha256,
    root_cause_sha256:classification.diagnostic_event_sha256}),
  sourceResultSha256:result.result_sha256,sourceReceipt:receipt};
}
async function authenticateRootCauseSource({stateCapability,planCapability,
  plan,sourceKind,sourceOperationId}={}){
  if(sourceKind==='debug-root')return authenticateDebugRoot({stateCapability,
    plan,sourceOperationId});
  if(sourceKind==='verification-result')return authenticateVerificationRoot({
    stateCapability,planCapability,plan,sourceOperationId});
  fail('root-cause-source-kind');
}
async function recordRootCause({stateCapability,planCapability,plan,sourceKind,
  sourceOperationId,seam,_locksHeld=false}={}){
  const sessionId=transaction.sessionIdFromState(stateCapability);
  if(!_locksHeld){
    const root=stateCapability.projectRoot,lock=(name,role)=>
      platform.issueProjectStateCapability(root,path.join(root,'.claude',name),
        {allowMissingLeaf:true,role});
    return transaction.withRankedLocks([
      {rank:transaction.RANKS.session,capability:lock(
        `deep-work.${sessionId}.rank-operation.lock`,'lock')},
      {rank:transaction.RANKS.journal,capability:lock(
        `deep-work.${sessionId}.rank-journal.lock`,'lock')},
      {rank:transaction.RANKS.state,
        capability:transaction.stateLock(stateCapability)},
      {rank:transaction.RANKS.target,capability:lock(
        `deep-work.target.${journal.sha256('root-causes')}.lock`,'lock')}],
    ()=>recordRootCause({stateCapability,planCapability,plan,sourceKind,
      sourceOperationId,seam,_locksHeld:true}));
  }
  if(!DIGEST.test(plan?.plan_authority_sha256||'')||
      !DIGEST.test(plan?.replan_epoch||''))fail('root-cause-plan');
  const source=await authenticateRootCauseSource({stateCapability,
    planCapability,plan,sourceKind,sourceOperationId}),
    fields=frontmatter.parseFrontmatter(
      fs.readFileSync(stateCapability.path,'utf8')).fields,
    ledger=parseStoredLedger(fields,{sessionId,
      planAuthoritySha256:plan.plan_authority_sha256,
      replanEpoch:plan.replan_epoch}),
    inserted=insertRootCause({ledger,observation:source.observation,
      sourceResultSha256:source.sourceResultSha256});
  const preconditions={session_id:sessionId,
    plan_authority_sha256:plan.plan_authority_sha256,
    replan_epoch:plan.replan_epoch,source_kind:sourceKind,
    source_operation_id:sourceOperationId,
    source_result_sha256:source.sourceResultSha256,
    root_cause_sha256:source.observation.root_cause_sha256};
  const operationId=`op-${semanticDigest('root-cause-record-v1',
    preconditions)}`,project=transaction.projectCapabilityFor(stateCapability);
  const existing=await journal.resumeOperation({projectCapability:project,
    operationId,sessionId,kind:'root-cause-record'}).catch((error)=>{
      if(error.code==='operation-not-found')return null;throw error;});
  if(existing?.stage==='completed-ledger'){
    const current=parseStoredLedger(frontmatter.parseFrontmatter(
      fs.readFileSync(stateCapability.path,'utf8')).fields,{sessionId,
      planAuthoritySha256:plan.plan_authority_sha256,
      replanEpoch:plan.replan_epoch});
    if(!current.entries.some((row)=>row.observation_id===
        existing.result.observation_id&&row.source_operation_id===
        sourceOperationId))fail('root-cause-record-replay');
    return{...existing.result,operation_id:operationId,
      operation_receipt:existing,adopted:true};
  }
  const operation=await journal.beginOperation({projectCapability:project,
    sessionId,kind:'root-cause-record',operationId,
    slice:source.observation.slice_id,preconditions});
  await journal.recordOperationStage(operation,'source-authenticated',{owned:{
    sourceLedgerResultSha256:source.sourceReceipt.resultSha256,
    sourceResultSha256:source.sourceResultSha256}});
  const base=`.deep-work/${sessionId}/root-causes`,
    observationPath=`${base}/${inserted.entry.observation_id}.json`;
  writeExclusive(path.join(stateCapability.projectRoot,
    ...observationPath.split('/')),source.observation,
  'root-cause-observation-publish');
  if(inserted.qualification)writeExclusive(path.join(
    stateCapability.projectRoot,
    ...inserted.pending_derivation.qualification_path.split('/')),
  inserted.qualification,'root-cause-qualification-publish');
  await journal.recordOperationStage(operation,'observation-published',{owned:{
    observationPath,observationId:inserted.entry.observation_id,
    qualificationLedgerSha256:
      inserted.qualification?.qualification_ledger_sha256||null}});
  const ledgerPath=`${base}/ledger-${inserted.ledger.ledger_sha256}.json`;
  writeExclusive(path.join(stateCapability.projectRoot,
    ...ledgerPath.split('/')),inserted.ledger,'root-cause-ledger-publish');
  const before=fs.readFileSync(stateCapability.path,'utf8'),after=
    frontmatter.updateFrontmatterText(before,{root_cause_ledger_json:
      canonical(inserted.ledger).trimEnd(),
      root_cause_ledger_sha256:inserted.ledger.ledger_sha256,
      root_cause_ledger_ref:ledgerPath});
  seam?.('before-root-cause-ledger-state-write',{operationId});
  platform.atomicWriteFile(stateCapability,after);
  await journal.recordOperationStage(operation,'ledger-committed',{owned:{
    ledgerPath,ledgerSha256:inserted.ledger.ledger_sha256,
    postStateSha256:journal.sha256(Buffer.from(after))}});
  const result={observation_id:inserted.entry.observation_id,
    record_sequence:inserted.entry.record_sequence,
    ledger_sha256:inserted.ledger.ledger_sha256,
    pending_repeated_operation_id:
      inserted.pending_derivation?.operation_id||null};
  const receipt=await journal.completeOperation(operation,result);
  return{...result,operation_id:operationId,operation_receipt:receipt,
    adopted:false};
}
function readCanonical(file,code){
  let stat,bytes;try{stat=fs.lstatSync(file);bytes=fs.readFileSync(file);}
  catch{fail(code);}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)
    fail(code);
  let value;try{value=JSON.parse(bytes);}catch{fail(code);}
  if(!bytes.equals(Buffer.from(canonical(value))))fail(code);
  return{value,sha256:journal.sha256(bytes)};
}
function recordOperationId(ledger,entry){
  return `op-${semanticDigest('root-cause-record-v1',{
    session_id:ledger.session_id,
    plan_authority_sha256:ledger.plan_authority_sha256,
    replan_epoch:ledger.replan_epoch,source_kind:entry.source_kind,
    source_operation_id:entry.source_operation_id,
    source_result_sha256:entry.source_result_sha256,
    root_cause_sha256:entry.root_cause_sha256})}`;
}
async function authenticateRepeatedDerivation({stateCapability,plan,
  operationId}={}){
  const sessionId=transaction.sessionIdFromState(stateCapability),
    project=transaction.projectCapabilityFor(stateCapability),
    receipt=await journal.resumeOperation({projectCapability:project,
      operationId,sessionId,kind:'repeated-root-cause-derive'}),result=
      receipt.result;
  if(receipt.stage!=='completed-ledger'||!exactKeys(result,
      ['operation_id','qualification_path','qualification_ledger_sha256',
        'completed_ledger_sha256','observation_path','observation_sha256'])||
      result.operation_id!==operationId||
      !DIGEST.test(result.qualification_ledger_sha256||'')||
      !DIGEST.test(result.completed_ledger_sha256||'')||
      !DIGEST.test(result.observation_sha256||''))
    fail('repeated-root-cause-producer');
  const observationRaw=readCanonical(path.join(stateCapability.projectRoot,
    ...result.observation_path.split('/')),'repeated-root-cause-producer'),
    observation=validateRepeatedRootCauseObservation(observationRaw.value);
  if(observationRaw.sha256!==result.observation_sha256||
      observation.qualification_path!==result.qualification_path||
      observation.qualification_ledger_sha256!==
        result.qualification_ledger_sha256)
    fail('repeated-root-cause-producer');
  const fields=frontmatter.parseFrontmatter(
    fs.readFileSync(stateCapability.path,'utf8')).fields,
    ledger=parseStoredLedger(fields,{sessionId,
      planAuthoritySha256:plan.plan_authority_sha256,
      replanEpoch:plan.replan_epoch}),
    row=ledger.repeated_derivations.find((item)=>
      item.operation_id===operationId);
  if(!row||row.status!=='completed'||
      row.observation_path!==result.observation_path||
      row.observation_sha256!==result.observation_sha256)
    fail('repeated-root-cause-producer');
  return{observation,receipt,ledger,row};
}
async function deriveRepeatedRootCause({stateCapability,plan,operationId,
  seam,_locksHeld=false}={}){
  const sessionId=transaction.sessionIdFromState(stateCapability);
  if(!_locksHeld){
    const root=stateCapability.projectRoot,lock=(name)=>
      platform.issueProjectStateCapability(root,path.join(root,'.claude',name),
        {allowMissingLeaf:true,role:'lock'});
    return transaction.withRankedLocks([
      {rank:transaction.RANKS.session,capability:lock(
        `deep-work.${sessionId}.rank-operation.lock`)},
      {rank:transaction.RANKS.journal,capability:lock(
        `deep-work.${sessionId}.rank-journal.lock`)},
      {rank:transaction.RANKS.state,
        capability:transaction.stateLock(stateCapability)},
      {rank:transaction.RANKS.target,capability:lock(
        `deep-work.target.${journal.sha256('root-causes')}.lock`)}],
    ()=>deriveRepeatedRootCause({stateCapability,plan,operationId,seam,
      _locksHeld:true}));
  }
  if(!OPERATION.test(operationId||'')||
      !DIGEST.test(plan?.plan_authority_sha256||'')||
      !DIGEST.test(plan?.replan_epoch||''))fail('repeated-root-cause-derive');
  const fields=frontmatter.parseFrontmatter(
    fs.readFileSync(stateCapability.path,'utf8')).fields,
    ledger=parseStoredLedger(fields,{sessionId,
      planAuthoritySha256:plan.plan_authority_sha256,
      replanEpoch:plan.replan_epoch}),
    row=ledger.repeated_derivations.find((item)=>
      item.operation_id===operationId);
  if(row?.status==='completed'){
    const authenticated=await authenticateRepeatedDerivation({
      stateCapability,plan,operationId});
    return{...authenticated.receipt.result,operation_receipt:
      authenticated.receipt,adopted:true};
  }
  const pending=ledger.repeated_derivations.filter((item)=>
    item.status==='pending').sort((a,b)=>byteCompare(a.slice_id,b.slice_id));
  if(!row||row.status!=='pending'||pending[0]?.operation_id!==operationId)
    fail('repeated-root-cause-order');
  const qualificationRaw=readCanonical(path.join(stateCapability.projectRoot,
    ...row.qualification_path.split('/')),'root-cause-qualification'),
    qualification=validateQualification(qualificationRaw.value);
  if(qualification.qualification_ledger_sha256!==
        row.qualification_ledger_sha256||
      qualification.slice_id!==row.slice_id||
      canonical(qualification.qualifying_observation_ids)!==
        canonical(row.qualifying_observation_ids))
    fail('root-cause-qualification');
  const project=transaction.projectCapabilityFor(stateCapability),entries=
    qualification.qualifying_observation_ids.map((id)=>{
      const entry=qualification.entries.find((item)=>item.observation_id===id);
      if(!entry)fail('repeated-root-cause-producers');return entry;});
  const producerReceipts=[];
  for(const entry of entries){
    const producerId=recordOperationId(ledger,entry),receipt=
      await journal.resumeOperation({projectCapability:project,
        operationId:producerId,sessionId,kind:'root-cause-record'});
    if(receipt.stage!=='completed-ledger'||
        receipt.result?.observation_id!==entry.observation_id||
        receipt.result?.record_sequence!==entry.record_sequence)
      fail('repeated-root-cause-producers');
    producerReceipts.push(receipt);
  }
  const preimage={session_id:sessionId,
    plan_authority_sha256:plan.plan_authority_sha256,
    replan_epoch:plan.replan_epoch,
    qualification_ledger_sha256:row.qualification_ledger_sha256,
    slice_id:row.slice_id,
    qualifying_observation_ids:row.qualifying_observation_ids};
  if(repeatedOperationId(preimage)!==operationId)
    fail('repeated-root-cause-derive');
  const operation=await journal.beginOperation({projectCapability:project,
    sessionId,kind:'repeated-root-cause-derive',operationId,
    slice:row.slice_id,preconditions:preimage});
  await journal.recordOperationStage(operation,'qualification-authenticated',
    {owned:{qualificationLedgerSha256:row.qualification_ledger_sha256}});
  await journal.recordOperationStage(operation,'producers-authenticated',
    {owned:{producerLedgerResultSha256s:producerReceipts.map((item)=>
      item.resultSha256).sort(byteCompare)}});
  const observation=validateRepeatedRootCauseObservation({schema_version:1,
    qualification_path:row.qualification_path,
    qualification_ledger_sha256:row.qualification_ledger_sha256,
    slice_id:row.slice_id,
    qualifying_observation_ids:[...row.qualifying_observation_ids],
    qualifying_root_cause_sha256s:entries.map((entry)=>
      entry.root_cause_sha256).sort(byteCompare)});
  const observationPath=`.deep-work/${sessionId}/root-causes/`+
    `repeated-${operationId}.json`,observationSha256=writeExclusive(
      path.join(stateCapability.projectRoot,...observationPath.split('/')),
      observation,'repeated-root-cause-publish');
  await journal.recordOperationStage(operation,'observation-published',
    {owned:{observationPath,observationSha256}});
  const updated=structuredClone(ledger),target=
    updated.repeated_derivations.find((item)=>item.operation_id===operationId);
  target.status='completed';target.observation_path=observationPath;
  target.observation_sha256=observationSha256;
  updated.ledger_sha256=ledgerDigest(updated);
  validateRootCauseLedger(updated);
  const ledgerPath=`.deep-work/${sessionId}/root-causes/`+
    `ledger-${updated.ledger_sha256}.json`;
  writeExclusive(path.join(stateCapability.projectRoot,
    ...ledgerPath.split('/')),updated,'root-cause-ledger-publish');
  const before=fs.readFileSync(stateCapability.path,'utf8'),after=
    frontmatter.updateFrontmatterText(before,{root_cause_ledger_json:
      canonical(updated).trimEnd(),root_cause_ledger_sha256:
      updated.ledger_sha256,root_cause_ledger_ref:ledgerPath});
  seam?.('before-repeated-root-ledger-state-write',{operationId});
  platform.atomicWriteFile(stateCapability,after);
  await journal.recordOperationStage(operation,'ledger-committed',{owned:{
    ledgerPath,ledgerSha256:updated.ledger_sha256,
    postStateSha256:journal.sha256(Buffer.from(after))}});
  const result={operation_id:operationId,
    qualification_path:row.qualification_path,
    qualification_ledger_sha256:row.qualification_ledger_sha256,
    completed_ledger_sha256:updated.ledger_sha256,
    observation_path:observationPath,observation_sha256:observationSha256};
  const receipt=await journal.completeOperation(operation,result);
  return{...result,operation_receipt:receipt,adopted:false};
}

module.exports={semanticDigest,validateRootCauseObservation,
  validateRootCauseLedger,emptyRootCauseLedger,insertRootCause,
  validateRepeatedRootCauseObservation,entryObservationId,
  qualificationDigest,validateQualification,repeatedOperationId,
  recordRootCause,authenticateRootCauseSource,deriveRepeatedRootCause,
  authenticateRepeatedDerivation};
