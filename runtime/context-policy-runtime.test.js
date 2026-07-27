'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {compileContextPolicy,validateContextPolicy,decideTaskCreation}=
  require('./context-policy-runtime.js');

test('Codex same-goal policy is compaction-first and never creates tasks automatically',()=>{
  const policy=compileContextPolicy({runtime:'codex',checkpoint:{
    last_spec_hash:'a'.repeat(64),last_plan_hash:'b'.repeat(64),
    open_findings:['FIND-002','FIND-001'],active_slice:'SLICE-003'}});
  assert.equal(policy.same_goal_strategy,'native-compaction');
  assert.equal(policy.task_creation.automatic,false);
  assert.deepEqual(policy.task_creation.allowed_reasons,[
    'alternative-experiment','independent-review','parallel-slice','recovery',
    'security-isolation']);
  assert.equal(validateContextPolicy(policy).policy_sha256,
    policy.policy_sha256);
  assert.deepEqual(decideTaskCreation(policy,{requested:false,
    reason:'context-pressure'}),{allowed:false,reason:'automatic-disabled'});
});

test('task creation requires one explicit closed reason',()=>{
  const policy=compileContextPolicy({runtime:'codex'});
  assert.deepEqual(decideTaskCreation(policy,{requested:true,
    reason:'independent-review'}),{allowed:true,reason:'independent-review'});
  assert.deepEqual(decideTaskCreation(policy,{requested:true,
    reason:'context-pressure'}),{allowed:false,reason:'reason-not-allowed'});
  assert.throws(()=>validateContextPolicy({...policy,
    same_goal_strategy:'new-task'}),/context-policy/);
});

test('Claude and unknown runtimes never inherit Codex task semantics',()=>{
  const claude=compileContextPolicy({runtime:'claude'});
  const unknown=compileContextPolicy({runtime:'unknown'});
  assert.equal(claude.same_goal_strategy,'host-continuation');
  assert.equal(unknown.same_goal_strategy,'same-session');
  assert.notEqual(claude.same_goal_strategy,'native-compaction');
  assert.notEqual(unknown.same_goal_strategy,'native-compaction');
});
