'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto=require('node:crypto');
const childProcess = require('node:child_process');
const {
  revalidatePathCapability,
  issueProjectStateCapability,
  issueInitialWorktreeCapability,
  issueForkWorktreeCapability,
  spawnPortable,
  canonicalizePortableProjectPathV1,
  normalizeForCompare,
  parseGitWorktreePorcelainZ,
  WORKTREE_MANIFEST_MAX_ENTRIES,
  WORKTREE_MANIFEST_MAX_RELATIVE_PATH_BYTES,
  WORKTREE_MANIFEST_MAX_PATH_TOTAL_BYTES,
  WORKTREE_MANIFEST_MAX_FILE_BYTES,
  WORKTREE_MANIFEST_MAX_TOTAL_BYTES,
} = require('./platform.js');
const {beginOperation,recordOperationStage,completeOperation,resumeOperation,canonicalJson}=require('./operation-journal.js');
const {parseFrontmatter}=require('./frontmatter.js');
const {withRankedLocks,RANKS}=require('./transaction-runtime.js');

const NODE_AUTHORITY=Object.freeze({runtime:'node',shell:false,authority:'git-runtime-v1'});
const WORKTREE_LIST_ARGS=Object.freeze(['worktree','list','--porcelain','-z']);

function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}

function samePortablePath(left,right,{allowMissing=false}={}){
  const identity=(stat)=>({dev:String(stat.dev),ino:String(stat.ino),mode:stat.mode,
    type:stat.isDirectory()?'directory':stat.isFile()?'file':stat.isSymbolicLink()?'link':'other'});
  const equal=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.type===b.type;
  try{const leftBefore=fs.lstatSync(left);const rightBefore=fs.lstatSync(right);
    if(leftBefore.isSymbolicLink()||rightBefore.isSymbolicLink())return false;
    fs.realpathSync(left);fs.realpathSync(right);
    const leftAfter=fs.lstatSync(left);const rightAfter=fs.lstatSync(right);
    return !leftAfter.isSymbolicLink()&&!rightAfter.isSymbolicLink()&&
      equal(identity(leftBefore),identity(leftAfter))&&equal(identity(rightBefore),identity(rightAfter))&&
      equal(identity(leftAfter),identity(rightAfter));}
  catch{if(!allowMissing)return false;return normalizeForCompare(path.resolve(left),process.platform)===
    normalizeForCompare(path.resolve(right),process.platform);}}

function resolveGit(){
  const search=(process.env.PATH||'').split(path.delimiter);
  const names=process.platform==='win32'?['git.exe']:['git'];
  for(const directory of search){for(const name of names){const candidate=path.join(directory,name);
    try{const stat=fs.lstatSync(candidate);if(stat.isFile()&&!stat.isSymbolicLink())return candidate;}catch{}}}
  fail('git-unavailable');
}

function gitEnvironment(lineEndingConversion){
  const environment={...process.env};
  if(lineEndingConversion===undefined)return environment;
  if(lineEndingConversion!=='disabled')fail('git-line-ending-mode');
  for(const key of Object.keys(environment)){
    if(/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/i.test(key))delete environment[key];
  }
  environment.GIT_CONFIG_COUNT='1';
  environment.GIT_CONFIG_KEY_0='core.autocrlf';
  environment.GIT_CONFIG_VALUE_0='false';
  return environment;
}

function gitCapability(projectCapability,{spawnPortable:spawnImpl=spawnPortable}={}){
  if(!projectCapability||projectCapability.role!=='project-root')fail('git-project-capability');
  revalidatePathCapability(projectCapability,'git-capability');
  const executable=resolveGit();
  return Object.freeze({kind:'git-capability',projectCapability,executable,
    async run(args,options={}){
      const allowed=new Set(['timeoutMs','maxOutputBytes','input','lineEndingConversion']);
      if(Object.keys(options).some((key)=>!allowed.has(key)))fail('git-run-option');
      const {timeoutMs=120000,maxOutputBytes=1048576,input,lineEndingConversion}=options;
      revalidatePathCapability(projectCapability,'git-before-argv');
      if(!Array.isArray(args)||args.some((arg)=>typeof arg!=='string'||/[\0\r\n]/.test(arg)))fail('git-argv');
      if(input!==undefined)fail('git-input-unsupported','portable Git runtime does not accept stdin');
      return spawnImpl({kind:'native-executable',executable,args},{projectCapability,
        timeoutMs,maxOutputBytes,env:gitEnvironment(lineEndingConversion)});
    }});
}

const parseWorktreePorcelain=parseGitWorktreePorcelainZ;

async function checkedRun(git,args,options){const result=await git.run(args,options);
  if(!result||result.ok!==true)fail('git-command-failed',result?.stderr||args.join(' '));return result;}
async function listWorktrees(git){return parseWorktreePorcelain((await checkedRun(git,WORKTREE_LIST_ARGS)).stdout);}

async function repositoryContext(git){
  const head=(await checkedRun(git,['rev-parse','--verify','HEAD^{commit}'])).stdout.trim();
  const branchResult=await git.run(['symbolic-ref','--short','HEAD']);
  const branch=branchResult.ok?branchResult.stdout.trim():null;
  const status=(await checkedRun(git,['status','--porcelain=v1','-z','--untracked-files=all'])).stdout;
  if(!/^[0-9a-f]{40,64}$/.test(head))fail('git-head');
  return {headOid:head,branch,dirty:status.length>0};
}

