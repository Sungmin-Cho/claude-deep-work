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
function isAtLeast614(value){const parsed=semverMajorMinor(value);return parsed&&(parsed[0]>6||(parsed[0]===6&&parsed[1]>=14));}

function compatibilityProof(facts={}){if(facts.planProjection?.schema_version===3){const plan=require('./execution-contract-runtime.js').validateExecutionPlanV3(facts.planProjection);const proof={schema_version:3,mode:'execution-spec',plan_authority_sha256:plan.plan_authority_sha256};return {mode:'execution-spec',proof,proof_sha256:digest(proof)};}if(!facts||typeof facts!=='object'||Array.isArray(facts))fail('compatibility-mode');
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

function compileVerificationPlan(input={}){if(input.planProjection?.schema_version===3)return compileExecutionVerificationPlan(input);const risk=input.riskProfile?.class||input.riskProfile?.risk_class;
  let policy=input.policySnapshot,methodologyPolicySha256=null;
  if(policy?.authority==='methodology-policy-v1'){
    policy=require('./policy-runtime.js').validateMethodologyAuthority(policy);
    if(Object.hasOwn(policy,'execution_basis'))fail('execution-policy');
    methodologyPolicySha256=policy.policy_sha256;
  }
  const profile=policy?.profile,verificationLabel=policy?.authority==='methodology-policy-v1'
    ?policy.verification_policy:policy?.verification_policy?.recommended;
  if(PROFILE_BY_CLASS[risk]!==profile||policy?.risk_class!==risk||
      verificationLabel!==VERIFICATION_POLICY[profile])fail('policy-snapshot-inconsistent');
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
  const capability_facts=projection.capability_facts?structuredClone(projection.capability_facts):
    catalog.normalizeCapabilityFacts(input.capabilities||{});const req=ids(spec,'requirements');
  if(isAtLeast614(binding.created_by_version)){
    const sourceRequirements=capability_facts?.source_requirement_ids;
    const sourceSlices=capability_facts?.source_slice_ids;
    const compatibility=spec.compatibility||{};
    const expectedRequirements=catalog.ordered((spec.requirements||[])
      .filter((row)=>(row.evidence_gate_ids||[]).some((id)=>
        ['GATE-backward-compat','GATE-migration-dry-run'].includes(id)))
      .map((row)=>row.id));
    const expectedSlices=catalog.ordered((projection.slices||[])
      .filter((row)=>row.slice_kind==='release-verification').map((row)=>row.id));
    if(capability_facts?.has_backward_compat!==Object.hasOwn(compatibility,'legacy_inputs')||
      capability_facts?.has_migration!==Object.hasOwn(compatibility,'migration')||
      canonicalJson(catalog.ordered(sourceRequirements||[]))!==canonicalJson(expectedRequirements)||
      canonicalJson(catalog.ordered(sourceSlices||[]))!==canonicalJson(expectedSlices))
      fail('verification-capability-facts');
  }
  const policyCapabilityFacts=catalog.normalizeCapabilityFacts(Object.fromEntries(
    ['destructive','external_action','has_backward_compat','has_migration','host_dependent']
      .map((key)=>[key,capability_facts[key]===true])));
  const fm=ids(spec,'failure_matrix').length?ids(spec,'failure_matrix'):ids(spec,'failure_modes');
  const gates=catalog.expectedGateRows({profile,capabilityFacts:policyCapabilityFacts,requirementIds:req,failureModeIds:fm});
  const checked=catalog.validateCatalogRows({profile,capabilityFacts:policyCapabilityFacts,requirementIds:req,failureModeIds:fm,
    gates,requiredGateIds:gates.filter((row)=>row.disposition==='required').map((row)=>row.id),
    evidenceRequiredGateIds:gates.filter((row)=>row.disposition==='required'&&row.evidence_required&&
      !['human','evidence'].includes(row.adapter)).map((row)=>row.id)});
  const plan={schema_version:1,spec_id:spec.spec_id,spec_sha256:input.specSha256,
    spec_approved_hash:input.specApprovedHash,risk_profile_sha256:input.riskProfileSha256,risk_class:risk,profile,
    source_policy_label:VERIFICATION_POLICY[profile],compatibility_mode:compatibility.mode,
    compatibility_proof_sha256:compatibility.proof_sha256,plan_projection_sha256:projectionSha256,
    source_plan_sha256:binding.source_plan_sha256,capability_facts,gates,
    required_gate_ids:checked.required,evidence_required_gate_ids:checked.evidenceRequired};
  if(methodologyPolicySha256)plan.methodology_policy_sha256=methodologyPolicySha256;
  const typedSlices=(projection.slices||[]).filter((row)=>row.slice_kind!==undefined);
  if(typedSlices.length){
    if(typedSlices.length!==(projection.slices||[]).length||!/^[0-9a-f]{64}$/.test(projection.plan_authority_sha256||''))
      fail('verification-plan-slice-carrier');
    const rows={};
    for(const slice of [...typedSlices].sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)))){
      if(!/^SLICE-\d{3}$/.test(slice.id||'')||!['functional','release-verification'].includes(slice.slice_kind)||
          slice.slice_kind==='functional'&&!isDigest(slice.verification_spec_sha256)||
          slice.slice_kind==='release-verification'&&slice.verification_spec_sha256!==null)
        fail('verification-plan-slice-carrier');
      rows[slice.id]={slice_kind:slice.slice_kind,verification_spec_sha256:slice.verification_spec_sha256};
    }
    plan.plan_authority_sha256=projection.plan_authority_sha256;
    plan.slice_verification_specs=rows;
    plan.slice_verification_specs_sha256=digest({
      plan_authority_sha256:plan.plan_authority_sha256,
      capability_facts:plan.capability_facts,
      slice_verification_specs:rows,
    });
  }
  plan.plan_sha256=digest(plan);return plan;}

