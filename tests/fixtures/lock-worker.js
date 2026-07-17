'use strict';

const fs = require('node:fs');
const path = require('node:path');
const platform = require('../../runtime/platform.js');

const [projectRoot, lockPath, processIdentity, targetSeam, controlDirectory] = process.argv.slice(2);
const blocker = new Int32Array(new SharedArrayBuffer(4));
const runtime = targetSeam ? platform.createPlatformRuntimeForTest({
  lockSeamImpl(event) {
    if (event.seam !== targetSeam) return;
    const marker = path.join(controlDirectory, `${targetSeam}.json`);
    fs.writeFileSync(marker, JSON.stringify({seam:event.seam, pid:process.pid, processIdentity}));
    Atomics.wait(blocker, 0, 0);
  },
}) : platform;
const lockCapability = runtime.issueProjectStateCapability(projectRoot, lockPath,
  {role:'lock', allowMissingLeaf:true});
runtime.withDirectoryLock(lockCapability, {
  timeoutMs: 2_000,
  staleMs: 150,
  heartbeatMs: 25,
  processIdentity,
}, async () => {
  if (process.send) process.send({type:'ready', pid:process.pid});
  if (!targetSeam) await new Promise(() => {});
  return 'complete';
});
