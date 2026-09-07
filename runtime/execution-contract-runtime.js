'use strict';

// V3 is a separate authority. No legacy object is defaulted or rewritten here.
const crypto=require('node:crypto');
const path=require('node:path');
const {canonicalJson}=require('./operation-journal.js');
const {canonicalizePortableProjectPathV1}=require('./platform.js');
const BASIS=Object.freeze(['strict-tdd-v2','outcome-v1']);
const sort=(rows)=>[...rows].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
const hash=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const digest=(value)=>hash(canonicalJson(value));
const isObject=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isDigest=(value)=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
function fail(code,detail=''){throw Object.assign(new Error(`[${code}] ${detail}`),{code});}
function keys(value,required,optional=[],code='execution-contract-schema') {
  if(!isObject(value)||required.some(k=>!Object.hasOwn(value,k))||
    Object.keys(value).some(k=>![...required,...optional].includes(k)))fail(code);
}
function text(value,code,max=8192){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>max||value.includes('\0'))fail(code);return value;}
function list(value,pattern,code,{nonempty=false}={}) {
  if(!Array.isArray(value)||value.length>4096||(nonempty&&!value.length)||new Set(value).size!==value.length||
    value.some(v=>typeof v!=='string'||!pattern.test(v)))fail(code);return sort(value);
}
function paths(value,code='execution-path') {
  if(!Array.isArray(value)||value.length>4096)fail(code);
  const seen=new Set();for(const file of value){const p=canonicalizePortableProjectPathV1(file);
    if(seen.has(p.windowsKey))fail(code);seen.add(p.windowsKey);}
  return sort(value);
}
function normalize(value){return JSON.parse(canonicalJson(value));}
function boundedJson(value,depth=0) {
  if(depth>32)fail('execution-json-bounds');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('execution-json-type');return;}
  if(typeof value==='string'){if(Buffer.byteLength(value)>65536||value.includes('\0'))fail('execution-json-bounds');return;}
  if(Array.isArray(value)){if(value.length>4096)fail('execution-json-bounds');for(const item of value)boundedJson(item,depth+1);return;}
  if(!isObject(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).length>4096)fail('execution-json-type');
  for(const [key,item]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))fail('execution-json-key');boundedJson(item,depth+1);}
}
function pointerValue(value,pointer) {
  if(pointer==='')return{present:true,value};
  for(const part of pointer.slice(1).split('/').map(v=>v.replaceAll('~1','/').replaceAll('~0','~'))){
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return{present:false};value=value[part];
  }
  return{present:true,value};
}
function validateOutcomeEnvironmentV1(value) {
  keys(value,['mode','values'],[],'outcome-environment');
  if(value.mode!=='closed'||!isObject(value.values))fail('outcome-environment');
  const allowed={LANG:/^[A-Za-z0-9_.@-]{1,80}$/,LC_ALL:/^[A-Za-z0-9_.@-]{1,80}$/,TZ:/^[A-Za-z0-9_+/:.-]{1,80}$/,
    PYTHONDONTWRITEBYTECODE:/^1$/,PYTHONNOUSERSITE:/^1$/,PYTHONHASHSEED:/^(?:0|[1-9]\d{0,9})$/};
  for(const required of ['LANG','LC_ALL','TZ'])if(!Object.hasOwn(value.values,required))fail('outcome-environment');
  for(const [key,v]of Object.entries(value.values))if(!Object.hasOwn(allowed,key)||typeof v!=='string'||!allowed[key].test(v)||
    key==='PYTHONHASHSEED'&&Number(v)>4294967295)fail('outcome-environment',key);
  return normalize(value);
}
function validateOutcomeCommandV1(command) {
  boundedJson(command);
  keys(command,['id','gate_ids','spec'],[],'outcome-command-schema');
  if(typeof command.id!=='string'||!/^CMD-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(command.id))fail('outcome-command-id');
  const gates=list(command.gate_ids,/^GATE-[a-z][a-z0-9-]{2,63}$/,'outcome-command-gates',{nonempty:true});
  const catalog=require('./verification-gate-catalog.js').CATALOG_V3;
  if(gates.some(id=>!catalog[id]||['GATE-tdd-red','GATE-tdd-green'].includes(id)))fail('outcome-command-gates');
  const spec=require('./verification-runtime.js').validateVerificationSpec(command.spec);
  if(Object.hasOwn(spec,'red_failure_literal')||spec.args.length>128||spec.args.some(a=>Buffer.byteLength(a)>4096))fail('outcome-command-spec');
  // The supported argv grammars are deliberately smaller than VerificationSpecV1.
  const args=spec.args,exe=spec.executable;
  if(exe.kind==='node'){
    if(args[0]!=='--test')fail('outcome-command-verifier');
    const files=args.slice(1).filter(a=>a!=='--test-reporter=tap'&&a!=='--');
    if(!files.length||files.some(a=>a.startsWith('-')))fail('outcome-command-verifier');paths(files);
  }else if(exe.kind==='absolute-native'){
    if(!path.isAbsolute(exe.value)||!/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(path.basename(exe.value))||
      args[0]!=='-m'||args[1]!=='unittest')fail('outcome-command-verifier');
    const rest=args.slice(2);for(let i=0;i<rest.length;i++){
      const a=rest[i];if(['-v','--verbose','-q','--quiet','-f','--failfast','-b','--buffer','discover'].includes(a))continue;
      if(['-s','--start-directory','-t','--top-level-directory'].includes(a)){paths([rest[++i]]);continue;}
      if(['-p','--pattern'].includes(a)){if(typeof rest[++i]!=='string'||!/^[-A-Za-z0-9_.*]+\.py$/.test(rest[i]))fail('outcome-command-verifier');continue;}
      if(!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(a))fail('outcome-command-verifier');
    }
  }else if(exe.kind==='node-package-bin'){
    const recipes={vitest:['vitest','run'],jest:['jest',null],mocha:['mocha',null]};const recipe=recipes[exe.package];
    if(!recipe||exe.bin!==recipe[0]||recipe[1]&&args[0]!==recipe[1])fail('outcome-command-verifier');
    // Project configuration loaders/options are excluded; only named test paths.
    const files=args.slice(recipe[1]?1:0);if(!files.length||files.some(a=>a.startsWith('-')))fail('outcome-command-verifier');paths(files);
  }else fail('outcome-command-verifier');
  return normalize({...command,gate_ids:gates,spec});
}
function validateOracleControlV1(control) {
  boundedJson(control);
  keys(control,['id','requirement_ids','invariant_ids','failure_mode_ids','source_kind','source_refs','check','counterexample','command_id'],[],'oracle-control-schema');
  if(typeof control.id!=='string'||!/^ORACLE-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(control.id))fail('oracle-control-id');
  for(const [key,pattern]of [['requirement_ids',/^REQ-\d{3}$/],['invariant_ids',/^INV-\d{3}$/],['failure_mode_ids',/^FM-\d{3}$/]])list(control[key],pattern,'oracle-control-ids');
  if(![...control.requirement_ids,...control.invariant_ids,...control.failure_mode_ids].length)fail('oracle-control-coverage');
  if(!['pre-existing-immutable','slice-authored'].includes(control.source_kind)||!Array.isArray(control.source_refs)||control.source_refs.length>128)fail('oracle-source');
  for(const ref of control.source_refs){keys(ref,['path'],['sha256'],'oracle-source');paths([ref.path]);
    if(control.source_kind==='pre-existing-immutable'&&!isDigest(ref.sha256)||Object.hasOwn(ref,'sha256')&&!isDigest(ref.sha256))fail('oracle-source');}
  paths(control.source_refs.map(r=>r.path),'oracle-source');
  const check=control.check;
  if(!isObject(check))fail('oracle-check');
  switch(check.kind){
    case 'program':keys(check,['kind','command_id'],[],'oracle-check');if(!control.source_refs.length||check.command_id!==control.command_id||typeof control.command_id!=='string')fail('oracle-check');break;
    case 'file-contains':keys(check,['kind','path','value'],[],'oracle-check');text(check.value,'oracle-check',65536);break;
    case 'json-pointer-equals':keys(check,['kind','path','pointer','value'],[],'oracle-check');if(typeof check.pointer!=='string'||check.pointer!==''&&!/^(?:\/(?:[^~\u0000]|~[01])*)+$/.test(check.pointer)||Buffer.byteLength(canonicalJson(check.value))>65536)fail('oracle-check');break;
    case 'path-exists':case 'path-absent':keys(check,['kind','path'],[],'oracle-check');break;
    default:fail('oracle-check');
  }
  if(check.kind!=='program'){paths([check.path]);if(control.command_id!==null||control.source_refs.length||control.source_kind!=='pre-existing-immutable')fail('oracle-builtin-identity');}
  const c=control.counterexample;if(!isObject(c))fail('oracle-counterexample');
  if(c.kind==='replace-target'){keys(c,['kind','path','content'],[],'oracle-counterexample');paths([c.path]);
    if(typeof c.content!=='string'||Buffer.byteLength(c.content)>65536||c.content.includes('\0'))fail('oracle-counterexample');}
  else if(c.kind==='remove-target'){keys(c,['kind','path'],[],'oracle-counterexample');paths([c.path]);}
  else if(c.kind==='pre-change-replay'){keys(c,['kind','commit','manifest_sha256','target_paths'],[],'oracle-counterexample');
    if(!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(c.commit)||!isDigest(c.manifest_sha256)||!c.target_paths?.length)fail('oracle-counterexample');paths(c.target_paths);}
  else fail('oracle-counterexample');
  const targets=c.target_paths||[c.path];if(targets.some(p=>control.source_refs.some(r=>r.path===p)))fail('oracle-counterexample-source');
  if(check.kind!=='program'&&(targets.length!==1||targets[0]!==check.path))fail('oracle-counterexample-target');
  if(check.kind!=='program'){
    let stillPassing=false;
    if(check.kind==='path-exists')stillPassing=c.kind==='replace-target';
    if(check.kind==='path-absent')stillPassing=c.kind==='remove-target';
    if(c.kind==='replace-target'&&check.kind==='file-contains')stillPassing=c.content.includes(check.value);
    if(c.kind==='replace-target'&&check.kind==='json-pointer-equals'){
      let parsed;try{parsed=JSON.parse(c.content);}catch{fail('oracle-counterexample-json');}
      const found=pointerValue(parsed,check.pointer);stillPassing=found.present&&canonicalJson(found.value)===canonicalJson(check.value);
    }
    if(stillPassing)fail('oracle-counterexample-ineffective');
  }
  return normalize(control);
}
const CONTRACT_KEYS=['id','outcome','files','depends_on','integration_touchpoints','requirements','invariants','failure_modes',
  'risk','negative_tests','evidence_required','rollback','review_policy','scope_expansion_trigger'];
