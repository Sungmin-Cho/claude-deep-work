'use strict';

const path = require('node:path');
const platform = require('../../runtime/platform.js');

const [root, operationId, sourceTempDigest, finalizedBytesDigest] = process.argv.slice(2);
try {
  const state = platform.issueProjectStateCapability(root,
    path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
  const work = platform.issueProjectStateCapability(root,
    path.join(root, '.deep-work', 's-a1b2c3d4'),
    {role:'session-work-dir', sessionStateCapability:state});
  const capability = platform.issueFinalizedReceiptPayloadCapability({sessionCapability:work,
    producerOperationReceipt:{version:1, kind:'finish-merge', operationId,
      sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest,
      finalizedBytesDigest}});
  process.stdout.write(JSON.stringify({state:capability.state,
    envelopeOperationId:capability.envelopeOperationId}));
} catch (error) {
  process.stderr.write(`${error.code || 'error'}: ${error.message}`);
  process.exitCode = 1;
}
