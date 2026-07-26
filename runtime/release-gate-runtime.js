'use strict';

const crypto=require('node:crypto');
const journal=require('./operation-journal.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
const SEMVER=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);
  error.code=code;throw error;}
function canonical(value){return journal.canonicalJson(value);}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonical(Object.keys(value).sort())===canonical([...keys].sort());}
function semanticDigest(domain,value){
  return crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from(`${domain}\0`),Buffer.from(canonical(value))])).digest('hex');
}
function sortedUnique(values,validator=()=>true){
  return Array.isArray(values)&&values.every(validator)&&
    new Set(values).size===values.length&&canonical(values)===canonical([...values]
      .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));
}
function portable(value){return typeof value==='string'&&value.length>0&&
  !value.startsWith('/')&&!value.includes('\\')&&!value.split('/').includes('..');}

const RELEASE_GATE_CATALOG=Object.freeze({
  carrier:Object.freeze({argv:Object.freeze(['node','--test',
    'runtime/contract-runtime.test.js','runtime/plan-runtime.test.js',
    'runtime/verification-policy-runtime.test.js','scripts/deep-work-runtime.test.js']),
  gate_ids:Object.freeze(['GATE-backward-compat','GATE-migration-dry-run'])}),
  tdd:Object.freeze({argv:Object.freeze(['node','--test',
    'runtime/verification-runtime.test.js','runtime/phase-runtime.test.js',
    'runtime/slice-runtime.test.js','hooks/scripts/verify-receipt-core.test.js']),
  gate_ids:Object.freeze(['GATE-negative-tests','GATE-permission-negative',
    'GATE-receipt-completeness','GATE-targeted-tests','GATE-tdd-green',
    'GATE-tdd-red'])}),
  replan:Object.freeze({argv:Object.freeze(['node','--test',
    'runtime/phase-runtime.test.js','runtime/slice-runtime.test.js',
    'runtime/evidence-runtime.test.js','runtime/report-runtime.test.js',
    'runtime/transaction-runtime.test.js','scripts/deep-work-runtime.test.js']),
  gate_ids:Object.freeze(['GATE-concurrency-stress','GATE-fault-injection',
    'GATE-idempotency-proof','GATE-recovery','GATE-timeout-retry-partial'])}),
  integration:Object.freeze({argv:Object.freeze(['node','--test',
    'tests/v6.13-spec-contract-integration.test.js',
    'tests/v6.13-spec-evidence-integration.test.js']),
  gate_ids:Object.freeze(['GATE-e2e-entrypoint','GATE-host-smoke',
    'GATE-relevant-integration'])}),
  full:Object.freeze({argv:Object.freeze(['npm','test']),
    gate_ids:Object.freeze(['GATE-full-relevant-suite'])}),
  pack:Object.freeze({argv:Object.freeze(['npm','pack','--dry-run','--json']),
    gate_ids:Object.freeze(['GATE-fresh-install-build'])}),
});

const DETERMINISTIC_GATE_MAPPING=Object.freeze({
  'spec-gate-v1':Object.freeze(['GATE-failure-matrix','GATE-plan-alignment',
    'GATE-requirement-coverage','GATE-spec-contract']),
  'changed-js-syntax-v1':Object.freeze(['GATE-impacted-lint-typecheck']),
  'release-integrity-v1':Object.freeze(['GATE-clean-build']),
  'single-review-v1':Object.freeze(['GATE-single-review']),
  'mutation-critical-path-v1':Object.freeze(['GATE-mutation-critical-path']),
  'rollback-rehearsal-v1':Object.freeze(['GATE-rollback-rehearsal']),
  'governed-health-v1':Object.freeze(['GATE-health-required']),
  'governed-evidence-v1':Object.freeze(['GATE-evidence-completeness']),
  'evidence-redaction-v1':Object.freeze(['GATE-redaction']),
  'dual-final-review-v1':Object.freeze(['GATE-dual-final-review']),
  'human-ack-v1':Object.freeze(['GATE-human-ack']),
});

