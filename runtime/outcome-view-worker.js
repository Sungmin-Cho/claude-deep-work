'use strict';
// The ephemeral signing key arrives only over this worker's IPC channel, never
// in verifier argv/environment/files. Signed scope is observed, not OS containment.
const q=require('./outcome-quiescence.js');let started=false,configuration;
function quiet(observations){return q.writeQuiescence({...configuration,started,observations});}
process.on('disconnect',()=>{if(!started){try{if(configuration)quiet();}finally{process.exit(0);}}});
process.on('message',async message=>{
 if(message?.type==='configure'&&!configuration){configuration=message;process.send({type:'ready'});return;}
 if(started||message?.type!=='start'||!configuration)return;started=true;process.send({type:'started'});
 const {pair,prepared}=configuration;let observations,error;
 try{const execute=require('./outcome-verification-runtime.js').executeOutcomeView;observations={positive:await execute({pair,kind:'positive',oracle:prepared.oracle,command:prepared.command,resolved:prepared.resolved}),control:await execute({pair,kind:'control',oracle:prepared.oracle,command:prepared.command,resolved:prepared.resolved})};const report=quiet(observations);if(!report.quiescent)error={code:'outcome-view-termination-unconfirmed',message:'observed execution scope did not terminate'};}
 catch(e){error={code:e.code||'outcome-view-worker-error',message:e.message};}
 if(process.connected)process.send({type:'result',observations,error},()=>{if(!process.connected)process.exit(0);});else process.exit(0);
});
