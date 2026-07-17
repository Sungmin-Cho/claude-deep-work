'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {issueOwnedTempCapability,atomicWriteFile,compareRemoveOwnedTemp,
  revalidatePathCapability,consumeOwnedTemp,authenticateOwnedTempConsumer,issueProjectStateCapability}=require('./platform.js');
const {beginOperation,recordOperationStage,completeOperation,resumeOperation}=require('./operation-journal.js');

const KINDS=new Set(['brainstorm','research','research-area','plan','plan-backup','plan-diff',
  'test-results','quality-gates','cross-slice-review','solid-review','insight-report','drift-report',
  'fidelity-score','debug-root-cause']);
const AREAS=new Set(['architecture','patterns','risks','tech-stack','conventions','data-model']);
function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function sessionIdFor(sessionCapability){const value=path.basename(sessionCapability?.path||'');if(!/^s-[0-9a-f]{8}$/.test(value))fail('temp-session');return value;}

function validateArtifactRequest(request){
  if(!request||!KINDS.has(request.kind))fail('artifact-kind');
  if(Object.hasOwn(request,'output'))fail('artifact-output');
  if(request.kind==='research-area'&&!AREAS.has(request.area))fail('artifact-area');
  if(request.kind!=='research-area'&&request.area!==undefined)fail('artifact-area');
  if(request.kind==='plan-backup'&&(!Number.isInteger(request.iteration)||request.iteration<1||request.iteration>20))fail('artifact-iteration');
  if(request.kind!=='plan-backup'&&request.iteration!==undefined)fail('artifact-iteration');
  return {...request};
}
function deriveArtifactName(request){const checked=validateArtifactRequest(request);const map={brainstorm:'brainstorm.md',
  research:'research.md',plan:'plan.md','plan-diff':'plan-diff.md','test-results':'test-results.md',
  'quality-gates':'quality-gates.md','cross-slice-review':'cross-slice-review.md','solid-review':'solid-review.md',
  'insight-report':'insight-report.md','drift-report':'drift-report.md','fidelity-score':'fidelity-score.json',
  'debug-root-cause':'debug-root-cause.md'};
  if(checked.kind==='research-area')return `research-${checked.area}.md`;
  if(checked.kind==='plan-backup')return `plan-v${checked.iteration}.md`;return map[checked.kind];}

