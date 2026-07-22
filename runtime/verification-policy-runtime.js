'use strict';

const crypto=require('node:crypto');
const {canonicalJson}=require('./operation-journal.js');
const {VERIFICATION_POLICY,PROFILE_BY_CLASS}=require('./policy-runtime.js');
const catalog=require('./verification-gate-catalog.js');

function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
const digest=(value)=>crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const isDigest=(value)=>/^[0-9a-f]{64}$/.test(value||'');
function ids(value,key){return catalog.ordered((value?.[key]||[]).map((row)=>typeof row==='string'?row:row.id).filter(Boolean));}
function semverMajorMinor(value){const match=String(value||'').match(/^(\d+)\.(\d+)\./);return match?[Number(match[1]),Number(match[2])]:null;}
function isPre613(value){const parsed=semverMajorMinor(value);return parsed&&(parsed[0]<6||(parsed[0]===6&&parsed[1]<13));}
function isAtLeast613(value){const parsed=semverMajorMinor(value);return parsed&&(parsed[0]>6||(parsed[0]===6&&parsed[1]>=13));}

function compatibilityProof(facts={}){if(!facts||typeof facts!=='object'||Array.isArray(facts))fail('compatibility-mode');
  const binding=facts.planProjection?.contract_binding||facts.plan_binding||null;const strictBinding=binding?.mode==='strict-spec';
  const created=facts.created_by_version||binding?.created_by_version||null;const changed=Number(facts.changed_slice_count||0)>0||
    Number(facts.rerun_slice_count||0)>0;const hasEvidence=facts.has_v613_evidence===true;
  const strictRequired=facts.spec_policy_required===true||isAtLeast613(created)||strictBinding||hasEvidence||
    (facts.risk_class&&['high','critical'].includes(facts.risk_class)&&changed);
  let mode;if(strictRequired){if(!strictBinding)fail('compatibility-strict-binding-required');mode='strict-spec';}
  else if(isPre613(created)&&!changed&&!hasEvidence&&!binding?.spec_contract)mode='legacy-no-spec';
  else fail('compatibility-mode');
  const proof={schema_version:1,mode,created_by_version:created,strict_binding:strictBinding,
    binding_sha256:binding?digest(binding):null,changed_slice_count:Number(facts.changed_slice_count||0),
    rerun_slice_count:Number(facts.rerun_slice_count||0),has_v613_evidence:hasEvidence,
    spec_policy_required:facts.spec_policy_required===true,risk_class:facts.risk_class||null};
  return{mode,proof,proof_sha256:digest(proof)};}
function deriveCompatibilityMode(facts={}){return compatibilityProof(facts).mode;}

function compileVerificationPlan(input={}){const risk=input.riskProfile?.class||input.riskProfile?.risk_class;
  const profile=input.policySnapshot?.profile;if(PROFILE_BY_CLASS[risk]!==profile||input.policySnapshot?.risk_class!==risk||
      input.policySnapshot?.verification_policy?.recommended!==VERIFICATION_POLICY[profile])fail('policy-snapshot-inconsistent');
  for(const value of [input.specSha256,input.specApprovedHash,input.riskProfileSha256])if(!isDigest(value))
    fail('verification-plan-input');const spec=input.specContract||{};
  if(!/^SPEC-[A-Z0-9][A-Z0-9-]{2,63}$/.test(spec.spec_id||''))fail('verification-plan-input');
  const projection=input.planProjection;if(!projection||typeof projection!=='object'||Array.isArray(projection))
    fail('verification-plan-plan-projection');const projectionSha256=digest(projection);
  if(input.planProjectionSha256&&input.planProjectionSha256!==projectionSha256)fail('verification-plan-plan-projection');
  const binding=projection.contract_binding;if(binding?.mode!=='strict-spec'||binding.spec_contract?.spec_id!==spec.spec_id||
      binding.spec_contract?.spec_sha256!==input.specSha256||binding.spec_contract?.spec_approved_hash!==input.specApprovedHash||
      binding.risk_profile_sha256!==input.riskProfileSha256||!isDigest(binding.source_plan_sha256))
    fail('verification-plan-plan-binding');
  const compatibility=compatibilityProof({...input.compatibilityFacts,planProjection:projection,risk_class:risk});
  const capability_facts=catalog.normalizeCapabilityFacts(input.capabilities||{});const req=ids(spec,'requirements');
  const fm=ids(spec,'failure_matrix').length?ids(spec,'failure_matrix'):ids(spec,'failure_modes');
  const gates=catalog.expectedGateRows({profile,capabilityFacts:capability_facts,requirementIds:req,failureModeIds:fm});
  const checked=catalog.validateCatalogRows({profile,capabilityFacts:capability_facts,requirementIds:req,failureModeIds:fm,
    gates,requiredGateIds:gates.filter((row)=>row.disposition==='required').map((row)=>row.id),
    evidenceRequiredGateIds:gates.filter((row)=>row.disposition==='required'&&row.evidence_required&&
      !['human','evidence'].includes(row.adapter)).map((row)=>row.id)});
  const plan={schema_version:1,spec_id:spec.spec_id,spec_sha256:input.specSha256,
    spec_approved_hash:input.specApprovedHash,risk_profile_sha256:input.riskProfileSha256,risk_class:risk,profile,
    source_policy_label:VERIFICATION_POLICY[profile],compatibility_mode:compatibility.mode,
    compatibility_proof_sha256:compatibility.proof_sha256,plan_projection_sha256:projectionSha256,
    source_plan_sha256:binding.source_plan_sha256,capability_facts,gates,
    required_gate_ids:checked.required,evidence_required_gate_ids:checked.evidenceRequired};
  plan.plan_sha256=digest(plan);return plan;}