function validateExecutionSliceContract(value,slice) {
  keys(value,CONTRACT_KEYS,['goal','slice_kind','change_kind','execution_basis','failing_test','verification_cmd','expected_output',
    'code_sketch','spec_checklist','contract','acceptance_threshold','size','steps','verification_spec','verification_scope','release_gate_ids'],'execution-slice-contract');
  if(value.id!==slice.id||canonicalJson(paths(value.files))!==canonicalJson(slice.files))fail('execution-slice-contract');
  text(value.outcome,'execution-slice-outcome');
  const patterns={requirements:/^REQ-\d{3}$/,invariants:/^INV-\d{3}$/,failure_modes:/^FM-\d{3}$/,negative_tests:/^NEG-\d{3}$/,depends_on:/^SLICE-\d{3}$/};
  for(const[k,p]of Object.entries(patterns))list(value[k],p,'execution-slice-contract',{nonempty:k==='requirements'});
  for(const k of ['integration_touchpoints','scope_expansion_trigger'])list(value[k],/^[^\0]{1,8192}$/,'execution-slice-contract',{nonempty:true});
  const gates=require('./verification-gate-catalog.js').CATALOG_V3;
  list(value.evidence_required,/^GATE-[a-z][a-z0-9-]{2,63}$/,'execution-slice-gates');
  if(value.evidence_required.some(id=>!gates[id]))fail('execution-slice-gates');
  if(!['single','dual'].includes(value.review_policy))fail('execution-slice-review');
  keys(value.risk,['class','score','triggers'],[],'execution-slice-risk');
  if(!['low','medium','high','critical'].includes(value.risk.class)||!Number.isSafeInteger(value.risk.score)||value.risk.score<0||value.risk.score>14)fail('execution-slice-risk');
  list(value.risk.triggers,/^[^\0]{1,8192}$/,'execution-slice-risk');
  keys(value.rollback,['method','verification'],[],'execution-slice-rollback');text(value.rollback.method,'execution-slice-rollback');
  list(value.rollback.verification,/^GATE-[a-z][a-z0-9-]{2,63}$/,'execution-slice-rollback',{nonempty:true});
  if(value.rollback.verification.some(id=>!gates[id]))fail('execution-slice-rollback');
  for(const k of ['slice_kind','change_kind','execution_basis'])if(Object.hasOwn(value,k)&&value[k]!==slice[k])fail('execution-slice-carrier');
  if(Object.hasOwn(value,'verification_spec')&&canonicalJson(value.verification_spec)!==canonicalJson(slice.verification_spec))fail('execution-slice-carrier');
  for(const key of ['goal','failing_test','verification_cmd','expected_output','code_sketch','acceptance_threshold','size'])
    if(Object.hasOwn(value,key))text(value[key],'execution-slice-contract');
  for(const key of ['steps','spec_checklist','contract'])if(Object.hasOwn(value,key))
    list(value[key],/^[^\0]{1,8192}$/,'execution-slice-contract');
  return normalize(value);
}
function validateExecutionPlanV3(input) {
  boundedJson(input);
  if(Buffer.byteLength(canonicalJson(input))>4194304)fail('execution-json-bounds');
  keys(input,['schema_version','contract_binding','execution_policy','replan_epoch','capability_facts','outcome_environment','slices'],['plan_authority_sha256'],'execution-plan-schema');
  if(input.schema_version!==3)fail('execution-plan-schema');
  const b=input.contract_binding;keys(b,['schema_version','mode','created_by_version','spec_contract','risk_profile_sha256','source_plan_sha256'],[],'execution-plan-binding');
  const version=typeof b.created_by_version==='string'&&b.created_by_version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if(b.schema_version!==1||b.mode!=='execution-spec'||!version||Number(version[1])<7||Number(version[1])===7&&Number(version[2])<4||!isDigest(b.risk_profile_sha256)||!isDigest(b.source_plan_sha256))fail('execution-plan-binding');
  keys(b.spec_contract,['spec_id','spec_sha256','spec_approved_hash'],['schema_version'],'execution-plan-binding');
  if(!/^SPEC-[A-Z0-9][A-Z0-9-]{2,63}$/.test(b.spec_contract.spec_id)||!isDigest(b.spec_contract.spec_sha256)||!isDigest(b.spec_contract.spec_approved_hash)||Object.hasOwn(b.spec_contract,'schema_version')&&b.spec_contract.schema_version!==1)fail('execution-plan-binding');
  const policy=input.execution_policy;keys(policy,['requested_method','strict_required_slice_ids'],[],'execution-policy');
  if(!['adaptive','strict','coaching','relaxed'].includes(policy.requested_method))fail('execution-policy');
  const required=list(policy.strict_required_slice_ids,/^SLICE-\d{3}$/,'execution-policy');
  if(input.replan_epoch!==null&&!isDigest(input.replan_epoch))fail('execution-replan-epoch');
  const environment=validateOutcomeEnvironmentV1(input.outcome_environment);
  if(!Array.isArray(input.slices)||!input.slices.length||input.slices.length>4096)fail('execution-slices');
  const sliceIds=list(input.slices.map(s=>s?.id),/^SLICE-\d{3}$/,'execution-slice-id',{nonempty:true});
  const slices=input.slices.map(s=>{
    const release=s.slice_kind==='release-verification';
    const common=['id','slice_kind','checked','scope_schema_version','files','write_scope','contract'];
    keys(s,release?[...common,'verification_scope','release_gate_ids','verification_spec','verification_spec_sha256']:
      [...common,'change_kind','execution_basis',...(s.execution_basis==='strict-tdd-v2'?['verification_spec','verification_spec_sha256']:['verification_commands','oracle_controls'])],[],'execution-slice-schema');
    if(typeof s.checked!=='boolean'||s.scope_schema_version!==1||!['functional','release-verification'].includes(s.slice_kind))fail('execution-slice-schema');
    keys(s.write_scope,['failing_test','production','refactor'],[],'execution-slice-scope');
    const files=paths(s.files),scope=Object.fromEntries(Object.entries(s.write_scope).map(([k,v])=>[k,paths(v)]));
    if(scope.failing_test.some(p=>scope.production.includes(p))||canonicalJson(sort(new Set(Object.values(scope).flat())))!==canonicalJson(files))fail('execution-slice-scope');
    let row={...s,files,write_scope:scope};
    if(release){if(files.length||s.verification_spec!==null||s.verification_spec_sha256!==null)fail('release-slice-write-scope');
      list(s.verification_scope,/^SLICE-\d{3}$/,'release-slice-verification',{nonempty:true});
      list(s.release_gate_ids,/^GATE-[a-z][a-z0-9-]{2,63}$/,'release-slice-verification',{nonempty:true});
      if(s.verification_scope.some(id=>id===s.id||!sliceIds.includes(id))||s.release_gate_ids.some(id=>!require('./verification-gate-catalog.js').CATALOG_V3[id]))fail('release-slice-verification');
    }else{
      if(!BASIS.includes(s.execution_basis)||!['functional','non-functional'].includes(s.change_kind))fail('execution-basis');
      if((required.includes(s.id)||['strict','coaching'].includes(policy.requested_method)&&s.change_kind==='functional')&&s.execution_basis!=='strict-tdd-v2')fail('execution-basis-required');
      if(!scope.production.length)fail('execution-slice-scope');
      if(s.execution_basis==='strict-tdd-v2'){
        if(!scope.failing_test.length)fail('execution-slice-scope');
        const spec=require('./contract-runtime.js').validateVerificationSpecV2(s.verification_spec);
        if(digest(spec)!==s.verification_spec_sha256||!scope.failing_test.includes(spec.args[3]))fail('verification-spec-digest');
        row.verification_spec=spec;
      }else{
        if(scope.failing_test.length)fail('outcome-failing-test-scope');
        if(!Array.isArray(s.verification_commands)||s.verification_commands.length>128||!Array.isArray(s.oracle_controls)||!s.oracle_controls.length||s.oracle_controls.length>128)fail('outcome-oracles');
        row.verification_commands=s.verification_commands.map(validateOutcomeCommandV1).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
        row.oracle_controls=s.oracle_controls.map(validateOracleControlV1).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
        if(new Set(row.verification_commands.map(c=>c.id)).size!==row.verification_commands.length||new Set(row.oracle_controls.map(c=>c.id)).size!==row.oracle_controls.length)fail('outcome-duplicate-id');
        const oracleSources=new Set(row.oracle_controls.flatMap(o=>o.source_refs.map(r=>r.path)));
        for(const oracle of row.oracle_controls){
          if((oracle.counterexample.target_paths||[oracle.counterexample.path]).some(p=>oracleSources.has(p)))fail('oracle-counterexample-source');if(oracle.command_id!==null&&!row.verification_commands.some(c=>c.id===oracle.command_id))fail('oracle-command');
          const targets=oracle.counterexample.target_paths||[oracle.counterexample.path];
          if(targets.some(p=>!files.includes(p))||oracle.source_kind==='slice-authored'&&oracle.source_refs.some(r=>!files.includes(r.path))||
            oracle.source_kind==='pre-existing-immutable'&&oracle.source_refs.some(r=>files.includes(r.path)))fail('oracle-scope');
        }
      }
    }
    row.contract=validateExecutionSliceContract(s.contract,row);
    if(s.contract.depends_on.some(id=>id===s.id||!sliceIds.includes(id)))fail('execution-dependency');
    if(s.execution_basis==='outcome-v1')for(const [key,oracleKey]of [['requirements','requirement_ids'],['invariants','invariant_ids'],['failure_modes','failure_mode_ids']]){
      const covered=row.oracle_controls.flatMap(o=>o[oracleKey]);
      if(s.contract[key].some(id=>!covered.includes(id))||covered.some(id=>!s.contract[key].includes(id)))fail('oracle-control-coverage');
    }
    return row;
  }).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
  if(required.some(id=>!slices.some(s=>s.id===id&&s.execution_basis==='strict-tdd-v2')))fail('execution-basis-required');
  const visited=new Set(),visiting=new Set();function visit(id){if(visiting.has(id))fail('execution-dependency-cycle');if(visited.has(id))return;
    visiting.add(id);for(const d of slices.find(s=>s.id===id).contract.depends_on)visit(d);visiting.delete(id);visited.add(id);}
  sliceIds.forEach(visit);
  const capabilities=require('./contract-runtime.js').validateCapabilityFactsV1(input.capability_facts,{allowEmpty:true,sliceIds:new Set(sliceIds),requirementIds:new Set(slices.flatMap(s=>s.contract.requirements))});
  const projection={schema_version:3,contract_binding:normalize(b),execution_policy:{requested_method:policy.requested_method,strict_required_slice_ids:required},replan_epoch:input.replan_epoch,
    capability_facts:capabilities,outcome_environment:environment,slices};
  const preimage={...projection,slices:slices.map(({checked,...rest})=>rest)};
  const authoritySha=hash('execution-plan-authority-v3\0'+canonicalJson(preimage));
  if(Object.hasOwn(input,'plan_authority_sha256')&&input.plan_authority_sha256!==authoritySha)fail('plan-authority-digest');
  return normalize({...projection,plan_authority_sha256:authoritySha});
}
function resolvePlanExecution(plan) {
  if(plan?.schema_version===1){if(plan.contract_binding?.mode==='execution-spec'||Object.hasOwn(plan,'execution_policy')||plan.slices?.some(s=>Object.hasOwn(s,'execution_basis')))fail('execution-legacy-injection');
    return{version:1,sliceBasis:null,strictRequiredSliceIds:[]};}
  if(plan?.schema_version===2){if(plan.contract_binding?.mode==='execution-spec'||Object.hasOwn(plan,'execution_policy')||plan.slices?.some(s=>Object.hasOwn(s,'execution_basis')))fail('execution-legacy-injection');
    const authority=require('./plan-runtime.js').compileImmutablePlanAuthorityV2(plan);
    return{version:2,sliceBasis:Object.fromEntries(authority.slices.filter(s=>s.slice_kind==='functional').map(s=>[s.id,'strict-tdd-v2'])),
      strictRequiredSliceIds:authority.slices.filter(s=>s.slice_kind==='functional').map(s=>s.id)};}
  const checked=validateExecutionPlanV3(plan);return{version:3,sliceBasis:Object.fromEntries(checked.slices.filter(s=>s.slice_kind==='functional').map(s=>[s.id,s.execution_basis])),
    strictRequiredSliceIds:checked.execution_policy.strict_required_slice_ids};
}
function compileImmutablePlanAuthority(plan) {
  if(plan?.schema_version===2){resolvePlanExecution(plan);return require('./plan-runtime.js').compileImmutablePlanAuthorityV2(plan);}
  const checked=validateExecutionPlanV3(plan),{plan_authority_sha256,...preimage}=checked;
  const authority={...preimage,slices:preimage.slices.map(({checked,...row})=>row)};
  return{...authority,plan_authority_sha256,authority};
}
function receiptStorePaths(state,plan) {
  const workDir=state?.work_dir;if(typeof workDir!=='string'||!workDir)fail('receipt-store-path');
  paths([workDir]);const execution=resolvePlanExecution(plan);
  return{internalDir:path.posix.join(workDir,execution.version===3?'runtime-receipts':'receipts'),publicDir:path.posix.join(workDir,'receipts')};
}
module.exports={BASIS,resolvePlanExecution,validateExecutionPlanV3,compileImmutablePlanAuthority,
  validateOutcomeCommandV1,validateOracleControlV1,validateOutcomeEnvironmentV1,validateExecutionSliceContract,receiptStorePaths};
