'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),Module=require('node:module');
const repo=path.resolve(__dirname,'..'),filename=path.join(repo,'tests/finish-pre-action-recovery.test.js');const text=fs.readFileSync(filename,'utf8'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(text.slice(0,text.indexOf('for(const drift of'))+'\nmodule.exports={fixture,runtimeFor};',filename);const {fixture,runtimeFor}=m.exports;
for(const mode of ['normal','stale-source','foreign-merge-head','abort-return-loss'])test(`owned merge conflict ${mode}: exact rollback only, no new stale effect`,async t=>{
 const f=await fixture(t),child=f.read().worktree_path;f.git(['switch','main']);fs.writeFileSync(path.join(f.root,'README.md'),'base change\n');f.git(['add','README.md']);f.git(['commit','-qm','base change']);const baseHead=f.git(['rev-parse','HEAD']).trim();fs.writeFileSync(path.join(child,'README.md'),'child change\n');cp.execFileSync('git',['-C',child,'add','README.md']);cp.execFileSync('git',['-C',child,'commit','-qm','child change']);f.admitted=()=>true;
 const runtime=runtimeFor(f);let aborted=0,merges=0,interrupted=false;const gitRunner=async args=>{if(args[0]==='merge'){if(args[1]==='--abort')aborted++;else merges++;}return f.gitRunner(args);};
 const call=seam=>require(path.join(repo,'runtime/session-store.js')).withFinishTransaction({sessionId:f.sessionId,stateCapability:f.cap(),outcome:'merge'},({caps})=>runtime.finishSessionV3({stateCapability:f.cap(),sessionId:f.sessionId,outcome:'merge',projectCapability:f.projectCapability,caps,identities:f.identities,gitRunner,dirtyResolution:'abort',seam}));
 const seam=(name,detail)=>{if(name==='before-call'&&detail.kind==='merge-abort'){if(mode==='stale-source')fs.appendFileSync(path.join(f.root,'README.md'),'new user edits\n');if(mode==='foreign-merge-head')fs.writeFileSync(path.join(f.root,'.git','MERGE_HEAD'),baseHead+'\n');}if(mode==='abort-return-loss'&&name==='after-call-before-stage'&&detail.kind==='merge-abort'&&!interrupted){interrupted=true;throw Error('controlled-abort-return-loss');}};
 let result,error;try{result=await call(seam);}catch(e){error=e;}
 if(['stale-source','foreign-merge-head'].includes(mode)){assert.match(error?.code||error?.message||'',/finish-rollback-authority-drift|finish-rollback-identity/);assert.equal(aborted,0);assert.equal(merges,1);assert.equal(cp.spawnSync('git',['rev-parse','--verify','MERGE_HEAD'],{cwd:f.root}).status,0);console.log(JSON.stringify({mode,merges,aborted,rejected:error.code}));return;}
 if(mode==='abort-return-loss'){assert.match(error?.message||'',/controlled-abort-return-loss/);result=await call();}else assert.equal(error,undefined);
 assert.equal(result.status,'manual-resolution');assert.equal(aborted,1);assert.equal(merges,1);assert.notEqual(cp.spawnSync('git',['rev-parse','--verify','MERGE_HEAD'],{cwd:f.root}).status,0);assert.equal(fs.readFileSync(path.join(f.root,'README.md'),'utf8'),'base change\n');assert.equal((await call()).status,'manual-resolution');assert.equal(aborted,1);assert.equal(merges,1);console.log(JSON.stringify({mode,merges,aborted,result:result.status,merge_head:'absent',replay:'no repeated effect'}));
});
test('finish merge from a root not on the base branch keeps its own switch as authority',async t=>{
 const f=await fixture(t),child=f.read().worktree_path;
 f.git(['switch','main']);fs.writeFileSync(path.join(f.root,'README.md'),'base change\n');f.git(['add','README.md']);f.git(['commit','-qm','base change']);
 const baseHead=f.git(['rev-parse','HEAD']).trim();
 f.git(['switch','feature']);
 fs.writeFileSync(path.join(child,'README.md'),'child change\n');cp.execFileSync('git',['-C',child,'add','README.md']);cp.execFileSync('git',['-C',child,'commit','-qm','child change']);
 f.admitted=()=>true;
 f.context=()=>{const current=f.read(),plan=JSON.parse(fs.readFileSync(f.planPath));return{plan,verificationPlan:{plan_sha256:current.verification_plan_sha256,gates:[]},workDir:f.workDir,sha256:'a'.repeat(64),projection:{plan_identity:{status:'current'},receipts:{status:'complete',rows:[{slice_id:'SLICE-001',status:'complete'}]},evidence:{status:'complete',completed_ids:[]}}};};
 const runtime=runtimeFor(f);let switches=0,merges=0;
 const gitRunner=async args=>{if(args[0]==='switch')switches++;if(args[0]==='merge'&&args[1]!=='--abort')merges++;return f.gitRunner(args);};
 const result=await require(path.join(repo,'runtime/session-store.js')).withFinishTransaction({sessionId:f.sessionId,stateCapability:f.cap(),outcome:'merge'},({caps})=>runtime.finishSessionV3({stateCapability:f.cap(),sessionId:f.sessionId,outcome:'merge',projectCapability:f.projectCapability,caps,identities:f.identities,gitRunner,dirtyResolution:'abort'}));
 assert.equal(result.status,'manual-resolution');
 assert.equal(switches,1);
 assert.equal(merges,1);
 assert.equal(f.git(['symbolic-ref','--short','HEAD']).trim(),'main');
 assert.equal(f.git(['rev-parse','HEAD']).trim(),baseHead);
});
