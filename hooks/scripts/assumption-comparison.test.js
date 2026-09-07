'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSignals,calculateConfidence,autoAdjust}=require('./assumption-engine.js');
const signal='test_pass_rate_with_guard > test_pass_rate_without';
const assumption={id:'phase_guard_blocks_edits',minimum_sessions_for_evaluation:3,
  evidence_signals:{supporting:[signal],weakening:[]}};
function pair(){return {signal,baseline:{session_id:'baseline',model:'gpt-6-astra',
  task_sha256:'a'.repeat(64),environment_sha256:'b'.repeat(64),metric_version:2,
  metric:'test_pass_rate',variant:'without-guard',value:60,evidence_sha256:'c'.repeat(64)},
  treatment:{session_id:'current',model:'gpt-6-astra',task_sha256:'a'.repeat(64),
    environment_sha256:'b'.repeat(64),metric_version:2,metric:'test_pass_rate',
    variant:'with-guard',value:80,evidence_sha256:'d'.repeat(64)}};}
test('successful guarded session alone is neutral for a with/without claim',()=>{
  const result=evaluateSignals(assumption,{slices_total:10,slices_passed_first_try:10});
  assert.equal(result.supporting,0);assert.equal(result.neutral,1);
});
test('comparative signal needs matched model/task/environment/metric and distinct evidence',()=>{
  assert.equal(evaluateSignals(assumption,{comparisons:[pair()]}).supporting,1);
  for(const [key,value] of [['model','gpt-5.6-sol'],['task_sha256','e'.repeat(64)],
    ['environment_sha256','e'.repeat(64)],['metric_version',1],['metric','quality_score'],
    ['session_id','baseline'],['evidence_sha256','c'.repeat(64)],['value','80']]){
    const row=pair();row.treatment[key]=value;
    assert.equal(evaluateSignals(assumption,{comparisons:[row]}).supporting,0,key);
  }
});
test('unmapped evidence is visible and correlated signals count as one session unit',()=>{
  const unknown=evaluateSignals({evidence_signals:{supporting:['missing-signal']}},{});
  assert.equal(unknown.details[0].reason,'unmapped-signal');
  const a={minimum_sessions_for_evaluation:1,evidence_signals:{supporting:
    ['cross_model_found_unique_issues > 0','plan_revision_after_cross_review'],weakening:[]}};
  const result=calculateConfidence(a,[{session_id:'one',cross_model_unique_findings:5}]);
  assert.equal(result.overall.supporting,1);
});
test('ordinary history never automatically changes explicit method or reviewer model',()=>{
  const sessions=Array.from({length:20},(_,i)=>({session_id:`s-${i}`,test_retry_count:0,
    bugs_caught_in_red_phase:0,tdd_overrides:5,slices_total:5}));
  assert.deepEqual(autoAdjust(sessions,{tdd_mode:'strict',evaluator_model:'gpt-6-astra'}, {registryPath:require('node:path').resolve(__dirname,'../../assumptions.json')}).adjustments,[]);
});

test('repeating one measured pair never creates additional independent samples',()=>{
  const sessions=Array.from({length:20},(_,i)=>({session_id:`copy-${i}`,comparisons:[pair()]}));
  const result=calculateConfidence(assumption,sessions);
  assert.equal(result.overall.total,1);assert.equal(result.insufficient,true);
});