function currentRepositoryContext(projectCapability){
  revalidatePathCapability(projectCapability,'current-repository-project');
  const gitPath=path.join(projectCapability.path,'.git');
  let directory=gitPath;const marker=fs.lstatSync(gitPath);
  if(marker.isFile()){const text=fs.readFileSync(gitPath,'utf8').trim();const match=text.match(/^gitdir: (.+)$/);
    if(!match)fail('git-marker');directory=path.resolve(projectCapability.path,match[1]);}
  let headText;try{headText=fs.readFileSync(path.join(directory,'HEAD'),'utf8').trim();}
  catch(error){if(error.code==='ENOENT')fail('git-head');throw error;}
  const symbolic=headText.match(/^ref: (refs\/heads\/(.+))$/);const branch=symbolic?symbolic[2]:null;
  let common=directory;try{common=path.resolve(directory,fs.readFileSync(path.join(directory,'commondir'),'utf8').trim());}catch{}
  let headOid=headText;if(symbolic){const loose=[path.join(directory,...symbolic[1].split('/')),
      path.join(common,...symbolic[1].split('/'))].find((file)=>fs.existsSync(file));
    if(loose)headOid=fs.readFileSync(loose,'utf8').trim();else{let packed='';try{packed=fs.readFileSync(path.join(common,'packed-refs'),'utf8');}catch{}
      const row=packed.split(/\r?\n/).find((line)=>line.endsWith(` ${symbolic[1]}`));headOid=row?.split(' ')[0]||'';}}
  if(!/^[0-9a-f]{40,64}$/.test(headOid))fail('git-head');
  const entries=[];let pathBytes=0,fileBytes=0;const walk=(directoryPath)=>{for(const name of fs.readdirSync(directoryPath)
      .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){if(directoryPath===projectCapability.path&&name==='.git')continue;
      const target=path.join(directoryPath,name);const relative=path.relative(projectCapability.path,target).split(path.sep).join('/');
      canonicalizePortableProjectPathV1(relative);const relativeBytes=Buffer.byteLength(relative);if(relativeBytes>
        WORKTREE_MANIFEST_MAX_RELATIVE_PATH_BYTES)fail('current-repository-path-limit');pathBytes+=relativeBytes;
      if(pathBytes>WORKTREE_MANIFEST_MAX_PATH_TOTAL_BYTES)fail('current-repository-path-total-limit');const stat=fs.lstatSync(target);
      if(stat.isDirectory()){entries.push({path:relative,type:'directory',mode:stat.mode});walk(target);}
      else if(stat.isFile()){if(stat.size>WORKTREE_MANIFEST_MAX_FILE_BYTES)fail('current-repository-file-limit');fileBytes+=stat.size;
        if(fileBytes>WORKTREE_MANIFEST_MAX_TOTAL_BYTES)fail('current-repository-total-limit');const bytes=fs.readFileSync(target);
        const after=fs.lstatSync(target);if(bytes.length!==stat.size||after.size!==stat.size||after.mtimeNs!==stat.mtimeNs||after.ino!==stat.ino)
          fail('current-repository-race');entries.push({path:relative,type:'file',mode:stat.mode,size:bytes.length,
          sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
      else if(stat.isSymbolicLink()){const link=fs.readlinkSync(target);if(Buffer.byteLength(link)>WORKTREE_MANIFEST_MAX_FILE_BYTES)
        fail('current-repository-file-limit');entries.push({path:relative,type:'link',mode:stat.mode,target:link});}
      else fail('current-repository-entry');if(entries.length>WORKTREE_MANIFEST_MAX_ENTRIES)fail('current-repository-entry-limit');}};
  walk(projectCapability.path);let index=Buffer.alloc(0);try{const stat=fs.lstatSync(path.join(directory,'index'));
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>WORKTREE_MANIFEST_MAX_FILE_BYTES)fail('current-repository-index-limit');
    index=fs.readFileSync(path.join(directory,'index'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const dirtyManifest={version:1,headOid,indexSha256:crypto.createHash('sha256').update(index).digest('hex'),entries};
  const dirtyManifestSha256=crypto.createHash('sha256').update(require('./operation-journal.js').canonicalJson(dirtyManifest)).digest('hex');
  return {headOid,branch,dirty:null,dirtyManifest,dirtyManifestSha256};
}

function validBaseRef(value){return value==='HEAD'||typeof value==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value)&&!value.includes('..')&&!value.endsWith('/');}
async function inspectInitialRepository({projectCapability,sessionId,mode,baseRef='HEAD',gitRunner}={}){
  if(!/^s-[0-9a-f]{8}$/.test(sessionId||''))fail('git-session');if(!['worktree','new-branch','current-branch'].includes(mode))fail('git-mode');
  if(!validBaseRef(baseRef))fail('git-base-ref');const gitPath=path.join(projectCapability.path,'.git');
  if(mode==='current-branch'){if(!fs.existsSync(gitPath))return{mode,repositoryKind:'none',baseRef:null,baseOid:null,
      before:{headOid:null,branch:null,dirty:false,noRepository:true}};const before=currentRepositoryContext(projectCapability);
    return{mode,repositoryKind:'git',baseRef:null,baseOid:before.headOid,before};}
  const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));const branch=`deep-work-${sessionId.slice(2)}`;
  const baseOid=String((await stashChecked(run,['rev-parse','--verify',`${baseRef}^{commit}`],'initial-base-ref')).stdout).trim();
  if(!/^[0-9a-f]{40,64}$/.test(baseOid))fail('initial-base-ref');const branchResult=await run(['symbolic-ref','--short','HEAD']);
  const currentBranch=branchResult?.ok?String(branchResult.stdout).trim():null;const snapshot=await stashSnapshot(projectCapability,run);
  return{mode,repositoryKind:'git',baseRef,baseOid,branch,currentBranch,before:snapshot,
    preconditionSha256:stashDigest({mode,baseRef,baseOid,branch,currentBranch,before:snapshot})};}
async function prepareInitialRepository({projectCapability,sessionId,mode,baseRef='HEAD',operation,inspection,gitRunner,seam}={}){
  const expected=inspection||await inspectInitialRepository({projectCapability,sessionId,mode,baseRef,gitRunner});
  if(expected.mode!==mode||expected.baseRef!==(mode==='current-branch'?null:baseRef))fail('initial-inspection');
  if(mode==='current-branch'){const repositoryContext=expected.repositoryKind==='none'?{headOid:null,branch:null,dirty:false,
      dirtyManifest:null,dirtyManifestSha256:null,noRepository:true,repositoryMode:mode,worktreePurpose:'current',
      worktreePath:projectCapability.path}:{...expected.before,repositoryMode:mode,worktreePurpose:'current',
      worktreePath:projectCapability.path};
    if(operation)await recordOperationStage(operation,'repository-prepared',{owned:{mode,repositoryContext,
      inspectionSha256:stashDigest(expected)}});return{mode,repositoryContext};}
  if(!operation||operation.kind!=='initial-repository-prepare'||operation.sessionId!==sessionId)fail('initial-operation');
  const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));let pending=await resumeOperation({projectCapability,
    operationId:operation.operationId,sessionId,kind:'initial-repository-prepare'});const recorded=pending.stages?.find(
      (row)=>row.stage==='repository-prepared')?.details?.owned;if(recorded){if(recorded.mode!==mode||
        recorded.inspectionSha256!==stashDigest(expected))fail('initial-repository-adoption');
    if(mode==='worktree'){const candidate=recorded.repositoryContext.worktreePath;const capability=issueInitialWorktreeCapability({
        projectRoot:projectCapability.path,candidate,sessionId,branch:expected.branch,baseRef:expected.baseOid,allowMissingLeaf:false});
      revalidatePathCapability(capability,'initial-worktree-adoption');return{mode,worktreeCapability:capability,
        repositoryContext:recorded.repositoryContext};}return{mode,repositoryContext:recorded.repositoryContext};}
  const calls=pending.stages?.filter((row)=>/^before-call-\d+$/.test(row.stage))||[];if(calls.length>1)fail('initial-repository-ambiguous');
  const candidate=mode==='worktree'?path.join(path.dirname(projectCapability.path),
    `${path.basename(projectCapability.path)}-wt-${sessionId.slice(2)}`):projectCapability.path;
  let capability=null;const adopt=async()=>{if(mode==='new-branch'){const after=await repositoryContext({run});
      if(after.branch!==expected.branch||after.headOid!==expected.baseOid||after.dirty)fail('initial-repository-adoption');
      return{mode,repositoryContext:{...after,repositoryMode:mode,worktreePurpose:'initial-session',worktreePath:projectCapability.path}};}
    const rows=parseWorktreePorcelain(String((await stashChecked(run,WORKTREE_LIST_ARGS,'initial-worktree-query')).stdout));
    const row=rows.filter((item)=>samePortablePath(item.path,candidate));
    if(row.length!==1)fail('initial-repository-adoption',
      `expected one physical worktree match, found ${row.length} of ${rows.length}`);
    if(row[0].head!==expected.baseOid)fail('initial-repository-adoption','worktree HEAD mismatch');
    if(row[0].branch!==`refs/heads/${expected.branch}`)fail('initial-repository-adoption','worktree branch mismatch');
    const ref=String((await stashChecked(run,
      ['show-ref','--verify','--hash',`refs/heads/${expected.branch}`],'initial-worktree-ref')).stdout).trim();
    if(ref!==expected.baseOid)fail('initial-repository-adoption','branch ref mismatch');capability=issueInitialWorktreeCapability({projectRoot:projectCapability.path,
      candidate,sessionId,branch:expected.branch,baseRef:expected.baseOid,allowMissingLeaf:false});revalidatePathCapability(capability,
      'initial-worktree-adoption');return{mode,worktreeCapability:capability,repositoryContext:{headOid:expected.baseOid,
      branch:expected.branch,dirty:false,repositoryMode:mode,worktreePurpose:'initial-session',worktreePath:capability.path}};};
  let prepared;if(calls.length)prepared=await adopt();else{if(mode==='new-branch'){
      if(expected.before.trackedChanged||expected.before.untracked.length||!expected.currentBranch)fail('initial-repository-precondition');
    }else{try{fs.lstatSync(candidate);fail('initial-worktree-collision');}catch(error){if(error.code!=='ENOENT')throw error;}
      const existing=await run(['show-ref','--verify','--hash',`refs/heads/${expected.branch}`]);if(existing?.ok)fail('initial-branch-collision');
      capability=issueInitialWorktreeCapability({projectRoot:projectCapability.path,candidate,sessionId,branch:expected.branch,
        baseRef:expected.baseOid,allowMissingLeaf:true});}
    const args=mode==='new-branch'?['switch','-c',expected.branch,expected.baseOid]:
      ['worktree','add','-b',expected.branch,capability.path,expected.baseOid];await recordOperationStage(operation,'before-call-0',
      {owned:{args,inspectionSha256:stashDigest(expected)}});seam?.('before-call',{operationId:operation.operationId,mode,args});
    const call=await run(args);if(!call?.ok)fail('initial-repository-call',call?.stderr);seam?.('after-call-before-stage',
      {operationId:operation.operationId,mode,args});await recordOperationStage(operation,'after-call-before-stage-0',
      {owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,'after-stage-0',{owned:{args}});
    prepared=await adopt();}
  await recordOperationStage(operation,'repository-prepared',{owned:{mode,repositoryContext:prepared.repositoryContext,
    inspectionSha256:stashDigest(expected)}});return prepared;
}

async function inspectForkRepository({projectCapability,parentSessionId,childSessionId,parentStateCapability,gitRunner}={}){
  if(!/^s-[0-9a-f]{8}$/.test(parentSessionId||'')||!/^s-[0-9a-f]{8}$/.test(childSessionId||''))fail('fork-session');
  if(!parentStateCapability||parentStateCapability.role!=='session-state'||
      parentStateCapability.projectRoot!==projectCapability.path||
      !parentStateCapability.path.endsWith(`deep-work.${parentSessionId}.md`))fail('fork-parent-capability');
  revalidatePathCapability(parentStateCapability,'fork-parent-state');
  const parentBytes=fs.readFileSync(parentStateCapability.path);const parent=parseFrontmatter(parentBytes.toString('utf8')).fields;
  const parentBranch=parent.branch;const baseOid=parent.head_oid||parent.headOid;
  if(typeof parentBranch!=='string'||!parentBranch||!/^[0-9a-f]{40,64}$/.test(baseOid||''))fail('fork-parent-identity');
  const suffix=childSessionId.slice(2);const branch=`${parentBranch}-fork-${suffix}`;
  const candidate=path.join(path.dirname(projectCapability.path),`${path.basename(projectCapability.path)}-wt-fork-${suffix}`);
  revalidatePathCapability(parentStateCapability,'fork-before-git');
  const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));await stashChecked(run,['check-ref-format','--branch',parentBranch],
    'fork-parent-branch');await stashChecked(run,['check-ref-format','--branch',branch],'fork-child-branch');
  const rows=parseWorktreePorcelain(String((await stashChecked(run,WORKTREE_LIST_ARGS,'fork-worktree-query')).stdout));
  const ref=await run(['show-ref','--verify','--hash',`refs/heads/${branch}`]);return{parentSessionId,childSessionId,parentBranch,
    branch,baseOid,candidate,parentStateSha256:stashDigest(parentBytes),candidateExists:fs.existsSync(candidate),
    branchOid:ref?.ok?String(ref.stdout).trim():null,registered:rows.some((row)=>samePortablePath(row.path,candidate))};}
async function createFork({projectCapability,parentSessionId,childSessionId,parentStateCapability,operation,inspection,gitRunner,seam}={}){
  const expected=inspection||await inspectForkRepository({projectCapability,parentSessionId,childSessionId,parentStateCapability,gitRunner});
  if(!operation||operation.kind!=='fork-create'||operation.sessionId!==childSessionId)fail('fork-operation');
  const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));let pending=await resumeOperation({projectCapability,
    operationId:operation.operationId,sessionId:childSessionId,kind:'fork-create'});const recorded=pending.stages?.find(
      (row)=>row.stage==='worktree-created')?.details?.owned;const adopt=async()=>{const rows=parseWorktreePorcelain(String((await stashChecked(run,
      WORKTREE_LIST_ARGS,'fork-worktree-query')).stdout));if(!fs.existsSync(expected.candidate))fail('fork-adoption');
    const matches=rows.filter((row)=>samePortablePath(row.path,expected.candidate));
    if(matches.length!==1||matches[0].head!==expected.baseOid||matches[0].branch!==`refs/heads/${expected.branch}`)fail('fork-adoption');
    const ref=String((await stashChecked(run,['show-ref','--verify','--hash',`refs/heads/${expected.branch}`],'fork-ref')).stdout).trim();
    if(ref!==expected.baseOid)fail('fork-adoption');const capability=issueForkWorktreeCapability({projectRoot:projectCapability.path,
      candidate:expected.candidate,sessionId:childSessionId,parentBranch:expected.parentBranch,branch:expected.branch,allowMissingLeaf:false});
    revalidatePathCapability(capability,'fork-adoption');return{worktreeCapability:capability,branch:expected.branch,path:capability.path,
      headOid:expected.baseOid,parentBranch:expected.parentBranch};};
  if(recorded){if(!samePortablePath(recorded.path,expected.candidate)||recorded.branch!==expected.branch||recorded.headOid!==expected.baseOid)
      fail('fork-adoption');return adopt();}
  const called=pending.stages?.some((row)=>row.stage==='before-call-0');let created;if(called)created=await adopt();else{
    if(expected.candidateExists||expected.registered||expected.branchOid!==null)fail('fork-collision');const capability=issueForkWorktreeCapability({
      projectRoot:projectCapability.path,candidate:expected.candidate,sessionId:childSessionId,parentBranch:expected.parentBranch,
      branch:expected.branch,allowMissingLeaf:true});const args=['worktree','add','-b',expected.branch,capability.path,expected.baseOid];
    await recordOperationStage(operation,'before-call-0',{owned:{args,inspectionSha256:stashDigest(expected)}});
    seam?.('before-call',{operationId:operation.operationId,args});const call=await run(args);if(!call?.ok)fail('fork-create-call',call?.stderr);
    seam?.('after-call-before-stage',{operationId:operation.operationId,args});await recordOperationStage(operation,'after-call-before-stage-0',
      {owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,'after-stage-0',{owned:{args}});
    created=await adopt();}
  await recordOperationStage(operation,'worktree-created',{owned:{path:created.path,branch:created.branch,headOid:created.headOid,
    parentBranch:created.parentBranch,inspectionSha256:stashDigest(expected)}});return created;
}

function resolveForkWorktreeCapability({projectCapability,stateCapability,sessionId,comparisonPath}={}){
  if(!/^s-[0-9a-f]{8}$/.test(sessionId||'')||!stateCapability||stateCapability.role!=='session-state'||
      stateCapability.projectRoot!==projectCapability.path||!stateCapability.path.endsWith(`deep-work.${sessionId}.md`))
    fail('managed-worktree-state');
  revalidatePathCapability(stateCapability,'managed-worktree-state');const fields=parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
  if(fields.session_id!==undefined&&fields.session_id!==sessionId)fail('managed-worktree-state');
  const parentBranch=fields.parent_branch;const branch=fields.branch;const candidate=fields.worktree_path;
  if(typeof parentBranch!=='string'||typeof branch!=='string'||typeof candidate!=='string')fail('managed-worktree-state');
  if(comparisonPath!==undefined&&!samePortablePath(comparisonPath,candidate,{allowMissing:true}))fail('managed-worktree-comparison');
  const capability=issueForkWorktreeCapability({projectRoot:projectCapability.path,candidate,sessionId,parentBranch,
    branch,allowMissingLeaf:!fs.existsSync(candidate)});
  if(fs.existsSync(candidate))revalidatePathCapability(capability,'managed-worktree-resolve');return capability;
}

