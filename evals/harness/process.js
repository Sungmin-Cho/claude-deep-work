'use strict';
const cp=require('node:child_process');
const {runSupervisedProcess}=require('../../runtime/process-supervisor.js');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Sampled identity cleanup, not OS containment. Diagnostics never collect argv/environment.
function snapshot(){
 const args=process.platform==='linux'
  ? ['-e','-o','pid=','-o','ppid=','-o','pgid=','-o','stat=','-o','lstart=']
  : ['-axo','pid=,ppid=,pgid=,stat=,lstart='];
 const output=cp.execFileSync('/bin/ps',args,{encoding:'utf8',timeout:2000,maxBuffer:8*1024*1024});
 return output.trim().split('\n').filter(Boolean).map(line=>{const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);if(!match)throw Error('eval-process-snapshot-invalid');return{pid:Number(match[1]),ppid:Number(match[2]),pgid:Number(match[3]),state:match[4],start:match[5]};});
}
function createTracker({readSnapshot=snapshot,signal=(pid,sig)=>process.kill(pid,sig),pause=sleep,graceMs=500,confirmMs=2000}={}){
 const owned=new Map(),seen=new Map(),groups=new Map(),retiredPids=new Set(),reasons=new Set(),diagnostics=[];let rootPid=null,rootObserved=false,confirmed=false,diagnosticsDropped=0;
 const same=(a,b)=>a.pid===b.pid&&a.start===b.start;const live=row=>row&&!String(row.state||'').startsWith('Z');
 const note=(kind,prior,current)=>{const entry={kind,pid:prior.pid,start:prior.start,prior_pgid:prior.pgid,...(current?{current_start:current.start,current_pgid:current.pgid}:{})};if(diagnostics.length<128)diagnostics.push(entry);else diagnosticsDropped++;};
 function retire(prior,kind,current){owned.delete(prior.pid);retiredPids.add(prior.pid);note(kind,prior,current);}
 function sample(registerRoot=false){let rows;try{rows=readSnapshot();if(!Array.isArray(rows)||rows.some(r=>!Number.isSafeInteger(r.pid)||r.pid<=0||!Number.isSafeInteger(r.ppid)||!Number.isSafeInteger(r.pgid)||r.pgid<=0||typeof r.start!=='string'||!r.start)||new Set(rows.map(r=>r.pid)).size!==rows.length)throw Error('invalid');}catch{reasons.add('snapshot-failed');return null;}
  const byPid=new Map(rows.map(r=>[r.pid,r]));
  if(registerRoot&&rootPid&&!rootObserved){const root=byPid.get(rootPid);if(root){owned.set(root.pid,{...root});seen.set(root.pid,{...root});if(root.pgid===root.pid)groups.set(root.pid,{...root});rootObserved=true;}else reasons.add('root-identity-unavailable');}
  // Retirement precedes parent-based discovery. A recycled parent is never an ancestry anchor.
  for(const prior of [...owned.values()]){const current=byPid.get(prior.pid);if(!current){retire(prior,'identity-exited');continue;}if(!same(prior,current)){retire(prior,'pid-reused',current);continue;}if(!live(current)){retire(prior,'identity-zombie',current);continue;}if(prior.pgid!==current.pgid)note('pgid-changed',prior,current);owned.set(prior.pid,{...current});}
  let added;do{added=false;for(const row of rows){if(!live(row)||owned.has(row.pid)||retiredPids.has(row.pid))continue;const parent=owned.get(row.ppid),liveParent=byPid.get(row.ppid);if(parent&&live(liveParent)&&same(parent,liveParent)){owned.set(row.pid,{...row});seen.set(row.pid,{...row});added=true;}}}while(added);
  // Group numbers are retained only for an authenticated owned group leader.
  for(const row of owned.values())if(row.pgid===row.pid&&!groups.has(row.pid))groups.set(row.pid,{...row});
  for(const [pgid,leader]of groups){const current=byPid.get(pgid);if(current&&!same(leader,current)){groups.delete(pgid);note('group-id-reused',leader,current);}else if(!rows.some(row=>live(row)&&row.pgid===pgid)){groups.delete(pgid);note('group-exited',leader);}}
  return byPid;
 }
 function register(pid){rootPid=pid;sample(true);}
 function signalOwned(sig){for(const prior of [...owned.values()].reverse()){const rows=sample();if(!rows)continue;const current=rows.get(prior.pid),tracked=owned.get(prior.pid);if(!tracked||!live(current)||!same(prior,current)||!same(tracked,current))continue;try{signal(prior.pid,sig);}catch(error){if(error.code!=='ESRCH')reasons.add('signal-failed');}}}
 function remaining(){const rows=sample();if(!rows)return true;return owned.size>0||[...rows.values()].some(row=>live(row)&&groups.has(row.pgid));}
 async function waitGone(ms){const deadline=Date.now()+ms;do{if(!remaining())return true;await pause(20);}while(Date.now()<deadline);return !remaining();}
 async function terminate(){sample();signalOwned('SIGTERM');confirmed=await waitGone(graceMs);if(!confirmed){signalOwned('SIGKILL');confirmed=await waitGone(confirmMs);if(!confirmed)reasons.add('termination-unconfirmed');}if(!rootObserved)reasons.add('root-identity-unavailable');return report();}
 function report(){return{confirmed:confirmed&&reasons.size===0&&rootObserved,scope:'observed-identities-and-owned-groups',descendant_discovery:'sampled',identity_precision:'ps-lstart-seconds',signal_boundary:'fresh-pid-start-check-no-os-handle',unobserved_descendants:'unknown',observed_processes:seen.size,active_observed_processes:owned.size,retired_observed_processes:seen.size-owned.size,reasons:[...reasons].sort(),identity_diagnostics:diagnostics.map(row=>({...row})),diagnostics_dropped:diagnosticsDropped,remaining_identities:[...owned.values()].slice(0,128).map(({pid,start,pgid})=>({pid,start,pgid})),remaining_identity_omissions:Math.max(0,owned.size-128),remaining_group_anchors:[...groups.values()].slice(0,128).map(({pid,start})=>({pgid:pid,leader_start:start}))};}
 return{register,sample,terminate,report};
}
async function runEvalProcess(spec,options={}){
 if(!['darwin','linux'].includes(process.platform))return{result:{ok:false,error:{code:'eval-supervision-platform-unsupported'},stdout:'',stderr:''},termination:{confirmed:false,scope:'observed-identities-and-owned-groups',descendant_discovery:'sampled',unobserved_descendants:'unknown',observed_processes:0,reasons:['platform-unsupported']}};
 const tracker=createTracker();let timer,deadlineTimer,termination,child,exit=null,deadlineReached=false;const started=Date.now();
 const limit=Number.isSafeInteger(options.maxOutputBytes)&&options.maxOutputBytes>0?Math.min(options.maxOutputBytes,67108864):16777216;
 let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),outputBytes=0;
 const append=(stream,data)=>{const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);outputBytes+=bytes.length;const keep=bytes.subarray(0,Math.max(0,limit-stdout.length-stderr.length));if(stream==='stdout')stdout=Buffer.concat([stdout,keep]);else stderr=Buffer.concat([stderr,keep]);};
 try{const result=await runSupervisedProcess(spec,{...options,spawnImpl:(executable,args,spawnOptions)=>{child=cp.spawn(executable,args,spawnOptions);child.stdout?.on('data',data=>append('stdout',data));child.stderr?.on('data',data=>append('stderr',data));child.once('exit',(code,signal)=>{exit={code,signal};clearTimeout(deadlineTimer);});if(child.pid){tracker.register(child.pid);timer=setInterval(()=>tracker.sample(),50);deadlineTimer=setTimeout(()=>{deadlineReached=true;},options.timeoutMs??30000);}return child;},terminationImpl:async()=>{termination=await tracker.terminate();if(!termination.confirmed){const error=Error('eval-termination-unconfirmed');error.code='eval-termination-unconfirmed';throw error;}}});return{result,termination:termination||tracker.report()};}
 catch(error){termination=await tracker.terminate();termination.confirmed=false;termination.reasons=[...new Set([...termination.reasons,'supervision-failed'])].sort();return{result:{ok:false,error:{code:error.code||'eval-process-error'},exitCode:exit?.code??null,signal:exit?.signal??null,stdout:options.rawOutput?Buffer.from(stdout):stdout.toString('utf8'),stderr:options.rawOutput?Buffer.from(stderr):stderr.toString('utf8'),timedOut:deadlineReached,outputOverflow:outputBytes>limit,durationMs:Date.now()-started,observations:{exit_observed:exit!==null,retained_output_bytes:stdout.length+stderr.length,observed_output_bytes:outputBytes}},termination};}
 finally{clearInterval(timer);clearTimeout(deadlineTimer);if(termination?.confirmed===false){child?.stdout?.destroy();child?.stderr?.destroy();}}
}
module.exports={runEvalProcess,createTracker,snapshot};
