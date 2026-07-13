'use strict';

const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const platform=require('./platform.js');const transaction=require('./transaction-runtime.js');
const {beginOperation,recordOperationStage,completeOperation,resumeOperation,canonicalJson,sha256}=require('./operation-journal.js');
const gitRuntime=require('./git-runtime.js');
function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function readBoundedJson(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)fail('receipt-bounds');
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('receipt-json');}}
function payload(value){return value&&value.envelope&&value.payload?value.payload:value?.payload||value;}
function files(receiptsDir){return fs.existsSync(receiptsDir)?fs.readdirSync(receiptsDir).filter((name)=>/^SLICE-\d{3}\.json$/.test(name))
  .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))):[];}
function bound(stateCapability){const state=transaction.readState(stateCapability);const sessionId=transaction.sessionIdFromState(stateCapability);
  if(state.session_id!==undefined&&state.session_id!==sessionId)fail('report-session-identity');if(typeof state.work_dir!=='string')fail('report-work-dir');
  const workPath=path.join(stateCapability.projectRoot,...state.work_dir.split('/'));const sessionCapability=platform.issueProjectStateCapability(
    stateCapability.projectRoot,workPath,{role:'session-work-dir',sessionStateCapability:stateCapability});const receiptsDir=path.join(workPath,'receipts');
  try{const stat=fs.lstatSync(receiptsDir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('receipt-directory');}
  catch(error){if(error.code!=='ENOENT')throw error;fs.mkdirSync(receiptsDir);}return{state,sessionId,sessionCapability,receiptsDir,
    projectCapability:transaction.projectCapabilityFor(stateCapability)};}
function resolveReceipts(input){if(input?.stateCapability)return bound(input.stateCapability).receiptsDir;
  if(typeof input?.receiptsDir!=='string')fail('receipt-directory');return input.receiptsDir;}
function readReceiptDashboard(input){const receiptsDir=resolveReceipts(input);return files(receiptsDir).map((name)=>{const row=payload(readBoundedJson(path.join(receiptsDir,name)));
  if(!row||typeof row!=='object')fail('receipt-schema');return {slice_id:row.slice_id||path.basename(name,'.json'),status:row.status||'unknown'};});}
function readReceiptDetail(input){if(!/^SLICE-\d{3}$/.test(input?.sliceId||''))fail('slice-identity');const receiptsDir=resolveReceipts(input);
  return payload(readBoundedJson(path.join(receiptsDir,`${input.sliceId}.json`)));}
function readSessionHistory(input){const projectRoot=typeof input==='string'?input:input?.path;if(typeof projectRoot!=='string')fail('history-project');
  const root=path.join(projectRoot,'.deep-work','history');if(!fs.existsSync(root))return[];return fs.readdirSync(root)
    .filter((name)=>!name.includes('/')&&!name.includes('\\')).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).slice(-512);}
function renderExport(receiptsDir,format){if(!['json','md','ci'].includes(format))fail('receipt-export-format');const rows=files(receiptsDir)
  .map((name)=>readBoundedJson(path.join(receiptsDir,name)));if(format==='ci')return `${JSON.stringify(rows,null,2)}\n`;
  const bodies=rows.map(payload);if(format==='json')return `${JSON.stringify(bodies,null,2)}\n`;
  return bodies.map((row)=>`- ${row.slice_id}: ${row.status}`).join('\n')+'\n';}
function exportReceipts(input){if(!input.stateCapability)return renderExport(resolveReceipts(input),input.format);return exportReceiptsBound(input);}
async function withOutputLocks(stateCapability,targetKey,callback){const sessionId=transaction.sessionIdFromState(stateCapability),root=
    stateCapability.projectRoot;return transaction.withRankedLocks([{rank:transaction.RANKS.session,capability:
      platform.issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),
        {allowMissingLeaf:true,role:'lock'})},{rank:transaction.RANKS.journal,capability:platform.issueProjectStateCapability(root,
      path.join(root,'.claude',`deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)},{rank:transaction.RANKS.target,
      capability:platform.issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.target.${sha256(targetKey)}.lock`),
        {allowMissingLeaf:true,role:'lock'})}],callback);}