const PLAN_KEYS=['schema_version','spec_id','spec_sha256','spec_approved_hash','risk_profile_sha256','risk_class','profile',
  'source_policy_label','compatibility_mode','compatibility_proof_sha256','plan_projection_sha256','source_plan_sha256',
  'capability_facts','gates','required_gate_ids','evidence_required_gate_ids','plan_sha256'];
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());}
function validateVerificationPlan(plan){try{if(!exactKeys(plan,PLAN_KEYS)||plan.schema_version!==1||
      !/^SPEC-[A-Z0-9][A-Z0-9-]{2,63}$/.test(plan.spec_id||'')||!['low','medium','high','critical'].includes(plan.risk_class)||
      PROFILE_BY_CLASS[plan.risk_class]!==plan.profile||plan.source_policy_label!==VERIFICATION_POLICY[plan.profile]||
      !['strict-spec','legacy-no-spec'].includes(plan.compatibility_mode)||
      [plan.spec_sha256,plan.spec_approved_hash,plan.risk_profile_sha256,plan.compatibility_proof_sha256,
        plan.plan_projection_sha256,plan.source_plan_sha256,plan.plan_sha256].some((value)=>!isDigest(value)))fail('verification-plan-schema');
    const preimage=structuredClone(plan);delete preimage.plan_sha256;if(digest(preimage)!==plan.plan_sha256)
      fail('verification-plan-digest');const requirements=ids({requirements:plan.gates.flatMap((row)=>row.requirement_ids||[])},'requirements');
    const failures=ids({failure_modes:plan.gates.flatMap((row)=>row.failure_mode_ids||[])},'failure_modes');
    const checked=catalog.validateCatalogRows({profile:plan.profile,capabilityFacts:plan.capability_facts,
      requirementIds:requirements,failureModeIds:failures,gates:plan.gates,requiredGateIds:plan.required_gate_ids,
      evidenceRequiredGateIds:plan.evidence_required_gate_ids});if(!checked.pass){const error=checked.errors[0];fail(error.code);}
    return{pass:true,errors:[]};}catch(error){return{pass:false,errors:[{code:error.code||'verification-plan'}]};}}

function pointMatches(value,at){if(at==='finish')return value.includes('finish');return value===at||
  value===`${at}-and-finish`||value===`spec-and-${at}`||value===`test-and-${at}`||
  at==='test'&&['spec-and-test','test-and-finish'].includes(value);}
function requiredGateIds(plan,{at}={}){if(!validateVerificationPlan(plan).pass)fail('verification-plan-invalid');
  return catalog.ordered(plan.gates.filter((row)=>row.disposition==='required'&&pointMatches(row.enforcement_point,at)).map((row)=>row.id));}
function evidenceRequiredGateIds(plan,{at}={}){if(!validateVerificationPlan(plan).pass)fail('verification-plan-invalid');
  return catalog.ordered(plan.gates.filter((row)=>row.disposition==='required'&&row.evidence_required&&
    !['human','evidence'].includes(row.adapter)&&(!at||pointMatches(row.enforcement_point,at))).map((row)=>row.id));}

const RISK_ORDER=['low','medium','high','critical'];
function validateAcceptance(row,index,finalClass,reasons){const id=typeof row?.id==='string'&&row.id.trim()?row.id:`invalid-${index}`;
  const required=['id','from','to','reason','unverified_risks','actor','at','scope'];if(!row||typeof row!=='object'||
      required.some((key)=>!Object.hasOwn(row,key))||typeof row.reason!=='string'||!row.reason.trim()||
      !RISK_ORDER.includes(row.from)||!RISK_ORDER.includes(row.to)||RISK_ORDER.indexOf(row.to)>=RISK_ORDER.indexOf(row.from)||
      row.from!==finalClass||!Array.isArray(row.unverified_risks)||!row.unverified_risks.length||
      row.unverified_risks.some((value)=>typeof value!=='string'||!value)||!Number.isFinite(Date.parse(row.at))||
      (!row.scope||(typeof row.scope!=='string'&&typeof row.scope!=='object')))return{id,pass:false};
  const human=typeof row.actor==='string'?row.actor.startsWith('human:'):row.actor?.type==='human'&&typeof row.actor.id==='string';
  if(['high','critical'].includes(row.from)&&RISK_ORDER.indexOf(row.to)<=RISK_ORDER.indexOf('medium')&&!human)return{id,pass:false};
  if(reasons.some((reason)=>!row.unverified_risks.includes(reason)))return{id,pass:false};return{id,pass:true};}
function computeResidualRisk({initialRisk,finalRisk,evidenceSummary,unverifiedAreas=[],riskAcceptances=[]}={}){
  const reasons=catalog.ordered([...unverifiedAreas.map((row)=>row.reason||row.gate_id||String(row)),
    ...(evidenceSummary?.complete?[]:['required-evidence-incomplete'])]);const finalClass=finalRisk?.class||initialRisk?.class||'low';
  const validation=(Array.isArray(riskAcceptances)?riskAcceptances:[]).map((row,index)=>validateAcceptance(row,index,finalClass,reasons));
  const invalid=validation.filter((row)=>!row.pass).map((row)=>row.id);const valid=validation.filter((row)=>row.pass);
  return{class:finalClass,reasons,unverified_areas:structuredClone(unverifiedAreas),accepted:Boolean(evidenceSummary?.complete)&&
    (reasons.length===0||valid.length>0)&&invalid.length===0,invalid_acceptance_ids:catalog.ordered(invalid)};}

module.exports={CATALOG:catalog.CATALOG,compileVerificationPlan,validateVerificationPlan,requiredGateIds,
  evidenceRequiredGateIds,gateRequirementFor:catalog.gateRequirementFor,deriveCompatibilityMode,computeResidualRisk};