async function scanCleanupCandidates({projectCapability,registry}){
  const rows=await listWorktrees(gitCapability(projectCapability));
  return Object.entries(registry.sessions||{}).filter(([,entry])=>entry.current_phase==='idle'&&entry.worktree_path&&
    rows.some((row)=>samePortablePath(row.path,entry.worktree_path)))
    .map(([sessionId,entry])=>({sessionId,path:entry.worktree_path,branch:entry.branch}));
}

async function removeWorktree({projectCapability,worktreeCapability,force=false,operation,expectedHead,seam,gitRunner,callIndex=0}){
  if(!worktreeCapability||worktreeCapability.kind!=='managed-worktree')fail('managed-worktree-capability');
  if(!operation||!['cleanup-remove','finish-discard','finish-merge'].includes(operation.kind)||
      operation.sessionId!==worktreeCapability.sessionId||!Number.isInteger(callIndex)||callIndex<0)fail('cleanup-operation');
  const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));let pending=await resumeOperation({projectCapability,
    operationId:operation.operationId,sessionId:operation.sessionId,kind:operation.kind});const recorded=pending.stages?.find(
      (row)=>row.stage==='worktree-removed')?.details?.owned;const query=async()=>{const rows=parseWorktreePorcelain(String((await stashChecked(run,
      WORKTREE_LIST_ARGS,'cleanup-worktree-query')).stdout));const matches=rows.filter((row)=>
      samePortablePath(row.path,worktreeCapability.path,{allowMissing:true}));return matches;};
  if(recorded){if(recorded.path!==worktreeCapability.path)
      fail('cleanup-worktree-adoption');if(fs.existsSync(worktreeCapability.path)||(await query()).length)fail('cleanup-worktree-adoption');
    return{removed:true,path:worktreeCapability.path,adopted:true,head:recorded.head};}
  const rows=await query();const intent=pending.stages?.some((row)=>row.stage===`before-call-${callIndex}`);if(!rows.length){if(!intent)
      fail('cleanup-worktree-absent');await recordOperationStage(operation,'worktree-removed',{owned:{path:worktreeCapability.path,
        branch:worktreeCapability.branch,head:expectedHead||null,adopted:true}});return{removed:true,path:worktreeCapability.path,adopted:true,
      head:expectedHead||null};}
  if(rows.length!==1||rows[0].branch!==`refs/heads/${worktreeCapability.branch}`||expectedHead&&rows[0].head!==expectedHead)
    fail('cleanup-worktree-identity');revalidatePathCapability(worktreeCapability,'cleanup-worktree-before-argv');const args=['worktree','remove',
      ...(force?['--force']:[]),worktreeCapability.path];await recordOperationStage(operation,`before-call-${callIndex}`,{owned:{args,
        path:worktreeCapability.path,branch:worktreeCapability.branch,head:rows[0].head}});seam?.('before-call',{operationId:operation.operationId,args});
  const call=await run(args);if(!call?.ok)fail('cleanup-worktree-remove',call?.stderr);seam?.('after-call-before-stage',
    {operationId:operation.operationId,args});await recordOperationStage(operation,`after-call-before-stage-${callIndex}`,{owned:{args,
      stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,`after-stage-${callIndex}`,{owned:{args}});
  if(fs.existsSync(worktreeCapability.path)||(await query()).length)fail('cleanup-worktree-postcondition');await recordOperationStage(operation,
    'worktree-removed',{owned:{path:worktreeCapability.path,branch:worktreeCapability.branch,head:rows[0].head,adopted:false}});
  return {removed:true,path:worktreeCapability.path,adopted:false,head:rows[0].head};
}
async function deleteBranchExact({projectCapability,sessionId,branch,expectedOid,force=false,parentOperationId,gitRunner,seam}={}){
  if(!/^s-[0-9a-f]{8}$/.test(sessionId||'')||typeof branch!=='string'||!/^[0-9a-f]{40,64}$/.test(expectedOid||'')||
      !/^op-[0-9a-f]{32,64}$/.test(parentOperationId||''))fail('branch-delete-input');const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));
  await stashChecked(run,['check-ref-format','--branch',branch],'branch-delete-ref');const preconditions={branch,expectedOid,force,parentOperationId};
  const operationId=`op-${stashDigest({kind:'branch-delete',sessionId,preconditions})}`;let prior=null;try{prior=await resumeOperation({projectCapability,
      operationId,sessionId,kind:'branch-delete'});}catch(error){if(error.code!=='operation-not-found')throw error;}
  if(prior?.stage==='completed-ledger'){if(prior.result?.branch!==branch||prior.result?.expectedOid!==expectedOid||
      prior.result?.parentOperationId!==parentOperationId)fail('branch-delete-adoption');return{...prior.result,operationId,operationReceipt:prior};}
  const operation=await beginOperation({projectCapability,sessionId,kind:'branch-delete',operationId,preconditions});const pending=await resumeOperation({
      projectCapability,operationId:operation.operationId,sessionId,kind:'branch-delete'});const ref=await run(['show-ref','--verify','--hash',`refs/heads/${branch}`]);
  const oid=ref?.ok?String(ref.stdout).trim():null;const intent=pending.stages?.some((row)=>row.stage==='before-call-0');if(oid===null){
    if(!intent)fail('branch-delete-absent');const result={status:'deleted',branch,expectedOid,adopted:true,parentOperationId};return{...result,
      operationId:operation.operationId,operationReceipt:await completeOperation(operation,result)};}
  if(oid!==expectedOid)fail('branch-delete-diverged');const args=['branch',force?'-D':'-d',branch];await recordOperationStage(operation,'before-call-0',
    {owned:{args,expectedOid}});seam?.('before-call',{operationId:operation.operationId,args});const call=await run(args);
  if(!call?.ok)fail('branch-delete-call',call?.stderr);seam?.('after-call-before-stage',{operationId:operation.operationId,args});
  await recordOperationStage(operation,'after-call-before-stage-0',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});
  await recordOperationStage(operation,'after-stage-0',{owned:{args}});const after=await run(['show-ref','--verify','--hash',`refs/heads/${branch}`]);
  if(after?.ok)fail('branch-delete-postcondition');const result={status:'deleted',branch,expectedOid,adopted:false,parentOperationId};return{...result,
    operationId:operation.operationId,operationReceipt:await completeOperation(operation,result)};}

async function finishDiscardWithinOperation({operation,projectCapability,stateCapability,stateFields,force=false,seam,gitRunner}={}){
  if(!operation||operation.kind!=='finish-discard'||operation.sessionId!==stateFields?.session_id&&stateFields?.session_id!==undefined)
    fail('finish-discard-operation');const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));let pending=await resumeOperation({
      projectCapability,operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-discard'});let inspection=pending.stages?.find(
      (row)=>row.stage==='finish-inspected')?.details?.owned;if(!stateFields?.worktree_enabled||typeof stateFields?.worktree_path!=='string'){
    if(!inspection){inspection={status:'no-managed-worktree',force:Boolean(force)};await recordOperationStage(operation,'finish-inspected',{owned:inspection});}
    return inspection;}
  let worktreeCapability=resolveForkWorktreeCapability({projectCapability,stateCapability,sessionId:operation.sessionId,
    comparisonPath:stateFields.worktree_path});if(!inspection){const rows=parseWorktreePorcelain(String((await stashChecked(run,
      WORKTREE_LIST_ARGS,'finish-discard-query')).stdout));const matches=rows.filter(
      (row)=>samePortablePath(row.path,worktreeCapability.path));if(matches.length!==1||
      matches[0].branch!==`refs/heads/${worktreeCapability.branch}`)fail('finish-discard-identity');const status=String((await stashChecked(run,
      ['-C',worktreeCapability.path,'status','--porcelain=v1','-z','--untracked-files=all'],'finish-discard-status')).stdout||'');
    if(status.length&&!force)fail('finish-discard-dirty');inspection={status:'managed-worktree',force:Boolean(force),path:worktreeCapability.path,
      branch:worktreeCapability.branch,head:matches[0].head,statusSha256:stashDigest(Buffer.from(status))};await recordOperationStage(operation,
      'finish-inspected',{owned:inspection});}
  pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-discard'});
  if(!pending.stages?.some((row)=>row.stage==='worktree-removed'))await removeWorktree({projectCapability,worktreeCapability,force,
    operation,expectedHead:inspection.head,gitRunner:run,seam:(name,context)=>seam?.(`worktree-${name}`,context),callIndex:0});
  pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-discard'});
  if(!pending.stages?.some((row)=>row.stage==='branch-deleted')){const deleted=await deleteBranchExact({projectCapability,
      sessionId:operation.sessionId,branch:inspection.branch,expectedOid:inspection.head,force:true,parentOperationId:operation.operationId,
      gitRunner:run,seam:(name,context)=>seam?.(`branch-${name}`,context)});seam?.('after-branch-delete-before-stage',
      {operationId:operation.operationId});await recordOperationStage(operation,'branch-deleted',{owned:{branch:inspection.branch,
        expectedOid:inspection.head,childOperationId:deleted.operationId}});}
  return{status:'discarded',force:Boolean(force),path:inspection.path,branch:inspection.branch,head:inspection.head};}

async function visibleWorktreeManifest(root,run){const output=String((await stashChecked(run,
    ['ls-files','--cached','--others','--exclude-standard','-z'],'worktree-file-manifest')).stdout||'');const names=output.split('\0')
    .filter(Boolean).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));if(new Set(names).size!==names.length||names.length>100000)
    fail('worktree-file-manifest');const rows=[];let total=0;for(const relative of names){if(path.isAbsolute(relative)||relative.split('/').includes('..'))
      fail('worktree-file-manifest');const target=path.join(root,...relative.split('/'));const stat=fs.lstatSync(target);let bytes,mode;
    if(stat.isSymbolicLink()){bytes=Buffer.from(fs.readlinkSync(target));mode='120000';}else if(stat.isFile()){
      bytes=fs.readFileSync(target);mode=stat.mode&0o111?'100755':'100644';}else fail('worktree-file-manifest');
    total+=bytes.length;if(total>64*1024*1024)fail('worktree-file-manifest');rows.push({path:relative,mode,size:bytes.length,sha256:stashDigest(bytes)});}
  return{rows,sha256:stashDigest(rows)};}