async function publishOutput({stateCapability,kind,basename,role,derive,seam}){
  return withOutputLocks(stateCapability,`${kind}:${basename}`,async()=>{const info=bound(stateCapability);if(typeof derive!=='function')
      fail('report-output-derive');const derived=derive(info);const bytes=derived?.bytes;if(!Buffer.isBuffer(bytes))fail('report-output-bytes');
    const preconditions=derived.preconditions,result=derived.result;const output=
      transaction.issueSessionFileCapability({sessionCapability:info.sessionCapability,candidate:path.join(info.sessionCapability.path,basename),
        allowedBasenames:[basename],allowMissingLeaf:true,role});const operation=await beginOperation({projectCapability:info.projectCapability,
        sessionId:info.sessionId,kind,preconditions});const digest=sha256(bytes);const exact=fs.existsSync(output.path)&&
        transaction.readSessionFile(output).equals(bytes);if(!exact){seam?.('before-output-write',{operationId:operation.operationId,path:output.path,
          sha256:digest});transaction.atomicWriteSessionFile(output,bytes);seam?.('after-output-write-before-stage',
          {operationId:operation.operationId,path:output.path,sha256:digest});}
      await recordOperationStage(operation,'output-written',{owned:{path:output.path,sha256:digest}});if(!transaction.readSessionFile(output)
        .equals(bytes))fail('report-output-postcondition');const terminal={...result,output:output.path,sha256:digest};const receipt=
        await completeOperation(operation,terminal);return{...terminal,operationId:operation.operationId,receipt};});}
async function exportReceiptsBound(input){if(!['json','md','ci'].includes(input.format))fail('receipt-export-format');
  const names={json:'receipts-export.json',md:'receipts-export.md',ci:'receipts-export-ci.json'};
  return publishOutput({stateCapability:input.stateCapability,kind:'receipt-export',basename:names[input.format],role:'receipt-export',
    derive:(info)=>{const sourceRows=files(info.receiptsDir).map((name)=>readBoundedJson(path.join(info.receiptsDir,name)));
      return{preconditions:{format:input.format,sourceSha256:sha256(canonicalJson(sourceRows))},
        bytes:Buffer.from(renderExport(info.receiptsDir,input.format)),result:{status:'exported',format:input.format}};},seam:input.seam});}
function renderReport(sessionId,receiptsDir){const rows=readReceiptDashboard({receiptsDir});return `# Deep Work Report\n\nSession: ${sessionId}\n\n${
  rows.map((row)=>`- ${row.slice_id}: ${row.status}`).join('\n')}\n`;}
function generateReport(input){if(!input.stateCapability)return renderReport(input.sessionId,input.receiptsDir);return generateReportBound(input);}
async function generateReportBound(input){return publishOutput({stateCapability:input.stateCapability,kind:'report-generate',basename:'report.md',
    role:'report-output',derive:(info)=>{const bytes=Buffer.from(renderReport(info.sessionId,info.receiptsDir));return{
      preconditions:{sourceSha256:sha256(bytes)},bytes,result:{status:'generated'}};},seam:input.seam});}
async function checked(run,args){const result=await run(args);if(!result?.ok)fail('report-git',result?.stderr);return result;}
function reportStatusRows(stdout){const records=String(stdout||'').split('\0').filter(Boolean);const rows=[];
  for(let index=0;index<records.length;index++){const record=records[index];if(record.length<4||record[2]!==' ')fail('report-status');
    const code=record.slice(0,2);if(/[RC]/.test(code))fail('report-status-rename');rows.push({code,path:record.slice(3)});}
  return rows;}
