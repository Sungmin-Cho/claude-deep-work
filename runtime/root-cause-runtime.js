'use strict';

const crypto=require('node:crypto');
const journal=require('./operation-journal.js');

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

module.exports={semanticDigest,validateRootCauseObservation,
  validateRootCauseLedger,emptyRootCauseLedger,insertRootCause,
  validateRepeatedRootCauseObservation,entryObservationId,
  qualificationDigest,validateQualification,repeatedOperationId};