async function commitDirtyWorktreeExact({projectCapability,worktreeCapability,sessionId,parentOperationId,expectedHead,
  expectedManifest,gitRunner,seam}={}){const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));const childRun=(args)=>run(
    ['-C',worktreeCapability.path,...args]);const message=`deep-work fork precommit: ${sessionId}`;const preconditions={parentOperationId,
    expectedHead,manifestSha256:expectedManifest.sha256,message};const operationId=`op-${stashDigest({kind:'fork-precommit',sessionId,preconditions})}`;
  let prior=null;try{prior=await resumeOperation({projectCapability,operationId,sessionId,kind:'fork-precommit'});}
  catch(error){if(error.code!=='operation-not-found')throw error;}if(prior?.stage==='completed-ledger'){if(prior.result?.parentOperationId!==parentOperationId||
      prior.result?.parent!==expectedHead||prior.result?.manifestSha256!==expectedManifest.sha256)fail('fork-precommit-adoption');
    return{...prior.result,operationId,operationReceipt:prior};}const operation=await beginOperation({projectCapability,sessionId,
    kind:'fork-precommit',operationId,preconditions});let pending=await resumeOperation({projectCapability,operationId,sessionId,
      kind:'fork-precommit'});let staged=pending.stages?.find((row)=>row.stage==='after-stage-0')?.details?.owned;
  const currentHead=()=>stashChecked(childRun,['rev-parse','--verify','HEAD^{commit}'],'fork-precommit-head').then((row)=>String(row.stdout).trim());
  if(!staged){if(await currentHead()!==expectedHead)fail('fork-precommit-head');const manifest=await visibleWorktreeManifest(worktreeCapability.path,childRun);
    if(manifest.sha256!==expectedManifest.sha256)fail('fork-precommit-manifest');const unstaged=await childRun(['diff','--quiet','--']);const others=
      String((await stashChecked(childRun,['ls-files','--others','--exclude-standard','-z'],'fork-precommit-untracked')).stdout||'');
    const intent=pending.stages?.some((row)=>row.stage==='before-call-0');if(intent&&unstaged?.ok&&others.length===0){const targetTree=
        String((await stashChecked(childRun,['write-tree'],'fork-precommit-tree')).stdout).trim();const args=['-C',worktreeCapability.path,'add','-A'];
      await recordOperationStage(operation,'after-call-before-stage-0',{owned:{args,stdout:'',stderr:'',adopted:true,targetTree}});
      await recordOperationStage(operation,'after-stage-0',{owned:{args,targetTree}});staged={args,targetTree};}
    else{const args=['-C',worktreeCapability.path,'add','-A'];await recordOperationStage(operation,'before-call-0',{owned:{args,
        manifestSha256:expectedManifest.sha256}});seam?.('before-call',{operationId,kind:'fork-precommit-add',args});const call=await run(args);
      if(!call?.ok)fail('fork-precommit-add',call?.stderr);seam?.('after-call-before-stage',{operationId,kind:'fork-precommit-add',args});
      const targetTree=String((await stashChecked(childRun,['write-tree'],'fork-precommit-tree')).stdout).trim();await recordOperationStage(operation,
        'after-call-before-stage-0',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||'',targetTree}});
      await recordOperationStage(operation,'after-stage-0',{owned:{args,targetTree}});staged={args,targetTree};}}
  pending=await resumeOperation({projectCapability,operationId,sessionId,kind:'fork-precommit'});const authenticate=async()=>{
    const head=await currentHead();if(head===expectedHead)return null;const parent=String((await stashChecked(childRun,
      ['rev-parse','--verify',`${head}^1`],'fork-precommit-parent')).stdout).trim();const tree=String((await stashChecked(childRun,
      ['rev-parse','--verify',`${head}^{tree}`],'fork-precommit-tree')).stdout).trim();const subject=String((await stashChecked(childRun,
      ['show','-s','--format=%s',head],'fork-precommit-message')).stdout).trim();if(parent!==expectedHead||tree!==staged.targetTree||subject!==message)
      fail('fork-precommit-adoption');return head;};const commitArgs=['-C',worktreeCapability.path,'commit','-m',message];let commitOid=await authenticate();
  if(commitOid){const intent=pending.stages?.find((row)=>row.stage==='before-call-1')?.details?.owned;
    if(!intent||canonicalJson(intent.args)!==canonicalJson(commitArgs)||intent.targetTree!==staged.targetTree)fail('fork-precommit-adoption');
    if(!pending.stages?.some((row)=>row.stage==='after-call-before-stage-1'))await recordOperationStage(operation,
      'after-call-before-stage-1',{owned:{args:commitArgs,stdout:'',stderr:'',adopted:true}});
    if(!pending.stages?.some((row)=>row.stage==='after-stage-1'))await recordOperationStage(operation,'after-stage-1',
      {owned:{args:commitArgs,targetTree:staged.targetTree}});
  }else{const args=commitArgs;await recordOperationStage(operation,'before-call-1',{owned:{args,targetTree:staged.targetTree}});
    seam?.('before-call',{operationId,kind:'fork-precommit-commit',args});const call=await run(args);if(!call?.ok)fail('fork-precommit-commit',call?.stderr);
    seam?.('after-call-before-stage',{operationId,kind:'fork-precommit-commit',args});await recordOperationStage(operation,
      'after-call-before-stage-1',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,
      'after-stage-1',{owned:{args,targetTree:staged.targetTree}});commitOid=await authenticate();if(!commitOid)fail('fork-precommit-postcondition');}
  const result={status:'committed',commitOid,parent:expectedHead,tree:staged.targetTree,message,manifestSha256:expectedManifest.sha256,
    parentOperationId};return{...result,operationId,operationReceipt:await completeOperation(operation,result)};}

async function finishMergeWithinOperation({operation,projectCapability,stateCapability,stateFields,dirtyResolution='abort',seam,gitRunner}={}){
  if(!operation||operation.kind!=='finish-merge'||!['commit','abort'].includes(dirtyResolution))fail('finish-merge-operation');
  const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));let pending=await resumeOperation({projectCapability,
    operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-merge'});let inspection=pending.stages?.find(
    (row)=>row.stage==='finish-inspected')?.details?.owned;if(!stateFields?.worktree_enabled||typeof stateFields?.worktree_path!=='string'){
    if(!inspection){inspection={status:'no-managed-worktree',dirtyResolution};await recordOperationStage(operation,'finish-inspected',{owned:inspection});}
    return inspection;}
  const worktreeCapability=resolveForkWorktreeCapability({projectCapability,stateCapability,sessionId:operation.sessionId,
    comparisonPath:stateFields.worktree_path});if(!inspection){const rows=parseWorktreePorcelain(String((await stashChecked(run,
      WORKTREE_LIST_ARGS,'finish-merge-query')).stdout));const child=rows.filter(
      (row)=>samePortablePath(row.path,worktreeCapability.path));if(child.length!==1||
      child[0].branch!==`refs/heads/${worktreeCapability.branch}`)fail('finish-merge-child-identity');const baseBranch=stateFields.parent_branch;
    if(typeof baseBranch!=='string'||!baseBranch)fail('finish-merge-base-branch');await stashChecked(run,
      ['check-ref-format','--branch',baseBranch],'finish-merge-base-branch');const baseHead=String((await stashChecked(run,
      ['show-ref','--verify','--hash',`refs/heads/${baseBranch}`],'finish-merge-base-ref')).stdout).trim();const currentBranchResult=
      await run(['symbolic-ref','--short','HEAD']);const currentBranch=currentBranchResult?.ok?String(currentBranchResult.stdout).trim():null;
    const rootStatus=String((await stashChecked(run,['status','--porcelain=v1','-z','--untracked-files=all'],'finish-merge-root-status')).stdout||'');
    const childStatus=String((await stashChecked(run,['-C',worktreeCapability.path,'status','--porcelain=v1','-z','--untracked-files=all'],
      'finish-merge-child-status')).stdout||'');if(rootStatus.length)fail('finish-merge-base-dirty');inspection={status:'managed-worktree',
      path:worktreeCapability.path,branch:worktreeCapability.branch,childHead:child[0].head,childStatusSha256:stashDigest(Buffer.from(childStatus)),
      childDirty:childStatus.length>0,baseBranch,baseHead,currentBranch,dirtyResolution,...(childStatus.length&&dirtyResolution==='commit'?
        {childManifest:await visibleWorktreeManifest(worktreeCapability.path,(args)=>run(['-C',worktreeCapability.path,...args]))}:{}),
    };await recordOperationStage(operation,'finish-inspected',{owned:inspection});}
  let mergeChildHead=inspection.childHead;if(inspection.childDirty){if(dirtyResolution==='commit'){const committed=await commitDirtyWorktreeExact({
        projectCapability,worktreeCapability,sessionId:operation.sessionId,parentOperationId:operation.operationId,
        expectedHead:inspection.childHead,expectedManifest:inspection.childManifest,gitRunner:run,
        seam:(name,context)=>seam?.(`precommit-${name}`,context)});mergeChildHead=committed.commitOid;}
    else return{status:'manual-resolution',reason:'dirty-worktree',path:inspection.path,branch:inspection.branch,head:inspection.childHead};}
  pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-merge'});
  if(inspection.currentBranch!==inspection.baseBranch){const now=await run(['symbolic-ref','--short','HEAD']);const branch=now?.ok?
      String(now.stdout).trim():null;const intent=pending.stages?.some((row)=>row.stage==='before-call-0');if(branch===inspection.baseBranch){
      if(intent&&!pending.stages?.some((row)=>row.stage==='after-stage-0')){const args=['switch',inspection.baseBranch];
        await recordOperationStage(operation,'after-call-before-stage-0',{owned:{args,stdout:'',stderr:'',adopted:true}});
        await recordOperationStage(operation,'after-stage-0',{owned:{args}});}}
    else{if(branch!==inspection.currentBranch)fail('finish-merge-base-checkout');const args=['switch',inspection.baseBranch];
      await recordOperationStage(operation,'before-call-0',{owned:{args,baseHead:inspection.baseHead}});seam?.('before-call',
        {operationId:operation.operationId,kind:'base-checkout',args});const call=await run(args);if(!call?.ok)fail('finish-merge-base-checkout',call?.stderr);
      seam?.('after-call-before-stage',{operationId:operation.operationId,kind:'base-checkout',args});await recordOperationStage(operation,
        'after-call-before-stage-0',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,
        'after-stage-0',{owned:{args}});}
    const checkedBranch=await run(['symbolic-ref','--short','HEAD']);const checkedHead=String((await stashChecked(run,
      ['rev-parse','--verify','HEAD^{commit}'],'finish-merge-base-checkout')).stdout).trim();if(!checkedBranch?.ok||
      String(checkedBranch.stdout).trim()!==inspection.baseBranch||checkedHead!==inspection.baseHead)fail('finish-merge-base-checkout');}
  const message=`deep-work merge: ${operation.sessionId}`;
  const authenticateMerge=async()=>{const head=String((await stashChecked(run,['rev-parse','--verify','HEAD^{commit}'],'finish-merge-head')).stdout).trim();
    if(head===inspection.baseHead)return null;const first=String((await stashChecked(run,['rev-parse','--verify',`${head}^1`],
      'finish-merge-parent')).stdout).trim();const second=String((await stashChecked(run,['rev-parse','--verify',`${head}^2`],
      'finish-merge-parent')).stdout).trim();const subject=String((await stashChecked(run,['show','-s','--format=%s',head],
      'finish-merge-message')).stdout).trim();if(first!==inspection.baseHead||second!==mergeChildHead||subject!==message)
      fail('finish-merge-adoption');return head;};const manual={status:'manual-resolution',reason:'merge-conflict',
    baseHead:inspection.baseHead,childHead:mergeChildHead,path:inspection.path,branch:inspection.branch};
  const abortConflict=async(stderr='')=>{let current=await resumeOperation({projectCapability,operationId:operation.operationId,
      sessionId:operation.sessionId,kind:'finish-merge'});if(current.stages?.some((row)=>row.stage==='merge-aborted'))return manual;
    const conflictStatus=String((await stashChecked(run,['status','--porcelain=v1','-z'],'finish-merge-conflict-status')).stdout||'');
    if(!current.stages?.some((row)=>row.stage==='merge-conflict'))await recordOperationStage(operation,'merge-conflict',{owned:{
      statusSha256:stashDigest(Buffer.from(conflictStatus)),stderrSha256:stashDigest(Buffer.from(stderr))}});const abortArgs=['merge','--abort'];
    const mergeHead=await run(['rev-parse','--verify','MERGE_HEAD']);const headBefore=String((await stashChecked(run,
      ['rev-parse','--verify','HEAD^{commit}'],'finish-merge-abort-head')).stdout).trim();current=await resumeOperation({projectCapability,
      operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-merge'});const abortIntent=current.stages?.some(
      (row)=>row.stage==='before-call-2');if(mergeHead?.ok){await recordOperationStage(operation,'before-call-2',{owned:{args:abortArgs}});
      seam?.('before-call',{operationId:operation.operationId,kind:'merge-abort',args:abortArgs});const aborted=await run(abortArgs);
      if(!aborted?.ok)fail('finish-merge-abort',aborted?.stderr);seam?.('after-call-before-stage',{operationId:operation.operationId,
        kind:'merge-abort',args:abortArgs});await recordOperationStage(operation,'after-call-before-stage-2',{owned:{args:abortArgs,
        stdout:aborted.stdout||'',stderr:aborted.stderr||''}});await recordOperationStage(operation,'after-stage-2',{owned:{args:abortArgs}});}
    else if(headBefore===inspection.baseHead&&abortIntent){if(!current.stages?.some((row)=>row.stage==='after-call-before-stage-2')){
        await recordOperationStage(operation,'after-call-before-stage-2',{owned:{args:abortArgs,stdout:'',stderr:'',adopted:true}});
        await recordOperationStage(operation,'after-stage-2',{owned:{args:abortArgs}});}}
    else fail('finish-merge-conflict-identity');const restored=String((await stashChecked(run,
      ['rev-parse','--verify','HEAD^{commit}'],'finish-merge-abort-head')).stdout).trim();const remaining=await run(['rev-parse','--verify','MERGE_HEAD']);
    if(restored!==inspection.baseHead||remaining?.ok)fail('finish-merge-abort-postcondition');await recordOperationStage(operation,
      'merge-aborted',{owned:{baseHead:restored}});return manual;};pending=await resumeOperation({projectCapability,
      operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-merge'});if(pending.stages?.some((row)=>row.stage==='merge-aborted'))
    return manual;const mergeHeadPending=await run(['rev-parse','--verify','MERGE_HEAD']);if(pending.stages?.some((row)=>row.stage==='merge-conflict')||
      pending.stages?.some((row)=>row.stage==='before-call-1')&&mergeHeadPending?.ok)return abortConflict();
  const mergeArgs=['merge','--no-ff','-m',message,inspection.branch];
  let mergeCommit=pending.stages?.find((row)=>row.stage==='merge-completed')?.details?.owned?.mergeCommit;
  if(!mergeCommit){mergeCommit=await authenticateMerge();if(mergeCommit){const intent=pending.stages?.find(
      (row)=>row.stage==='before-call-1')?.details?.owned;if(!intent||canonicalJson(intent.args)!==canonicalJson(mergeArgs)||
      intent.baseHead!==inspection.baseHead||intent.childHead!==mergeChildHead)fail('finish-merge-adoption');
    if(!pending.stages?.some((row)=>row.stage==='after-call-before-stage-1'))await recordOperationStage(operation,
      'after-call-before-stage-1',{owned:{args:mergeArgs,stdout:'',stderr:'',ok:true,adopted:true}});
    if(!pending.stages?.some((row)=>row.stage==='after-stage-1'))await recordOperationStage(operation,'after-stage-1',
      {owned:{args:mergeArgs}});}
    if(!mergeCommit){const args=mergeArgs;
      await recordOperationStage(operation,'before-call-1',{owned:{args,baseHead:inspection.baseHead,childHead:mergeChildHead}});
      seam?.('before-call',{operationId:operation.operationId,kind:'merge',args});const call=await run(args);
      if(!call?.ok){seam?.('after-call-before-stage',{operationId:operation.operationId,kind:'merge',args,ok:false});
        await recordOperationStage(operation,'after-call-before-stage-1',{owned:{args,stdout:call?.stdout||'',stderr:call?.stderr||'',ok:false}});
        return abortConflict(call?.stderr||'');}seam?.('after-call-before-stage',{operationId:operation.operationId,kind:'merge',args,ok:true});
      await recordOperationStage(operation,'after-call-before-stage-1',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||'',ok:true}});
      await recordOperationStage(operation,'after-stage-1',{owned:{args}});mergeCommit=await authenticateMerge();
      if(!mergeCommit)fail('finish-merge-postcondition');}await recordOperationStage(operation,'merge-completed',{owned:{mergeCommit,
      baseHead:inspection.baseHead,childHead:mergeChildHead,message}});}
  pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-merge'});
  if(!pending.stages?.some((row)=>row.stage==='worktree-removed'))await removeWorktree({projectCapability,worktreeCapability,force:false,
    operation,expectedHead:mergeChildHead,gitRunner:run,seam:(name,context)=>seam?.(`worktree-${name}`,context),callIndex:3});
  pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId:operation.sessionId,kind:'finish-merge'});
  if(!pending.stages?.some((row)=>row.stage==='branch-deleted')){const deleted=await deleteBranchExact({projectCapability,
      sessionId:operation.sessionId,branch:inspection.branch,expectedOid:mergeChildHead,force:false,parentOperationId:operation.operationId,
      gitRunner:run,seam:(name,context)=>seam?.(`branch-${name}`,context)});await recordOperationStage(operation,'branch-deleted',
      {owned:{branch:inspection.branch,expectedOid:mergeChildHead,childOperationId:deleted.operationId}});}
  return{status:'merged',mergeCommit,baseHead:inspection.baseHead,childHead:mergeChildHead,baseBranch:inspection.baseBranch,
    branch:inspection.branch};}

