'use strict';

const fs = require('node:fs');
const path = require('node:path');
const platform = require('../../runtime/platform.js');

const [root, sidecarKind, boundary, producerId, consumerId, controlDirectory] =
  process.argv.slice(2);
const blocker = new Int32Array(new SharedArrayBuffer(4));
let armed = false;
let sidecarPath = null;
let watchedFd = null;
let watchedPath = null;
let digest = null;

function isSidecarPublication(value) {
  return value === sidecarPath || String(value).startsWith(`${sidecarPath}.publish.`);
}

function pause(actualPath) {
  const marker = path.join(controlDirectory, `${sidecarKind}-${boundary}.json`);
  fs.writeFileSync(marker, JSON.stringify({sidecarKind, boundary, pid:process.pid,
    sidecarPath, actualPath, producerId, consumerId, digest}));
  Atomics.wait(blocker, 0, 0);
}

const runtime = platform.createPlatformRuntimeForTest({fsImpl:{
  openSync(value, flags, mode) {
    const fd = fs.openSync(value, flags, mode);
    if (armed && flags === 'wx' && isSidecarPublication(value)) {
      watchedFd = fd;
      watchedPath = value;
      if (boundary === 'after-open') pause(value);
    }
    return fd;
  },
  writeFileSync(fd, bytes) {
    if (armed && fd === watchedFd && boundary === 'during-write') {
      const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      fs.writeSync(fd, source.subarray(0, Math.max(1, Math.floor(source.length / 2))));
      pause(watchedPath);
    }
    return fs.writeFileSync(fd, bytes);
  },
  linkSync(existingPath, newPath) {
    const result = fs.linkSync(existingPath, newPath);
    if (armed && boundary === 'after-publish' && newPath === sidecarPath) pause(existingPath);
    return result;
  },
}});

const state = runtime.issueProjectStateCapability(root,
  path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
const work = runtime.issueProjectStateCapability(root,
  path.join(root, '.deep-work', 's-a1b2c3d4'),
  {role:'session-work-dir', sessionStateCapability:state});
const payload = `sidecar-${sidecarKind}-${boundary}`;

if (sidecarKind === 'finalized-consumer') {
  const payloadBytes = Buffer.from(`${JSON.stringify({payload})}\n`);
  const payloadPath = path.join(work.path, '.operation-results', producerId,
    'finalized-receipt-payload.json');
  fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
  fs.writeFileSync(payloadPath, payloadBytes);
  digest = require('node:crypto').createHash('sha256').update(payloadBytes).digest('hex');
  const finalized = runtime.issueFinalizedReceiptPayloadCapability({sessionCapability:work,
    producerOperationReceipt:{version:1, kind:'finish-merge', operationId:producerId,
      sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'a'.repeat(64),
      finalizedBytesDigest:digest}});
  sidecarPath = `${finalized.path}.envelope-consumer.json`;
  armed = true;
  platform.consumeFinalizedReceiptPayload(finalized,
    {kind:'envelope-publish', operationId:consumerId});
} else {
  const temp = runtime.issueOwnedTempCapability({sessionCapability:work,
    operationId:producerId, purpose:'notes'});
  sidecarPath = sidecarKind === 'owner' ? `${temp.path}.owner.json`
    : sidecarKind === 'owned-consumer' ? `${temp.path}.consumer.json`
      : `${temp.path}.cleanup.json`;
  if (sidecarKind === 'owner') {
    armed = true;
    runtime.atomicWriteFile(temp, payload);
  } else {
    runtime.atomicWriteFile(temp, payload);
    digest = temp.contentDigest;
    if (sidecarKind === 'owned-consumer') {
      armed = true;
      platform.consumeOwnedTemp(temp,
        {operationId:consumerId, purpose:'notes', expectedDigest:digest});
    } else {
      platform.consumeOwnedTemp(temp,
        {operationId:consumerId, purpose:'notes', expectedDigest:digest});
      armed = true;
      platform.compareRemoveOwnedTemp(temp, digest);
    }
  }
}

process.stderr.write(`sidecar boundary not reached: ${sidecarKind}/${boundary}\n`);
process.exitCode = 1;
