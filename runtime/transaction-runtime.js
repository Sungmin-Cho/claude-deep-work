'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {issueProjectStateCapability,revalidatePathCapability,atomicWriteFile,withDirectoryLock,
  canonicalizePortableProjectPathV1,isPathInside}=
  require('./platform.js');
const {parseFrontmatter,updateFrontmatterText}=require('./frontmatter.js');
const {beginOperation,recordOperationStage,completeOperation,resumeOperation,canonicalJson,sha256}=
  require('./operation-journal.js');

const LOCK_OPTIONS=Object.freeze({timeoutMs:10_000,staleMs:30_000,heartbeatMs:1_000,
  processIdentity:crypto.createHash('sha256').update(`transaction-runtime:${process.pid}`).digest('hex').slice(0,32)});
const RANKS=Object.freeze({repository:5,git:5,session:10,operation:10,journal:20,pointer:30,
  registry:40,state:50,pending:60,target:70,receipt:70,artifact:70,external:70});
const rankContext=new AsyncLocalStorage();
const localLockTails=new Map();

function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function sessionIdFromState(stateCapability){
  if(!stateCapability||stateCapability.role!=='session-state')fail('transaction-state-capability');
  const match=path.basename(stateCapability.path).match(/^deep-work\.(s-[0-9a-f]{8})\.md$/);
  if(!match)fail('transaction-session-identity');return match[1];
}
function projectCapabilityFor(stateCapability){return issueProjectStateCapability(stateCapability.projectRoot,
  stateCapability.projectRoot,{role:'project-root'});}
function readState(stateCapability){revalidatePathCapability(stateCapability,'transaction-state-read');
  return parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;}
function stateLock(stateCapability){return issueProjectStateCapability(stateCapability.projectRoot,
  `${stateCapability.path}.lock`,{allowMissingLeaf:true,role:'lock'});}
function invokeSeam(seam,name,context){if(seam!==undefined){if(typeof seam!=='function')fail('transaction-seam');seam(name,Object.freeze({...context}));}}

function validateRankedRequests(requests){if(!Array.isArray(requests)||!requests.length)fail('lock-rank-requests');
  let previous=0;let previousPath=null;const paths=new Set();for(const request of requests){
    if(!request||!Object.values(RANKS).includes(request.rank)||!request.capability||request.capability.role!=='lock')fail('lock-rank-request');
    if(request.rank<previous)fail('lock-rank-order');if(paths.has(request.capability.path))fail('lock-rank-duplicate');
    if(request.rank===previous&&Buffer.compare(Buffer.from(previousPath),Buffer.from(request.capability.path))>=0)
      fail('lock-rank-tie-order');
    previous=request.rank;previousPath=request.capability.path;paths.add(request.capability.path);}return requests;}
async function withLocalPathLock(key,callback){const previous=localLockTails.get(key)||Promise.resolve();let release;
  const gate=new Promise((resolve)=>{release=resolve;});const tail=previous.catch(()=>{}).then(()=>gate);localLockTails.set(key,tail);
  await previous.catch(()=>{});try{return await callback();}finally{release();if(localLockTails.get(key)===tail){
      await tail; if(localLockTails.get(key)===tail)localLockTails.delete(key);}}}
async function withRankedLocks(requests,callback){if(typeof callback!=='function')fail('lock-rank-callback');
  const checked=validateRankedRequests(requests);const held=rankContext.getStore()||[];const max=held.at(-1)?.rank||0;
  if(checked[0].rank<=max)fail('lock-rank-inversion',`${checked[0].rank} after ${max}`);
  const acquire=async(index)=>{if(index===checked.length)return callback();const request=checked[index];
    return withLocalPathLock(request.capability.path,async()=>{const deadline=Date.now()+LOCK_OPTIONS.timeoutMs;
      for(;;){let entered=false;const refreshed=issueProjectStateCapability(request.capability.projectRoot,request.capability.path,
          {allowMissingLeaf:true,role:'lock'});
        try{return await withDirectoryLock(refreshed,LOCK_OPTIONS,()=>{entered=true;return rankContext.run(
          [...held,...checked.slice(0,index+1)],()=>acquire(index+1));});}
        catch(error){if(entered||!['lock-ambiguous','lock-chain-invalid','ENOENT'].includes(error.code)||Date.now()>=deadline)throw error;
          await new Promise((resolve)=>setTimeout(resolve,2));}}
    });};
  return acquire(0);}
