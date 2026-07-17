'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnPortable,issueProjectStateCapability,atomicWriteFile,revalidatePathCapability}=require('./platform.js');
const {beginOperation,recordOperationStage,completeOperation,canonicalJson,sha256}=require('./operation-journal.js');
const transaction=require('./transaction-runtime.js');

const SENSOR_REGISTRY_MAX_FILE_BYTES=262144;
const SENSOR_REGISTRY_MAX_DEPTH=8;
const SENSOR_REGISTRY_MAX_ENTRIES=512;
const SENSOR_REGISTRY_MAX_STRING_BYTES=16384;
const KINDS=new Set(['lint','typecheck','coverage','mutation','review-check']);
const PARSERS=new Set(['eslint','tsc','ruff','stryker','clang-tidy','generic-json','generic-line','generic','mutation']);

function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function byteSortKeys(value){return Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));}
function parseInput(input){
  if(Buffer.isBuffer(input)||typeof input==='string'){
    const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
    if(bytes.length>SENSOR_REGISTRY_MAX_FILE_BYTES)fail('sensor-registry-size-limit');
    try{return JSON.parse(bytes.toString('utf8'));}catch{fail('sensor-registry-json');}
  }
  return structuredClone(input);
}
function account(value,depth=1,counter={entries:0}){
  if(depth>SENSOR_REGISTRY_MAX_DEPTH)fail('sensor-registry-depth-limit');
  if(typeof value==='string'){
    if(Buffer.byteLength(value)>SENSOR_REGISTRY_MAX_STRING_BYTES)fail('sensor-registry-string-limit');return;
  }
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value))for(const item of value){counter.entries++;if(counter.entries>SENSOR_REGISTRY_MAX_ENTRIES)fail('sensor-registry-entry-limit');account(item,depth+1,counter);}
  else for(const key of byteSortKeys(value)){counter.entries++;if(counter.entries>SENSOR_REGISTRY_MAX_ENTRIES)fail('sensor-registry-entry-limit');
    if(Buffer.byteLength(key)>SENSOR_REGISTRY_MAX_STRING_BYTES)fail('sensor-registry-string-limit');account(value[key],depth+1,counter);}
}
function validateProcessSpec(spec){
  if(!spec||typeof spec!=='object'||Array.isArray(spec)||!['native-executable','node-package-bin'].includes(spec.kind))fail('sensor-process-spec');
  const keys=spec.kind==='native-executable'?['args','executable','kind']:['args','bin','kind','package'];
  if(Object.keys(spec).sort().join(',')!==keys.join(',')||!Array.isArray(spec.args)||spec.args.some((arg)=>typeof arg!=='string'||/[\0\r\n]/.test(arg)))fail('sensor-process-spec');
  if(spec.kind==='native-executable'&&(typeof spec.executable!=='string'||!spec.executable||/\.(cmd|bat)$/i.test(spec.executable)))fail('sensor-process-spec');
  if(spec.kind==='node-package-bin'&&(!/^[@a-z0-9][@a-z0-9._/-]*$/i.test(spec.package||'')||!/^[a-z0-9._-]+$/i.test(spec.bin||'')))fail('sensor-process-spec');
  return structuredClone(spec);
}
function validateRegistry(input){
  const registry=parseInput(input);account(registry);
  if(!registry||registry.$schema!=='sensor-registry-v2'||!registry.ecosystems||typeof registry.ecosystems!=='object')fail('sensor-registry-schema');
  for(const ecosystem of Object.values(registry.ecosystems))for(const kind of ['lint','typecheck','coverage','mutation']){
    const row=ecosystem[kind];if(row===null||row===undefined)continue;
    if(row.processSpec)validateProcessSpec(row.processSpec);else if(row.kind==='review-check'){}else fail('sensor-registry-schema');
    if(row.parser&&!PARSERS.has(row.parser))fail('sensor-registry-parser');
    if(row.budgetMs!==undefined&&(!Number.isSafeInteger(row.budgetMs)||row.budgetMs<100||row.budgetMs>600000))fail('sensor-registry-budget');
  }
  return {ok:true,registry};
}

