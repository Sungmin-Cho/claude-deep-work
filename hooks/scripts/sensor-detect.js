#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {issueProjectStateCapability}=require('../../runtime/platform.js');
const {migrateRegistryV1,validateRegistry,detectSensors,writeSensorDetectionCache}=require('../../runtime/sensor-runtime.js');

async function runSensorDetectHook({projectRoot=process.cwd(),registryPath=path.resolve(__dirname,'..','..','sensors','registry.json')}={}){
  const projectCapability=issueProjectStateCapability(projectRoot,projectRoot,{role:'project-root'});
  const raw=fs.readFileSync(registryPath);let registry=JSON.parse(raw.toString('utf8'));
  if(registry.$schema==='sensor-registry-v1')registry=migrateRegistryV1(raw);
  else registry=validateRegistry(raw).registry;
  const plans=detectSensors(projectCapability,registry);writeSensorDetectionCache(projectCapability,plans);
  return {status:0,plans};
}
async function main(){try{const result=await runSensorDetectHook({});process.stdout.write(`${JSON.stringify(result)}\n`);}
  catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
if(require.main===module)void main();
module.exports={runSensorDetectHook};
