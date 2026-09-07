'use strict';
const crypto=require('node:crypto');
const {canonicalJson}=require('../../runtime/operation-journal.js');
const hash=(v)=>crypto.createHash('sha256').update(canonicalJson(v)).digest('hex');
function makeExecutionPlanFixture({basis='outcome-v1',strictRequired=[],slices,method='adaptive'}={}) {
  const contract={id:'SLICE-001',outcome:'README states the new heading',files:['README.md'],depends_on:[],
    integration_touchpoints:['documentation'],requirements:['REQ-001'],invariants:[],failure_modes:[],
    risk:{class:'low',score:1,triggers:[]},negative_tests:[],evidence_required:['GATE-outcome-verification'],
    rollback:{method:'restore previous content',verification:['GATE-plan-alignment']},review_policy:'single',
    scope_expansion_trigger:['public contract change']};
  const slice={id:contract.id,slice_kind:'functional',change_kind:'non-functional',execution_basis:basis,
    checked:false,scope_schema_version:1,files:contract.files,write_scope:{failing_test:[],production:contract.files,refactor:[]},
    verification_commands:[],oracle_controls:[{id:'ORACLE-001',requirement_ids:['REQ-001'],invariant_ids:[],failure_mode_ids:[],
      source_kind:'pre-existing-immutable',source_refs:[],check:{kind:'file-contains',path:'README.md',value:'New heading'},
      counterexample:{kind:'replace-target',path:'README.md',content:'Old heading'},command_id:null}],contract};
  if(basis==='strict-tdd-v2') {
    slice.change_kind='functional';slice.files=['src/a.js','tests/a.test.js'];slice.contract.files=slice.files;
    slice.write_scope={failing_test:['tests/a.test.js'],production:['src/a.js'],refactor:[]};
    slice.contract.evidence_required=['GATE-tdd-red','GATE-tdd-green'];
    delete slice.verification_commands;delete slice.oracle_controls;
    slice.verification_spec={schema_version:2,executable:{kind:'node-toolchain',name:'node',supported_patches_sha256:'1'.repeat(64)},
      args:['--test','--test-reporter=tap','--','tests/a.test.js'],cwd_role:'worktree',timeout_ms:30000,max_output_bytes:262144,
      environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},red_failure:{adapter:'node-test-tap',adapter_version:1,
        expected_class:'expected-failure',expected_signal:{kind:'assertion',operator:'strictEqual',test_identity:{test_file:'tests/a.test.js',
          test_name:'implements contract',start_line:1},expected_digest:'2'.repeat(64),actual_digest:null,message_pattern:'implements contract'}}};
    slice.verification_spec_sha256=hash(slice.verification_spec);
  }
  const actualSlices=structuredClone(slices||[slice]);
  const facts={schema_version:1,authority:'reviewed-plan',destructive:false,external_action:false,has_backward_compat:false,
    has_migration:false,host_dependent:false,source_requirement_ids:[],source_slice_ids:[]};
  facts.facts_sha256=crypto.createHash('sha256').update('capability-facts-v1\0'+canonicalJson(facts)).digest('hex');
  return {schema_version:3,contract_binding:{schema_version:1,mode:'execution-spec',created_by_version:'7.4.0',
    spec_contract:{spec_id:'SPEC-EXECUTION',spec_sha256:'a'.repeat(64),spec_approved_hash:'b'.repeat(64)},
    risk_profile_sha256:'c'.repeat(64),source_plan_sha256:'d'.repeat(64)},execution_policy:{requested_method:method,
    strict_required_slice_ids:[...strictRequired]},replan_epoch:null,capability_facts:facts,
    outcome_environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},slices:actualSlices};
}
module.exports={makeExecutionPlanFixture};
