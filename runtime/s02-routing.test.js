'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const routing=require('./model-routing-runtime.js'),review=require('./review-policy-runtime.js');
const {parseFlags,parseDeepWorkFlags}=require('./flags-runtime.js');
const {decideRiskProfile}=require('./risk-runtime.js');

test('explicit Astra and unknown pins remain visible; foreign family rejects',()=>{
  for(const model of ['gpt-6-astra','future-openai-model']){
    assert.equal(parseFlags([`--model-routing=implement=${model}`]).model_routing,`implement=${model}`);
    const r=routing.decideModelRouting({runtime:'codex',pinned:{implement:model}});
    assert.equal(r.model_routing.implement,model);
    assert.equal(r.meta.model_identity.implement.requested_model,model);
    assert.equal(r.meta.model_identity.implement.observed_model,null);
    if(model==='future-openai-model')assert.equal(r.meta.model_identity.implement.status,'unverified');
  }
  assert.throws(()=>routing.decideModelRouting({runtime:'codex',pinned:{implement:'opus'}}),/foreign-model/);
  assert.equal(review.mapCodexReasoningEffort('max','gpt-6-astra').mapped,'max');
});
test('public CLI passes catalog override and explicit pin',()=>{
 const cli=path.join(__dirname,'../scripts/model-routing-cli.js');
 const r=JSON.parse(execFileSync(process.execPath,[cli,'--runtime','codex','--pinned','implement=gpt-6-astra','--catalog-override',JSON.stringify({codex:{light:'custom-light'}})],{encoding:'utf8'}));
 assert.equal(r.model_routing.implement,'gpt-6-astra');assert.equal(r.model_routing.test,'custom-light');
});
test('main is never migrated to delegation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'s02-main-'));try{
 const file=path.join(root,'state.md'),text='---\nmodel_routing:\n  implement: main\n---\n';fs.writeFileSync(file,text);
 assert.deepEqual(require('../scripts/migrate-model-routing.js').migrateStateFile(file).replaced,[]);
 assert.equal(fs.readFileSync(file,'utf8'),text);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('all required roles fallback and High single keeps roles and floors',()=>{
 const options={riskClass:'high',artifactKind:'document',runtime:'codex',availableChannels:{subagent:false,codex_cli:true}};
 const normal=review.compileReviewPlan(options),single=review.compileReviewPlan({...options,reviewModeOverride:'single'});
 assert.deepEqual(single.reviewers.map(({role,tier,required})=>({role,tier,required})),normal.reviewers.map(({role,tier,required})=>({role,tier,required})));
 assert.ok(single.reviewers.every(r=>r.channel==='codex-cli'&&r.fresh_session_required));
 assert.deepEqual(single.degraded.unavailable_roles,[]);
 assert.equal(review.detectReviewChannels({runtime:'claude',env:{},probe:()=>false}).subagent,false);
 assert.equal(review.detectReviewChannels({runtime:'codex',nativeCapability:{available:true,observed:true},env:{},probe:()=>false}).subagent,true);
});
test('fresh adaptive profile and explicit continuation flags preserve setup-only no-ask',()=>{
 assert.equal(parseFlags(['--tdd=adaptive']).tdd_mode,'adaptive');
 assert.equal(parseDeepWorkFlags(['--tdd=adaptive']).tdd,'adaptive');
 assert.equal(parseFlags(['--autonomous']).continuation_mode,'autonomous');
 assert.equal(parseFlags(['--interactive-gates']).continuation_mode,'interactive');
 assert.equal(parseFlags(['--no-ask']).continuation_mode,null);
 assert.throws(()=>parseFlags(['--autonomous','--interactive-gates']),/continuation-conflict/);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'s02-profile-'));try{
 const file=path.join(root,'profile.yaml');require('./profile-runtime.js').createV4Profile(file);
 const profile=require('./profile-runtime.js').loadProfile(file);assert.equal(profile.default_preset,'solo-adaptive');assert.equal(profile.defaults.tdd_mode,'adaptive');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('negative constraints and quoted README examples are not action intent; evidence remains',()=>{
 for(const taskText of ['Update README; do not npm publish','README에 npm publish를 실행하지 마세요','Document the command `npm publish`','Do not deploy or npm publish']){
 const r=decideRiskProfile({taskText});assert.equal(r.dimensions.external_side_effects,0,taskText);assert.ok(r.rationale.some(x=>x.includes('excluded-constraint')),taskText);
 }
 for(const input of [{taskText:'Do not deploy; npm publish now'},{taskText:'배포하지 말고 npm publish 실행'},{taskText:'do not npm publish',evidence:{side_effects:['npm publish']}}])
 assert.equal(decideRiskProfile(input).class,'critical');
 assert.ok(decideRiskProfile({taskText:'do not npm publish',evidence:{changed_paths:['.github/workflows/release.yaml']}}).dimensions.external_side_effects>0);
 assert.equal(decideRiskProfile({taskText:'npm publish'}).confidence_kind,'heuristic-not-empirical');
});
test('strict public parser carries continuation flags and fresh migration default',()=>{
 assert.equal(parseDeepWorkFlags(['--autonomous']).continuation_mode,'autonomous');
 assert.equal(parseDeepWorkFlags(['--interactive-gates']).continuation_mode,'interactive');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'s02-profile-migrate-'));try{
 const file=path.join(root,'profile.yaml');require('./profile-runtime.js').migrateProfile(file);
 assert.equal(require('./profile-runtime.js').loadProfile(file).defaults.tdd_mode,'adaptive');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a negated constraint does not swallow a following affirmative action',()=>{
 assert.equal(decideRiskProfile({taskText:'Do not deploy and run npm publish now'}).class,'critical');
});
test('recognition never treats a foreign model placed in a catalog override as valid',()=>{
 assert.throws(()=>routing.decideModelRouting({runtime:'codex',catalogOverride:{codex:{standard:'opus'}},pinned:{implement:'opus'}}),/foreign-model/);
});
test('all CLI probes are bounded and exceptions remain unavailable',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'s02-probe-'));try{
 if(process.platform!=='win32'){
 const binary=path.join(root,'codex');fs.writeFileSync(binary,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`,{mode:0o755});
 const before=Date.now(),channels=review.detectReviewChannels({env:{PATH:root}});
 assert.equal(channels.codex_cli,false);assert.ok(Date.now()-before<6000);
 }
 assert.equal(review.detectReviewChannels({env:{},probe:()=>{throw new Error('unavailable');}}).codex_cli,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('review assessment discloses observed same-provider diversity and unknown identities',()=>{
 const plan=review.compileReviewPlan({riskClass:'high',artifactKind:'cross-slice',runtime:'codex',availableChannels:{codex_cli:true,subagent:false}});
 const results=plan.reviewers.map((r,i)=>({...r,status:'completed',observed_provider:'openai',observed_session_id:`fresh-${i}`}));
 const assessed=review.evaluateReviewExecution(plan,results);
 assert.equal(assessed.provider_diversity.family_count,1);assert.equal(assessed.provider_diversity.cross_family,false);assert.equal(assessed.provider_diversity.distinct_sessions,true);
});
test('unknown channel model or weaker reviewer pin cannot masquerade as deep-tier availability',()=>{
 const options={riskClass:'high',artifactKind:'slice-diff',runtime:'claude'};
 const weak=review.compileReviewPlan({...options,evaluatorModelOverride:'haiku',availableChannels:{subagent:true}});
 assert.ok(weak.degraded.unavailable_roles.includes('semantic'));
 const unknown=review.compileReviewPlan({...options,availableChannels:{subagent:false,gemini_cli:true}});
 assert.ok(unknown.degraded.unavailable_roles.includes('semantic'));
});
