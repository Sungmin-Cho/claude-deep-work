'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const j=require('./operation-journal.js'),tx=require('./transaction-runtime.js');
const OWNER='.runtime-owner.json',QUIET='.runtime-quiescent.json';
function fail(code){throw Object.assign(new Error(`[${code}]`),{code});}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)fail('outcome-view-owner');try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;return true;}}
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16384)fail('outcome-view-owner');return fs.readFileSync(file,'utf8');}
function identity(base){const st=fs.lstatSync(base);if(!st.isDirectory()||st.isSymbolicLink())fail('outcome-view-owner');return{dev:String(st.dev),ino:String(st.ino)};}
function same(a,b){return j.canonicalJson(a)===j.canonicalJson(b);}
function stage(op,name){return op.stages?.find(s=>s.stage===name)?.details?.owned;}
function contained(base){if(path.dirname(base)!==os.tmpdir()||!/^dw-outcome-[a-f0-9]{64}$/.test(path.basename(base)))fail('outcome-view-owner');}
function assertOwned(base,owner,inode){contained(base);if(!same(identity(base),inode)||regular(path.join(base,OWNER))!==j.canonicalJson(owner))fail('outcome-view-owner');}
async function cleanExisting({stateCapability,prepared}){
 const base=prepared.view_base;contained(base);let stat;try{stat=fs.lstatSync(base);}catch(e){if(e.code==='ENOENT')return;throw e;}if(!stat.isDirectory()||stat.isSymbolicLink())fail('outcome-view-owner');
 let owner;try{owner=JSON.parse(regular(path.join(base,OWNER)));}catch{fail('outcome-view-owner');}
 const prior=await j.resumeOperation({projectCapability:tx.projectCapabilityFor(stateCapability),sessionId:tx.sessionIdFromState(stateCapability),kind:'outcome-check-run-v1',operationId:owner.operation_id});
 const retired=prior.stage==='completed-ledger'&&prior.result?.status==='abandoned-view'?prior.result:null;
 const reservation=retired?{owner:retired.owner,view_base:retired.view_base}:stage(prior,'views-reserved'),owned=retired?{inode:retired.inode}:stage(prior,'views-owned');
 if(!reservation||!owned||!same(reservation.owner,owner)||reservation.view_base!==base||(retired?.prepared_sha256||prior.preconditions?.prepared_sha256)!==prepared.prepared_sha256)fail('outcome-view-owner');
 assertOwned(base,owner,owned.inode);
 const worker=retired?retired.worker:stage(prior,'worker-authorized');if(worker){try{require('./outcome-quiescence.js').recoverQuiescence({base,owner,worker,roots:[prepared.views.positive.root,prepared.views.control.root]});}catch(error){if(alive(worker.pid))fail('outcome-view-in-use');throw error;}}else if(!retired&&owner.parent_pid!==process.pid&&alive(owner.parent_pid))fail('outcome-view-in-use');
 // No worker-authorized journal stage means no start message was permitted.
 assertOwned(base,owner,owned.inode);if(!retired)await j.completeOperation({projectCapability:tx.projectCapabilityFor(stateCapability),sessionId:tx.sessionIdFromState(stateCapability),kind:'outcome-check-run-v1',operationId:owner.operation_id},{status:'abandoned-view',view_base:base,prepared_sha256:prepared.prepared_sha256,owner,inode:owned.inode,worker:worker||null});fs.rmSync(base,{recursive:true});
}
async function reserve({stateCapability,prepared,operation,seam}){
 await cleanExisting({stateCapability,prepared});
 const keys=crypto.generateKeyPairSync('ed25519');const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});
 const owner={operation_id:operation.operationId,parent_pid:process.pid,nonce:crypto.randomBytes(32).toString('hex'),quiescence_public_key:keys.publicKey.export({type:'spki',format:'pem'})};
 const staging=`${prepared.view_base}.reserve-${owner.nonce}`;
 await j.recordOperationStage(operation,'views-reserved',{owned:{view_base:prepared.view_base,staging,owner}});
 // Prepare ownership before publishing the deterministic path. An unrecorded
 // staging-directory interruption never grants cleanup authority over another path.
 fs.mkdirSync(staging,{mode:0o700});fs.writeFileSync(path.join(staging,OWNER),j.canonicalJson(owner),{flag:'wx',mode:0o600});const inode=identity(staging);
 await j.recordOperationStage(operation,'views-owned',{owned:{inode}});
 try{fs.lstatSync(prepared.view_base);fail('outcome-view-collision');}catch(e){if(e.code!=='ENOENT')throw e;}
 fs.renameSync(staging,prepared.view_base);const reservation={base:prepared.view_base,owner,inode,privateKey,beforeCwd:process.platform==='win32'?null:require('./process-descendant-tracker.js').snapshot()};try{seam?.('after-view-reservation',{view_base:prepared.view_base});}catch(error){await j.completeOperation(operation,{status:'abandoned-view',view_base:prepared.view_base,prepared_sha256:prepared.prepared_sha256,owner,inode,worker:null});dispose(reservation);throw error;}return reservation;
}
function assertReservation(reservation){assertOwned(reservation.base,reservation.owner,reservation.inode);}
function dispose(reservation){assertReservation(reservation);if(reservation.worker){require('./outcome-quiescence.js').authenticateQuiescence({base:reservation.base,owner:reservation.owner,worker:reservation.worker});if(process.platform!=='win32'&&reservation.roots){const witness=require('./process-cwd-witness.js').inspectOwnedCwds({roots:reservation.roots,before:reservation.beforeCwd});if(witness.status!=='complete'||witness.witnesses.length)fail('outcome-view-termination-unconfirmed');}}fs.rmSync(reservation.base,{recursive:true});}
function disposeIfQuiescent(reservation){try{dispose(reservation);return true;}catch(error){if(error.code==='outcome-view-termination-unconfirmed')return false;throw error;}}
async function execute({operation,reservation,pair,prepared,seam}){
 assertReservation(reservation);
 const worker=cp.fork(path.join(__dirname,'outcome-view-worker.js'),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{...prepared.supervisor_environment,LANG:'C',LC_ALL:'C',TZ:'UTC'}});
 let authorized=false,finished=false;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{if(worker.connected)worker.disconnect();reject(Object.assign(new Error('outcome-view-termination-unconfirmed'),{code:'outcome-view-termination-unconfirmed'}));},(prepared.command?.spec.timeout_ms||5000)*2+10000);
  worker.once('exit',()=>clearTimeout(timer));
  worker.once('error',error=>{clearTimeout(timer);if(worker.connected)worker.disconnect();reject(error);});worker.send({type:'configure',pair,prepared,owner:reservation.owner,privateKey:reservation.privateKey});
  worker.on('message',async message=>{try{
   if(message?.type==='ready'&&!authorized){authorized=true;reservation.worker={pid:worker.pid,nonce:reservation.owner.nonce};await j.recordOperationStage(operation,'worker-authorized',{owned:reservation.worker});seam?.('before-worker-start',{pid:worker.pid,view_base:pair.base});worker.send({type:'start',pair,prepared,owner:reservation.owner});}
   else if(message?.type==='started'){seam?.('after-worker-start',{pid:worker.pid,view_base:pair.base});}
   else if(message?.type==='result'){finished=true;worker.once('exit',()=>{try{if(message.error)throw Object.assign(new Error(message.error.code),message.error);require('./outcome-quiescence.js').authenticateQuiescence({base:reservation.base,owner:reservation.owner,worker:reservation.worker});if(process.platform!=='win32'){const witness=require('./process-cwd-witness.js').inspectOwnedCwds({roots:[pair.positive.root,pair.control.root],before:reservation.beforeCwd});if(witness.status!=='complete'||witness.witnesses.length)fail('outcome-view-termination-unconfirmed');}resolve(message.observations);}catch(error){reject(error);}});worker.disconnect();}
  }catch(e){worker.disconnect();reject(e);}});
  worker.once('exit',()=>{if(!finished)reject(Object.assign(new Error('outcome-view-termination-unconfirmed'),{code:'outcome-view-termination-unconfirmed'}));});
 });
}
async function materialize({reservation,prepared,...args}){
 assertReservation(reservation);reservation.roots=[prepared.views.positive.root,prepared.views.control.root];
 // Assembly has no verifier effects. Move the completed copies into the exact
 // immutable prepared paths before any process is authorized or executed.
 const pair=await require('./outcome-oracle-runtime.js').createOutcomeViewPair({...args,viewBase:path.join(reservation.base,'materialized')});
 for(const kind of ['positive','control']){
  const container=path.dirname(prepared.views[kind].root);
  fs.renameSync(pair[kind].container,container);
  pair[kind]={...pair[kind],container,root:prepared.views[kind].root,environment:prepared.views[kind].environment};
 }
 fs.rmdirSync(pair.base);pair.base=reservation.base;return pair;
}
module.exports={materialize,reserve,assertReservation,dispose,disposeIfQuiescent,execute,cleanExisting,OWNER,QUIET};
