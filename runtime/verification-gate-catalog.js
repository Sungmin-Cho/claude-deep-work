'use strict';

const {canonicalJson}=require('./operation-journal.js');

function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
const ordered=(rows)=>[...new Set(rows)].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));

const rows={
  'GATE-receipt-completeness':['receipt','test',true],
  'GATE-plan-alignment':['contract','test',true],
  'GATE-spec-contract':['contract','spec-and-test',true],
  'GATE-requirement-coverage':['contract','spec-and-test',true],
  'GATE-tdd-red':['command','test',true],
  'GATE-tdd-green':['command','test',true],
  'GATE-targeted-tests':['command','test',true],
  'GATE-negative-tests':['command','test',true],
  'GATE-impacted-lint-typecheck':['sensor','test',true],
  'GATE-relevant-integration':['command','test',true],
  'GATE-full-relevant-suite':['command','test',true],
  'GATE-clean-build':['command','test',true],
  'GATE-backward-compat':['command','test',true],
  'GATE-single-review':['review','test',true],
  'GATE-dual-final-review':['review','test',true],
  'GATE-failure-matrix':['contract','spec-and-test',true],
  'GATE-fresh-install-build':['command','test',true],
  'GATE-e2e-entrypoint':['command','test',true],
  'GATE-fault-injection':['fault','test',true],
  'GATE-timeout-retry-partial':['fault','test',true],
  'GATE-recovery':['recovery','test',true],
  'GATE-mutation-critical-path':['command','test',true],
  'GATE-permission-negative':['command','test',true],
  'GATE-host-smoke':['host-smoke','test',true],
  'GATE-migration-dry-run':['recovery','test',true],
  'GATE-rollback-rehearsal':['recovery','test',true],
  'GATE-destructive-canary':['fault','test',true],
  'GATE-concurrency-stress':['command','test',true],
  'GATE-idempotency-proof':['recovery','test',true],
  'GATE-health-required':['health','test',true],
  'GATE-evidence-completeness':['evidence','test-and-finish',false],
  'GATE-redaction':['evidence','test-and-finish',false],
  'GATE-human-ack':['human','finish-pre-action',false],
  'GATE-post-action-verification':['command','finish-finalize',true],
};

const CATALOG=Object.freeze(Object.fromEntries(Object.entries(rows).map(([id,[adapter,enforcement_point,evidence_required]])=>
  [id,Object.freeze({id,kind:adapter,adapter,enforcement_point,evidence_required})])));
const CATALOG_IDS=Object.freeze(ordered(Object.keys(CATALOG)));
const LEAN=['GATE-receipt-completeness','GATE-plan-alignment','GATE-tdd-red','GATE-tdd-green',
  'GATE-targeted-tests','GATE-impacted-lint-typecheck','GATE-single-review'];
const STANDARD=[...LEAN,'GATE-spec-contract','GATE-requirement-coverage','GATE-negative-tests',
  'GATE-relevant-integration','GATE-full-relevant-suite','GATE-clean-build','GATE-health-required',
  'GATE-evidence-completeness','GATE-redaction'];
const STRICT=[...STANDARD,'GATE-failure-matrix','GATE-fresh-install-build','GATE-e2e-entrypoint',
  'GATE-fault-injection','GATE-timeout-retry-partial','GATE-recovery','GATE-mutation-critical-path',
  'GATE-permission-negative','GATE-dual-final-review'];
const CRITICAL=[...STRICT,'GATE-rollback-rehearsal','GATE-concurrency-stress','GATE-idempotency-proof','GATE-human-ack'];
const REQUIRED_BY_PROFILE=Object.freeze({lean:Object.freeze(ordered(LEAN)),standard:Object.freeze(ordered(STANDARD)),
  strict:Object.freeze(ordered(STRICT)),critical:Object.freeze(ordered(CRITICAL))});
const CONDITIONAL=new Set(['GATE-backward-compat','GATE-host-smoke','GATE-migration-dry-run',
  'GATE-destructive-canary','GATE-post-action-verification']);