const PLAN_KEYS=['schema_version','spec_id','spec_sha256','spec_approved_hash','risk_profile_sha256','risk_class','profile',
  'source_policy_label','compatibility_mode','compatibility_proof_sha256','plan_projection_sha256','source_plan_sha256',
  'capability_facts','gates','required_gate_ids','evidence_required_gate_ids','plan_sha256'];
const PLAN_V2_KEYS=[...PLAN_KEYS.slice(0,-1),'plan_authority_sha256','slice_verification_specs',
  'slice_verification_specs_sha256','plan_sha256'];
const PLAN_POLICY_KEYS=[...PLAN_KEYS.slice(0,-1),'methodology_policy_sha256','plan_sha256'];
const PLAN_V2_POLICY_KEYS=[...PLAN_V2_KEYS.slice(0,-1),'methodology_policy_sha256',
  'plan_sha256'];
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());}
function validateVerificationPlan(plan){if(plan?.schema_version===3)return validateExecutionVerificationPlan(plan);try{const typed=Object.hasOwn(plan||{},'slice_verification_specs');
    const policyBound=Object.hasOwn(plan||{},'methodology_policy_sha256');
    const keys=typed?(policyBound?PLAN_V2_POLICY_KEYS:PLAN_V2_KEYS):
      (policyBound?PLAN_POLICY_KEYS:PLAN_KEYS);
    if(!exactKeys(plan,keys)||plan.schema_version!==1||
      !/^SPEC-[A-Z0-9][A-Z0-9-]{2,63}$/.test(plan.spec_id||'')||!['low','medium','high','critical'].includes(plan.risk_class)||
      PROFILE_BY_CLASS[plan.risk_class]!==plan.profile||plan.source_policy_label!==VERIFICATION_POLICY[plan.profile]||
      !['strict-spec','legacy-no-spec'].includes(plan.compatibility_mode)||
      [plan.spec_sha256,plan.spec_approved_hash,plan.risk_profile_sha256,plan.compatibility_proof_sha256,
        plan.plan_projection_sha256,plan.source_plan_sha256,plan.plan_sha256,
        ...(typed?[plan.plan_authority_sha256,plan.slice_verification_specs_sha256]:[]),
        ...(policyBound?[plan.methodology_policy_sha256]:[])].some((value)=>!isDigest(value)))
      fail('verification-plan-schema');
    const preimage=structuredClone(plan);delete preimage.plan_sha256;if(digest(preimage)!==plan.plan_sha256)
      fail('verification-plan-digest');
    if(typed){
      if(!plan.slice_verification_specs||typeof plan.slice_verification_specs!=='object'||
          Array.isArray(plan.slice_verification_specs)||digest({
            plan_authority_sha256:plan.plan_authority_sha256,
            capability_facts:plan.capability_facts,
            slice_verification_specs:plan.slice_verification_specs,
          })!==plan.slice_verification_specs_sha256)
        fail('verification-plan-slice-carrier');
      const sliceIds=Object.keys(plan.slice_verification_specs);
      if(canonicalJson(sliceIds)!==canonicalJson([...sliceIds].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))))||
          sliceIds.some((id)=>{const row=plan.slice_verification_specs[id];return !/^SLICE-\d{3}$/.test(id)||
            !exactKeys(row,['slice_kind','verification_spec_sha256'])||
            row.slice_kind==='functional'?!isDigest(row.verification_spec_sha256):
              row.slice_kind==='release-verification'?row.verification_spec_sha256!==null:true;}))
        fail('verification-plan-slice-carrier');
    }
    const policyCapabilityFacts=catalog.normalizeCapabilityFacts(Object.fromEntries(
      ['destructive','external_action','has_backward_compat','has_migration','host_dependent']
        .map((key)=>[key,plan.capability_facts[key]===true])));
    const requirements=ids({requirements:plan.gates.flatMap((row)=>row.requirement_ids||[])},'requirements');
    const failures=ids({failure_modes:plan.gates.flatMap((row)=>row.failure_mode_ids||[])},'failure_modes');
    const checked=catalog.validateCatalogRows({profile:plan.profile,capabilityFacts:policyCapabilityFacts,
      requirementIds:requirements,failureModeIds:failures,gates:plan.gates,requiredGateIds:plan.required_gate_ids,
      evidenceRequiredGateIds:plan.evidence_required_gate_ids});if(!checked.pass){const error=checked.errors[0];fail(error.code);}
    return{pass:true,errors:[]};}catch(error){return{pass:false,errors:[{code:error.code||'verification-plan'}]};}}