function reportBlobOid(bytes,oidLength){const algorithm=oidLength===64?'sha256':'sha1';return crypto.createHash(algorithm)
  .update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');}
async function commitReport({stateCapability,seam,gitRunner,userChoice='commit'}={}){const info=bound(stateCapability);
  if(userChoice!=='commit')fail('report-consent');const reportPath=path.join(info.sessionCapability.path,'report.md');let stat;
  try{stat=fs.lstatSync(reportPath);}catch(error){if(error.code==='ENOENT')fail('report-missing');throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1_048_576)fail('report-missing');const reportBytes=fs.readFileSync(reportPath);
  const relative=path.relative(info.projectCapability.path,reportPath).split(path.sep).join('/');const root=info.projectCapability.path;
  const message=`deep-report: ${info.sessionId}`;const reportSha256=sha256(reportBytes);const operationId=`op-${sha256(canonicalJson({
    kind:'report-commit',sessionId:info.sessionId,relative,reportSha256,message,userChoice}))}`;const gitLock=
    platform.issueProjectStateCapability(root,path.join(root,'.claude','deep-work.git.lock'),{allowMissingLeaf:true,role:'lock'});
  const operationLock=platform.issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${info.sessionId}.rank-operation.lock`),
    {allowMissingLeaf:true,role:'lock'});const journalLock=platform.issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${info.sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'});
  return transaction.withRankedLocks([{rank:transaction.RANKS.repository,capability:gitLock},
    {rank:transaction.RANKS.session,capability:operationLock},{rank:transaction.RANKS.journal,capability:journalLock},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}],async()=>{
    const run=gitRunner||((args)=>gitRuntime.gitCapability(info.projectCapability).run(args));let prior=null;
    try{prior=await resumeOperation({projectCapability:info.projectCapability,operationId,sessionId:info.sessionId,kind:'report-commit'});}
    catch(error){if(error.code!=='operation-not-found')throw error;}if(prior?.stage==='completed-ledger')return{...prior.result,
      operationId,receipt:prior};let preconditions=prior?.preconditions;if(!preconditions){const head=String((await checked(run,
        ['rev-parse','--verify','HEAD^{commit}'])).stdout).trim();const indexTree=String((await checked(run,['write-tree'])).stdout).trim();
      const staged=String((await checked(run,['diff','--cached','--name-only','-z'])).stdout||'').split('\0').filter(Boolean);
      if(staged.length)fail('report-foreign-index');const status=String((await checked(run,
        ['status','--porcelain=v1','-z','--untracked-files=all'])).stdout||'');const statusRows=reportStatusRows(status);
      if(statusRows.some((row)=>row.path!==relative))fail('report-foreign-worktree');if(statusRows.length>1)fail('report-path-manifest');
      preconditions={head,indexTree,statusSha256:sha256(Buffer.from(status)),paths:[relative],message,userChoice,reportSha256,
        reportBlobOid:reportBlobOid(reportBytes,head.length),hasChange:statusRows.length===1};}
    if(preconditions.userChoice!==userChoice||preconditions.message!==message||preconditions.reportSha256!==reportSha256||
        canonicalJson(preconditions.paths)!==canonicalJson([relative]))fail('report-precondition');const operation=await beginOperation({
      projectCapability:info.projectCapability,sessionId:info.sessionId,kind:'report-commit',operationId,preconditions});
    if(!preconditions.hasChange){const result={status:'nothing-to-commit',commit:preconditions.head,parent:preconditions.head,
        paths:[relative],message,userChoice};const receipt=await completeOperation(operation,result);return{...result,operationId,receipt};}
    const indexIdentity=async()=>{const staged=String((await checked(run,['diff','--cached','--name-only','-z'])).stdout||'')
        .split('\0').filter(Boolean);if(canonicalJson(staged)!==canonicalJson([relative]))return null;const row=String((await checked(run,
        ['ls-files','-s','--',relative])).stdout||'').trim();const match=row.match(/^([0-7]{6}) ([0-9a-f]{40,64}) 0\t(.+)$/);
      if(!match||match[3]!==relative||match[2]!==preconditions.reportBlobOid)return null;const tree=String((await checked(run,
        ['write-tree'])).stdout).trim();return /^[0-9a-f]{40,64}$/.test(tree)?tree:null;};
    let pending=await resumeOperation({projectCapability:info.projectCapability,operationId,sessionId:info.sessionId,kind:'report-commit'});
    let targetTree=pending.stages?.find((row)=>row.stage==='after-stage-0')?.details?.owned?.targetTree;
    if(!targetTree){const args=['add','-A','--',relative];const intent=pending.stages?.some((row)=>row.stage==='before-call-0');
      targetTree=await indexIdentity();if(targetTree){if(!intent)fail('report-index-adoption');if(!pending.stages?.some(
          (row)=>row.stage==='after-call-before-stage-0'))await recordOperationStage(operation,'after-call-before-stage-0',
          {owned:{args,stdout:'',stderr:'',adopted:true,targetTree}});await recordOperationStage(operation,'after-stage-0',
          {owned:{args,targetTree}});}else{const head=String((await checked(run,['rev-parse','--verify','HEAD^{commit}'])).stdout).trim();
        const indexTree=String((await checked(run,['write-tree'])).stdout).trim();const status=String((await checked(run,
          ['status','--porcelain=v1','-z','--untracked-files=all'])).stdout||'');if(head!==preconditions.head||
          indexTree!==preconditions.indexTree||sha256(Buffer.from(status))!==preconditions.statusSha256)fail('report-precondition-mismatch');
        if(!intent)await recordOperationStage(operation,'before-call-0',{owned:{args,indexTree:preconditions.indexTree,
          reportBlobOid:preconditions.reportBlobOid}});seam?.('before-call-0',{operationId,args});const call=await checked(run,args);
        seam?.('after-call-before-stage-0',{operationId,args});targetTree=await indexIdentity();if(!targetTree)fail('report-index-postcondition');
        await recordOperationStage(operation,'after-call-before-stage-0',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||'',targetTree}});
        await recordOperationStage(operation,'after-stage-0',{owned:{args,targetTree}});}}
    const authenticateCommit=async()=>{const head=String((await checked(run,['rev-parse','--verify','HEAD^{commit}'])).stdout).trim();
      if(head===preconditions.head)return null;const parent=String((await checked(run,['rev-parse','--verify',`${head}^1`])).stdout).trim();
      const second=await run(['rev-parse','--verify',`${head}^2`]);const tree=String((await checked(run,
        ['rev-parse','--verify',`${head}^{tree}`])).stdout).trim();const subject=String((await checked(run,
        ['show','-s','--format=%s',head])).stdout).trim();const changed=String((await checked(run,
        ['diff-tree','--no-commit-id','--name-only','-r','-z',head])).stdout||'').split('\0').filter(Boolean)
        .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));if(parent!==preconditions.head||second?.ok||tree!==targetTree||
        subject!==message||canonicalJson(changed)!==canonicalJson([relative]))fail('report-commit-adoption');return head;};
    pending=await resumeOperation({projectCapability:info.projectCapability,operationId,sessionId:info.sessionId,kind:'report-commit'});
    let committed=pending.stages?.find((row)=>row.stage==='commit-recorded')?.details?.owned?.commit||await authenticateCommit();
    const commitArgs=['commit','-m',message,'--',relative];if(committed){const intent=pending.stages?.some((row)=>row.stage==='before-call-1');
      if(!intent)fail('report-commit-adoption');if(!pending.stages?.some((row)=>row.stage==='after-call-before-stage-1'))
        await recordOperationStage(operation,'after-call-before-stage-1',{owned:{args:commitArgs,stdout:'',stderr:'',adopted:true}});
      if(!pending.stages?.some((row)=>row.stage==='after-stage-1'))await recordOperationStage(operation,'after-stage-1',
        {owned:{args:commitArgs,targetTree}});}
    else{await recordOperationStage(operation,'before-call-1',{owned:{args:commitArgs,parent:preconditions.head,targetTree}});
      seam?.('before-call-1',{operationId,args:commitArgs});const call=await checked(run,commitArgs);seam?.('after-call-before-stage-1',
        {operationId,args:commitArgs});committed=await authenticateCommit();if(!committed)fail('report-commit-postcondition');
      await recordOperationStage(operation,'after-call-before-stage-1',{owned:{args:commitArgs,stdout:call.stdout||'',stderr:call.stderr||''}});
      await recordOperationStage(operation,'after-stage-1',{owned:{args:commitArgs,targetTree}});}
    const remaining=String((await checked(run,['status','--porcelain=v1','-z','--untracked-files=all'])).stdout||'');
    if(remaining.length)fail('report-postcondition');await recordOperationStage(operation,'commit-recorded',{owned:{commit:committed,
      parent:preconditions.head,tree:targetTree,paths:[relative],message}});const result={status:'completed',commit:committed,
      parent:preconditions.head,tree:targetTree,paths:[relative],message,userChoice};const receipt=await completeOperation(operation,result);
    return{...result,operationId,receipt};});}

module.exports={readReceiptDashboard,readReceiptDetail,readSessionHistory,exportReceipts,generateReport,commitReport,renderExport,renderReport};