const CHECKER_INPUT_CATALOG=Object.freeze({
  'spec-gate-v1':Object.freeze(['spec-approval','spec-contract','spec-gate-result']),
  'changed-js-syntax-v1':Object.freeze(['git-diff-manifest','plan-authority']),
  'release-integrity-v1':Object.freeze(['claude-manifest','codex-manifest',
    'docs-rule','external-operation-index','git-snapshot','package-manifest',
    'runtime-version']),
  'single-review-v1':Object.freeze(['finding-ref','review-execution']),
  'mutation-critical-path-v1':Object.freeze(['mutation-round-result']),
  'rollback-rehearsal-v1':Object.freeze(['rollback-rehearsal']),
  'governed-health-v1':Object.freeze(['health-report']),
  'governed-evidence-v1':Object.freeze(['evidence-package','verification-plan']),
  'evidence-redaction-v1':Object.freeze(['evidence-package','redaction-policy']),
  'dual-final-review-v1':Object.freeze(['executability-finding-ref',
    'executability-review-execution','semantic-finding-ref',
    'semantic-review-execution']),
  'human-ack-v1':Object.freeze(['human-ack']),
});

function validateCoverage(row){
  if(!exactKeys(row,['total','covered','uncovered_ids','ratio'])||
      !Number.isSafeInteger(row.total)||row.total<0||
      !Number.isSafeInteger(row.covered)||row.covered<0||row.covered>row.total||
      !sortedUnique(row.uncovered_ids,(value)=>typeof value==='string'&&value.length>0)||
      row.uncovered_ids.length!==row.total-row.covered||
      row.ratio!==(row.total===0?1:row.covered/row.total))
    fail('release-gate-facts');
  return row;
}
function locator(value){return exactKeys(value,
  ['kind','path','sha256','producer_operation_id'])&&
  typeof value.kind==='string'&&portable(value.path)&&DIGEST.test(value.sha256||'')&&
  OPERATION.test(value.producer_operation_id||'');}
function locatorSortKey(row){return `${row.kind}\0${row.path}\0${row.sha256}\0${
  row.producer_operation_id}`;}
