'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {resolveNativeClaude}=require('./reviewer-toolchain-runtime.js');
test('native Claude resolution accepts standard versioned installation and rejects escaped or script targets',t=>{
  if(process.platform==='win32'){t.skip('native POSIX installer; Windows uses package toolchain');return;}
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dw-native-cli-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const versions=path.join(home,'.local/share/claude/versions'),bin=path.join(home,'.local/bin');fs.mkdirSync(versions,{recursive:true});fs.mkdirSync(bin,{recursive:true});
  const target=path.join(versions,'2.1.263'),entry=path.join(bin,'claude');fs.writeFileSync(target,Buffer.from('cffaedfe00000000','hex'),{mode:0o755});fs.symlinkSync(target,entry);
  assert.equal(resolveNativeClaude({home,args:['--version']}).executable,fs.realpathSync(target));
  fs.writeFileSync(target,'#!/bin/sh\necho forged');assert.throws(()=>resolveNativeClaude({home,args:[]}),/unavailable/);
  fs.unlinkSync(entry);const escaped=path.join(home,'2.1.263');fs.writeFileSync(escaped,Buffer.from('cffaedfe00000000','hex'),{mode:0o755});fs.symlinkSync(escaped,entry);
  assert.throws(()=>resolveNativeClaude({home,args:[]}),/unavailable/);
});
