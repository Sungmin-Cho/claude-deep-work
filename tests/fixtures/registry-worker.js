'use strict';

const path = require('node:path');
const { issueProjectStateCapability } = require('../../runtime/platform.js');
const { registerFileOwnership, updateLastActivity, updateRegistryPhase } =
  require('../../runtime/session-store.js');

async function main() {
  const [root, verb, sessionId, value] = process.argv.slice(2);
  const state = path.join(root, '.claude', `deep-work.${sessionId}.md`);
  const stateCapability = issueProjectStateCapability(root, state, {role:'session-state'});
  const seam=process.env.REGISTRY_PAUSE_DIR?(name)=>{if(name!=='after-pointer-snapshot')return;const fs=require('node:fs');
    const locked=path.join(process.env.REGISTRY_PAUSE_DIR,'locked'),resume=path.join(process.env.REGISTRY_PAUSE_DIR,'resume');
    fs.writeFileSync(locked,'locked');while(!fs.existsSync(resume))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}:undefined;
  if (verb === 'own') await registerFileOwnership({sessionId,stateCapability,portablePath:value,seam,
    pathCapability:issueProjectStateCapability(root,path.join(root,'.claude','worker-path'),
      {allowMissingLeaf:true})});
  else if (verb === 'touch') await updateLastActivity({sessionId,stateCapability,at:value,seam});
  else if (verb === 'phase') await updateRegistryPhase({sessionId,stateCapability,phase:value,
    at:new Date().toISOString(),seam});
  else throw new Error('unknown-worker-verb');
}
main().catch((error) => { process.stderr.write(error.stack || error.message); process.exitCode = 1; });