function rollbackReceiptRows(receiptsDirCapability){
  if(!receiptsDirCapability||receiptsDirCapability.kind!=='receipts-directory'||
      receiptsDirCapability.role!=='receipts-directory')fail('delegated-rollback-receipts');
  revalidatePathCapability(receiptsDirCapability.sessionCapability,'delegated-rollback-work-dir');
  const expected=path.join(receiptsDirCapability.sessionCapability.path,'receipts');
  if(receiptsDirCapability.path!==expected||receiptsDirCapability.projectRoot!==
      receiptsDirCapability.sessionCapability.projectRoot)fail('delegated-rollback-receipts');
  const directory=fs.lstatSync(expected);if(!directory.isDirectory()||directory.isSymbolicLink())fail('delegated-rollback-receipts');
  const names=fs.readdirSync(expected).filter((name)=>/^SLICE-\d{3}\.json$/.test(name))
    .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));const rows=[];
  for(const name of names){const target=path.join(expected,name);const stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1_048_576)fail('delegated-rollback-receipt');
    const bytes=fs.readFileSync(target);rows.push({name,size:bytes.length,sha256:stashDigest(bytes)});}
  return rows;
}
function rollbackPostcondition(current,preconditions){const empty=stashDigest(Buffer.alloc(0));return current.head===preconditions.snapshotOid&&
  current.indexTree===preconditions.targetTree&&current.indexDiffSha256===empty&&current.worktreeDiffSha256===empty&&
  current.trackedDiffSha256===empty&&current.trackedChanged===false&&current.ignoredPolicy===preconditions.repositoryBefore.ignoredPolicy&&
  canonicalJson(current.untracked)===canonicalJson(preconditions.repositoryBefore.untracked)&&
  current.stashRefOid===preconditions.repositoryBefore.stashRefOid&&
  current.reflogSha256===preconditions.repositoryBefore.reflogSha256;}
