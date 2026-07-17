'use strict';

const fs = require('node:fs');
const path = require('node:path');
const platform = require('../../runtime/platform.js');

const [root, operationId, purpose, data] = process.argv.slice(2);
try {
  const sessionState = platform.issueProjectStateCapability(root,
    path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
  const work = platform.issueProjectStateCapability(root,
    path.join(root, '.deep-work', 's-a1b2c3d4'),
    {role:'session-work-dir', sessionStateCapability:sessionState});
  const cap = platform.issueOwnedTempCapability({sessionCapability:work, operationId, purpose});
  const result = platform.atomicWriteFile(cap, data);
  process.stdout.write(JSON.stringify({ok:true, result, state:cap.state,
    targetExists:fs.existsSync(cap.path)}));
} catch (error) {
  process.stderr.write(`${error.code || 'error'}: ${error.message}`);
  process.exitCode = 1;
}
