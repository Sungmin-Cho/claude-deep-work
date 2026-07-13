'use strict';

const fs = require('node:fs');
const path = require('node:path');
const platform = require('../../runtime/platform.js');

const [root, boundary, producerId, consumerId, controlDirectory] = process.argv.slice(2);
const blocker = new Int32Array(new SharedArrayBuffer(4));
let armed = false;
let fired = false;
let digest = null;
let targetPath = null;
let ownerPath = null;
let terminalPath = null;
const directoryFds = new Set();
const terminalStageFds = new Set();

function pauseAtBoundary() {
  if (!armed || fired) return;
  fired = true;
  fs.writeFileSync(path.join(controlDirectory, `${boundary}.json`), JSON.stringify({
    boundary,
    pid:process.pid,
    producerId,
    consumerId,
    digest,
    targetPath,
  }));
  Atomics.wait(blocker, 0, 0);
}

const runtime = platform.createPlatformRuntimeForTest({fsImpl:{
  openSync(value, flags, mode) {
    const fd = fs.openSync(value, flags, mode);
    if (flags === 'r' && targetPath && value === path.dirname(targetPath)) directoryFds.add(fd);
    if (terminalPath && String(value).startsWith(`${terminalPath}.publish.`)) {
      terminalStageFds.add(fd);
    }
    return fd;
  },
  closeSync(fd) {
    directoryFds.delete(fd);
    terminalStageFds.delete(fd);
    return fs.closeSync(fd);
  },
  writeFileSync(fd, bytes) {
    const result = fs.writeFileSync(fd, bytes);
    if (boundary === 'after-terminal-stage-write' && terminalStageFds.has(fd)) pauseAtBoundary();
    return result;
  },
  fsyncSync(fd) {
    const result = fs.fsyncSync(fd);
    if (boundary === 'after-terminal-stage-fsync' && terminalStageFds.has(fd)) pauseAtBoundary();
    if (directoryFds.has(fd) && targetPath && ownerPath && terminalPath) {
      const directoryNames = fs.readdirSync(path.dirname(targetPath));
      const terminalStageExists = directoryNames.some((name) =>
        name.startsWith(`${path.basename(terminalPath)}.publish.`));
      if (boundary === 'after-cleanup-directory-fsync' && !fs.existsSync(targetPath) &&
          !fs.existsSync(ownerPath) && !fs.existsSync(terminalPath)) {
        pauseAtBoundary();
      }
      if (boundary === 'after-terminal-directory-fsync' && fs.existsSync(terminalPath) &&
          !terminalStageExists) {
        pauseAtBoundary();
      }
    }
    return result;
  },
  renameSync(source, destination) {
    if (boundary === 'after-cleanup-intent-fsync' && source === ownerPath) pauseAtBoundary();
    const result = fs.renameSync(source, destination);
    if (boundary === 'after-owner-rename' && source === ownerPath) pauseAtBoundary();
    if (boundary === 'after-target-rename' && source === targetPath) pauseAtBoundary();
    if (boundary === 'after-terminal-rename' && terminalPath &&
        String(source).startsWith(`${terminalPath}.publish.`) && destination === terminalPath) {
      pauseAtBoundary();
    }
    return result;
  },
  unlinkSync(value) {
    const result = fs.unlinkSync(value);
    if (boundary === 'after-target-unlink' && targetPath &&
        String(value).startsWith(`${targetPath}.remove.`)) pauseAtBoundary();
    if (boundary === 'after-owner-unlink' && ownerPath &&
        String(value).startsWith(`${ownerPath}.remove.`)) pauseAtBoundary();
    return result;
  },
}});

const state = runtime.issueProjectStateCapability(root,
  path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
const work = runtime.issueProjectStateCapability(root,
  path.join(root, '.deep-work', 's-a1b2c3d4'),
  {role:'session-work-dir', sessionStateCapability:state});
const temp = runtime.issueOwnedTempCapability({sessionCapability:work,
  operationId:producerId, purpose:'notes'});
targetPath = temp.path;
ownerPath = `${targetPath}.owner.json`;
terminalPath = `${targetPath}.terminal.json`;
runtime.atomicWriteFile(temp, `payload-${boundary}`);
digest = temp.contentDigest;
platform.consumeOwnedTemp(temp, {operationId:consumerId, purpose:'notes', expectedDigest:digest});
armed = true;
platform.compareRemoveOwnedTemp(temp, digest);
process.stderr.write(`boundary not reached: ${boundary}\n`);
process.exitCode = 1;
