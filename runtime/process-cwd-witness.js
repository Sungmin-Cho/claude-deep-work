'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {snapshot}=require('./process-descendant-tracker.js');
function inspectOwnedCwds({roots,before=[],known=[]}){
 if(!Array.isArray(roots)||roots.some(root=>typeof root!=='string'||!path.isAbsolute(root)))throw Error('process-cwd-roots');
 const canonical=roots.map(root=>fs.realpathSync(root)),baseline=new Map(before.map(r=>[r.pid,r.start])),owned=new Map(known.map(r=>[r.pid,r.start]));
 let current;try{current=snapshot();}catch{return{status:'unavailable',reason:'snapshot-failed',witnesses:[]};}
 const candidates=current.filter(r=>!String(r.state||'').startsWith('Z')&&baseline.get(r.pid)!==r.start&&owned.get(r.pid)!==r.start),cwd=new Map();
 try{if(process.platform==='linux'){for(const row of candidates)try{cwd.set(row.pid,fs.readlinkSync(`/proc/${row.pid}/cwd`).replace(/ \(deleted\)$/,''));}catch{}}
 else if(process.platform==='darwin'){for(let i=0;i<candidates.length;i+=256){const pids=candidates.slice(i,i+256).map(r=>r.pid);const result=cp.spawnSync('/usr/sbin/lsof',['-nP','-a','-d','cwd','-p',pids.join(','),'-Fpn'],{encoding:'utf8',timeout:3000,maxBuffer:1048576,env:{LANG:'C',LC_ALL:'C',TZ:'UTC'}});if(result.error||![0,1].includes(result.status))throw Error('lsof-unavailable');let pid;for(const line of result.stdout.split('\n')){if(/^p\d+$/.test(line))pid=Number(line.slice(1));else if(line.startsWith('n')&&pid)cwd.set(pid,line.slice(1));}}}
 else return{status:'unsupported-platform',witnesses:[]};
 const after=new Map(snapshot().map(r=>[r.pid,r])),witnesses=[];for(const row of candidates){const live=after.get(row.pid);if(!live||live.start!==row.start||String(live.state||'').startsWith('Z'))continue;let location=cwd.get(row.pid);if(!location)continue;try{location=fs.realpathSync(location);}catch{location=path.resolve(location);}
 const index=canonical.findIndex(root=>location===root||location.startsWith(root+path.sep));if(index>=0)witnesses.push({pid:row.pid,start:row.start,root_index:index});}
 return{status:'complete',mechanism:process.platform==='linux'?'proc-cwd':'lsof-cwd',inspected_new_processes:candidates.length,witnesses};
 }catch{return{status:'unavailable',reason:'cwd-inspection-failed',witnesses:[]};}
}
module.exports={inspectOwnedCwds};
