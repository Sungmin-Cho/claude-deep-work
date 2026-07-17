'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {validateRegistry,migrateRegistryV1,writeSensorDetectionCache}=require('../runtime/sensor-runtime.js');
const {issueProjectStateCapability}=require('../runtime/platform.js');

function loadRegistry(registryPath){const raw=fs.readFileSync(registryPath);const parsed=JSON.parse(raw.toString('utf8'));
  return parsed.$schema==='sensor-registry-v1'?migrateRegistryV1(raw):validateRegistry(raw).registry;}
function fileExistsOrGlob(dir,pattern){if(!pattern.includes('*'))return fs.existsSync(path.join(dir,pattern));
  const regex=new RegExp(`^${pattern.replace(/\./g,'\\.').replace(/\*/g,'.*')}$`);try{return fs.readdirSync(dir).some((entry)=>regex.test(entry));}catch{return false;}}
function matchEcosystem(projectRoot,detectConfig){const required=detectConfig.require;const anyOf=detectConfig.any_of;
  if(required?.length&&!required.every((pattern)=>fileExistsOrGlob(projectRoot,pattern)))return false;
  if(anyOf?.length&&!anyOf.some((pattern)=>fileExistsOrGlob(projectRoot,pattern)))return false;
  return Boolean(required?.length||anyOf?.length);}
function executableName(spec){return spec.kind==='node-package-bin'?spec.bin:path.basename(spec.executable);}
function checkToolAvailable(spec,options={}){if(!spec||typeof spec!=='object')return false;const root=options.projectRoot||process.cwd();
  if(spec.kind==='node-package-bin')return fs.existsSync(path.join(root,'node_modules','.bin',spec.bin));
  if(spec.kind!=='native-executable')return false;if(path.isAbsolute(spec.executable)){try{return fs.lstatSync(spec.executable).isFile();}catch{return false;}}
  return (process.env.PATH||'').split(path.delimiter).some((directory)=>{try{return fs.lstatSync(path.join(directory,spec.executable)).isFile();}catch{return false;}});}
function detectEcosystems(projectRoot,registryPath){const registry=loadRegistry(registryPath);const detected=[];
  for(const name of Object.keys(registry.ecosystems).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){const def=registry.ecosystems[name];
    if(!def.detect||!matchEcosystem(projectRoot,def.detect))continue;const sensors={};
    for(const key of ['lint','typecheck','mutation'])if(def[key]){const sensorDef=def[key];const available=checkToolAvailable(sensorDef.processSpec,{projectRoot});
      sensors[key]={tool:executableName(sensorDef.processSpec),processSpec:sensorDef.processSpec,parser:sensorDef.parser||null,budgetMs:sensorDef.budgetMs,
        status:available?'available':'not_installed'};}
    detected.push({name,root:'.',sensors,file_extensions:def.file_extensions||[],coverage_flag:def.coverage_flag||null});}
  return {ecosystems:detected,detected_at:new Date().toISOString()};}
module.exports={loadRegistry,matchEcosystem,detectEcosystems,checkToolAvailable};
if(require.main===module){const projectRoot=process.argv[2]||process.cwd();const result=detectEcosystems(projectRoot,path.join(__dirname,'registry.json'));
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(fs.existsSync(path.join(projectRoot,'.claude'))){const cap=issueProjectStateCapability(projectRoot,projectRoot,{role:'project-root'});
    writeSensorDetectionCache(cap,result);}}
