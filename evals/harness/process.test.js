'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {runEvalProcess,createTracker,snapshot}=require('./process.js');
const row=(pid,ppid=1,pgid=pid,start='stable')=>({pid,ppid,pgid,start});
test('confirmed PID replacement retires the exited identity and never signals the reused PID',async()=>{
 let rows=[row(100)],signals=[];
 const tracker=createTracker({readSnapshot:()=>rows,signal:(...args)=>signals.push(args),graceMs:0,confirmMs:0});
 tracker.register(100);rows=[row(100,1,100,'reused')];
 const result=await tracker.terminate();assert.equal(result.confirmed,true);
 assert.ok(result.identity_diagnostics.some(row=>row.kind==='pid-reused'));assert.deepEqual(signals,[]);
});
test('snapshot failure remains false even when later recovery permits cleanup',async()=>{
 let rows=[row(100)],fail=false;
 const tracker=createTracker({readSnapshot:()=>{if(fail)throw Error('ps unavailable');return rows;},
 signal:()=>{rows=[];},graceMs:0,confirmMs:0});
 tracker.register(100);fail=true;tracker.sample();fail=false;
 const result=await tracker.terminate();assert.equal(result.confirmed,false);assert.ok(result.reasons.includes('snapshot-failed'));
});
test('SIGTERM survivor gets SIGKILL and verified absence',async()=>{
 let rows=[row(100)],signals=[];
 const tracker=createTracker({readSnapshot:()=>rows,signal:(pid,sig)=>{signals.push([pid,sig]);if(sig==='SIGKILL')rows=[];},graceMs:0,confirmMs:0});
 tracker.register(100);assert.equal((await tracker.terminate()).confirmed,true);
 assert.deepEqual(signals,[[100,'SIGTERM'],[100,'SIGKILL']]);
});
for(const mode of ['timeout','normal'])test(`real detached nested child cleaned after ${mode}`,async(t)=>{
 if(process.platform!=='darwin'){t.skip('sampled POSIX eval supervisor is Darwin-only');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eval-descendant-test-'));
 const file=path.join(dir,'pids.json');const script=path.join(dir,'root.cjs');
 const supervisor=path.resolve(__dirname,'../../runtime/process-supervisor.js');
 fs.writeFileSync(script,`const fs=require('node:fs');const {runSupervisedProcess}=require(${JSON.stringify(supervisor)});
 function id(pid){const line=require('node:child_process').execFileSync('/bin/ps',['-p',String(pid),'-o','pgid=,lstart='],{encoding:'utf8'}).trim();const m=line.match(/^(\\d+)\\s+(.+)$/);return {pid,pgid:Number(m[1]),start:m[2]};}
 if(process.argv[2]==='idle'){process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(file)},JSON.stringify({root:id(process.ppid),idle:id(process.pid)}));setInterval(()=>{},1000);}
 else {runSupervisedProcess({executable:process.execPath,args:[__filename,'idle']},{timeoutMs:15000,maxOutputBytes:1024}).catch(()=>{});
 ${mode==='normal'?'setTimeout(()=>process.exit(0),500);':''}}
 `);
 let pids;
 try{
  const outcome=await runEvalProcess({executable:process.execPath,args:[script]},{timeoutMs:1000,maxOutputBytes:1024});
  pids=JSON.parse(fs.readFileSync(file));
  assert.equal(outcome.result.timedOut,mode==='timeout');assert.equal(outcome.termination.confirmed,true,JSON.stringify(outcome));
  assert.equal(outcome.termination.descendant_discovery,'sampled');assert.equal(outcome.termination.unobserved_descendants,'unknown');
  assert.ok(outcome.termination.observed_processes>=2);
  const rows=snapshot();for(const {pid} of Object.values(pids)){
   assert.equal(rows.some(row=>row.pid===pid||row.pgid===pid),false);
  }
  console.log(JSON.stringify({mode,pids,cleanup:'ps-pids-and-groups-absent',termination:outcome.termination}));
 }finally{
  // Fixtures have a 15 s fallback lifetime through their own supervisor; successful checks leave none.
  // Emergency cleanup requires matching the freshly recorded test-owned process IDs and start identities.
  if(fs.existsSync(file)){
   const ids=JSON.parse(fs.readFileSync(file));const current=snapshot();
   for(const identity of Object.values(ids)){
    const again=snapshot().find(r=>r.pid===identity.pid);
    if(again&&again.start===identity.start&&again.pgid===identity.pgid)process.kill(identity.pid,'SIGKILL');
   }
   for(let i=0;i<100&&snapshot().some(r=>Object.values(ids).some(id=>r.pid===id.pid&&r.start===id.start));i++)await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(snapshot().some(r=>Object.values(ids).some(id=>r.pid===id.pid&&r.start===id.start)),false,'fixture cleanup verified');
  }
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
test('PGID migration preserves birth identity and signals only the owned PID',async()=>{let rows=[row(100)],signals=[];const tracker=createTracker({readSnapshot:()=>rows,signal:(pid,sig)=>{signals.push([pid,sig]);rows=[];},graceMs:0,confirmMs:0});tracker.register(100);rows=[row(100,1,999),row(999,1,999,'unowned')];const result=await tracker.terminate();assert.equal(result.confirmed,true);assert.deepEqual(signals,[[100,'SIGTERM']]);assert(result.identity_diagnostics.some(r=>r.kind==='pgid-changed'));});
test('a reused parent cannot confer ownership on its new children',async()=>{let rows=[row(100)],signals=[];const tracker=createTracker({readSnapshot:()=>rows,signal:(...args)=>signals.push(args),graceMs:0,confirmMs:0});tracker.register(100);rows=[row(100,1,100,'new-birth'),row(200,100,100,'new-child')];const result=await tracker.terminate();assert.equal(result.confirmed,true);assert.equal(result.observed_processes,1);assert.deepEqual(signals,[]);});
test('confirmed absence retires historical group and never readopts the recycled PID',async()=>{let rows=[row(100)],signals=[];const tracker=createTracker({readSnapshot:()=>rows,signal:(...args)=>signals.push(args),graceMs:0,confirmMs:0});tracker.register(100);rows=[];tracker.sample();rows=[row(100),row(200,100,100)];const result=await tracker.terminate();assert.equal(result.confirmed,true);assert.equal(result.retired_observed_processes,1);assert.deepEqual(signals,[]);});
test('unknown members of a still-owned group are never signalled or declared gone',async()=>{let rows=[row(100),row(200,999,100)],signals=[];const tracker=createTracker({readSnapshot:()=>rows,signal:(pid,sig)=>{signals.push([pid,sig]);rows=rows.filter(r=>r.pid!==pid);},graceMs:0,confirmMs:0});tracker.register(100);const result=await tracker.terminate();assert.equal(result.confirmed,false);assert(result.reasons.includes('termination-unconfirmed'));assert.deepEqual(signals,[[100,'SIGTERM']]);});
test('real setsid migration child is cleaned using stable PID/start identity',async t=>{
 if(process.platform!=='darwin'||!fs.existsSync('/usr/bin/python3')){t.skip('requires Darwin Python for harmless setsid fixture');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eval-pgid-migration-')),marker=path.join(dir,'identity.json');
 const code=`import os,time,signal,json,subprocess
root=os.getpid()
pid=os.fork()
if pid==0:
 signal.signal(signal.SIGTERM,lambda *_:None)
 old=os.getpgrp()
 time.sleep(.4)
 os.setsid()
 def identity(pid):
  line=subprocess.check_output(['/bin/ps','-p',str(pid),'-o','lstart='],text=True).strip()
  return {'pid':pid,'start':line}
 with open(${JSON.stringify(marker)},'w') as file: json.dump({'root':identity(root),'child':identity(os.getpid()),'old_pgid':old,'new_pgid':os.getpgrp()},file)
 time.sleep(10)
 os._exit(0)
time.sleep(10)
`;
 let identities;try{const pending=runEvalProcess({executable:'/usr/bin/python3',args:['-c',code]},{timeoutMs:5000,maxOutputBytes:1024});
 const ready=Date.now()+4000;while(!fs.existsSync(marker)&&Date.now()<ready)await new Promise(r=>setTimeout(r,20));
 assert.equal(fs.existsSync(marker),true,'setsid fixture wrote identity.json');
 const result=await pending;identities=JSON.parse(fs.readFileSync(marker));assert.notEqual(identities.old_pgid,identities.new_pgid);assert.equal(result.termination.confirmed,true,JSON.stringify(result.termination));assert(result.termination.identity_diagnostics.some(r=>r.kind==='pgid-changed'&&r.pid===identities.child.pid));console.log(JSON.stringify({mode:'real-setsid-migration',identities,termination:result.termination}));const current=snapshot();for(const id of [identities.root,identities.child])assert.equal(current.some(r=>r.pid===id.pid&&r.start===id.start),false);}
 finally{if(fs.existsSync(marker)){identities=JSON.parse(fs.readFileSync(marker));for(const id of [identities.root,identities.child]){const current=snapshot().find(r=>r.pid===id.pid);if(current&&current.start===id.start)process.kill(id.pid,'SIGKILL');}for(let i=0;i<100&&snapshot().some(r=>[identities.root,identities.child].some(id=>r.pid===id.pid&&r.start===id.start));i++)await new Promise(r=>setTimeout(r,20));assert.equal(snapshot().some(r=>[identities.root,identities.child].some(id=>r.pid===id.pid&&r.start===id.start)),false);}fs.rmSync(dir,{recursive:true,force:true});}
});
test('observed zombie root retains its authenticated group until unknown live members exit',async()=>{let rows=[{...row(100),state:'Z'},row(200,1,100)],signals=[];const tracker=createTracker({readSnapshot:()=>rows,signal:(...args)=>signals.push(args),graceMs:0,confirmMs:0});tracker.register(100);const result=await tracker.terminate();assert.equal(result.confirmed,false);assert(result.reasons.includes('termination-unconfirmed'));assert.deepEqual(signals,[]);});
test('actual terminal stdout/stderr and exit survive snapshot/termination failure within the output budget',async()=>{const cp=require('node:child_process'),original=cp.execFileSync;cp.execFileSync=(file,...args)=>{if(file==='/bin/ps')throw Object.assign(Error('fixture ps unavailable'),{code:'FIXTURE_PS'});return original(file,...args);};try{const result=await runEvalProcess({executable:process.execPath,args:['-e',"process.stdout.write('stdout-marker');process.stderr.write('stderr-marker');process.exitCode=7;"]},{timeoutMs:1000,maxOutputBytes:64});assert.equal(result.termination.confirmed,false);assert(result.termination.reasons.includes('snapshot-failed'));assert.equal(result.result.exitCode,7);assert.equal(result.result.stdout,'stdout-marker');assert.equal(result.result.stderr,'stderr-marker');assert.equal(result.result.observations.exit_observed,true);assert(result.result.observations.retained_output_bytes<=64);}finally{cp.execFileSync=original;}});

for(const reason of ['snapshot-failed','identity-mismatch','termination-unconfirmed'])test(`runAttempt skips grading when ${reason}`,async()=>{
 const {gradeAfterTermination}=require('./run.js');let grades=0;
 const termination={confirmed:false,reasons:[reason]};
 const result=await gradeAfterTermination({termination,workspace:'/unused',oracle:{},processResult:{ok:true},claim:true,
  grader:async()=>{grades++;return{task_complete:true};}});
 assert.equal(grades,0);assert.equal(result.reason,'termination-unconfirmed');assert.equal(result.task_complete,false);
});