async function journaledStateMutation({stateCapability,kind,preconditions={},slice,reducer,seam}={}){
  if(typeof reducer!=='function')fail('transaction-reducer');const sessionId=sessionIdFromState(stateCapability);
  const projectCapability=projectCapabilityFor(stateCapability);
  const sessionRankLock=issueProjectStateCapability(stateCapability.projectRoot,
    path.join(stateCapability.projectRoot,'.claude',`deep-work.${sessionId}.rank-operation.lock`),
    {allowMissingLeaf:true,role:'lock'});
  const journalRankLock=issueProjectStateCapability(stateCapability.projectRoot,
    path.join(stateCapability.projectRoot,'.claude',`deep-work.${sessionId}.rank-journal.lock`),
    {allowMissingLeaf:true,role:'lock'});
  return withRankedLocks([{rank:RANKS.session,capability:sessionRankLock},
    {rank:RANKS.journal,capability:journalRankLock},
    {rank:RANKS.state,capability:stateLock(stateCapability)}],async()=>{
    const operation=await beginOperation({projectCapability,sessionId,kind,preconditions,slice});
    invokeSeam(seam,'before-state-lock',{operationId:operation.operationId,kind});
    revalidatePathCapability(stateCapability,'transaction-state');let text=fs.readFileSync(stateCapability.path,'utf8');
    let pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind});let prepared=
      pending.stages?.find((row)=>row.stage==='state-prepared')?.details?.owned;let patch=null;let nextText=null;
    const currentBytesSha256=sha256(text);if(prepared){if(prepared.statePath!==stateCapability.path||
        !/^[0-9a-f]{64}$/.test(prepared.beforeBytesSha256||'')||!/^[0-9a-f]{64}$/.test(prepared.afterBytesSha256||'')||
        !/^[0-9a-f]{64}$/.test(prepared.beforeStateSha256||'')||!/^[0-9a-f]{64}$/.test(prepared.afterStateSha256||'')||
        !/^[0-9a-f]{64}$/.test(prepared.patchSha256||''))fail('transaction-prepared');
      if(currentBytesSha256!==prepared.beforeBytesSha256&&currentBytesSha256!==prepared.afterBytesSha256)
        fail('transaction-state-diverged');}
    if(!prepared||currentBytesSha256===prepared.beforeBytesSha256){const before=parseFrontmatter(text).fields;
      patch=await reducer(structuredClone(before),Object.freeze({operationId:operation.operationId,kind}));
      if(!patch||typeof patch!=='object'||Array.isArray(patch))fail('transaction-patch');nextText=updateFrontmatterText(text,patch);
      const computed={statePath:stateCapability.path,beforeBytesSha256:sha256(text),afterBytesSha256:sha256(nextText),
        beforeStateSha256:sha256(canonicalJson(before)),afterStateSha256:sha256(canonicalJson(parseFrontmatter(nextText).fields)),
        patchSha256:sha256(canonicalJson(patch))};if(prepared){for(const key of Object.keys(computed))if(computed[key]!==prepared[key])
          fail('transaction-replay-diverged');}else{prepared=computed;await recordOperationStage(operation,'state-prepared',{owned:prepared});}}
    if(currentBytesSha256===prepared.beforeBytesSha256){invokeSeam(seam,'before-state-write',{operationId:operation.operationId,kind,patch});
      atomicWriteFile(stateCapability,nextText);invokeSeam(seam,'after-state-write-before-stage',{operationId:operation.operationId,kind,patch});}
    await recordOperationStage(operation,'state-written',{owned:prepared});
    invokeSeam(seam,'after-state-stage',{operationId:operation.operationId,kind,patch});
    const after=readState(stateCapability);if(sha256(canonicalJson(after))!==prepared.afterStateSha256)fail('transaction-state-postcondition');
    const receipt=await completeOperation(operation,{status:'completed',statePath:stateCapability.path,
      stateSha256:prepared.afterStateSha256,patchSha256:prepared.patchSha256});
    return {...after,operationId:operation.operationId,operationReceipt:receipt};
  });
}