async function delegatedRollback({projectCapability,stateCapability,receiptsDirCapability,sessionId,snapshotOid,
  userChoice='redelegate',gitRunner,seam}={}){
  if(!/^s-[0-9a-f]{8}$/.test(sessionId||'')||!/^[0-9a-f]{40,64}$/.test(snapshotOid||'')||
      userChoice!=='redelegate')fail('delegated-rollback-input');
  if(!stateCapability||stateCapability.role!=='session-state'||stateCapability.projectRoot!==projectCapability?.path)
    fail('delegated-rollback-state');
  const stateSession=path.basename(stateCapability.path).match(/^deep-work\.(s-[0-9a-f]{8})\.md$/)?.[1];
  if(stateSession!==sessionId||!receiptsDirCapability?.sessionCapability||
      !['session-work-dir','work-dir'].includes(receiptsDirCapability.sessionCapability.role)||
      receiptsDirCapability.sessionCapability.projectRoot!==stateCapability.projectRoot)
    fail('delegated-rollback-state');
  const root=projectCapability.path;const operationId=`op-${stashDigest({kind:'delegated-rollback',sessionId,snapshotOid,userChoice})}`;
  const locks=[{rank:RANKS.repository,capability:issueProjectStateCapability(root,path.join(root,'.claude','deep-work.git.lock'),
    {allowMissingLeaf:true,role:'lock'})},{rank:RANKS.session,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},{rank:RANKS.journal,
    capability:issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${sessionId}.rank-journal.lock`),
      {allowMissingLeaf:true,role:'lock'})},{rank:RANKS.state,capability:require('./transaction-runtime.js').stateLock(stateCapability)},
    {rank:RANKS.target,capability:issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.target.${stashDigest(
      path.relative(root,receiptsDirCapability.path))}.lock`),{allowMissingLeaf:true,role:'lock'})}];
  return withRankedLocks(locks,async()=>{revalidatePathCapability(stateCapability,'delegated-rollback-state');
    const fields=parseFrontmatter(fs.readFileSync(stateCapability.path,'utf8')).fields;
    if(fields.session_id!==sessionId||fields.current_phase!=='implement'||fields.delegation_snapshot!==snapshotOid)
      fail('delegated-rollback-snapshot');
    if(path.join(root,...String(fields.work_dir||'').split('/'))!==receiptsDirCapability.sessionCapability.path)
      fail('delegated-rollback-state');
    const run=gitRunner||((args)=>gitCapability(projectCapability).run(args));const targetTree=String((await stashChecked(run,
      ['rev-parse','--verify',`${snapshotOid}^{tree}`],'delegated-rollback-snapshot')).stdout).trim();
    if(!/^[0-9a-f]{40,64}$/.test(targetTree))fail('delegated-rollback-snapshot');let prior=null;
    try{prior=await resumeOperation({projectCapability,operationId,sessionId,kind:'delegated-rollback'});}
    catch(error){if(error.code!=='operation-not-found')throw error;}
    if(prior?.stage==='completed-ledger')return{...prior.result,operationId,operationReceipt:prior};
    const preconditions=prior?.preconditions||{snapshotOid,targetTree,userChoice,repositoryBefore:await stashSnapshot(projectCapability,run),
      receiptRows:rollbackReceiptRows(receiptsDirCapability)};
    if(preconditions.snapshotOid!==snapshotOid||preconditions.targetTree!==targetTree||preconditions.userChoice!==userChoice)
      fail('delegated-rollback-precondition');
    const operation=await beginOperation({projectCapability,sessionId,kind:'delegated-rollback',operationId,preconditions});
    let pending=await resumeOperation({projectCapability,operationId,sessionId,kind:'delegated-rollback'});
    const current=await stashSnapshot(projectCapability,run);const before=canonicalJson(current)===canonicalJson(preconditions.repositoryBefore);
    const after=rollbackPostcondition(current,preconditions);const intent=pending.stages?.some((row)=>row.stage==='before-call-0');
    if(!pending.stages?.some((row)=>row.stage==='after-stage-0')){const args=['reset','--hard',snapshotOid];
      if(intent&&after){if(!pending.stages?.some((row)=>row.stage==='after-call-before-stage-0'))await recordOperationStage(operation,
          'after-call-before-stage-0',{owned:{args,stdout:'',stderr:'',adopted:true}});
        await recordOperationStage(operation,'after-stage-0',{owned:{args,snapshotOid,targetTree}});}
      else{if(!before)fail('delegated-rollback-repository-diverged');if(!intent)await recordOperationStage(operation,'before-call-0',
          {owned:{args,repositoryBeforeDigest:preconditions.repositoryBefore.digest,snapshotOid,targetTree}});
        seam?.('before-call',{operationId,args});const call=await run(args);if(!call?.ok)fail('delegated-rollback-reset',call?.stderr);
        seam?.('after-call-before-stage',{operationId,args});const verified=await stashSnapshot(projectCapability,run);
        if(!rollbackPostcondition(verified,preconditions))fail('delegated-rollback-postcondition');await recordOperationStage(operation,
          'after-call-before-stage-0',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,
          'after-stage-0',{owned:{args,snapshotOid,targetTree}});}}
    else if(!after)fail('delegated-rollback-repository-diverged');
    pending=await resumeOperation({projectCapability,operationId,sessionId,kind:'delegated-rollback'});const boundNames=new Set(
      preconditions.receiptRows.map((row)=>row.name));for(const row of rollbackReceiptRows(receiptsDirCapability))if(!boundNames.has(row.name))
      fail('delegated-rollback-receipt-diverged');let removal=pending.stages?.some((row)=>row.stage==='receipt-removal-prepared');
    if(!removal){for(const row of preconditions.receiptRows){const target=path.join(receiptsDirCapability.path,row.name);
        if(!fs.existsSync(target))fail('delegated-rollback-receipt-diverged');const bytes=fs.readFileSync(target);
        if(bytes.length!==row.size||stashDigest(bytes)!==row.sha256)fail('delegated-rollback-receipt-diverged');}
      await recordOperationStage(operation,'receipt-removal-prepared',{owned:{receiptRows:preconditions.receiptRows}});removal=true;}
    for(const row of preconditions.receiptRows){const target=path.join(receiptsDirCapability.path,row.name);if(!fs.existsSync(target))continue;
      const stat=fs.lstatSync(target);const bytes=stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1_048_576?fs.readFileSync(target):null;
      if(!bytes||bytes.length!==row.size||stashDigest(bytes)!==row.sha256)fail('delegated-rollback-receipt-diverged');
      seam?.('before-receipt-remove',{operationId,name:row.name,sha256:row.sha256});fs.unlinkSync(target);
      seam?.('after-receipt-remove-before-stage',{operationId,name:row.name,sha256:row.sha256});}
    await recordOperationStage(operation,'receipts-removed',{owned:{receiptRows:preconditions.receiptRows}});const result={status:'rolled-back',
      snapshotOid,targetTree,userChoice,receiptRows:preconditions.receiptRows,repositoryBeforeDigest:preconditions.repositoryBefore.digest};
    const receipt=await completeOperation(operation,result);return{...result,operationId,operationReceipt:receipt};});
}

const STASH_PUSH_MAX_RECOVERY_ATTEMPTS=2;
function stashDigest(value){return crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:canonicalJson(value)).digest('hex');}
function gitBlobOid(bytes,oidLength){const algorithm=oidLength===64?'sha256':'sha1';return crypto.createHash(algorithm)
  .update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');}
function isRuntimePath(relative){return relative==='.claude/deep-work-sessions.json'||
  relative==='.claude/deep-work-current-session'||relative.startsWith('.claude/deep-work.')||
  relative==='.deep-work'||relative.startsWith('.deep-work/');}
async function stashChecked(run,args,code='stash-git'){const result=await run(args);if(!result?.ok)fail(code,result?.stderr);return result;}
function stashOwnedRunner(projectCapability,gitRunner){const native=gitRunner||((args,options)=>
  gitCapability(projectCapability).run(args,options));return(args)=>native(args,{lineEndingConversion:'disabled'});}
async function stashContext(run){const ref=await run(['show-ref','--verify','--hash','refs/stash']);
  if(!ref?.ok)return{stashRefOid:null,reflogSha256:stashDigest(Buffer.alloc(0))};const stashRefOid=String(ref.stdout).trim();
  if(!/^[0-9a-f]{40,64}$/.test(stashRefOid))fail('stash-ref');const reflog=await stashChecked(run,
    ['reflog','show','--format=%H%x00%gs','refs/stash'],'stash-reflog');
  return{stashRefOid,reflogSha256:stashDigest(Buffer.from(reflog.stdout||''))};}
async function stashSnapshot(projectCapability,run){const head=String((await stashChecked(run,
    ['rev-parse','--verify','HEAD^{commit}'])).stdout).trim();const indexTree=String((await stashChecked(run,['write-tree'])).stdout).trim();
  const indexDiff=Buffer.from((await stashChecked(run,['diff','--cached','--binary','HEAD','--'])).stdout||'');
  const worktreeDiff=Buffer.from((await stashChecked(run,['diff','--binary','--'])).stdout||'');
  const trackedDiff=Buffer.from((await stashChecked(run,['diff','--binary','HEAD','--'])).stdout||'');
  const untrackedOutput=String((await stashChecked(run,['ls-files','--others','--exclude-standard','-z'])).stdout||'');const untracked=[];
  for(const relative of untrackedOutput.split('\0').filter(Boolean).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){
    if(isRuntimePath(relative))fail('stash-runtime-unignored',relative);
    if(path.isAbsolute(relative)||relative.split('/').includes('..'))fail('stash-untracked-path');
    const target=path.join(projectCapability.path,...relative.split('/'));const stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink())fail('stash-untracked-type');const bytes=fs.readFileSync(target);
    untracked.push({path:relative,mode:stat.mode&0o111?'100755':'100644',size:bytes.length,sha256:stashDigest(bytes),
      gitObjectId:gitBlobOid(bytes,head.length)});}
  if(!/^[0-9a-f]{40,64}$/.test(head)||!/^[0-9a-f]{40,64}$/.test(indexTree))fail('stash-snapshot');
  const workingState={head,indexTree,indexDiffSha256:stashDigest(indexDiff),worktreeDiffSha256:stashDigest(worktreeDiff),
    trackedDiffSha256:stashDigest(trackedDiff),trackedChanged:trackedDiff.length>0,ignoredPolicy:'exclude-standard',untracked};
  const context=await stashContext(run);return{...workingState,...context,workingStateDigest:stashDigest(workingState),
    digest:stashDigest({...workingState,...context})};}
function parseStashList(stdout){const rows=[];for(const line of String(stdout||'').split(/\r?\n/).filter(Boolean)){
    const split=line.indexOf('\0');if(split<0)fail('stash-list');const objectId=line.slice(0,split),subject=line.slice(split+1);
    if(!/^[0-9a-f]{40,64}$/.test(objectId))fail('stash-list');rows.push({objectId,subject,index:rows.length});}return rows;}
async function stashRows(run){return parseStashList((await stashChecked(run,
  ['stash','list','--format=%H%x00%gs'],'stash-list')).stdout);}
async function reconstructUntracked(run,objectId){const parent=await run(['rev-parse','--verify',`${objectId}^3^{tree}`]);
  if(!parent?.ok)return[];const tree=String(parent.stdout).trim();if(!/^[0-9a-f]{40,64}$/.test(tree))fail('stash-object-untracked');
  const listed=String((await stashChecked(run,['ls-tree','-rz','--full-tree',tree],'stash-object-untracked')).stdout||'');const rows=[];
  for(const record of listed.split('\0').filter(Boolean)){const tab=record.indexOf('\t');const header=record.slice(0,tab).split(' ');
    if(tab<0||header.length!==3||header[1]!=='blob'||!['100644','100755'].includes(header[0])||
        !/^[0-9a-f]{40,64}$/.test(header[2]))fail('stash-object-untracked');const relative=record.slice(tab+1);
    const size=Number(String((await stashChecked(run,['cat-file','-s',header[2]],'stash-object-untracked')).stdout).trim());
    if(!Number.isSafeInteger(size)||size<0)fail('stash-object-untracked');
    rows.push({path:relative,mode:header[0],size,gitObjectId:header[2]});}
  return rows.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));}
async function authenticateStashObject(run,row,prepared,marker){if(!row||!row.subject.includes(marker))fail('stash-object-marker');
  const subject=String((await stashChecked(run,['show','-s','--format=%s',row.objectId],'stash-object')).stdout).trim();
  if(!subject.includes(marker))fail('stash-object-marker');const parent=String((await stashChecked(run,
    ['rev-parse','--verify',`${row.objectId}^1`],'stash-object')).stdout).trim();const indexTree=String((await stashChecked(run,
    ['rev-parse','--verify',`${row.objectId}^2^{tree}`],'stash-object')).stdout).trim();
  const tracked=Buffer.from((await stashChecked(run,['diff','--binary',parent,row.objectId,'--'],'stash-object')).stdout||'');
  const untracked=await reconstructUntracked(run,row.objectId);const expectedUntracked=prepared.untracked.map(({path,mode,size,gitObjectId})=>
    ({path,mode,size,gitObjectId}));if(parent!==prepared.head||indexTree!==prepared.indexTree||
      stashDigest(tracked)!==prepared.trackedDiffSha256||canonicalJson(untracked)!==canonicalJson(expectedUntracked))fail('stash-object-mismatch');
  return{stashObjectId:row.objectId,stashIndex:row.index,objectManifestSha256:stashDigest({parent,indexTree,
    trackedDiffSha256:stashDigest(tracked),untracked})};}
