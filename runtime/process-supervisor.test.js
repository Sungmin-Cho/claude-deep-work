'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {runSupervisedProcess, terminateWindowsTree} = require('./process-supervisor.js');

function fakeTaskkill(exitCode = 0) {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit('close', exitCode));
  return child;
}

test('closed Windows stream supervisor pins the exact helper bytes', () => {
  const helper = fs.readFileSync(path.join(__dirname, 'windows-stream-inventory.ps1'));
  const supervisor = fs.readFileSync(path.join(__dirname, 'process-supervisor.js'), 'utf8');
  const matches = [...supervisor.matchAll(/helperDigest !==\s*'([0-9a-f]{64})'/gu)];
  assert.equal(matches.length, 1, 'closed helper digest guard count');
  assert.equal(matches[0][1], crypto.createHash('sha256').update(helper).digest('hex'),
    'closed supervisor helper digest must match the exact helper bytes');
});

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

test('native Windows supervisor delivers exact non-null stdin and EOF before tool-result', {
  skip:process.platform !== 'win32' ? 'native Windows only' : false,
}, async () => {
  const input = Buffer.from('alpha\r\n한글🙂\r\nomega', 'utf8');
  const expectedBytes = 24;
  const expectedSha256 = '01c20deffb167db1aaea5667d35771bd177cbf2b053e082e9d8774cf69efee91';
  assert.equal(input.length, expectedBytes);
  assert.equal(crypto.createHash('sha256').update(input).digest('hex'), expectedSha256);
  assert.equal(input.toString('utf8').endsWith('\n'), false);

  const childSource = [
    "'use strict';",
    "const crypto=require('node:crypto');",
    'const chunks=[];',
    "process.stdin.on('data',(chunk)=>chunks.push(chunk));",
    "process.stdin.once('end',()=>{",
    'const input=Buffer.concat(chunks);',
    "process.stdout.write(JSON.stringify({bytes:input.length,sha256:crypto.createHash('sha256').update(input).digest('hex')}));",
    '});',
  ].join('');
  const result = await runSupervisedProcess({executable:process.execPath,
    args:['-e', childSource]}, {
    platform:'win32', cwd:process.cwd(), env:{...process.env}, input,
    timeoutMs:20_000, maxOutputBytes:4_096,
  });
  const diagnostic = JSON.stringify({
    ok:result.ok,
    exitCode:result.exitCode,
    signal:result.signal,
    timedOut:result.timedOut,
    stdoutBytes:Buffer.byteLength(result.stdout),
    stderrBytes:Buffer.byteLength(result.stderr),
    stdout:result.stdout.slice(0, 512),
    stderr:result.stderr.slice(0, 512),
    stages:result.stages,
  });
  assert.equal(result.ok, true, diagnostic);
  assert.equal(result.exitCode, 0, diagnostic);
  assert.equal(result.signal, null, diagnostic);
  assert.equal(result.stderr, '', diagnostic);
  assert.equal(result.timedOut, false, diagnostic);
  assert.deepEqual(result.stages, {
    started:true,
    'tool-result':true,
    termination:'complete',
  }, diagnostic);
  let observed;
  try { observed = JSON.parse(result.stdout); }
  catch (error) { assert.fail(`stdin observer returned malformed JSON: ${diagnostic}`); }
  assert.deepEqual(observed, {bytes:expectedBytes, sha256:expectedSha256}, diagnostic);
});

test('native Windows supervisor drains trailing stdout before returning the tool result', {
  skip:process.platform !== 'win32' ? 'native Windows only' : false,
}, async () => {
  const outputBytes = 1_048_576;
  const result = await runSupervisedProcess({executable:process.execPath,
    args:['-e', `process.stdout.write('x'.repeat(${outputBytes}))`]}, {
    platform:'win32', cwd:process.cwd(), env:{...process.env},
    timeoutMs:20_000, maxOutputBytes:outputBytes + 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.stdout.length, outputBytes);
  assert.equal(result.stdout, 'x'.repeat(outputBytes));
  assert.equal(result.stderr, '');
});

test('Windows supervisor timeout preserves started, tool-result, and termination stages', async () => {
  const result = await runSupervisedProcess({executable:process.execPath,
    args:['-e', 'setInterval(() => {}, 1000)']}, {
    platform:'win32', cwd:process.cwd(), env:{...process.env}, timeoutMs:2_000,
    maxOutputBytes:4_096,
    terminationImpl:({pid, child, knownPids}) => new Promise((resolve, reject) => {
      const closed = child.exitCode === null && child.signalCode === null
        ? new Promise((done) => child.once('close', done)) : Promise.resolve();
      try {
        for (const target of [...new Set([...(knownPids || []), pid])]) {
          try { process.kill(target, 'SIGKILL'); }
          catch (error) { if (error?.code !== 'ESRCH') throw error; }
        }
      } catch (error) { reject(error); return; }
      closed.then(resolve, reject);
    }),
  });
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.stages, {
    started:true,
    'tool-result':false,
    termination:'complete',
  });
});
