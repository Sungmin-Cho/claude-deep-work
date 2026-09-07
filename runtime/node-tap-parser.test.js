'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const bootstrap=require('./bootstrap-runtime.js');
const root=path.resolve(__dirname,'..'),testPath='runtime/node-tap-parser.test.js';
const patches=['22.23.2','24.20.0','26.0.0','26.8.1'];
function api(){
  assert.ok(fs.existsSync(path.join(__dirname,'node-tap-policy.js')),'portable policy registry exists');
  assert.ok(fs.existsSync(path.join(__dirname,'node-tap-parser.js')),'portable full-document parser exists');
  return {...require('./node-tap-policy.js'),...require('./node-tap-parser.js')};
}
function bytes(patch,kind){return fs.readFileSync(path.join(__dirname,'fixtures','node-tap-portable',`${patch}-${kind}.stdout`),'utf8').replaceAll('__TEST_FILE__',path.join(root,testPath));}
function options(a,patch,kind='pass-plus-fail') {return {policy:a.resolveNodeTapPolicy({policySha256:a.CURRENT_NODE_TAP_POLICY_SHA256,nodeVersion:patch}),nodeVersion:patch,root,testPath,expectedOutcome:kind==='green'?'must-pass':'must-fail',expectedSignal:{kind:'assertion',operator:'strictEqual',test_identity:{test_file:testPath,test_name:'target',start_line:kind==='suite-pass-fail'?2:3},expected_digest:bootstrap.tapValueDigest(2),actual_digest:bootstrap.tapValueDigest(1),message_pattern:'Expected values to be strictly equal'}};}
test('portable registry preserves legacy bytes and only admits observed exact patches',()=>{
 const a=api();assert.equal(a.LEGACY_NODE_TAP_POLICY_SHA256,'2713a843a7b75414a28deee6d658c09e7356294514ea8ff5a3637d9e280afba5');assert.equal(a.LEGACY_NODE_TAP_POLICY_SHA256,bootstrap.BOOTSTRAP_SUPPORTED_NODE_PATCHES_SHA256);
 assert.equal(a.LEGACY_NODE_TAP_POLICY_SHA256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/node-tap-26.0.0.json'))).digest('hex'));
 for(const [name,digest] of Object.entries(a.resolveNodeTapPolicy({policySha256:a.CURRENT_NODE_TAP_POLICY_SHA256,nodeVersion:'22.23.2'}).grammar.conformance_fixtures))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures','node-tap-portable',name))).digest('hex'),digest);
 for(const patch of patches)assert.equal(a.resolveNodeTapPolicy({policySha256:a.CURRENT_NODE_TAP_POLICY_SHA256,nodeVersion:patch}).supported,true);
 assert.deepEqual(a.resolveNodeTapPolicy({policySha256:'0'.repeat(64),nodeVersion:'26.0.0'}),{supported:false,reason:'unknown-policy'});
 assert.equal(a.resolveNodeTapPolicy({policySha256:a.CURRENT_NODE_TAP_POLICY_SHA256,nodeVersion:'26.9.0'}).reason,'unsupported-node-version');
 assert.equal(a.resolveNodeTapPolicy({policySha256:a.LEGACY_NODE_TAP_POLICY_SHA256,nodeVersion:'22.23.2'}).reason,'unsupported-node-version');
});
for(const patch of patches){
 for(const kind of ['pass-plus-fail','suite-pass-fail','green'])test(`${patch} full ${kind} reconciles siblings, plans and selected identity`,()=>{
  const a=api(),v=a.parseNodeTapDocument(bytes(patch,kind),options(a,patch,kind));
  assert.equal(v.counts.tests,2);assert.equal(v.counts.failures,kind==='green'?0:1);
  assert.equal(v.selectedEvent?.test_name??v.selectedTest.test_name,'target');
 });
 test(`${patch} rejects extra failures, malformed counts, directives, wrong signals and truncated output`,()=>{
  const a=api(),opts=options(a,patch),tap=bytes(patch,'pass-plus-fail');
  for(const bad of [bytes(patch,'extra-failure'),tap.replace('# tests 2','# tests 3'),tap.replace('ok 1 - existing','ok 3 - existing'),tap.replace('ok 1 - existing','ok 1 - existing # SKIP'),tap.replace('# skipped 0','# skipped 1'),tap.replace('  actual: 1','  actual: 9'),tap.slice(0,-1),tap+'# extra\n',tap.replace('  operator:', '  alien:')])assert.throws(()=>a.parseNodeTapDocument(bad,opts));
  assert.throws(()=>a.parseNodeTapDocument(tap,{...opts,expectedSignal:{...opts.expectedSignal,test_identity:{...opts.expectedSignal.test_identity,test_name:'wrong'}}}));
  assert.throws(()=>a.parseNodeTapDocument(bytes(patch,'green').replaceAll('target','other'),options(a,patch,'green')));
  assert.throws(()=>a.parseNodeTapDocument('unstructured pass\n',options(a,patch,'green')));
 });
}
test('portable classifier rejects zero-exit garbage and accepts only complete intended GREEN',()=>{
 const a=api(),opts=options(a,'22.23.2','green');
 function classify(stdout){return bootstrap.classifyVerificationObservation({processResult:{exitCode:0,signal:null,timedOut:false,outputOverflow:false,spawnError:null},changedPaths:[],stdout:Buffer.from(stdout),stderr:Buffer.alloc(0),root,testPath,nodePatch:'22.23.2',expectedSignal:opts.expectedSignal,policySha256:a.CURRENT_NODE_TAP_POLICY_SHA256});}
 assert.equal(classify('garbage\n').observed_class,'invalid-output');
 assert.equal(classify(bytes('22.23.2','green')).observed_class,'unexpected-pass');
 assert.equal(classify(bytes('22.23.2','green').replace('# skipped 0','# skipped 1')).observed_class,'invalid-output');
 assert.equal(typeof bootstrap.validateVerificationResultForSpec,'function');
});
test('portable parser bounds all input and rejects forged policies, duplicate selected names and suite aggregates',()=>{
 const a=api(),patch='22.23.2',opts=options(a,patch),tap=bytes(patch,'pass-plus-fail');
 assert.throws(()=>a.parseNodeTapDocument(Buffer.from([255]),opts));
 assert.throws(()=>a.parseNodeTapDocument('TAP version 13\n'+'x'.repeat(1048576)+'\n',opts));
 assert.throws(()=>a.parseNodeTapDocument(tap,{...opts,policy:{...opts.policy,grammar:{...opts.policy.grammar}}}));
 assert.throws(()=>a.parseNodeTapDocument(tap.replaceAll('existing','target'),opts));
 for(const directive of ['TODO','SKIP'])assert.throws(()=>a.parseNodeTapDocument(tap.replace('not ok 2 - target',`not ok 2 - target # ${directive}`),opts));
 for(const count of ['cancelled','todo'])assert.throws(()=>a.parseNodeTapDocument(tap.replace(`# ${count} 0`,`# ${count} 1`),opts));
 const nested=bytes(patch,'suite-pass-fail');
 for(const bad of [nested.replace('    1..2','    1..1'),nested.replace("error: '1 subtest failed'","error: '2 subtests failed'"),nested.replace('not ok 1 - group','ok 1 - group')])assert.throws(()=>a.parseNodeTapDocument(bad,options(a,patch,'suite-pass-fail')));
 assert.throws(()=>a.parseNodeTapDocument(bytes(patch,'deep-assert'),opts),'structured assertion values are explicitly unsupported');
});
test('legacy diagnostic golden is stable with an explicit recorded Node 26 version on any reader',()=>{
 let tap=bytes('26.0.0','pass-plus-fail');
 tap='TAP version 13\n'+tap.slice(tap.indexOf('# Subtest: target')).replace('not ok 2 - target','not ok 1 - target').replace('1..2\n','1..1\n').replace('# tests 2','# tests 1').replace('# pass 1','# pass 0');
 const event=bootstrap.parseNodeTapFailure(tap,{root,testPath,nodePatch:'26.0.0'});
 const digest=crypto.createHash('sha256').update('diagnostic-event-v1\0').update(require('./operation-journal.js').canonicalJson(event)).digest('hex');
 assert.equal(digest,'498a8f1bc48de7aa391b08e54323a08c725dbbc612c99688d059f027d2b179b8');
 assert.throws(()=>bootstrap.parseNodeTapFailure(tap,{root,testPath,nodePatch:'22.23.2'}));
});
