'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {terminateWindowsTree} = require('./process-supervisor.js');

function fakeTaskkill(exitCode = 0) {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit('close', exitCode));
  return child;
}

test('Windows termination confirms the supervisor and every recorded descendant', async () => {
  const alive = new Set([41]);
  await assert.rejects(() => terminateWindowsTree(40, {
    systemRoot:'C:\\Windows',
    knownPids:[41],
    spawnImpl:() => fakeTaskkill(0),
    pidAliveImpl:(pid) => alive.has(pid),
    confirmMs:25,
  }), (error) => error.code === 'process-tree-termination-failed' &&
    error.remainingPids.includes(41));
});

test('Windows termination accepts only when all recorded identities are gone', async () => {
  await terminateWindowsTree(40, {
    systemRoot:'C:\\Windows',
    knownPids:[41, 42],
    spawnImpl:() => fakeTaskkill(0),
    pidAliveImpl:() => false,
    confirmMs:25,
  });
});

test('a vanished supervisor still triggers cleanup of every recorded child root', async () => {
  const calls = [];
  const alive = new Set([41]);
  await assert.rejects(() => terminateWindowsTree(40, {
    systemRoot:'C:\\Windows', knownPids:[41], pidAliveImpl:(pid) => alive.has(pid), confirmMs:25,
    spawnImpl:(executable, args) => {
      const pid = Number(args[1]);
      calls.push(pid);
      if (pid === 41) alive.delete(41);
      return fakeTaskkill(pid === 40 ? 128 : 0);
    },
  }), /taskkill failed/);
  assert.deepEqual(calls, [40, 41]);
  assert.equal(alive.has(41), false);
});