function stashRankLocks(projectCapability,sessionId){if(!/^s-[0-9a-f]{8}$/.test(sessionId||''))fail('stash-session');const root=projectCapability.path;
  return[{rank:RANKS.repository,capability:issueProjectStateCapability(root,path.join(root,'.claude','deep-work.git.lock'),
    {allowMissingLeaf:true,role:'lock'})},{rank:RANKS.session,capability:issueProjectStateCapability(root,
    path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
  {rank:RANKS.journal,capability:issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${sessionId}.rank-journal.lock`),
    {allowMissingLeaf:true,role:'lock'})}];}
async function stashPublishLocked({projectCapability,sessionId,purpose,includeUntracked=false,gitRunner,seam,operationId}={}){
  if(!['fork','slice-reset'].includes(purpose))fail('stash-purpose');const run=stashOwnedRunner(projectCapability,gitRunner);
  if(operationId){let prior=null;try{prior=await resumeOperation({projectCapability,operationId,sessionId,kind:'stash-publish'});}
    catch(error){if(error.code!=='operation-not-found')throw error;}if(prior?.stage==='completed-ledger')return{...prior.result,
      operationId,operationReceipt:prior};}
  const operation=await beginOperation({projectCapability,sessionId,kind:'stash-publish',operationId,
    preconditions:{purpose,includeUntracked}});
  let pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'stash-publish'});
  let prepared=pending.stages?.find((row)=>row.stage==='stash-prepared')?.details?.owned;
  if(!prepared){prepared=await stashSnapshot(projectCapability,run);await recordOperationStage(operation,'stash-prepared',{owned:prepared});}
  const hasStashableChanges=prepared.trackedChanged||includeUntracked&&prepared.untracked.length>0;
  if(!hasStashableChanges){await recordOperationStage(operation,'nothing-to-stash',{owned:{preStateDigest:prepared.digest}});
    const result={result:'nothing-to-stash',stashObjectId:null,applyRequired:false,dropRequired:false,
      preStateDigest:prepared.digest,purpose,includeUntracked};const receipt=await completeOperation(operation,result);
    return{...result,operationId:operation.operationId,operationReceipt:receipt};}
  const marker=`deep-work:${operation.operationId}`;let matches=(await stashRows(run)).filter((row)=>row.subject.includes(marker));
  if(matches.length>1)fail('stash-publication-ambiguous');pending=await resumeOperation({projectCapability,
    operationId:operation.operationId,sessionId,kind:'stash-publish'});
  if(!matches.length){const stages=pending.stages||[];const attempts=stages.filter((row)=>/^before-call-\d+$/.test(row.stage));
    const results=stages.filter((row)=>/^call-result-\d+$/.test(row.stage));const unknown=attempts.length>results.length;
    if(results.some((row)=>row.details?.owned?.ok===false))fail('stash-push',results.at(-1).details.owned.stderr);
    if(attempts.length&& !unknown)fail('stash-publication-missing');const current=await stashSnapshot(projectCapability,run);
    if(current.workingStateDigest!==prepared.workingStateDigest)fail('stash-precondition-mismatch');
    if(unknown&&attempts.length>=STASH_PUSH_MAX_RECOVERY_ATTEMPTS)fail('stash-publication-ambiguous');const attempt=attempts.length;
    const args=['stash','push',...(includeUntracked?['--include-untracked']:[]),'--message',marker];
    await recordOperationStage(operation,'call-intent',{owned:{args,marker,preStateDigest:prepared.digest,
      maxRecoveryAttempts:STASH_PUSH_MAX_RECOVERY_ATTEMPTS}});await recordOperationStage(operation,`before-call-${attempt}`,{owned:{args,attempt}});
    seam?.('before-call',{operationId:operation.operationId,attempt});const call=await run(args);
    if(!call?.ok){await recordOperationStage(operation,`call-result-${attempt}`,{owned:{ok:false,stdout:call?.stdout||'',
        stderr:call?.stderr||'',attempt}});fail('stash-push',call?.stderr);}
    seam?.('after-call-before-stage',{operationId:operation.operationId,attempt});await recordOperationStage(operation,`call-result-${attempt}`,
      {owned:{ok:true,stdout:call.stdout||'',stderr:call.stderr||'',attempt}});await recordOperationStage(operation,
      `after-call-before-stage-${attempt}`,{owned:{args,stdout:call.stdout||'',stderr:call.stderr||'',attempt}});
    await recordOperationStage(operation,`after-stage-${attempt}`,{owned:{args,attempt}});matches=(await stashRows(run))
      .filter((row)=>row.subject.includes(marker));if(matches.length!==1)fail('stash-publication-missing');}
  const authenticated=await authenticateStashObject(run,matches[0],prepared,marker);await recordOperationStage(operation,'stash-published',
    {owned:{marker,...authenticated,preStateDigest:prepared.digest}});const result={result:'published',marker,...authenticated,
    applyRequired:true,dropRequired:true,preState:prepared,preStateDigest:prepared.digest,purpose,includeUntracked};
  const receipt=await completeOperation(operation,result);return{...result,operationId:operation.operationId,operationReceipt:receipt};}
async function stashPublish(options={}){return withRankedLocks(stashRankLocks(options.projectCapability,options.sessionId),
  ()=>stashPublishLocked(options));}
async function stashPublishUnderHeldLocks(options={}){if(!/^op-[0-9a-f]{32,64}$/.test(options.operationId||''))
  fail('stash-operation-id');return stashPublishLocked(options);}
async function stashApplyLocked({projectCapability,sessionId,operationId,gitRunner,seam}={}){
  const source=await resumeOperation({projectCapability,operationId,sessionId,kind:'stash-publish'});
  if(source.stage!=='completed-ledger'||source.result?.result!=='published'||!/^[0-9a-f]{40,64}$/.test(source.result.stashObjectId||''))
    fail('stash-source');const run=stashOwnedRunner(projectCapability,gitRunner);const matches=(await stashRows(run))
      .filter((row)=>row.objectId===source.result.stashObjectId&&row.subject.includes(source.result.marker));
  if(matches.length!==1)fail('stash-apply-identity');await authenticateStashObject(run,matches[0],source.result.preState,source.result.marker);
  const operation=await beginOperation({projectCapability,sessionId,kind:'stash-apply',preconditions:{source:source.resultSha256,
    sourceOperationId:operationId,stashObjectId:source.result.stashObjectId}});let pending=await resumeOperation({projectCapability,
      operationId:operation.operationId,sessionId,kind:'stash-apply'});if(pending.stages?.some((row)=>row.stage==='apply-conflict'))
    fail('stash-apply-conflict-pending');let prepared=pending.stages?.find((row)=>row.stage==='apply-prepared')?.details?.owned;
  if(!prepared){prepared=await stashSnapshot(projectCapability,run);await recordOperationStage(operation,'apply-prepared',{owned:prepared});}
  const current=await stashSnapshot(projectCapability,run);const intent=pending.stages?.find((row)=>row.stage==='apply-intent');
  if(intent&&current.workingStateDigest===source.result.preState.workingStateDigest){await recordOperationStage(operation,'stash-applied',
      {owned:{stashObjectId:source.result.stashObjectId,destinationPreStateDigest:prepared.digest,
        postStateDigest:current.digest,workingStateDigest:current.workingStateDigest,adopted:true}});const result={status:'applied',
      sourceOperationId:operationId,stashObjectId:source.result.stashObjectId,destinationPreStateDigest:prepared.digest,
      postStateDigest:current.digest,workingStateDigest:current.workingStateDigest,adopted:true};
    return{...result,operationId:operation.operationId,operationReceipt:await completeOperation(operation,result)};}
  if(current.workingStateDigest!==prepared.workingStateDigest)fail('stash-apply-precondition');const args=['stash','apply','--index',
    source.result.stashObjectId];await recordOperationStage(operation,'apply-intent',{owned:{args,stashObjectId:source.result.stashObjectId,
      destinationPreStateDigest:prepared.digest}});await recordOperationStage(operation,'before-call-0',{owned:{args}});
  seam?.('before-call',{operationId:operation.operationId});const call=await run(args);
  if(!call?.ok){await recordOperationStage(operation,'call-result-0',{owned:{ok:false,stdout:call?.stdout||'',stderr:call?.stderr||''}});
    const status=await stashChecked(run,['status','--porcelain=v1','-z','--untracked-files=all'],'stash-apply-conflict-status');
    const unmerged=await stashChecked(run,['ls-files','--unmerged','-z'],'stash-apply-conflict-status');
    await recordOperationStage(operation,'apply-conflict',{owned:{stashObjectId:source.result.stashObjectId,
      postStateDigest:stashDigest({statusSha256:stashDigest(Buffer.from(status.stdout||'')),
        unmergedSha256:stashDigest(Buffer.from(unmerged.stdout||''))}),stderrSha256:stashDigest(Buffer.from(call?.stderr||''))}});
    fail('stash-apply-conflict',call?.stderr);}
  seam?.('after-call-before-stage',{operationId:operation.operationId});await recordOperationStage(operation,'call-result-0',
    {owned:{ok:true,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,'after-call-before-stage-0',
    {owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,'after-stage-0',{owned:{args}});
  const post=await stashSnapshot(projectCapability,run);if(post.workingStateDigest!==source.result.preState.workingStateDigest)
    fail('stash-apply-postcondition');await recordOperationStage(operation,'stash-applied',{owned:{stashObjectId:source.result.stashObjectId,
      destinationPreStateDigest:prepared.digest,postStateDigest:post.digest,workingStateDigest:post.workingStateDigest,
      adopted:false}});const result={status:'applied',
    sourceOperationId:operationId,stashObjectId:source.result.stashObjectId,destinationPreStateDigest:prepared.digest,
    postStateDigest:post.digest,workingStateDigest:post.workingStateDigest,adopted:false};return{...result,operationId:operation.operationId,
    operationReceipt:await completeOperation(operation,result)};}
async function stashApply(options={}){return withRankedLocks(stashRankLocks(options.projectCapability,options.sessionId),
  ()=>stashApplyLocked(options));}
async function stashDropLocked({projectCapability,sessionId,operationId,gitRunner,seam}={}){
  const source=await resumeOperation({projectCapability,operationId,sessionId,kind:'stash-publish'});
  if(source.stage!=='completed-ledger'||source.result?.result!=='published')fail('stash-source');
  const run=stashOwnedRunner(projectCapability,gitRunner);const operation=await beginOperation({projectCapability,
    sessionId,kind:'stash-drop',preconditions:{source:source.resultSha256,sourceOperationId:operationId,
      stashObjectId:source.result.stashObjectId,marker:source.result.marker,stashIndex:source.result.stashIndex}});
  let pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'stash-drop'});
  let matches=(await stashRows(run)).filter((row)=>row.objectId===source.result.stashObjectId&&row.subject.includes(source.result.marker));
  const intent=pending.stages?.find((row)=>row.stage==='drop-intent');if(!matches.length&&intent){await recordOperationStage(operation,
      'stash-dropped',{owned:{stashObjectId:source.result.stashObjectId,adopted:true}});const result={status:'dropped',
      sourceOperationId:operationId,stashObjectId:source.result.stashObjectId,adopted:true};return{...result,
      operationId:operation.operationId,operationReceipt:await completeOperation(operation,result)};}
  if(matches.length!==1||matches[0].index!==source.result.stashIndex)fail('stash-drop-identity');
  await authenticateStashObject(run,matches[0],source.result.preState,source.result.marker);let prepared=pending.stages?.find(
    (row)=>row.stage==='drop-prepared')?.details?.owned;if(!prepared){prepared={stashObjectId:source.result.stashObjectId,
      marker:source.result.marker,stashIndex:matches[0].index,...await stashContext(run)};
    await recordOperationStage(operation,'drop-prepared',{owned:prepared});}
  const selector=`stash@{${matches[0].index}}`;const args=['stash','drop',selector];await recordOperationStage(operation,'drop-intent',
    {owned:{args,stashObjectId:source.result.stashObjectId,marker:source.result.marker,stashIndex:matches[0].index}});
  await recordOperationStage(operation,'before-call-0',{owned:{args}});seam?.('before-call',{operationId:operation.operationId});
  const call=await run(args);if(!call?.ok){await recordOperationStage(operation,'call-result-0',{owned:{ok:false,stdout:call?.stdout||'',
      stderr:call?.stderr||''}});fail('stash-drop',call?.stderr);}seam?.('after-call-before-stage',{operationId:operation.operationId});
  await recordOperationStage(operation,'call-result-0',{owned:{ok:true,stdout:call.stdout||'',stderr:call.stderr||''}});
  await recordOperationStage(operation,'after-call-before-stage-0',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});
  await recordOperationStage(operation,'after-stage-0',{owned:{args}});matches=(await stashRows(run)).filter((row)=>
    row.objectId===source.result.stashObjectId&&row.subject.includes(source.result.marker));if(matches.length)fail('stash-drop-postcondition');
  await recordOperationStage(operation,'stash-dropped',{owned:{stashObjectId:source.result.stashObjectId,adopted:false}});
  const result={status:'dropped',sourceOperationId:operationId,stashObjectId:source.result.stashObjectId,adopted:false};
  return{...result,operationId:operation.operationId,operationReceipt:await completeOperation(operation,result)};}
async function stashDrop(options={}){return withRankedLocks(stashRankLocks(options.projectCapability,options.sessionId),
  ()=>stashDropLocked(options));}

function parseGitHubRemote(remoteUrl){if(typeof remoteUrl!=='string'||/[\0\r\n]/.test(remoteUrl))fail('remote-url');
  let host,repository;let match=remoteUrl.match(/^git@([^:]+):([^/]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if(match){[,host,repository]=match;}else{try{const url=new URL(remoteUrl);host=url.hostname;
      repository=url.pathname.replace(/^\//,'').replace(/\.git$/,'');}catch{fail('remote-url');}}
  if(host!=='github.com'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||''))fail('remote-repository');
  return{host,repository,remoteUrl};}
function findNative(name){const fileNames=process.platform==='win32'?[`${name}.exe`]:[name];
  for(const directory of (process.env.PATH||'').split(path.delimiter))for(const fileName of fileNames){const candidate=path.join(directory,fileName);
    try{const stat=fs.lstatSync(candidate);if(stat.isFile()&&!stat.isSymbolicLink())return candidate;}catch{}}
  fail(`${name}-unavailable`);}
async function defaultGhRunner(projectCapability,args){return require('./platform.js').spawnPortable({kind:'native-executable',
  executable:findNative('gh'),args},{projectCapability,timeoutMs:120000,maxOutputBytes:1048576,env:{...process.env}});}
function parseRemoteOid(stdout){const value=String(stdout||'').trim();if(!value)return null;const rows=value.split(/\r?\n/).filter(Boolean);
  if(rows.length!==1)fail('remote-ref-ambiguous');const oid=rows[0].split(/\s+/)[0];if(!/^[0-9a-f]{40,64}$/.test(oid))fail('remote-ref');return oid;}
function parsePrRows(stdout){let rows;try{rows=JSON.parse(stdout||'[]');}catch{fail('pull-request-json');}
  if(!Array.isArray(rows))fail('pull-request-json');return rows;}

async function publishPullRequestWithinOperation({operation,projectCapability,stateFields,titleBytes,
  bodyCapability,bodyBytes,gitRunner,ghRunner,seam}={}){
  if(!operation||operation.kind!=='finish-publish-pr')fail('finish-pr-operation');
  const title=Buffer.from(titleBytes||'').toString('utf8');const body=Buffer.from(bodyBytes||'').toString('utf8');
  if(!title||/[\0\r\n]/.test(title)||Buffer.byteLength(title)>1024||Buffer.byteLength(body)>1048576)
    fail('pull-request-content');
  revalidatePathCapability(bodyCapability,'pull-request-body');
  const gitRun=gitRunner||((args)=>gitCapability(projectCapability).run(args));
  const ghRun=ghRunner||((args)=>defaultGhRunner(projectCapability,args));
  const checked=async(run,args,code)=>{const result=await run(args);if(!result||result.ok!==true)fail(code,result?.stderr);return result;};
  const remoteUrl=(await checked(gitRun,['remote','get-url','origin'],'remote-origin')).stdout.trim();
  const remote=parseGitHubRemote(remoteUrl);const headOid=(await checked(gitRun,
    ['rev-parse','--verify','HEAD^{commit}'],'finish-head')).stdout.trim();
  const headRef=(await checked(gitRun,['symbolic-ref','--short','HEAD'],'finish-head-ref')).stdout.trim();
  const baseRef=stateFields?.base_branch||stateFields?.parent_branch||'main';
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(headRef)||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(baseRef)||
      !/^[0-9a-f]{40,64}$/.test(headOid))fail('finish-ref');
  const titleSha256=crypto.createHash('sha256').update(titleBytes).digest('hex');
  const bodySha256=crypto.createHash('sha256').update(bodyBytes).digest('hex');
  await checked(ghRun,['auth','status','--hostname',remote.host],'pull-request-auth');
  let operationState=await resumeOperation({projectCapability,operationId:operation.operationId,
    sessionId:operation.sessionId,kind:'finish-publish-pr'});
  let recordedRemote=operationState.stage==='completed-ledger'?null:
    operationState.stages?.find((row)=>row.stage==='remote-pushed')?.details?.owned;
  const remoteArgs=['ls-remote','--heads','origin',`refs/heads/${headRef}`];let remoteOldOid=parseRemoteOid(
    (await checked(gitRun,remoteArgs,'remote-ref-query')).stdout);let pushStatus='adopted';
  if(recordedRemote){if(recordedRemote.repository!==remote.repository||recordedRemote.remoteUrl!==remoteUrl||
      recordedRemote.headRef!==headRef||recordedRemote.headOid!==headOid||remoteOldOid!==headOid)fail('remote-push-adoption');
    remoteOldOid=recordedRemote.remoteOldOid;pushStatus=recordedRemote.pushStatus;
  }else if(remoteOldOid!==headOid){if(remoteOldOid!==null)fail('remote-ref-diverged');const args=['push','--set-upstream','origin',
      `HEAD:refs/heads/${headRef}`];await recordOperationStage(operation,'before-call-0',{owned:{args,remoteOldOid:null,headOid}});
    if(seam)seam('before-call',{kind:'remote-push',operationId:operation.operationId});const call=await checked(gitRun,args,'remote-push');
    if(seam)seam('after-call-before-stage',{kind:'remote-push',operationId:operation.operationId});
    await recordOperationStage(operation,'after-call-before-stage-0',{owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});
    await recordOperationStage(operation,'after-stage-0',{owned:{args,headOid}});pushStatus='pushed';
    remoteOldOid=null;
  }else{
    const pending=operationState;if(pending.stage!=='completed-ledger'&&pending.stages?.some((row)=>row.stage==='before-call-0')&&
        !pending.stages.some((row)=>row.stage==='after-call-before-stage-0')){
      const args=['push','--set-upstream','origin',`HEAD:refs/heads/${headRef}`];
      await recordOperationStage(operation,'after-call-before-stage-0',{owned:{args,stdout:'',stderr:'',adopted:true}});
      await recordOperationStage(operation,'after-stage-0',{owned:{args,headOid}});
      remoteOldOid=pending.stages.find((row)=>row.stage==='before-call-0').details.owned.remoteOldOid;}
  }
  const confirmed=parseRemoteOid((await checked(gitRun,remoteArgs,'remote-ref-query')).stdout);
  if(confirmed!==headOid)fail('remote-push-postcondition');if(!recordedRemote)await recordOperationStage(operation,'remote-pushed',
    {owned:{repository:remote.repository,remoteUrl,headRef,headOid,remoteOldOid,pushStatus}});
  const listArgs=['pr','list','--repo',remote.repository,'--head',headRef,'--base',baseRef,'--state','open',
    '--json','number,id,url,title,body,headRefOid,headRefName,baseRefName'];
  const exact=(row)=>row&&row.title===title&&row.body===body&&row.headRefOid===headOid&&
    row.headRefName===headRef&&row.baseRefName===baseRef&&Number.isSafeInteger(row.number)&&row.number>0&&
    typeof row.id==='string'&&row.id&&/^https:\/\//.test(row.url||'');
  let rows=parsePrRows((await checked(ghRun,listArgs,'pull-request-query')).stdout);
  if(rows.length>1||rows.length===1&&!exact(rows[0]))fail('pull-request-diverged');let pr=rows[0];let prStatus='adopted';
  operationState=await resumeOperation({projectCapability,operationId:operation.operationId,
    sessionId:operation.sessionId,kind:'finish-publish-pr'});const recordedPr=operationState.stage==='completed-ledger'?null:
    operationState.stages?.find((row)=>row.stage==='pull-request-created')?.details?.owned;
  if(recordedPr){if(!pr||recordedPr.repository!==remote.repository||recordedPr.baseRef!==baseRef||
      recordedPr.headRef!==headRef||recordedPr.headOid!==headOid||recordedPr.prNumber!==pr.number||
      recordedPr.prNodeId!==pr.id||recordedPr.prUrl!==pr.url||recordedPr.titleSha256!==titleSha256||
      recordedPr.bodySha256!==bodySha256)fail('pull-request-adoption');return recordedPr;}
  if(!pr){const args=['pr','create','--repo',remote.repository,'--base',baseRef,'--head',headRef,
      '--title',title,'--body-file',bodyCapability.path];await recordOperationStage(operation,'before-call-1',
      {owned:{args,titleSha256,bodySha256,headOid}});if(seam)seam('before-call',{kind:'pull-request-create',operationId:operation.operationId});
    const call=await checked(ghRun,args,'pull-request-create');if(seam)seam('after-call-before-stage',
      {kind:'pull-request-create',operationId:operation.operationId});await recordOperationStage(operation,'after-call-before-stage-1',
      {owned:{args,stdout:call.stdout||'',stderr:call.stderr||''}});await recordOperationStage(operation,'after-stage-1',{owned:{args}});
    rows=parsePrRows((await checked(ghRun,listArgs,'pull-request-query')).stdout);if(rows.length!==1||!exact(rows[0]))
      fail('pull-request-postcondition');pr=rows[0];prStatus='created';
  }else{const pending=operationState;if(pending.stage!=='completed-ledger'&&pending.stages?.some((row)=>row.stage==='before-call-1')&&
        !pending.stages.some((row)=>row.stage==='after-call-before-stage-1')){const args=['pr','create','--repo',remote.repository,
          '--base',baseRef,'--head',headRef,'--title',title,'--body-file',bodyCapability.path];
      await recordOperationStage(operation,'after-call-before-stage-1',{owned:{args,stdout:pr.url,stderr:'',adopted:true}});
      await recordOperationStage(operation,'after-stage-1',{owned:{args}});}}
  const receipt={repository:remote.repository,host:remote.host,remoteUrl,baseRef,headRef,headOid,
    remoteOldOid,prNumber:pr.number,prNodeId:pr.id,prUrl:pr.url,titleSha256,bodySha256,pushStatus,prStatus};
  await recordOperationStage(operation,'pull-request-created',{owned:receipt});return receipt;
}

module.exports={NODE_AUTHORITY,gitCapability,parseWorktreePorcelain,listWorktrees,prepareInitialRepository,
  inspectInitialRepository,inspectForkRepository,createFork,scanCleanupCandidates,removeWorktree,deleteBranchExact,
  finishDiscardWithinOperation,finishMergeWithinOperation,repositoryContext,currentRepositoryContext,
  delegatedRollback,stashPublish,stashPublishUnderHeldLocks,stashApply,stashDrop,resolveForkWorktreeCapability,parseGitHubRemote,
  publishPullRequestWithinOperation};