function projectFor(sessionCapability){return issueProjectStateCapability(sessionCapability.projectRoot,sessionCapability.projectRoot,{role:'project-root'});}
async function createOwnedTemp({sessionCapability,purpose}){
  const operationId=`op-${crypto.randomBytes(32).toString('hex')}`;
  const operation=await beginOperation({projectCapability:projectFor(sessionCapability),sessionId:sessionIdFor(sessionCapability),
    kind:'owned-temp',operationId,preconditions:{purpose}});
  const capability=issueOwnedTempCapability({sessionCapability,operationId,purpose,allowMissingLeaf:true});
  if(capability.state!=='reserved')fail('temp-create-collision');
  fs.mkdirSync(path.dirname(capability.path),{recursive:true});
  const reservation=path.join(path.dirname(capability.path),'reservation.json');
  const bytes=Buffer.from(`${JSON.stringify({version:1,sessionId:capability.sessionId,operationId,purpose})}\n`);
  try{const fd=fs.openSync(reservation,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  catch(error){if(error.code!=='EEXIST')throw error;let current;try{current=fs.readFileSync(reservation);}catch{fail('temp-create-collision');}
    if(Buffer.compare(current,bytes)!==0)fail('temp-create-collision');}
  await recordOperationStage(operation,'reserved',{owned:{path:capability.path,purpose}});
  return {operationId,path:capability.path,purpose,capability};
}
function resolveOwnedTemp({sessionCapability,operationId}={}){
  if(!/^op-[0-9a-f]{32,64}$/.test(operationId||''))fail('temp-operation-id');
  const reservation=path.join(sessionCapability.path,'.tmp',operationId,'reservation.json');let row;
  try{const stat=fs.lstatSync(reservation);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)fail('temp-reservation');
    row=JSON.parse(fs.readFileSync(reservation,'utf8'));}catch(error){if(error.code==='ENOENT')fail('temp-reservation');throw error;}
  if(row.version!==1||row.operationId!==operationId||typeof row.sessionId!=='string'||
      typeof row.purpose!=='string')fail('temp-reservation');
  const capability=issueOwnedTempCapability({sessionCapability,operationId,purpose:row.purpose,allowMissingLeaf:true});
  if(row.sessionId!==capability.sessionId)fail('temp-reservation');
  return{operationId,purpose:row.purpose,capability};
}
async function writeOwnedTemp({sessionCapability,operationId,purpose},bytes){
  const operation=await beginOperation({projectCapability:projectFor(sessionCapability),sessionId:sessionIdFor(sessionCapability),
    kind:'owned-temp',operationId,preconditions:{purpose}});
  const capability=issueOwnedTempCapability({sessionCapability,operationId,purpose,allowMissingLeaf:true});
  const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  if(fs.existsSync(capability.path)){
    const current=fs.readFileSync(capability.path);if(Buffer.compare(current,data)!==0)fail('temp-digest');
    const digest=sha256(current);await recordOperationStage(operation,'written',{owned:{path:capability.path,sha256:digest}});
    return {status:'adopted',sha256:digest,capability};
  }
  atomicWriteFile(capability,data);const digest=sha256(data);await recordOperationStage(operation,'written',{owned:{path:capability.path,sha256:digest}});
  return {status:'written',sha256:digest,capability};
}
async function removeOwnedTemp({sessionCapability,operationId,purpose,expectedSha256}){
  const operation=await beginOperation({projectCapability:projectFor(sessionCapability),sessionId:sessionIdFor(sessionCapability),
    kind:'owned-temp',operationId,preconditions:{purpose}});
  const capability=issueOwnedTempCapability({sessionCapability,operationId,purpose,allowMissingLeaf:true});
  const result=compareRemoveOwnedTemp(capability,expectedSha256);await recordOperationStage(operation,'removed',
    {owned:{path:capability.path,sha256:expectedSha256}});const receipt=await completeOperation(operation,
      {status:'removed',purpose,sha256:expectedSha256});return{...result,operationId,operationReceipt:receipt};
}
async function prepareOwnedTempForOperation({sessionCapability,sourceOperationId,purpose}={}){
  const resolved=resolveOwnedTemp({sessionCapability,operationId:sourceOperationId});if(resolved.purpose!==purpose)fail('temp-purpose');
  const source=await resumeOperation({projectCapability:projectFor(sessionCapability),operationId:sourceOperationId,
    sessionId:sessionIdFor(sessionCapability),kind:'owned-temp'});const written=source.stages?.find((row)=>row.stage==='written');
  const expectedDigest=written?.details?.owned?.sha256;if(!/^[0-9a-f]{64}$/.test(expectedDigest||''))fail('temp-not-written');
  const bytes=fs.readFileSync(resolved.capability.path);if(sha256(bytes)!==expectedDigest)fail('temp-digest');
  return{...resolved,bytes,sha256:expectedDigest};
}
async function consumeOwnedTempForOperation({sessionCapability,sourceOperationId,purpose,consumerOperationId,
  expectedDigest,adoptWithoutRead=false}={}){
  const resolved=resolveOwnedTemp({sessionCapability,operationId:sourceOperationId});if(resolved.purpose!==purpose)fail('temp-purpose');
  const source=await resumeOperation({projectCapability:projectFor(sessionCapability),operationId:sourceOperationId,
    sessionId:sessionIdFor(sessionCapability),kind:'owned-temp'});const written=source.stages?.find((row)=>row.stage==='written');
  const sourceDigest=written?.details?.owned?.sha256;if(!/^[0-9a-f]{64}$/.test(sourceDigest||'')||
      expectedDigest!==undefined&&expectedDigest!==sourceDigest)fail('temp-not-written');let bytes=null,adopted=false;
  if(adoptWithoutRead){adopted=Boolean(authenticateOwnedTempConsumer(resolved.capability,{operationId:consumerOperationId,purpose,
      expectedDigest:sourceDigest,allowMissing:true}));if(!adopted)consumeOwnedTemp(resolved.capability,{operationId:consumerOperationId,
      purpose,expectedDigest:sourceDigest});}
  else{bytes=fs.readFileSync(resolved.capability.path);if(sha256(bytes)!==sourceDigest)fail('temp-digest');
    consumeOwnedTemp(resolved.capability,{operationId:consumerOperationId,purpose,expectedDigest:sourceDigest});}
  const producer=await beginOperation({projectCapability:projectFor(sessionCapability),sessionId:sessionIdFor(sessionCapability),
    kind:'owned-temp',operationId:sourceOperationId,preconditions:{purpose}});await recordOperationStage(producer,'consumed',
      {owned:{consumerOperationId,sha256:sourceDigest}});return{...resolved,bytes,sha256:sourceDigest,consumerOperationId,adopted};
}
function publishArtifact({sessionCapability,kind,inputCapability,area,iteration}){
  const name=deriveArtifactName({kind,area,iteration});revalidatePathCapability(inputCapability,'artifact-input');
  const target=path.join(sessionCapability.path,name);const transaction=require('./transaction-runtime.js');
  const output=transaction.issueSessionFileCapability({sessionCapability,candidate:target,
    allowedBasenames:[name],allowMissingLeaf:true,role:'artifact-output'});
  const bytes=fs.readFileSync(inputCapability.path);transaction.atomicWriteSessionFile(output,bytes);return {path:target,sha256:sha256(bytes)};
}
function publishFinalizedReceipt({sessionCapability,operation,kind,sourceTempDigest,payload,slice}={}){
  if(!operation||operation.kind!==kind||!['finish-merge','finish-publish-pr','finish-keep','finish-discard','implement-slice-complete'].includes(kind)||
      !/^[0-9a-f]{64}$/.test(sourceTempDigest||''))fail('finalized-receipt-producer');
  const bytes=Buffer.from(require('./operation-journal.js').canonicalJson(payload));const digest=sha256(bytes);
  const target=path.join(sessionCapability.path,'.operation-results',operation.operationId,'finalized-receipt-payload.json');
  const transaction=require('./transaction-runtime.js');const capability=transaction.issueSessionFileCapability({sessionCapability,candidate:target,
    allowedBasenames:['finalized-receipt-payload.json'],allowMissingLeaf:true,role:'finalized-result'});
  if(fs.existsSync(target)){const current=fs.readFileSync(target);if(Buffer.compare(current,bytes)!==0)fail('finalized-receipt-result-mismatch');}
  else transaction.atomicWriteSessionFile(capability,bytes);
  const producerReceipt={version:1,kind,operationId:operation.operationId,sessionId:sessionIdFor(sessionCapability),
    stage:'payload-published',sourceTempDigest,finalizedBytesDigest:digest,...(slice?{slice}:{})};
  const resultCapability=require('./platform.js').issueFinalizedReceiptPayloadCapability({sessionCapability,
    producerOperationReceipt:producerReceipt,...(slice?{slice}:{})});return{producerReceipt,resultCapability,path:target,sha256:digest};
}
module.exports={KINDS,AREAS,validateArtifactRequest,deriveArtifactName,createOwnedTemp,writeOwnedTemp,
  removeOwnedTemp,publishArtifact,resolveOwnedTemp,prepareOwnedTempForOperation,consumeOwnedTempForOperation,publishFinalizedReceipt};
