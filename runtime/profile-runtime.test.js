'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn}=require('node:child_process');
const { migrateProfile, loadProfile, updateProfile, createV3Profile, loadV3Profile, v2TextToV3Text } = require('./profile-runtime.js');

test('profile v3 migration and update preserve unselected presets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-profile-'));
  const file = path.join(dir, 'profile.yml');
  fs.writeFileSync(file, 'version: 2\ndefault_preset: one\npresets:\n  one:\n    tdd_mode: strict\n');
  await migrateProfile(file, 'one');
  let loaded = loadProfile(file, 'one');
  assert.equal(loaded.version, 3);
  await updateProfile(file, {reason:'setup',selectedPreset:'two',defaults:{tdd_mode:'strict'}});
  loaded = loadProfile(file, 'two');
  assert.deepEqual(Object.keys(loaded.presets).sort(), ['one','two']);
  assert.throws(() => updateProfile(file, {reason:'other',selectedPreset:'x',defaults:{}}),
    /profile-reason/);
});

test('profile owner is target-derived across processes and prevents different-preset lost updates', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-profile-race-'));const file=path.join(dir,'profile.yml');
  await migrateProfile(file,'one');const runtime=path.resolve(__dirname,'profile-runtime.js');const source=`
    const fs=require('node:fs');const path=require('node:path');const target=process.env.PROFILE_TARGET;
    const original=fs.readFileSync;fs.readFileSync=function(file,...args){const value=original.call(this,file,...args);
      if(path.resolve(String(file))===path.resolve(target)&&args[0]==='utf8')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);
      return value;};const {updateProfile}=require(process.env.PROFILE_RUNTIME);process.send('ready');process.once('message',()=>{
      try{updateProfile(target,{reason:'setup',selectedPreset:process.env.PROFILE_PRESET,defaults:{tdd_mode:'strict'}});
        process.send({ok:true});}catch(error){process.send({ok:false,error:error.stack});process.exitCode=1;}});`;
  const children=['two','three'].map((preset)=>spawn(process.execPath,['-e',source],{stdio:['ignore','ignore','pipe','ipc'],
    env:{...process.env,PROFILE_TARGET:file,PROFILE_RUNTIME:runtime,PROFILE_PRESET:preset}}));
  await Promise.all(children.map((child)=>new Promise((resolve,reject)=>{child.once('message',(message)=>message==='ready'?resolve():
    reject(new Error(`worker did not become ready: ${JSON.stringify(message)}`)));child.once('error',reject);})));children.forEach((child)=>child.send('go'));
  await Promise.all(children.map((child)=>new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',(chunk)=>{stderr+=chunk;});
    child.on('message',(message)=>{if(message?.ok!==true)reject(new Error(message?.error||stderr));});child.once('exit',(code)=>code===0?resolve():
      reject(new Error(stderr||`profile worker exited ${code}`)));child.once('error',reject);})));assert.deepEqual(
    Object.keys(loadProfile(file).presets).sort(),['one','three','two']);
});

test('신규 v3 프로필: ask 목록에 model_routing 없음 + defaults는 auto 스칼라', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-prof-'));
  const p = path.join(dir, 'profile.yaml');
  createV3Profile(p, 'solo-strict');
  const text = fs.readFileSync(p, 'utf8');
  assert.ok(!/interactive_each_session:[\s\S]*?- model_routing/.test(
    text.slice(0, text.indexOf('defaults:'))));
  assert.match(text, /model_routing: auto/);
  assert.ok(!/model_routing:\n\s+brainstorm:/.test(text)); // per-phase 블록 아님
  const loaded = loadV3Profile(p);
  assert.strictEqual(loaded.defaults.model_routing, 'auto');
  assert.ok(!loaded.interactive_each_session.includes('model_routing'));
  const full = loadProfile(p); // presets['solo-strict']를 통한 nested 접근도 동일하게 검증 (brief 원문 형태)
  assert.strictEqual(full.presets['solo-strict'].defaults.model_routing, 'auto');
  assert.ok(!full.presets['solo-strict'].interactive_each_session.includes('model_routing'));
});

test('v2TextToV3Text: 변환 출력에도 model_routing 부재 + auto 스칼라 (fallback 경로)', () => {
  const v2 = 'version: 2\ndefault_preset: solo\npresets:\n  solo:\n    team_mode: solo\n';
  const { text } = v2TextToV3Text(v2);
  assert.ok(!/interactive_each_session:[\s\S]*?- model_routing/.test(
    text.slice(0, text.indexOf('defaults:'))));
  assert.match(text, /model_routing: auto/);
  assert.ok(!/model_routing:\n\s+brainstorm:/.test(text));
});

test('profile v4 loads methodology policy while v3 remains a compatibility fallback',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dw-profile-v4-'));
  const file=path.join(dir,'profile.yaml');
  fs.writeFileSync(file,`version: 4
default_preset: adaptive
presets:
  adaptive:
    interactive_each_session:
      - team_mode
    defaults:
      team_mode: auto
      start_phase: auto
      tdd_mode: auto
      git: auto
      methodology_policy: auto
    policy:
      max_risk_without_confirmation: medium
      low_risk_profile: lean
      medium_risk_profile: standard
      high_risk_profile: strict
      critical_risk_profile: critical
      preferred_review_roles:
        semantic: claude
        executability: codex
      context:
        codex_same_goal: native-compaction
`);
  const loaded=loadProfile(file,'adaptive');
  assert.equal(loaded.version,4);
  assert.equal(loaded.compatibility_mode,'native-v4');
  assert.equal(loaded.defaults.methodology_policy,'auto');
  assert.deepEqual(loaded.policy,{
    max_risk_without_confirmation:'medium',
    low_risk_profile:'lean',medium_risk_profile:'standard',
    high_risk_profile:'strict',critical_risk_profile:'critical',
    preferred_review_roles:{semantic:'claude',executability:'codex'},
    context:{codex_same_goal:'native-compaction'},
  });
  const invalid=fs.readFileSync(file,'utf8').replace(
    'max_risk_without_confirmation: medium',
    'max_risk_without_confirmation: impossible');
  fs.writeFileSync(file,invalid);
  assert.throws(()=>loadProfile(file,'adaptive'),/profile-v4-policy/);

  createV3Profile(file,'legacy');
  const legacy=loadProfile(file,'legacy');
  assert.equal(legacy.version,3);
  assert.equal(legacy.compatibility_mode,'legacy-v3');
  assert.equal(legacy.policy,null);
});
