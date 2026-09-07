#!/usr/bin/env node
'use strict';
const path=require('node:path');
function main(argv=process.argv.slice(2)){
 if(argv.length!==2||argv[0]!=='--state')throw new Error('usage: session-metrics-cli.js --state <absolute-state-path>');
 const candidate=argv[1];if(!path.isAbsolute(candidate)||!/^deep-work\.s-[0-9a-f]{8}\.md$/.test(path.basename(candidate))||path.basename(path.dirname(candidate))!=='.claude')throw new Error('metrics-state-path');
 const root=path.dirname(path.dirname(candidate)),stateCapability=require('../runtime/platform.js').issueProjectStateCapability(root,candidate,{role:'session-state'});
 const result=require('../runtime/session-receipt-runtime.js').collectSessionMetrics({stateCapability});process.stdout.write(JSON.stringify(result)+'\n');return result;
}
if(require.main===module)try{main();}catch(e){process.stderr.write(`${e.code||e.message}\n`);process.exitCode=1;}
module.exports={main};