function validateCheckerInputRefs(checkerId,refs){
  const expected=CHECKER_INPUT_CATALOG[checkerId];
  if(!expected||!Array.isArray(refs)||refs.some((row)=>!locator(row))||
      canonical(refs.map(locatorSortKey))!==canonical(refs.map(locatorSortKey)
        .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))))||
      new Set(refs.map(locatorSortKey)).size!==refs.length)
    fail('checker-input-catalog');
  const kinds=refs.map((row)=>row.kind);
  if(checkerId==='mutation-critical-path-v1'){
    if(kinds.length===0||kinds.some((kind)=>kind!=='mutation-round-result'))
      fail('checker-input-catalog');
  }else if(canonical(kinds)!==canonical(expected))fail('checker-input-catalog');
  return structuredClone(refs);
}
function commonLocator(value){return locator(value);}
function validateFacts(checkerId,facts){
  const ids=(value)=>sortedUnique(value,(row)=>typeof row==='string'&&row.length>0);
  switch(checkerId){
  case 'spec-gate-v1':
    if(!exactKeys(facts,['spec_sha256','spec_approved_hash',
      'requirement_coverage','failure_matrix_coverage','pass'])||
      !DIGEST.test(facts.spec_sha256||'')||!DIGEST.test(facts.spec_approved_hash||'')||
      typeof facts.pass!=='boolean')fail('release-gate-facts');
    validateCoverage(facts.requirement_coverage);
    validateCoverage(facts.failure_matrix_coverage);break;
  case 'changed-js-syntax-v1':
    if(!exactKeys(facts,['changed_paths','checked_paths','failure_paths'])||
      !ids(facts.changed_paths)||!ids(facts.checked_paths)||!ids(facts.failure_paths)||
      facts.failure_paths.some((value)=>!facts.checked_paths.includes(value)))
      fail('release-gate-facts');break;
  case 'release-integrity-v1':
    if(!exactKeys(facts,['manifest_versions','package_version','runtime_version',
      'docs_rule_sha256','v7_surface_violations','git_state',
      'external_effect_operation_ids'])||
      !exactKeys(facts.manifest_versions,['claude','codex'])||
      ![facts.manifest_versions.claude,facts.manifest_versions.codex,
        facts.package_version,facts.runtime_version].every((value)=>SEMVER.test(value||''))||
      !DIGEST.test(facts.docs_rule_sha256||'')||!ids(facts.v7_surface_violations)||
      !exactKeys(facts.git_state,['head','branch','dirty','changed_paths'])||
      !/^[0-9a-f]{40}$/.test(facts.git_state.head||'')||
      typeof facts.git_state.branch!=='string'||!facts.git_state.branch||
      typeof facts.git_state.dirty!=='boolean'||!ids(facts.git_state.changed_paths)||
      !sortedUnique(facts.external_effect_operation_ids,(value)=>OPERATION.test(value)))
      fail('release-gate-facts');break;
  case 'single-review-v1':
    if(!exactKeys(facts,['point','finding_ref_sha256','review_execution_sha256',
      'blocking_ids'])||typeof facts.point!=='string'||!facts.point||
      !DIGEST.test(facts.finding_ref_sha256||'')||
      !DIGEST.test(facts.review_execution_sha256||'')||!ids(facts.blocking_ids))
      fail('release-gate-facts');break;
  case 'mutation-critical-path-v1':
    if(!exactKeys(facts,['round_result_refs','survived_count'])||
      !Array.isArray(facts.round_result_refs)||facts.round_result_refs.length===0||
      facts.round_result_refs.some((row)=>!commonLocator(row))||
      !Number.isSafeInteger(facts.survived_count)||facts.survived_count<0)
      fail('release-gate-facts');break;
  case 'rollback-rehearsal-v1':
    if(!exactKeys(facts,['rehearsal_result_ref','passed'])||
      !commonLocator(facts.rehearsal_result_ref)||typeof facts.passed!=='boolean')
      fail('release-gate-facts');break;
  case 'governed-health-v1':
    if(!exactKeys(facts,['health_report_sha256','required_missing','failed'])||
      !DIGEST.test(facts.health_report_sha256||'')||
      !ids(facts.required_missing)||!ids(facts.failed))fail('release-gate-facts');break;
  case 'governed-evidence-v1': {
    if(!exactKeys(facts,['package_sha256','required_ids','completed_ids',
      'missing_ids','invalidated_ids'])||!DIGEST.test(facts.package_sha256||'')||
      !ids(facts.required_ids)||!ids(facts.completed_ids)||!ids(facts.missing_ids)||
      !ids(facts.invalidated_ids))fail('release-gate-facts');
    const required=new Set(facts.required_ids),sets=[facts.completed_ids,
      facts.missing_ids,facts.invalidated_ids];
    if(sets.some((rows)=>rows.some((id)=>!required.has(id)))||
        new Set(sets.flat()).size!==sets.flat().length)fail('release-gate-facts');break;}
  case 'evidence-redaction-v1':
    if(!exactKeys(facts,['package_sha256','passed','violation_ids'])||
      !DIGEST.test(facts.package_sha256||'')||typeof facts.passed!=='boolean'||
      !ids(facts.violation_ids))fail('release-gate-facts');break;
  case 'dual-final-review-v1':
    if(!exactKeys(facts,['semantic_finding_ref_sha256',
      'executability_finding_ref_sha256','blocking_ids'])||
      !DIGEST.test(facts.semantic_finding_ref_sha256||'')||
      !DIGEST.test(facts.executability_finding_ref_sha256||'')||
      facts.semantic_finding_ref_sha256===facts.executability_finding_ref_sha256||
      !ids(facts.blocking_ids))fail('release-gate-facts');break;
  case 'human-ack-v1':
    if(!exactKeys(facts,['point','actor','at','ack_sha256'])||
      typeof facts.point!=='string'||!facts.point||typeof facts.actor!=='string'||
      !facts.actor||typeof facts.at!=='string'||!DIGEST.test(facts.ack_sha256||'')||
      Number.isNaN(Date.parse(facts.at))||new Date(facts.at).toISOString()!==facts.at)
      fail('release-gate-facts');break;
  default: fail('release-gate-checker');
  }
  return facts;
}
function computeBlockingCodes(checkerId,facts){
  validateFacts(checkerId,facts);const blockers=[];
  switch(checkerId){
  case 'spec-gate-v1':
    if(!facts.pass)blockers.push('spec-invalid');
    if(facts.requirement_coverage.ratio!==1)blockers.push('required-uncovered');
    if(facts.failure_matrix_coverage.ratio!==1)blockers.push('failure-uncovered');break;
  case 'changed-js-syntax-v1': {
    const expected=facts.changed_paths.filter((value)=>
      /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(value));
    if(canonical(expected)!==canonical(facts.checked_paths))
      blockers.push('changed-path-mismatch');
    if(facts.failure_paths.length)blockers.push('syntax-failed');break;}
  case 'release-integrity-v1': {
    const versions=[facts.manifest_versions.claude,facts.manifest_versions.codex,
      facts.package_version,facts.runtime_version];
    if(new Set(versions).size!==1)blockers.push('version-mismatch');
    if(facts.v7_surface_violations.length)blockers.push('v7-surface-present');
    if(!facts.git_state.head||!facts.git_state.branch)blockers.push('git-state-invalid');
    if(facts.external_effect_operation_ids.length)blockers.push('external-effect-seen');break;}
  case 'single-review-v1':
    if(facts.blocking_ids.length)blockers.push('review-blocking');break;
  case 'mutation-critical-path-v1':
    if(facts.survived_count>0)blockers.push('mutation-survived');break;
  case 'rollback-rehearsal-v1':
    if(!facts.passed)blockers.push('rollback-failed');break;
  case 'governed-health-v1':
    if(facts.required_missing.length)blockers.push('health-missing');
    if(facts.failed.length)blockers.push('health-failed');break;
  case 'governed-evidence-v1':
    if(facts.missing_ids.length)blockers.push('evidence-missing');
    if(facts.invalidated_ids.length)blockers.push('evidence-invalidated');break;
  case 'evidence-redaction-v1':
    if(!facts.passed||facts.violation_ids.length)blockers.push('redaction-failed');break;
  case 'dual-final-review-v1':
    if(facts.blocking_ids.length)blockers.push('review-blocking');break;
  case 'human-ack-v1': break;
  }
  return blockers.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
}
function buildGateFactArtifact(checkerId,facts){
  validateFacts(checkerId,facts);
  return{schema_version:1,checker_id:checkerId,facts:structuredClone(facts),
    facts_sha256:semanticDigest(checkerId,facts)};
}
function validateGateFactArtifact(value){
  if(!exactKeys(value,['schema_version','checker_id','facts','facts_sha256'])||
      value.schema_version!==1||!Object.hasOwn(DETERMINISTIC_GATE_MAPPING,
        value.checker_id)||semanticDigest(value.checker_id,
        validateFacts(value.checker_id,value.facts))!==value.facts_sha256)
    fail('gate-fact-artifact');
  return{artifact:structuredClone(value),
    facts_artifact_sha256:journal.sha256(canonical(value)),
    blocking_codes:computeBlockingCodes(value.checker_id,value.facts)};
}
function argvSha256(argv){
  if(!Array.isArray(argv)||argv.some((value)=>typeof value!=='string'||/[\0\r\n]/.test(value)))
    fail('gate-result-argv');
  return journal.sha256(canonical(argv));
}
function sortInputRefs(refs){
  if(!Array.isArray(refs)||refs.some((row)=>!locator(row))||
      new Set(refs.map(locatorSortKey)).size!==refs.length)
    fail('gate-result-input');
  const sorted=[...refs].sort((a,b)=>Buffer.compare(Buffer.from(locatorSortKey(a)),
    Buffer.from(locatorSortKey(b))));
  if(canonical(sorted)!==canonical(refs))fail('gate-result-input');
  return structuredClone(refs);
}
function resultDigest(value){const copy=structuredClone(value);delete copy.result_sha256;
  return journal.sha256(canonical(copy));}
