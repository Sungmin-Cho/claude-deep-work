'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const platform = require('../../runtime/platform.js');

const [root, sidecarKind, boundary, producerId, consumerId] = process.argv.slice(2);

try {
  const state = platform.issueProjectStateCapability(root,
    path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
  const work = platform.issueProjectStateCapability(root,
    path.join(root, '.deep-work', 's-a1b2c3d4'),
    {role:'session-work-dir', sessionStateCapability:state});
  const payload = `sidecar-${sidecarKind}-${boundary}`;
  if (sidecarKind === 'finalized-consumer') {
    const payloadBytes = Buffer.from(`${JSON.stringify({payload})}\n`);
    const digest = crypto.createHash('sha256').update(payloadBytes).digest('hex');
    const input = {sessionCapability:work,
      producerOperationReceipt:{version:1, kind:'finish-merge', operationId:producerId,
        sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'a'.repeat(64),
        finalizedBytesDigest:digest}};
    const first = platform.issueFinalizedReceiptPayloadCapability(input);
    platform.consumeFinalizedReceiptPayload(first,
      {kind:'envelope-publish', operationId:consumerId});
    const retry = platform.issueFinalizedReceiptPayloadCapability(input);
    process.stdout.write(JSON.stringify({state:retry.state,
      envelopeOperationId:retry.envelopeOperationId, digest}));
  } else {
    const input = {sessionCapability:work, operationId:producerId, purpose:'notes'};
    const temp = platform.issueOwnedTempCapability(input);
    const write = platform.atomicWriteFile(temp, payload);
    const digest = temp.contentDigest;
    platform.consumeOwnedTemp(temp,
      {operationId:consumerId, purpose:'notes', expectedDigest:digest});
    platform.compareRemoveOwnedTemp(temp, digest);
    const terminal = platform.issueOwnedTempCapability(input);
    const directoryEntries = fs.readdirSync(path.dirname(temp.path));
    process.stdout.write(JSON.stringify({state:terminal.state, digest,
      write, targetExists:fs.existsSync(temp.path),
      ownerExists:fs.existsSync(`${temp.path}.owner.json`),
      removeResidue:directoryEntries.filter((name) => name.includes('.remove.'))}));
  }
} catch (error) {
  process.stderr.write(`${error.code || 'error'}: ${error.message}\n`);
  process.exitCode = 1;
}