const COMMAND_MAP=new Map([
  ['npx eslint --format json .',{kind:'node-package-bin',package:'eslint',bin:'eslint',args:['--format','json','.']}],
  ['npx tsc --noEmit',{kind:'node-package-bin',package:'typescript',bin:'tsc',args:['--noEmit']}],
  ['npx stryker run',{kind:'node-package-bin',package:'@stryker-mutator/core',bin:'stryker',args:['run']}],
  ['ruff check --output-format json .',{kind:'native-executable',executable:'ruff',args:['check','--output-format','json','.']}],
  ['mypy --no-error-summary .',{kind:'native-executable',executable:'mypy',args:['--no-error-summary','.']}],
  ['mutmut run',{kind:'native-executable',executable:'mutmut',args:['run']}],
  ['dotnet format --verify-no-changes',{kind:'native-executable',executable:'dotnet',args:['format','--verify-no-changes']}],
  ['dotnet build --no-restore --nologo',{kind:'native-executable',executable:'dotnet',args:['build','--no-restore','--nologo']}],
  ['dotnet stryker',{kind:'native-executable',executable:'dotnet',args:['stryker']}],
  ['clang-tidy',{kind:'native-executable',executable:'clang-tidy',args:[]}],
  ['cmake --build . --target all',{kind:'native-executable',executable:'cmake',args:['--build','.','--target','all']}],
  ['mull-runner',{kind:'native-executable',executable:'mull-runner',args:[]}],
]);
function migrateRegistryV1(input){
  const source=parseInput(input);if(source.$schema!=='sensor-registry-v1')fail('sensor-registry-v1');
  const result={$schema:'sensor-registry-v2',...Object.fromEntries(Object.entries(source).filter(([key])=>!['$schema','ecosystems'].includes(key))),ecosystems:{}};
  for(const [name,ecosystem] of Object.entries(source.ecosystems||{})){
    const next={...ecosystem};
    for(const kind of ['lint','typecheck','mutation']){
      const row=ecosystem[kind];if(!row){next[kind]=row;continue;}
      const command=row.cmd||row.command;const processSpec=COMMAND_MAP.get(command);
      if(!processSpec)fail('manual-structured-migration-required',command);
      next[kind]={processSpec:structuredClone(processSpec),parser:row.parser,
        ...(row.timeout?{budgetMs:row.timeout*1000}:{}),...(row.max_mutants?{maxMutants:row.max_mutants}:{})};
    }
    result.ecosystems[name]=next;
  }
  validateRegistry(result);return result;
}

function projectCapability(input){
  if(input&&input.kind==='project-state')return input;
  const root=path.resolve(input);return issueProjectStateCapability(root,root,{role:'project-root'});
}
function parseOutput(parser,stdout,stderr){
  if(['generic-json','eslint','ruff','stryker'].includes(parser)){try{return JSON.parse(stdout||'[]');}catch{return[];}}
  return `${stdout}\n${stderr}`.split('\n').filter(Boolean).map((message)=>({message}));
}
async function runSensor({kind,processSpec,parser,budgetMs,projectCapability:capability,projectRoot,refactorContext}={}){
  if(!KINDS.has(kind)||kind==='review-check')fail('sensor-kind');if(!PARSERS.has(parser))fail('sensor-parser');
  if(!Number.isSafeInteger(budgetMs)||budgetMs<100||budgetMs>600000)fail('sensor-budget');
  const spec=validateProcessSpec(processSpec);const project=projectCapability(capability||projectRoot);
  let executableSpec=spec;
  if(spec.kind==='native-executable'&&!path.isAbsolute(spec.executable)){
    const search=(process.env.PATH||'').split(path.delimiter).map((directory)=>path.join(directory,spec.executable));
    const found=search.find((candidate)=>{try{return fs.lstatSync(candidate).isFile();}catch{return false;}});
    if(!found)return contextualize({kind,status:'not-installed',errors:[],warnings:[],durationMs:0,budgetMs,parser},refactorContext,project);
    executableSpec={...spec,executable:found};
  }
  const started=Date.now();let result;
  try{result=await spawnPortable(executableSpec,{projectCapability:project,timeoutMs:budgetMs,maxOutputBytes:1048576,env:{...process.env}});}
  catch(error){return contextualize({kind,status:error.code==='process-native-executable'?'not-installed':'error',errors:[{message:error.message}],warnings:[],durationMs:Date.now()-started,budgetMs,parser},refactorContext,project);}
  const items=parseOutput(parser,result.stdout,result.stderr);const status=result.timedOut?'timeout':result.ok?'pass':'fail';
  return contextualize({kind,status,errors:status==='fail'?items:[],warnings:status==='pass'?items:[],durationMs:result.durationMs,budgetMs,parser},refactorContext,project);
}
function parseMaybeJson(value){if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}}
async function contextualize(result,context,project){if(!context)return result;const keys=['sessionId','stateCapability','planCapability','sliceId','afterWriteOperationId'];
  if(!context||keys.some((key)=>!context[key])||Object.keys(context).some((key)=>!keys.includes(key)))fail('sensor-refactor-context');
  const sessionId=transaction.sessionIdFromState(context.stateCapability);if(sessionId!==context.sessionId)fail('sensor-session');
  const state=transaction.readState(context.stateCapability);const cycle=parseMaybeJson(state.refactor_cycle);
  if(state.current_phase!=='implement'||state.active_slice!==context.sliceId||!cycle||
      cycle.writeOperationId!==context.afterWriteOperationId)fail('sensor-refactor-cycle');
  const plan=JSON.parse(transaction.readSessionFile(context.planCapability));const planSha256=sha256(canonicalJson(plan));
  if(!(plan.slices||[]).some((row)=>row.id===context.sliceId))fail('sensor-plan');const operation=await beginOperation({
    projectCapability:project,sessionId,kind:'sensor-run',slice:context.sliceId,preconditions:{kind:result.kind,planSha256,
      sliceId:context.sliceId,afterWriteOperationId:context.afterWriteOperationId}});await recordOperationStage(operation,'before-call',
      {owned:{kind:result.kind}});await recordOperationStage(operation,'after-call-before-stage',{owned:{status:result.status}});
  const canonical={...result,sessionId,planSha256,sliceId:context.sliceId,afterWriteOperationId:context.afterWriteOperationId};
  const resultSha256=sha256(canonicalJson(canonical));const target=path.join(project.path,'.claude',
    `deep-work.${sessionId}.sensor.${operation.operationId}.json`);const cap=issueProjectStateCapability(project.path,target,
      {allowMissingLeaf:true,role:'state'});atomicWriteFile(cap,canonicalJson(canonical));await recordOperationStage(operation,'result-published',
      {owned:{path:target,resultSha256}});await recordOperationStage(operation,'after-stage',{owned:{path:target,resultSha256}});
  const receipt=await completeOperation(operation,{status:'completed',resultPath:target,resultSha256,kind:result.kind,
    sensorStatus:result.status,planSha256,sliceId:context.sliceId,afterWriteOperationId:context.afterWriteOperationId});return{...result,
    operationId:operation.operationId,resultSha256,planSha256,sliceId:context.sliceId,
    afterWriteOperationId:context.afterWriteOperationId,resultCapability:cap,operationReceipt:receipt};}
