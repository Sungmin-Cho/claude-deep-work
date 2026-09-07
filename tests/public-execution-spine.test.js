'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),r=n=>require(path.join(repo,'runtime',n)),j=r('operation-journal.js');
const test=require('node:test');
const {createCompletedMixedFixture}=require('./helpers/completed-mixed-fixture.js');
test('public schema3 strict and outcome children produce authenticated mixed M3 without granting global Test',createCompletedMixedFixture);

test('release Spec coverage keeps explicit no-obligation observations and rejects incomplete N/A claims',()=>{
 const gate=r('release-gate-runtime.js');
 const facts={spec_sha256:'a'.repeat(64),spec_approved_hash:'b'.repeat(64),pass:true,
  requirement_coverage:{total:1,covered:1,uncovered_ids:[],ratio:1},
  failure_matrix_coverage:{total:0,covered:0,uncovered_ids:[],ratio:null,not_applicable_reason:'risk class has no failure matrix obligation'}};
 assert.deepEqual(gate.computeBlockingCodes('spec-gate-v1',facts),[]);
 for(const mutation of [{total:1},{covered:1},{ratio:1},{not_applicable_reason:''},{uncovered_ids:['FM-001']}]){
  const broken=structuredClone(facts);Object.assign(broken.failure_matrix_coverage,mutation);assert.throws(()=>gate.computeBlockingCodes('spec-gate-v1',broken),/release-gate-facts/);
 }
 const legacy=structuredClone(facts);legacy.failure_matrix_coverage={total:0,covered:0,uncovered_ids:[],ratio:1};assert.deepEqual(gate.computeBlockingCodes('spec-gate-v1',legacy),[]);
});
