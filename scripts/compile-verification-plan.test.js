'use strict';const test=require('node:test');const assert=require('node:assert/strict');const {parseArgs}=require('./compile-verification-plan.js');
test('compiler CLI accepts only authoritative state spec and plan inputs',()=>{
  assert.deepEqual(parseArgs(['--state-file','state.md','--spec','spec.md','--plan','plan.json']),
    {state_file:'state.md',spec:'spec.md',plan:'plan.json'});
  assert.throws(()=>parseArgs(['--input','facts.json']),/unknown flag|invalid flag/);
  assert.throws(()=>parseArgs(['--compatibility-mode','legacy-no-spec']),/unknown flag|invalid flag/);
});