function aggregateSensorResults(rows){if(!Array.isArray(rows)||!rows.length)fail('sensor-aggregate');const normalized=rows.map((row)=>{
  if(!/^op-[0-9a-f]{32,64}$/.test(row.operationId||'')||!/^[0-9a-f]{64}$/.test(row.resultSha256||'')||!KINDS.has(row.kind))
    fail('sensor-aggregate');return{operation_id:row.operationId,result_sha256:row.resultSha256,kind:row.kind};})
  .sort((a,b)=>Buffer.compare(Buffer.from(a.operation_id),Buffer.from(b.operation_id)));
  if(new Set(normalized.map((row)=>row.operation_id)).size!==normalized.length)fail('sensor-aggregate');return sha256(canonicalJson(normalized));}

function listFiles(root){const out=[];const walk=(dir)=>{for(const name of fs.readdirSync(dir).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){
    if(['.git','node_modules'].includes(name))continue;const file=path.join(dir,name);const stat=fs.lstatSync(file);if(stat.isSymbolicLink())continue;
    if(stat.isDirectory())walk(file);else if(stat.isFile())out.push(file);}};walk(root);return out;}
function loadTopology(id){const file=path.resolve(__dirname,'..','templates','topologies',`${id||'generic'}.json`);try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{return JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','templates','topologies','generic.json'),'utf8'));}}
function evaluateFitness(projectRoot,data){const validTypes=new Set(['dependency','file-metric','forbidden-pattern','structure']);const rules=(data?.version===1&&Array.isArray(data.rules)?data.rules:[])
  .filter((rule)=>rule?.id&&rule.severity&&validTypes.has(rule.type));const results=[];for(const rule of rules){let violations=[];let status='passed';
    if(rule.type==='file-metric'){const max=rule.max_lines||rule.max||500;for(const file of listFiles(projectRoot)){if(rule.include&&
        !file.slice(projectRoot.length+1).startsWith(String(rule.include).replace(/\*.*$/,'')))continue;const lines=fs.readFileSync(file,'utf8').split(/\r?\n/).length;
        if(lines>max)violations.push({file:path.relative(projectRoot,file).split(path.sep).join('/'),lines,max});}}
    else if(rule.type==='forbidden-pattern'){let regex;try{regex=new RegExp(rule.pattern,'g');}catch{regex=null;}if(regex)for(const file of listFiles(projectRoot)){
      const relative=path.relative(projectRoot,file).split(path.sep).join('/');if(rule.include&&!relative.startsWith(String(rule.include).replace(/\*.*$/,'')))continue;
      if(regex.test(fs.readFileSync(file,'utf8')))violations.push({file:relative,message:`Forbidden pattern: ${rule.pattern}`});regex.lastIndex=0;}}
    else if(rule.type==='dependency'){status=rule.severity==='required'?'required_missing':'not_applicable';}
    else status='not_applicable';if(violations.length)status='failed';results.push({ruleId:rule.id,status,passed:!violations.length&&status!=='required_missing',violations});}
  return{total:rules.length,passed:results.filter((r)=>r.passed&&r.status!=='not_applicable').length,failed:results.filter((r)=>!r.passed&&r.status==='failed').length,results,rules};}
function runReviewCheck(projectCapabilityInput,options={},refactorContext){const project=projectCapability(projectCapabilityInput);const root=project.path;
  try{const config=JSON.parse(fs.readFileSync(path.join(root,'.deep-work','config.json'),'utf8'));if(config.review_check===false)return contextualizeReview(
    {status:'disabled',alwaysOn:null,fitness:null,violations:[],hasRequired:false},refactorContext,project);}catch{}
  const template=loadTopology(options.topology||'generic');const guides=template.guides?.phase3||[];const hasGuides=(options.topology||'generic')!=='generic'&&guides.length>0;
  let fitnessData=null;try{fitnessData=JSON.parse(fs.readFileSync(path.join(root,'.deep-review','fitness.json'),'utf8'));}catch{}
  if(!hasGuides&&!fitnessData)return contextualizeReview({status:'not_applicable',alwaysOn:null,fitness:null,violations:[],hasRequired:false},refactorContext,project);
  const evaluated=fitnessData?evaluateFitness(root,fitnessData):null;const violations=[];if(evaluated)for(const result of evaluated.results)if(!result.passed&&result.status!=='not_applicable'){
    const rule=evaluated.rules.find((row)=>row.id===result.ruleId);violations.push({source:'fitness',ruleId:result.ruleId,severity:rule?.severity||'advisory',details:result.violations||[]});}
  const result={status:'completed',alwaysOn:hasGuides?{guides,topology:template.display_name||options.topology}:null,
    fitness:evaluated?{total:evaluated.total,passed:evaluated.passed,failed:evaluated.failed,results:evaluated.results}:null,
    violations,hasRequired:violations.some((row)=>row.severity==='required')};return contextualizeReview(result,refactorContext,project);}
function contextualizeReview(result,context,project){if(!context)return result;return contextualize({kind:'review-check',status:result.hasRequired?'fail':'pass',
  errors:result.violations,warnings:result.alwaysOn?[result.alwaysOn]:[],durationMs:0,budgetMs:0,parser:'review-check',review:result},context,project);}
function phase3SensorKinds(plans){const order=new Map([['lint',0],['typecheck',1],['review-check',2]]);return plans.map((plan)=>plan.kind)
  .filter((kind)=>order.has(kind)).sort((a,b)=>order.get(a)-order.get(b));}
function detectSensors(projectCapability,registry){const checked=validateRegistry(registry).registry;const root=projectCapability.path;const plans=[];
  for(const ecosystem of Object.values(checked.ecosystems)){
    const detect=ecosystem.detect||{};const matches=(detect.require||[]).every((file)=>fs.existsSync(path.join(root,file)))&&
      (!(detect.any_of||[]).length||(detect.any_of||[]).some((file)=>fs.existsSync(path.join(root,file))));if(!matches)continue;
    for(const kind of ['lint','typecheck','coverage','mutation'])if(ecosystem[kind]?.processSpec)plans.push({kind,...ecosystem[kind]});
  }plans.push({kind:'review-check'});return plans;}
function writeSensorDetectionCache(projectCapability,plans){revalidatePathCapability(projectCapability,'sensor-cache-project');const target=path.join(projectCapability.path,'.claude','.sensor-detection-cache.json');
  const cap=issueProjectStateCapability(projectCapability.path,target,{allowMissingLeaf:true,role:'state'});atomicWriteFile(cap,`${JSON.stringify(plans)}\n`);return target;}

module.exports={SENSOR_REGISTRY_MAX_FILE_BYTES,SENSOR_REGISTRY_MAX_DEPTH,SENSOR_REGISTRY_MAX_ENTRIES,
  SENSOR_REGISTRY_MAX_STRING_BYTES,validateRegistry,migrateRegistryV1,detectSensors,runSensor,
  runReviewCheck,aggregateSensorResults,phase3SensorKinds,writeSensorDetectionCache,validateProcessSpec};
