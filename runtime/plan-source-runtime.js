'use strict';
const j=require('./operation-journal.js'),contracts=require('./contract-runtime.js');
function fail(code){throw Object.assign(new Error(`[${code}]`),{code});}
function equal(a,b){return j.canonicalJson(a)===j.canonicalJson(b);}
function fillChecked(explicit,expected){if(explicit===undefined)return structuredClone(expected);if(expected&&typeof expected==='object'&&!Array.isArray(expected)){
 if(!explicit||typeof explicit!=='object'||Array.isArray(explicit))fail('plan-derived-context-mismatch');
 const output=structuredClone(expected);for(const key of Object.keys(explicit)){if(!(key in expected)||!equal(explicit[key],expected[key])&&!(expected[key]&&typeof expected[key]==='object'&&!Array.isArray(expected[key])))fail('plan-derived-context-mismatch');output[key]=fillChecked(explicit[key],expected[key]);}return output;
 }if(!equal(explicit,expected))fail('plan-derived-context-mismatch');return explicit;}
function contextFor(fields,specContract,specBytes){
 const risk=typeof fields.risk_profile_json==='string'?JSON.parse(fields.risk_profile_json):fields.risk_profile_json;
 const policy=typeof fields.methodology_policy_json==='string'?JSON.parse(fields.methodology_policy_json):fields.methodology_policy_json;
 if(j.sha256(j.canonicalJson(risk))!==fields.risk_profile_sha256)fail('plan-source-risk-authority');
 const methodology=require('./policy-runtime.js').validateMethodologyAuthority(policy);
 const validation=contracts.validateSpecContract(specContract,{riskClass:specContract.risk_class});if(!validation.pass)fail('plan-source-spec');
 const context={schema_version:1,session_id:fields.session_id,created_by_version:fields.created_by_version,task_sha256:j.sha256(Buffer.from(fields.task_description)),risk_profile_sha256:fields.risk_profile_sha256,methodology_policy_sha256:methodology.policy_sha256,execution_method:fields.execution_method,review_mode_override:fields.review_mode_override||'auto',model_routing:fields.model_routing||null,replan_epoch:fields.active_replan_epoch_id||null,spec_contract:{spec_id:specContract.spec_id,spec_sha256:contracts.specContractDigest(specContract),spec_approved_hash:j.sha256(specBytes)}};
 return{context,context_sha256:j.sha256(j.canonicalJson(context)),risk,methodology};
}
function deriveSource(source,{fields,specContract,specBytes}){
 const derived=contextFor(fields,specContract,specBytes),ctx=derived.context;const out=structuredClone(source);
 out.contract_binding=fillChecked(source.contract_binding,{schema_version:1,mode:'execution-spec',created_by_version:ctx.created_by_version,spec_contract:{...ctx.spec_contract,...(source.contract_binding?.spec_contract?.schema_version!==undefined?{schema_version:1}:{})},risk_profile_sha256:ctx.risk_profile_sha256});
 out.replan_epoch=fillChecked(source.replan_epoch,ctx.replan_epoch);
 if(source.outcome_environment===undefined)out.outcome_environment={mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}};
 if(source.execution_policy?.requested_method!==ctx.execution_method)fail('plan-execution-method-drift');
 const compatibility=specContract.compatibility||{},nonempty=value=>value!==undefined&&String(value).trim().toLowerCase()!=='none';
 // The V3 execution grammar has no external/destructive operation basis. Risk
 // triggers still set review floors; they are not observations of an executed effect.
 const facts={schema_version:1,authority:'reviewed-plan',destructive:false,external_action:false,has_backward_compat:nonempty(compatibility.legacy_inputs),has_migration:nonempty(compatibility.migration),host_dependent:(out.slices||[]).some(s=>(s.contract?.evidence_required||[]).includes('GATE-host-smoke')),source_requirement_ids:(specContract.requirements||[]).filter(row=>(row.evidence_gate_ids||[]).some(id=>['GATE-backward-compat','GATE-migration-dry-run'].includes(id))).map(r=>r.id).sort(),source_slice_ids:(out.slices||[]).filter(s=>s.slice_kind==='release-verification').map(s=>s.id).sort()};
 if(source.capability_facts?.host_dependent===true)facts.host_dependent=true;
 facts.facts_sha256=j.sha256('capability-facts-v1\0'+j.canonicalJson(facts));out.capability_facts=fillChecked(source.capability_facts,facts);
 return{source:out,...derived};
}
module.exports={deriveSource,contextFor,fillChecked};