const EXECUTION_PLAN_KEYS=['schema_version','spec_id','spec_sha256','spec_approved_hash','risk_profile_sha256',
  'risk_class','profile','source_policy_label','compatibility_mode','methodology_policy_sha256','source_plan_sha256',
  'plan_projection_sha256','plan_authority_sha256','capability_facts','execution_policy','slice_basis','slice_contracts',
  'slice_verification_specs','slice_verification_specs_sha256','gates','required_gate_ids','evidence_required_gate_ids','plan_sha256'];
function executionGateFacts(facts) {return catalog.normalizeCapabilityFacts(Object.fromEntries(catalog.CAPABILITY_KEYS.map(key=>[key,facts[key]])));}
function executionGateSets(gates){return{required_gate_ids:catalog.ordered(gates.filter(g=>g.disposition==='required').map(g=>g.id)),
  evidence_required_gate_ids:catalog.ordered(gates.filter(g=>g.disposition==='required'&&g.evidence_required&&!['human','evidence'].includes(g.adapter)).map(g=>g.id))};}
function compileExecutionVerificationPlan(input){
  const execution=require('./execution-contract-runtime.js');
  const projection=execution.validateExecutionPlanV3(input.planProjection);
  const policy=require('./policy-runtime.js').validateMethodologyAuthority(input.policySnapshot);
  if(policy.execution_basis!=='per-slice-v1')fail('execution-policy');
  const risk=input.riskProfile?.class||input.riskProfile?.risk_class;
  if(policy.risk_class!==risk||policy.profile!==PROFILE_BY_CLASS[risk])fail('policy-snapshot-inconsistent');
  const binding=projection.contract_binding,spec=input.specContract;
  if(binding.spec_contract.spec_id!==spec?.spec_id||binding.spec_contract.spec_sha256!==input.specSha256||
    binding.spec_contract.spec_approved_hash!==input.specApprovedHash||binding.risk_profile_sha256!==input.riskProfileSha256)fail('verification-plan-plan-binding');
  const projectionDigest=digest(projection);
  if(input.planProjectionSha256&&input.planProjectionSha256!==projectionDigest)fail('verification-plan-plan-projection');
  const declaredGates=[...(spec.requirements||[]),...(spec.failure_matrix||[])].flatMap(r=>r.evidence_gate_ids||[]);
  declaredGates.push(...(spec.negative_tests||[]).map(r=>r.gate_id));
  if(declaredGates.some(id=>!Object.hasOwn(catalog.CATALOG_V3,id)))fail('verification-plan-spec-gate');
  const requirements=ids(spec,'requirements'),invariants=ids(spec,'invariants'),failures=ids(spec,'failure_matrix').length?ids(spec,'failure_matrix'):ids(spec,'failure_modes');
  for(const [key,known]of [['requirements',requirements],['invariants',invariants],['failure_modes',failures]]){
    const actual=catalog.ordered(projection.slices.flatMap(s=>s.contract[key]));
    if(canonicalJson(actual)!==canonicalJson(known))fail('verification-plan-requirement-coverage');
  }
  const facts=projection.capability_facts,compatibility=spec.compatibility||{};
  const expectedReq=catalog.ordered((spec.requirements||[]).filter(row=>(row.evidence_gate_ids||[]).some(id=>['GATE-backward-compat','GATE-migration-dry-run'].includes(id))).map(row=>row.id));
  const expectedSlices=projection.slices.filter(s=>s.slice_kind==='release-verification').map(s=>s.id);
  require('./contract-runtime.js').validateCapabilityFactsV1(facts,{allowEmpty:true,expectedBackwardCompat:Object.hasOwn(compatibility,'legacy_inputs')&&String(compatibility.legacy_inputs).trim().toLowerCase()!=='none',
    expectedMigration:Object.hasOwn(compatibility,'migration')&&String(compatibility.migration).trim().toLowerCase()!=='none',expectedRequirementIds:expectedReq,expectedSliceIds:expectedSlices});
  const sliceBasis={},sliceContracts={},sliceSpecs={};
  for(const slice of projection.slices){const basis=slice.execution_basis||null;
    if(basis)sliceBasis[slice.id]=basis;
    sliceContracts[slice.id]={slice_kind:slice.slice_kind,execution_basis:basis,requirement_ids:catalog.ordered(slice.contract.requirements),
      invariant_ids:catalog.ordered(slice.contract.invariants),failure_mode_ids:catalog.ordered(slice.contract.failure_modes)};
    sliceSpecs[slice.id]={slice_kind:slice.slice_kind,execution_basis:basis,
      verification_spec_sha256:basis==='strict-tdd-v2'?slice.verification_spec_sha256:null,
      verification_commands:basis==='outcome-v1'?Object.fromEntries(slice.verification_commands.map(c=>[c.id,digest(c)])):{},
      oracle_controls_sha256:basis==='outcome-v1'?digest(slice.oracle_controls):null};
  }
  const gates=catalog.expectedExecutionGateRows({profile:policy.profile,capabilityFacts:executionGateFacts(facts),sliceContracts});
  const plan={schema_version:3,spec_id:spec.spec_id,spec_sha256:input.specSha256,spec_approved_hash:input.specApprovedHash,
    risk_profile_sha256:input.riskProfileSha256,risk_class:risk,profile:policy.profile,source_policy_label:policy.verification_policy,
    compatibility_mode:'execution-spec',methodology_policy_sha256:policy.policy_sha256,source_plan_sha256:binding.source_plan_sha256,
    plan_projection_sha256:projectionDigest,plan_authority_sha256:projection.plan_authority_sha256,capability_facts:facts,
    execution_policy:projection.execution_policy,slice_basis:sliceBasis,slice_contracts:sliceContracts,slice_verification_specs:sliceSpecs,
    slice_verification_specs_sha256:digest({plan_authority_sha256:projection.plan_authority_sha256,capability_facts:facts,slice_verification_specs:sliceSpecs}),
    gates,...executionGateSets(gates)};
  plan.plan_sha256=digest(plan);return plan;
}
function validateExecutionVerificationPlan(plan){try{
  if(!exactKeys(plan,EXECUTION_PLAN_KEYS)||plan.schema_version!==3||plan.compatibility_mode!=='execution-spec'||
    !/^SPEC-[A-Z0-9][A-Z0-9-]{2,63}$/.test(plan.spec_id)||PROFILE_BY_CLASS[plan.risk_class]!==plan.profile||
    plan.source_policy_label!==VERIFICATION_POLICY[plan.profile]||
    ['spec_sha256','spec_approved_hash','risk_profile_sha256','methodology_policy_sha256','source_plan_sha256','plan_projection_sha256',
      'plan_authority_sha256','slice_verification_specs_sha256','plan_sha256'].some(key=>!isDigest(plan[key])))fail('verification-plan-schema');
  const preimage=structuredClone(plan);delete preimage.plan_sha256;if(digest(preimage)!==plan.plan_sha256)fail('verification-plan-digest');
  if(!exactKeys(plan.execution_policy,['requested_method','strict_required_slice_ids'])||
    !['strict','coaching','relaxed','adaptive'].includes(plan.execution_policy.requested_method)||
    !Array.isArray(plan.execution_policy.strict_required_slice_ids)||
    new Set(plan.execution_policy.strict_required_slice_ids).size!==plan.execution_policy.strict_required_slice_ids.length)fail('execution-policy');
  for(const map of [plan.slice_basis,plan.slice_contracts,plan.slice_verification_specs])if(!map||typeof map!=='object'||Array.isArray(map))fail('verification-plan-slice-carrier');
  const sliceIds=Object.keys(plan.slice_contracts);
  if(!sliceIds.length||canonicalJson(catalog.ordered(sliceIds))!==canonicalJson(sliceIds)||
    canonicalJson(Object.keys(plan.slice_verification_specs))!==canonicalJson(sliceIds))fail('verification-plan-slice-carrier');
  const functional=[];
  for(const id of sliceIds){const row=plan.slice_contracts[id],spec=plan.slice_verification_specs[id];
    if(!/^SLICE-\d{3}$/.test(id)||!exactKeys(row,['slice_kind','execution_basis','requirement_ids','invariant_ids','failure_mode_ids'])||
      !exactKeys(spec,['slice_kind','execution_basis','verification_spec_sha256','verification_commands','oracle_controls_sha256']))fail('verification-plan-slice-carrier');
    for(const[key,pattern]of [['requirement_ids',/^REQ-\d{3}$/],['invariant_ids',/^INV-\d{3}$/],['failure_mode_ids',/^FM-\d{3}$/]])
      if(!Array.isArray(row[key])||canonicalJson(catalog.ordered(row[key]))!==canonicalJson(row[key])||row[key].some(v=>typeof v!=='string'||!pattern.test(v)))fail('verification-plan-slice-carrier');
    if(!row.requirement_ids.length||row.slice_kind!==spec.slice_kind||row.execution_basis!==spec.execution_basis)fail('verification-plan-slice-carrier');
    if(row.slice_kind==='functional'){
      if(!['strict-tdd-v2','outcome-v1'].includes(row.execution_basis)||plan.slice_basis[id]!==row.execution_basis)fail('verification-plan-slice-carrier');functional.push(id);
    }else if(row.slice_kind!=='release-verification'||row.execution_basis!==null)fail('verification-plan-slice-carrier');
    if(!spec.verification_commands||typeof spec.verification_commands!=='object'||Array.isArray(spec.verification_commands)||
      Object.entries(spec.verification_commands).some(([id,sha])=>!/^CMD-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)||!isDigest(sha)))fail('verification-plan-slice-carrier');
    if(row.execution_basis==='strict-tdd-v2'?(!isDigest(spec.verification_spec_sha256)||spec.oracle_controls_sha256!==null||Object.keys(spec.verification_commands).length):
      row.execution_basis==='outcome-v1'?(spec.verification_spec_sha256!==null||!isDigest(spec.oracle_controls_sha256)):
      spec.verification_spec_sha256!==null||spec.oracle_controls_sha256!==null||Object.keys(spec.verification_commands).length)fail('verification-plan-slice-carrier');
  }
  if(canonicalJson(Object.keys(plan.slice_basis))!==canonicalJson(functional)||plan.execution_policy.strict_required_slice_ids.some(id=>plan.slice_basis[id]!=='strict-tdd-v2'))fail('execution-basis-required');
  require('./contract-runtime.js').validateCapabilityFactsV1(plan.capability_facts,{allowEmpty:true,sliceIds:new Set(sliceIds),
    requirementIds:new Set(Object.values(plan.slice_contracts).flatMap(s=>s.requirement_ids))});
  if(digest({plan_authority_sha256:plan.plan_authority_sha256,capability_facts:plan.capability_facts,slice_verification_specs:plan.slice_verification_specs})!==plan.slice_verification_specs_sha256)fail('verification-plan-slice-carrier');
  const gates=catalog.expectedExecutionGateRows({profile:plan.profile,capabilityFacts:executionGateFacts(plan.capability_facts),sliceContracts:plan.slice_contracts});
  if(canonicalJson(gates)!==canonicalJson(plan.gates))fail('verification-plan-disposition');
  const sets=executionGateSets(gates);for(const key of Object.keys(sets))if(canonicalJson(plan[key])!==canonicalJson(sets[key]))fail('verification-plan-required');
  return{pass:true,errors:[]};
}catch(error){return{pass:false,errors:[{code:error.code||'verification-plan'}]};}}

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
  evidenceRequiredGateIds,gateRequirementFor:catalog.gateRequirementFor,
  deriveCompatibilityMode,computeResidualRisk,isAtLeast614};
