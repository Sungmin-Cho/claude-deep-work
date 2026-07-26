'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  detectTopology,
  runHealthCheck,
  writeResearchHealthState,
  withTimeout,
  validateReleaseCarrier,
  validateNativeSpec,
  runStructuredSync,
} = require('./health-runtime.js');

test('withTimeout clears its deadline when work settles first', async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const handle = { referenced: true };
  let cleared = null;
  global.setTimeout = () => handle;
  global.clearTimeout = (value) => { cleared = value; };
  try {
    assert.deepEqual(await withTimeout(() => 'done', 30_000), { value: 'done' });
    assert.equal(cleared, handle);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('health runtime degrades to typed results and limits state fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-health-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({dependencies:{express:'1'}}));
  const topology = detectTopology(root);
  assert.equal(typeof topology.name, 'string');
  const report = await runHealthCheck({projectRoot:root,skipAudit:true});
  const before = {session_id:'s-aaaaaaaa',current_phase:'research',unrelated:'keep'};
  const next = writeResearchHealthState(before, report);
  assert.equal(next.unrelated, 'keep');
  assert.deepEqual(Object.keys(next).filter((key) => !Object.hasOwn(before,key)).sort(),
    ['fitness_baseline','health_report','topology','unresolved_required_issues']);
});

test('closed release environment authenticates health executable carriers',
  {skip:process.platform==='win32'},t=>{
    const parent=fs.mkdtempSync(path.join(os.tmpdir(),'dw-health-carrier-')),
      bin=path.join(parent,'bin'),home=path.join(parent,'home'),
      foreign=path.join(parent,'foreign');
    t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
    fs.mkdirSync(bin);fs.mkdirSync(home);
    fs.symlinkSync(process.execPath,path.join(bin,'node'));
    fs.writeFileSync(foreign,'#!/bin/sh\nexit 0\n',{mode:0o755});
    const environment={LANG:'C',LC_ALL:'C',TZ:'UTC',HOME:home,PATH:bin},
      spec={kind:'native-executable',executable:process.execPath,
        args:['-e','process.stdout.write("ok")']};

    assert.deepEqual(validateReleaseCarrier(process.execPath,environment),{
      bin:fs.realpathSync(bin),target:fs.realpathSync(process.execPath),
      names:['node']});
    assert.equal(validateNativeSpec(spec,{environment}),spec);
    assert.equal(runStructuredSync(spec,{environment}).stdout,'ok');
    assert.throws(()=>validateNativeSpec({...spec,executable:foreign},
      {environment}),/health-release-carrier/);

    fs.writeFileSync(path.join(bin,'unexpected'),'not a shim');
    assert.throws(()=>validateReleaseCarrier(process.execPath,environment),
      /health-release-carrier/);
  });
