'use strict';

const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const BASELINE_FILE='health-baseline.json';const MAX_AGE_MS=7*24*60*60*1000;
const DEFAULT_TIMEOUTS=Object.freeze({deadExport:30000,depVuln:30000,staleConfig:10000,coverage:60000,fitness:60000,total:180000});
function fail(code,message){const error=new Error(`[${code}] ${message||code}`);error.code=code;throw error;}
function loadRegistry(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function loadCustomTopologies(directory){if(!fs.existsSync(directory))return[];const rows=[];
  for(const name of fs.readdirSync(directory).filter((entry)=>entry.endsWith('.json')).sort())try{const value=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
    if(Array.isArray(value.topologies))rows.push(...value.topologies);else if(value.id)rows.push(value);}catch{}return rows;}
function mergeTopologies(builtins,customs){const map=new Map([...builtins,...customs].map((row)=>[row.id,row]));
  return[...map.values()].sort((a,b)=>(b.priority||0)-(a.priority||0));}
function nodeDeps(root){try{const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));return new Set([
  ...Object.keys(pkg.dependencies||{}),...Object.keys(pkg.devDependencies||{}),...Object.keys(pkg.peerDependencies||{})]);}catch{return new Set();}}
function pythonDeps(root){try{const text=fs.readFileSync(path.join(root,'pyproject.toml'),'utf8');const match=text.match(/^dependencies\s*=\s*\[([^\]]*)\]/m);
  const result=new Set();for(const item of (match?.[1]||'').matchAll(/"([^"]+)"|'([^']+)'/g)){const name=(item[1]||item[2]).split(/[><=!~\[;]/)[0].trim().toLowerCase();if(name)result.add(name);}return result;}catch{return new Set();}}
function matchTopology(root,detect,node=nodeDeps(root),python=pythonDeps(root)){if(detect.always===true)return true;
  const any=(values,predicate)=>!values?.length||values.some(predicate);const all=(values,predicate)=>!values?.length||values.every(predicate);
  if(!any(detect.marker_files,(name)=>fs.existsSync(path.join(root,name))))return false;
  if(!any(detect.marker_dirs,(name)=>{try{return fs.statSync(path.join(root,name)).isDirectory();}catch{return false;}}))return false;
  if(!all(detect.deps,(name)=>node.has(name))||!any(detect.deps_any,(name)=>node.has(name))||
      !any(detect.python_deps_any,(name)=>python.has(name)))return false;
  if((detect.exclude_deps||[]).some((name)=>node.has(name))||(detect.exclude_python_deps||[]).some((name)=>python.has(name)))return false;
  if(detect.python_project===true&&!['pyproject.toml','setup.py','requirements.txt'].some((name)=>fs.existsSync(path.join(root,name))))return false;
  return Boolean(detect.always||detect.marker_files?.length||detect.marker_dirs?.length||detect.deps?.length||
    detect.deps_any?.length||detect.python_deps_any?.length||detect.python_project);}
function detectTopology(projectRoot,registryPath=path.resolve(__dirname,'..','templates','topology-registry.json'),options={}){
  const registry=loadRegistry(registryPath);const topologies=mergeTopologies(registry.topologies||[],
    loadCustomTopologies(options.customDir||path.join(path.dirname(registryPath),'custom')));const node=nodeDeps(projectRoot),python=pythonDeps(projectRoot);
  const found=topologies.find((row)=>row.detect&&matchTopology(projectRoot,row.detect,node,python));const result=found?{
    id:found.id,display_name:found.display_name,priority:found.priority,confidence:found.priority>=60?'high':'low'}:
    {id:'generic',display_name:'Generic',priority:0,confidence:'low'};Object.defineProperty(result,'name',{value:result.id,enumerable:false});return result;}
function generateFitnessProposal(projectRoot){const pkg=fs.existsSync(path.join(projectRoot,'package.json'));
  return{version:1,rules:pkg?[{id:'no-circular',type:'dependency',severity:'advisory',check:'circular',include:'src'}]:[]};}
async function withTimeout(fn,ms){let timer;const deadline=new Promise((resolve)=>{timer=setTimeout(()=>resolve({timeout:true}),ms);timer.unref?.();});
  try{return await Promise.race([Promise.resolve().then(fn).then((value)=>({value})),deadline]);}finally{clearTimeout(timer);}}
async function safeRun(fn,ms){try{const result=await withTimeout(fn,ms);return result.timeout?{_timeout:true}:result.value;}
  catch(error){return{_error:true,message:error.message||String(error)};}}
function normalizeDeadExports(raw){if(!raw)return{status:'error',count:0,items:[]};if(raw._timeout)return{status:'timeout',count:0,items:[]};
  if(raw._error)return{status:'error',count:0,items:[],error:raw.message};if(raw.status==='not_applicable')return{status:'not_applicable',count:0,items:[]};
  const count=raw.count||0;return{status:count?'advisory':'pass',count,items:raw.deadExports||[]};}
function normalizeStaleConfig(raw){if(!raw)return{status:'error',count:0,items:[]};if(raw._timeout)return{status:'timeout',count:0,items:[]};
  if(raw._error)return{status:'error',count:0,items:[],error:raw.message};const count=raw.count||0;return{status:count?'advisory':'pass',count,items:raw.issues||[]};}
function parseNpmAudit(stdout){let data;try{data=JSON.parse(stdout);}catch{return{error:true,vulnerabilities:[],high:0,critical:0};}
  const vulnerabilities=[];let high=0,critical=0;for(const [name,info] of Object.entries(data.vulnerabilities||{})){
    if(info.severity==='high'){high+=1;vulnerabilities.push({name,severity:'high'});}else if(info.severity==='critical'){
      critical+=1;vulnerabilities.push({name,severity:'critical'});}}return{vulnerabilities,high,critical};}
function validateNativeSpec(spec){if(!spec||spec.kind!=='native-executable'||typeof spec.executable!=='string'||!path.isAbsolute(spec.executable)||
    !Array.isArray(spec.args)||spec.args.some((arg)=>typeof arg!=='string'||/[\0\r\n]/.test(arg))||/\.(cmd|bat)$/i.test(spec.executable))fail('health-process-spec');return spec;}
function runStructuredSync(spec,{cwd,timeout=60000}={}){const checked=validateNativeSpec(spec);const result=spawnSync(checked.executable,checked.args,
  {cwd,encoding:'utf8',timeout,shell:false,maxBuffer:1048576,windowsHide:true});return{stdout:result.stdout||'',stderr:result.stderr||'',
    exitCode:result.status,killed:Boolean(result.error?.code==='ETIMEDOUT'),error:result.error||null};}
async function scanDependencyVuln(ecosystems,timeout=60000,options={}){const results={};for(const [name,config] of Object.entries(ecosystems||{})){
  if(!config.audit){results[name]={status:'not_applicable'};continue;}if(config.audit.cmd)fail('health-command-string');
  const execution=(options.runner||runStructuredSync)(config.audit.processSpec,{cwd:options.projectRoot,timeout});const settled=await execution;
  if(settled.killed||settled.error&&!settled.stdout){results[name]={error:true,killed:settled.killed||false,vulnerabilities:[],high:0,critical:0};continue;}
  results[name]=parseNpmAudit(settled.stdout);}return results;}
function normalizeDepVuln(raw){if(!raw)return{status:'error',critical:0,high:0,items:[]};if(raw._timeout)return{status:'timeout',critical:0,high:0,items:[]};
  if(raw._error)return{status:'error',critical:0,high:0,items:[],error:raw.message};let critical=0,high=0;const items=[];
  for(const [ecosystem,result] of Object.entries(raw)){if(result.status==='not_applicable')continue;critical+=result.critical||0;high+=result.high||0;
    for(const item of result.vulnerabilities||[])items.push({...item,ecosystem});}const hasError=Object.values(raw).some((row)=>row.error||row.status==='error');
  return{status:hasError&&!critical&&!high?'error':critical||high?'required_fail':'pass',critical,high,items};}
function normalizeCoverageTrend(raw){if(!raw||raw.status==='not_applicable')return{status:'not_applicable',baseline:null,current:null,delta:null};
  if(raw._timeout)return{status:'timeout',baseline:null,current:null,delta:null};if(raw._error)return{status:'error',baseline:null,current:null,delta:null};
  return{status:raw.degraded?'advisory':'pass',baseline:raw.baseline,current:raw.current,delta:raw.delta};}
function checkDependency(projectRoot,rule,options={}){const available=typeof options.depCruiserAvailable==='boolean'?options.depCruiserAvailable:false;
  if(!available)return rule.severity==='required'?{ruleId:rule.id,status:'required_missing',passed:false,message:'dep-cruiser is not installed but rule severity is required',violations:[]}:
    {ruleId:rule.id,status:'not_applicable',passed:true,message:'dep-cruiser is not installed; skipping advisory rule',violations:[]};
  if(rule.check!=='circular')return{ruleId:rule.id,status:'not_applicable',passed:true,message:`check type '${rule.check}' is not yet implemented in v1`,violations:[]};
  if(!options.processSpec)return{ruleId:rule.id,status:'error',passed:false,message:'authenticated dep-cruiser process spec required',violations:[]};
  const result=runStructuredSync(options.processSpec,{cwd:projectRoot,timeout:60000});if(result.error)return{ruleId:rule.id,status:'error',passed:false,message:result.error.message,violations:[]};
  const report=JSON.parse(result.stdout);const violations=[];for(const mod of report.modules||report.output?.modules||[])for(const dep of mod.dependencies||[])if(dep.circular)
    violations.push({file:mod.source,dependency:dep.resolved,message:`Circular dependency: ${mod.source} → ${dep.resolved}`});
  return{ruleId:rule.id,status:violations.length?'failed':'passed',passed:!violations.length,violations};}
function isDepCruiserAvailable(options={}){if(!options.processSpec)return false;return !runStructuredSync(options.processSpec,{timeout:10000}).error;}
function normalizeFitness(fitness,validation,check){if(!fitness)return{yaml_exists:false,total_rules:0,passed:0,failed:0,not_applicable:0,
  required_missing:0,violations:[],validation_errors:[],skipped_rules:[]};const violations=[];for(const row of check?.results||[])if(!row.passed)violations.push(...(row.violations||[]));
  return{yaml_exists:true,total_rules:check?.total||0,passed:check?.passed||0,failed:check?.failed||0,not_applicable:check?.notApplicable||0,
    required_missing:check?.requiredMissing||0,violations,validation_errors:validation?.errors||[],skipped_rules:validation?.skippedRules||[]};}
function dynamicHealth(relative){return require(path.join(__dirname,'..','health',...relative.split('/')));}
function loadFitnessFile(file){try{if(!file||!fs.existsSync(file))return null;return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){throw new Error(`Failed to load fitness file ${file}: ${error.message}`);}}
async function runHealthCheck(input,maybeOptions={}){const projectRoot=typeof input==='string'?input:input?.projectRoot;const options=typeof input==='string'?maybeOptions:input||{};
  const hasFitness=Object.hasOwn(options,'fitness');const fitness=hasFitness?options.fitness:loadFitnessFile(options.fitnessFile||options.fitnessPath||path.join(projectRoot,'.deep-review','fitness.json'));
  const timeouts={...DEFAULT_TIMEOUTS,...options.timeouts};let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Health check exceeded total timeout')),timeouts.total);});
  const run=async()=>{if(options._testDelay)await new Promise((resolve)=>setTimeout(resolve,options._testDelay));
    const dead=dynamicHealth('drift/dead-export.js'),stale=dynamicHealth('drift/stale-config.js'),coverage=dynamicHealth('drift/coverage-trend.js');
    const ignore=(options.healthIgnore!==undefined?options.healthIgnore:dead.loadHealthIgnore(projectRoot)).dead_export_ignore||[];
    const [deadRaw,staleRaw,depRaw]=await Promise.all([safeRun(()=>dead.scanDeadExports(projectRoot,['.js','.ts','.jsx','.tsx','.mjs','.cjs'],{ignoreList:ignore}),timeouts.deadExport),
      safeRun(()=>Promise.resolve(stale.scanStaleConfig(projectRoot)),timeouts.staleConfig),safeRun(()=>options.skipAudit?Promise.resolve({}):
        scanDependencyVuln(options.ecosystems||{},timeouts.depVuln,{projectRoot,runner:options.auditRunner}),timeouts.depVuln)]);
    let validation=null,check=null;if(fitness){const validator=dynamicHealth('fitness/fitness-validator.js');validation=validator.validateFitness(fitness);
      if(validation.validRules.length)check=validator.runFitnessCheck(projectRoot,validation.validRules,{depCruiserAvailable:options.depCruiserAvailable||false});}
    return{scan_time:new Date().toISOString(),scan_commit:options.commit||null,drift:{dead_exports:normalizeDeadExports(deadRaw),
      stale_config:normalizeStaleConfig(staleRaw),dependency_vuln:normalizeDepVuln(depRaw),coverage_trend:normalizeCoverageTrend(
        coverage.analyzeCoverageTrend(options.baseline||null,options.currentCoverage||null))},fitness:normalizeFitness(fitness,validation,check)};};
  try{return await Promise.race([run(),timeout]);}finally{clearTimeout(timer);}}
function writeResearchHealthState(state,report){if(!state||typeof state!=='object'||!report)fail('health-state');return{...structuredClone(state),
  topology:report.topology||report.project?.topology||'generic',health_report:report.health_report||report,
  fitness_baseline:report.fitness_baseline||report.fitness||null,unresolved_required_issues:report.unresolved_required_issues||[]};}
function readBaseline(directory){try{return JSON.parse(fs.readFileSync(path.join(directory,BASELINE_FILE),'utf8'));}catch{return null;}}
function writeBaseline(directory,data,commit,branch){fs.mkdirSync(directory,{recursive:true});const value={updated_at:new Date().toISOString(),commit,branch,...data};
  fs.writeFileSync(path.join(directory,BASELINE_FILE),JSON.stringify(value,null,2));return value;}
function isBaselineValid(baseline,currentCommit,currentBranch,options={}){if(!baseline)return false;if(baseline.commit===null&&currentCommit===null)
  return Date.now()-new Date(baseline.updated_at).getTime()<=MAX_AGE_MS;if(baseline.branch!==currentBranch||Date.now()-new Date(baseline.updated_at).getTime()>MAX_AGE_MS)return false;
  return !(options.isAncestor&&baseline.commit&&currentCommit)&&true||options.isAncestor(baseline.commit,currentCommit);}
function gitIsAncestor(ancestor,descendant,options={}){if(!options.processSpec)return false;const result=runStructuredSync({...options.processSpec,args:['merge-base','--is-ancestor',ancestor,descendant]});return result.exitCode===0;}
function parseCliArgs(args,cwd=process.cwd()){const options={skipAudit:args.includes('--skip-audit')};const positionals=[];for(let i=0;i<args.length;i+=1){const arg=args[i];
  if(arg==='--skip-audit')continue;if(arg==='--no-fitness'){options.fitness=null;continue;}if(arg==='--fitness'&&args[i+1]&&!args[i+1].startsWith('--')){options.fitnessPath=args[++i];continue;}
  if(arg.startsWith('--fitness=')){options.fitnessPath=arg.slice(10);continue;}if(!arg.startsWith('--'))positionals.push(arg);}return{projectRoot:positionals[0]||cwd,options};}

module.exports={BASELINE_FILE,MAX_AGE_MS,DEFAULT_TIMEOUTS,loadRegistry,loadCustomTopologies,mergeTopologies,matchTopology,detectTopology,
  generateFitnessProposal,withTimeout,safeRun,normalizeDeadExports,normalizeStaleConfig,normalizeDepVuln,normalizeCoverageTrend,normalizeFitness,
  parseNpmAudit,scanDependencyVuln,checkDependency,isDepCruiserAvailable,runHealthCheck,loadFitnessFile,parseCliArgs,writeResearchHealthState,
  readBaseline,writeBaseline,isBaselineValid,gitIsAncestor,runStructuredSync,validateNativeSpec};
