'use strict';

const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {runSupervisedProcess}=require('./process-supervisor.js');
const platform=require('./platform.js');const transaction=require('./transaction-runtime.js');
const {beginOperation,recordOperationStage,completeOperation,canonicalJson,sha256}=require('./operation-journal.js');

const SPEC_KEYS=new Set(['schema_version','executable','args','cwd_role','timeout_ms','max_output_bytes','red_failure_literal']);
const EXECUTABLE_KINDS=new Set(['node','npm','node-package-bin','project-relative','absolute-native']);
function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function exactKeys(value,allowed,required=[]){return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every((key)=>allowed.has(key))&&required.every((key)=>Object.hasOwn(value,key));}
function validateExecutable(value){if(!exactKeys(value,new Set(['kind','value','package','bin']),['kind','value'])||
    !EXECUTABLE_KINDS.has(value.kind)||typeof value.value!=='string'||!value.value||/[\r\n\0;&|`$]/.test(value.value)||
    /\.(?:cmd|bat)$/i.test(value.value))fail('verification-executable');
  if(value.kind==='node'&&(value.value!=='node'||value.package!==undefined||value.bin!==undefined))fail('verification-executable');
  if(value.kind==='npm'&&(value.value!=='npm'||value.package!==undefined||value.bin!==undefined))fail('verification-executable');
  if(value.kind==='node-package-bin'&&(!/^[@a-z0-9][@a-z0-9._/-]*$/i.test(value.package||'')||
      !/^[a-z0-9._-]+$/i.test(value.bin||'')))fail('verification-executable');
  if(value.kind!=='node-package-bin'&&(value.package!==undefined||value.bin!==undefined))fail('verification-executable');return structuredClone(value);}
function validateVerificationSpec(spec){if(spec&&Object.hasOwn(spec,'command'))fail('structured-verification','command strings are forbidden');
  if(!exactKeys(spec,SPEC_KEYS,['schema_version','executable','args','cwd_role','timeout_ms','max_output_bytes'])||spec.schema_version!==1||
      !Array.isArray(spec.args)||spec.args.some((arg)=>typeof arg!=='string'||/[\0\r\n]/.test(arg)||/^(?:&&|\|\||[;|<>])$/.test(arg))||
      spec.cwd_role!=='active-worktree'||!Number.isSafeInteger(spec.timeout_ms)||spec.timeout_ms<1000||spec.timeout_ms>600000||
      !Number.isSafeInteger(spec.max_output_bytes)||spec.max_output_bytes<4096||spec.max_output_bytes>1048576)fail('structured-verification');
  validateExecutable(spec.executable);if(spec.red_failure_literal!==undefined&&(typeof spec.red_failure_literal!=='string'||!spec.red_failure_literal||
    Buffer.byteLength(spec.red_failure_literal)>4096))fail('verification-red-literal');return structuredClone(spec);}

const LEGACY_SPECS=Object.freeze({'npm test':{schema_version:1,executable:{kind:'npm',value:'npm'},args:['test'],
  cwd_role:'active-worktree',timeout_ms:600000,max_output_bytes:1048576}});
function migrateKnownVerificationSpec(command){if(typeof command!=='string'||!Object.hasOwn(LEGACY_SPECS,command))
  fail('manual-structured-verification-migration-required');return structuredClone(LEGACY_SPECS[command]);}

function physicalExecutable(file){if(!path.isAbsolute(file))fail('verification-executable');const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())fail('verification-executable');return {file:fs.realpathSync(file),identity:`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`};}
async function resolveExecutable(executable,args,cwd,toolchainCapability){if(executable.kind==='node')return {...physicalExecutable(process.execPath),args};
  if(executable.kind==='absolute-native')return {...physicalExecutable(executable.value),args};
  if(executable.kind==='project-relative'){if(path.isAbsolute(executable.value)||executable.value.split('/').includes('..'))fail('verification-executable');
    const candidate=path.join(cwd,...executable.value.split('/'));if(!platform.isPathInside(cwd,candidate))fail('verification-executable');
    return {...physicalExecutable(candidate),args};}
  const toolchain=toolchainCapability||await platform.issueNodeToolchainCapability({nodeExecutable:process.execPath,
    home:os.homedir(),environment:{...process.env}});const request=executable.kind==='npm'?{package:'npm',bin:'npm',args}:
    {package:executable.package,bin:executable.bin,args};const resolved=platform.resolveNodePackageBin(toolchain,request);
  return {...physicalExecutable(resolved.executable),args:resolved.argv};}
function validateExpected(checked,expectedOutcome,{sliceId,gateId}={}){if(!['must-pass','must-fail'].includes(expectedOutcome))fail('verification-outcome');
  if(Boolean(sliceId)===Boolean(gateId))fail('verification-target');if(gateId&&expectedOutcome!=='must-pass')fail('verification-gate-outcome');
  if(expectedOutcome==='must-fail'&&!checked.red_failure_literal)fail('verification-red-literal');}
function resolveAcceptedWrite({stateCapability,state,planSha256,sliceId,expectedOutcome}={}){
  const expectedClass=state?.tdd_state==='PENDING'&&expectedOutcome==='must-fail'?'failing-test':
    state?.tdd_state==='RED_VERIFIED'&&expectedOutcome==='must-pass'?'production':
    state?.tdd_state==='REFACTOR_PENDING'&&expectedOutcome==='must-pass'?'refactor':null;
  if(!expectedClass)fail('verification-write-state');
  const operationId=state.accepted_write_operation_id;const receiptSha256=state.accepted_write_receipt_sha256;
  if(!/^op-[0-9a-f]{32,64}$/.test(operationId||'')||!/^[0-9a-f]{64}$/.test(receiptSha256||'')||
      state.accepted_write_class!==expectedClass)fail('verification-write-required');
  const sessionId=transaction.sessionIdFromState(stateCapability);const target=path.join(stateCapability.projectRoot,'.claude',
    `deep-work.${sessionId}.scoped-write.${operationId}.json`);const cap=platform.issueProjectStateCapability(
      stateCapability.projectRoot,target,{role:'state'});platform.revalidatePathCapability(cap,'verification-write-receipt');
  let receipt;try{receipt=JSON.parse(fs.readFileSync(target,'utf8'));}catch{fail('verification-write-receipt');}
  const recomputed=sha256(canonicalJson({operationId,postManifestSha256:receipt.postManifest?.sha256,
    changedPaths:receipt.changedPaths,planSha256:receipt.planSha256,sliceId,writeClass:receipt.writeClass}));
  if(receipt.status!=='accepted'||receipt.operationId!==operationId||receipt.sliceId!==sliceId||
      receipt.writeClass!==expectedClass||receipt.planSha256!==planSha256||receipt.receiptSha256!==receiptSha256||
      recomputed!==receiptSha256||!receipt.preManifest?.sha256||!receipt.postManifest?.sha256) {
    fail('verification-write-receipt');
  }
  return {operationId,receiptSha256,writeClass:expectedClass,receipt,cap};
}
async function execute({checked,expectedOutcome,cwd,toolchainCapability}){const resolved=await resolveExecutable(checked.executable,checked.args,cwd,toolchainCapability);
  const result=await runSupervisedProcess({executable:resolved.file,args:resolved.args},{cwd,timeoutMs:checked.timeout_ms,
    maxOutputBytes:checked.max_output_bytes,env:{...process.env}});const full=Buffer.from(`${result.stdout}\0${result.stderr}`);
  const accepted=expectedOutcome==='must-pass'?result.exitCode===0&&!result.timedOut&&!result.outputOverflow:
    result.exitCode!==0&&!result.timedOut&&!result.outputOverflow&&`${result.stdout}\n${result.stderr}`.includes(checked.red_failure_literal);
  if(!accepted){if(expectedOutcome==='must-fail'&&result.exitCode!==0)fail('red-evidence-mismatch');fail('verification-outcome-mismatch');}
  const stat=fs.lstatSync(resolved.file);const currentIdentity=`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if(resolved.identity!==currentIdentity)fail('verification-executable-drift');return {result,resolved,outputDigest:sha256(full)};}

async function runVerification(args={}){const checked=validateVerificationSpec(args.spec);const hasBound=Boolean(args.stateCapability||args.planCapability);
  if(!hasBound){if(!['must-pass','must-fail'].includes(args.expectedOutcome))fail('verification-outcome');
    if(args.expectedOutcome==='must-fail'&&!checked.red_failure_literal)fail('verification-red-literal');const ran=await execute({checked,
      expectedOutcome:args.expectedOutcome,cwd:args.cwd||process.cwd(),toolchainCapability:args.toolchainCapability});
    const canonical={schema_version:1,spec_sha256:sha256(canonicalJson(checked)),expected_outcome:args.expectedOutcome,
      executable:ran.resolved.file,executable_identity:ran.resolved.identity,exit_code:ran.result.exitCode,signal:ran.result.signal,
      termination:{timed_out:ran.result.timedOut,output_overflow:ran.result.outputOverflow},output_digest:ran.outputDigest,
      stdout:ran.result.stdout,stderr:ran.result.stderr,duration_ms:ran.result.durationMs};return {accepted:true,exitCode:ran.result.exitCode,
      outputDigest:ran.outputDigest,resultSha256:sha256(canonicalJson(canonical)),result:canonical};}
  const {stateCapability,planCapability,sliceId,gateId,expectedOutcome}=args;validateExpected(checked,expectedOutcome,{sliceId,gateId});
  const sessionId=transaction.sessionIdFromState(stateCapability);const state=transaction.readState(stateCapability);
  if(!['implement','test'].includes(state.current_phase))fail('verification-phase');const plan=args.plan||JSON.parse(transaction.readSessionFile(planCapability));
  const target=sliceId?(plan.slices||[]).find((row)=>row.id===sliceId):(plan.quality_gates||[]).find((row)=>row.id===gateId);
  if(!target)fail('verification-plan');if(target.verification_spec&&canonicalJson(validateVerificationSpec(target.verification_spec))!==canonicalJson(checked))
    fail('verification-spec-identity');const project=transaction.projectCapabilityFor(stateCapability);
  const planSha256=sha256(canonicalJson(plan));const write=sliceId?resolveAcceptedWrite({stateCapability,state,planSha256,
    sliceId,expectedOutcome}):null;const operation=await beginOperation({projectCapability:project,sessionId,kind:'verification-run',slice:sliceId,
    preconditions:{planSha256,specSha256:sha256(canonicalJson(checked)),sliceId:sliceId||null,gateId:gateId||null,expectedOutcome,
      writeOperationId:write?.operationId||null,writeReceiptSha256:write?.receiptSha256||null}});
  const journalPath=path.join(project.path,'.claude',`deep-work.${sessionId}.op.verification-run.${operation.operationId}.json`);
  await recordOperationStage(operation,'before-call',{owned:{specSha256:sha256(canonicalJson(checked)),
    executable:checked.executable,expectedOutcome}});
  const journalCapability=platform.issueProjectStateCapability(project.path,journalPath,{role:'state'});
  const gitCapability=platform.issueProjectStateCapability(project.path,path.join(project.path,'.git'),{role:'git-root'});
  const manifestInput={projectCapability:project,gitCapability,runtimeExclusions:[journalCapability]};const pre=platform.captureWorktreeManifest(manifestInput);
  const ran=await execute({checked,expectedOutcome,
    cwd:args.cwd||project.path,toolchainCapability:args.toolchainCapability});const post=platform.captureWorktreeManifest(manifestInput);
  if(pre.sha256!==post.sha256)fail('verification-side-effect');await recordOperationStage(operation,'after-call-before-stage',
    {owned:{exitCode:ran.result.exitCode,outputDigest:ran.outputDigest,postManifestSha256:post.sha256}});
  const canonical={schema_version:1,session_id:sessionId,plan_sha256:planSha256,slice_id:sliceId||null,gate_id:gateId||null,
    spec_sha256:sha256(canonicalJson(checked)),expected_outcome:expectedOutcome,executable:ran.resolved.file,
    executable_identity:ran.resolved.identity,exit_code:ran.result.exitCode,signal:ran.result.signal,termination:{timed_out:ran.result.timedOut,
      output_overflow:ran.result.outputOverflow},output_digest:ran.outputDigest,stdout:ran.result.stdout,stderr:ran.result.stderr,
    duration_ms:ran.result.durationMs,pre_manifest_sha256:pre.sha256,post_manifest_sha256:post.sha256,
    write_operation_id:write?.operationId||null,write_receipt_sha256:write?.receiptSha256||null};
  const resultSha256=sha256(canonicalJson(canonical));const resultPath=path.join(project.path,'.claude',
    `deep-work.${sessionId}.verification.${operation.operationId}.json`);const resultCapability=platform.issueProjectStateCapability(project.path,
      resultPath,{allowMissingLeaf:true,role:'state'});platform.atomicWriteFile(resultCapability,canonicalJson(canonical));
  await recordOperationStage(operation,'result-published',{owned:{resultPath,resultSha256}});await recordOperationStage(operation,'after-stage',
    {owned:{resultPath,resultSha256}});const receipt=await completeOperation(operation,{status:'accepted',resultPath,resultSha256,
    outputDigest:ran.outputDigest,preManifestSha256:pre.sha256,postManifestSha256:post.sha256,
    writeOperationId:write?.operationId||null,writeReceiptSha256:write?.receiptSha256||null});return {accepted:true,
    exitCode:ran.result.exitCode,outputDigest:ran.outputDigest,resultSha256,result:canonical,resultCapability,
    resultPath,operationId:operation.operationId,operationReceipt:receipt};}

async function authenticateVerificationResult({stateCapability,planCapability,plan,sliceId,
  operationId,resultSha256,claimedResult}={}){
  if(!/^SLICE-\d{3}$/.test(sliceId||'')||!/^op-[0-9a-f]{32,64}$/.test(operationId||'')||
      !/^[0-9a-f]{64}$/.test(resultSha256||''))fail('verification-evidence-identity');
  const sessionId=transaction.sessionIdFromState(stateCapability);const state=transaction.readState(stateCapability);
  const lockedPlan=JSON.parse(transaction.readSessionFile(planCapability));
  if(canonicalJson(lockedPlan)!==canonicalJson(plan))fail('verification-plan-changed');
  const planSha256=sha256(canonicalJson(lockedPlan));const target=lockedPlan.slices?.find((row)=>row.id===sliceId);
  if(!target)fail('verification-plan');
  const resultPath=path.join(stateCapability.projectRoot,'.claude',
    `deep-work.${sessionId}.verification.${operationId}.json`);const cap=platform.issueProjectStateCapability(
      stateCapability.projectRoot,resultPath,{role:'state'});platform.revalidatePathCapability(cap,'verification-result');
  let result;try{result=JSON.parse(fs.readFileSync(resultPath,'utf8'));}catch{fail('verification-result');}
  if(sha256(canonicalJson(result))!==resultSha256||claimedResult&&canonicalJson(claimedResult)!==canonicalJson(result))
    fail('verification-result-digest');
  const receipt=await require('./operation-journal.js').resumeOperation({projectCapability:transaction.projectCapabilityFor(stateCapability),
    operationId,sessionId,kind:'verification-run'});
  if(receipt.stage!=='completed-ledger'||receipt.result?.status!=='accepted'||
      receipt.result.resultPath!==resultPath||receipt.result.resultSha256!==resultSha256)fail('verification-result-ledger');
  const expectedOutcome=state.tdd_state==='PENDING'?'must-fail':'must-pass';
  const checked=validateVerificationSpec(target.verification_spec);
  if(result.schema_version!==1||result.session_id!==sessionId||result.plan_sha256!==planSha256||
      result.slice_id!==sliceId||result.gate_id!==null||result.spec_sha256!==sha256(canonicalJson(checked))||
      result.expected_outcome!==expectedOutcome||result.pre_manifest_sha256!==result.post_manifest_sha256||
      !/^[0-9a-f]{64}$/.test(result.output_digest||''))fail('verification-result-authority');
  if(expectedOutcome==='must-pass'&&result.exit_code!==0)fail('verification-result-outcome');
  if(expectedOutcome==='must-fail'&&(result.exit_code===0||!`${result.stdout}\n${result.stderr}`.includes(checked.red_failure_literal)))
    fail('verification-result-outcome');
  const write=resolveAcceptedWrite({stateCapability,state,planSha256,sliceId,expectedOutcome});
  if(result.write_operation_id!==write.operationId||result.write_receipt_sha256!==write.receiptSha256||
      receipt.result.writeOperationId!==write.operationId||receipt.result.writeReceiptSha256!==write.receiptSha256)
    fail('verification-result-write');
  return {sessionId,state,plan:lockedPlan,planSha256,target,result,resultPath,resultSha256,
    operationId,expectedOutcome,write};
}

module.exports={validateVerificationSpec,migrateKnownVerificationSpec,runVerification,
  authenticateVerificationResult,resolveAcceptedWrite,LEGACY_SPECS};