function buildDeterministicGateResult({sessionId,planAuthoritySha256,
  verificationPlanSha256,checkerId,gateIds,factsRef,artifact}={}){
  const checked=validateGateFactArtifact(artifact),blocking=checked.blocking_codes;
  if(!locator(factsRef)||factsRef.kind!=='gate-fact'||
      factsRef.sha256!==checked.facts_artifact_sha256||
      !Object.hasOwn(DETERMINISTIC_GATE_MAPPING,checkerId)||
      canonical(gateIds)!==canonical(DETERMINISTIC_GATE_MAPPING[checkerId]))
    fail('gate-result');
  const result={schema_version:1,session_id:sessionId,
    plan_authority_sha256:planAuthoritySha256,
    verification_plan_sha256:verificationPlanSha256,checker_id:checkerId,
    argv_sha256:argvSha256([]),gate_ids:[...gateIds],input_refs:[factsRef],
    status:blocking.length?'failed':'passed',result:{kind:'deterministic',
      facts_ref:factsRef,facts_sha256:artifact.facts_sha256,
      facts_artifact_sha256:checked.facts_artifact_sha256,
      passed:blocking.length===0,blocking_codes:blocking},result_sha256:null};
  result.result_sha256=resultDigest(result);return validateGateResult(result);
}
function buildCommandGateResult({sessionId,planAuthoritySha256,verificationPlanSha256,
  commandId,inputRefs,releaseEnvironmentSha256,processResult}={}){
  const catalog=RELEASE_GATE_CATALOG[commandId];
  if(!catalog||!DIGEST.test(releaseEnvironmentSha256||'')||
      !exactKeys(processResult,['exit_code','signal','timed_out','output_overflow',
        'stdout_sha256','stderr_sha256'])||
      !(processResult.exit_code===null||Number.isSafeInteger(processResult.exit_code))||
      !(processResult.signal===null||typeof processResult.signal==='string')||
      typeof processResult.timed_out!=='boolean'||
      typeof processResult.output_overflow!=='boolean'||
      !DIGEST.test(processResult.stdout_sha256||'')||
      !DIGEST.test(processResult.stderr_sha256||''))fail('gate-result');
  const passed=processResult.exit_code===0&&processResult.signal===null&&
    !processResult.timed_out&&!processResult.output_overflow;
  const result={schema_version:1,session_id:sessionId,
    plan_authority_sha256:planAuthoritySha256,
    verification_plan_sha256:verificationPlanSha256,checker_id:'command-v1',
    argv_sha256:argvSha256(catalog.argv),gate_ids:[...catalog.gate_ids],
    input_refs:sortInputRefs(inputRefs),status:passed?'passed':'failed',
    result:{kind:'command',release_environment_sha256:releaseEnvironmentSha256,
      ...structuredClone(processResult)},result_sha256:null};
  result.result_sha256=resultDigest(result);return validateGateResult(result);
}
function validateGateResult(value){
  const keys=['schema_version','session_id','plan_authority_sha256',
    'verification_plan_sha256','checker_id','argv_sha256','gate_ids',
    'input_refs','status','result','result_sha256'];
  if(!exactKeys(value,keys)||value.schema_version!==1||
      !/^s-[0-9a-f]{8}$/.test(value.session_id||'')||
      !DIGEST.test(value.plan_authority_sha256||'')||
      !DIGEST.test(value.verification_plan_sha256||'')||
      !DIGEST.test(value.argv_sha256||'')||
      !['passed','failed','unknown'].includes(value.status)||
      !DIGEST.test(value.result_sha256||'')||
      !sortedUnique(value.gate_ids,(id)=>/^GATE-[A-Za-z0-9-]+$/.test(id))||
      resultDigest(value)!==value.result_sha256)
    fail('gate-result');
  sortInputRefs(value.input_refs);
  if(value.checker_id==='command-v1'){
    const command=Object.values(RELEASE_GATE_CATALOG).find((row)=>
      row.argv&&argvSha256(row.argv)===value.argv_sha256);
    if(!command||canonical(command.gate_ids)!==canonical(value.gate_ids)||
        !exactKeys(value.result,['kind','release_environment_sha256','exit_code',
          'signal','timed_out','output_overflow','stdout_sha256','stderr_sha256'])||
        value.result.kind!=='command'||
        !DIGEST.test(value.result.release_environment_sha256||'')||
        !(value.result.exit_code===null||Number.isSafeInteger(value.result.exit_code))||
        !(value.result.signal===null||typeof value.result.signal==='string')||
        typeof value.result.timed_out!=='boolean'||
        typeof value.result.output_overflow!=='boolean'||
        !DIGEST.test(value.result.stdout_sha256||'')||
        !DIGEST.test(value.result.stderr_sha256||''))fail('gate-result');
    const passed=value.result.exit_code===0&&value.result.signal===null&&
      !value.result.timed_out&&!value.result.output_overflow;
    if(value.status!==(passed?'passed':'failed'))fail('gate-result');
  }else{
    if(!Object.hasOwn(DETERMINISTIC_GATE_MAPPING,value.checker_id)||
        canonical(value.gate_ids)!==canonical(
          DETERMINISTIC_GATE_MAPPING[value.checker_id])||
        value.argv_sha256!==argvSha256([])||
        value.input_refs.length!==1||value.input_refs[0].kind!=='gate-fact'||
        !exactKeys(value.result,['kind','facts_ref','facts_sha256',
          'facts_artifact_sha256','passed','blocking_codes'])||
        value.result.kind!=='deterministic'||
        canonical(value.result.facts_ref)!==canonical(value.input_refs[0])||
        !DIGEST.test(value.result.facts_sha256||'')||
        value.result.facts_artifact_sha256!==value.input_refs[0].sha256||
        typeof value.result.passed!=='boolean'||
        !sortedUnique(value.result.blocking_codes,
          (code)=>typeof code==='string'&&code.length>0)||
        value.status!==(value.result.passed?'passed':'failed')||
        value.result.passed!==(value.result.blocking_codes.length===0))
      fail('gate-result');
  }
  return structuredClone(value);
}
function validateGateResultRef(value){
  if(!exactKeys(value,['gate_id','operation_id','result_path','result_sha256',
      'ledger_result_sha256','checker_id','argv_sha256'])||
      !/^GATE-[A-Za-z0-9-]+$/.test(value.gate_id||'')||
      !OPERATION.test(value.operation_id||'')||!portable(value.result_path)||
      !DIGEST.test(value.result_sha256||'')||
      !DIGEST.test(value.ledger_result_sha256||'')||
      !(value.checker_id==='command-v1'||
        Object.hasOwn(DETERMINISTIC_GATE_MAPPING,value.checker_id))||
      !DIGEST.test(value.argv_sha256||''))
    fail('gate-result-ref');
  return structuredClone(value);
}

module.exports={RELEASE_GATE_CATALOG,DETERMINISTIC_GATE_MAPPING,
  CHECKER_INPUT_CATALOG,validateCheckerInputRefs,computeBlockingCodes,
  buildGateFactArtifact,validateGateFactArtifact,argvSha256,
  buildDeterministicGateResult,buildCommandGateResult,validateGateResult,
  validateGateResultRef,semanticDigest};