const CAPABILITY_KEYS=Object.freeze(['destructive','external_action','has_backward_compat','has_migration','host_dependent']);

function normalizeCapabilityFacts(value={}){if(!value||typeof value!=='object'||Array.isArray(value))fail('verification-capability-facts');
  if(Object.keys(value).some((key)=>!CAPABILITY_KEYS.includes(key)))fail('verification-capability-facts');
  return Object.fromEntries(CAPABILITY_KEYS.map((key)=>[key,value[key]===true]));}

function gateRequirementFor(profile,gateId,capabilities={}){if(!REQUIRED_BY_PROFILE[profile]||!CATALOG[gateId])
  fail('verification-gate');const facts=normalizeCapabilityFacts(capabilities);let required=REQUIRED_BY_PROFILE[profile].includes(gateId);
  if(gateId==='GATE-backward-compat')required=facts.has_backward_compat;
  if(gateId==='GATE-host-smoke')required=profile==='critical'||facts.host_dependent;
  if(gateId==='GATE-migration-dry-run')required=profile==='critical'&&facts.has_migration;
  if(gateId==='GATE-destructive-canary')required=profile==='critical'&&facts.destructive;
  if(gateId==='GATE-post-action-verification')required=profile==='critical'&&facts.external_action;
  return{disposition:required?'required':CONDITIONAL.has(gateId)?'not-applicable':'advisory',
    reason:required?`${profile} policy requires ${gateId}`:`${gateId} is not required by compiled facts`};}

function expectedGateRows({profile,capabilityFacts,requirementIds=[],failureModeIds=[]}={}){
  const requirements=ordered(requirementIds),failures=ordered(failureModeIds);return CATALOG_IDS.map((id)=>{const meta=CATALOG[id];
    const decision=gateRequirementFor(profile,id,capabilityFacts);const tracesFailure=meta.adapter==='fault'||
      meta.adapter==='recovery'||id==='GATE-failure-matrix';return{id,kind:meta.kind,disposition:decision.disposition,
      adapter:meta.adapter,enforcement_point:meta.enforcement_point,evidence_required:meta.evidence_required,
      requirement_ids:requirements,failure_mode_ids:tracesFailure?failures:[],reason:decision.reason};});}

function validateCatalogRows({profile,capabilityFacts,requirementIds,failureModeIds,gates,requiredGateIds,
  evidenceRequiredGateIds}={}){const errors=[];let expected;try{expected=expectedGateRows({profile,capabilityFacts,
    requirementIds,failureModeIds});}catch(error){return{pass:false,errors:[{code:error.code||'verification-plan-catalog'}]};}
  if(canonicalJson(gates)!==canonicalJson(expected))errors.push({code:'verification-plan-disposition'});
  const required=ordered(expected.filter((row)=>row.disposition==='required').map((row)=>row.id));
  const evidenceRequired=ordered(expected.filter((row)=>row.disposition==='required'&&row.evidence_required&&
    !['human','evidence'].includes(row.adapter)).map((row)=>row.id));
  if(canonicalJson(required)!==canonicalJson(requiredGateIds))errors.push({code:'verification-plan-required'});
  if(canonicalJson(evidenceRequired)!==canonicalJson(evidenceRequiredGateIds))
    errors.push({code:'verification-plan-evidence-required'});
  return{pass:errors.length===0,errors,expected,required,evidenceRequired};}

function recordKindForAdapter(adapter){if(['fault','recovery','host-smoke'].includes(adapter))return'adapter';
  if(['command','contract','receipt','review','sensor','health'].includes(adapter))return adapter;return null;}

module.exports={CATALOG,CATALOG_IDS,REQUIRED_BY_PROFILE,CAPABILITY_KEYS,normalizeCapabilityFacts,
  gateRequirementFor,expectedGateRows,validateCatalogRows,recordKindForAdapter,ordered};