function readBoundedJson(file,{maxBytes=1_048_576}={}){const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)fail('transaction-json-bounds');
  return JSON.parse(fs.readFileSync(file,'utf8'));}
function atomicJson(capability,value){atomicWriteFile(capability,canonicalJson(value));return value;}
function issueSessionFileCapability({sessionCapability,candidate,allowedBasenames,allowMissingLeaf=false,role='session-file'}={}){
  if(!sessionCapability||!['session-work-dir','work-dir'].includes(sessionCapability.role))fail('session-file-work-dir');
  revalidatePathCapability(sessionCapability,'session-file-work-dir');const target=path.resolve(candidate);
  if(!isPathInside(sessionCapability.path,target)||target===sessionCapability.path)fail('session-file-route');
  const relative=path.relative(sessionCapability.path,target).split(path.sep).join('/');canonicalizePortableProjectPathV1(relative);
  if(allowedBasenames&&(!Array.isArray(allowedBasenames)||!allowedBasenames.includes(path.basename(target))))fail('session-file-basename');
  let cursor=sessionCapability.path;for(const segment of relative.split('/').slice(0,-1)){cursor=path.join(cursor,segment);
    try{const stat=fs.lstatSync(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())fail('session-file-parent');}
    catch(error){if(error.code!=='ENOENT')throw error;fs.mkdirSync(cursor);}}
  try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink())fail('session-file-type');}
  catch(error){if(error.code!=='ENOENT'||!allowMissingLeaf)throw error;}
  return Object.freeze({kind:'session-file-capability',role,path:target,relative,sessionCapability,
    projectRoot:sessionCapability.projectRoot,allowMissingLeaf});}
function revalidateSessionFile(capability,{allowMissing=false}={}){if(!capability||capability.kind!=='session-file-capability')fail('session-file-capability');
  revalidatePathCapability(capability.sessionCapability,'session-file-parent-revalidate');
  const expected=path.join(capability.sessionCapability.path,...capability.relative.split('/'));if(expected!==capability.path)fail('session-file-identity');
  try{const stat=fs.lstatSync(capability.path);if(!stat.isFile()||stat.isSymbolicLink())fail('session-file-type');return stat;}
  catch(error){if(error.code==='ENOENT'&&(allowMissing||capability.allowMissingLeaf))return null;throw error;}}
function readSessionFile(capability,{maxBytes=1_048_576}={}){const stat=revalidateSessionFile(capability);if(stat.size>maxBytes)fail('session-file-bounds');
  return fs.readFileSync(capability.path);}
function atomicWriteSessionFile(capability,data){revalidateSessionFile(capability,{allowMissing:true});const bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
  const temp=path.join(path.dirname(capability.path),`.${path.basename(capability.path)}.tmp.${process.pid}.${crypto.randomBytes(8).toString('hex')}`);
  const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}revalidatePathCapability(capability.sessionCapability,'session-file-before-rename');
  fs.renameSync(temp,capability.path);return{path:capability.path,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}

module.exports={LOCK_OPTIONS,sessionIdFromState,projectCapabilityFor,readState,stateLock,
  journaledStateMutation,readBoundedJson,atomicJson,invokeSeam,RANKS,withRankedLocks,
  issueSessionFileCapability,revalidateSessionFile,readSessionFile,atomicWriteSessionFile};
