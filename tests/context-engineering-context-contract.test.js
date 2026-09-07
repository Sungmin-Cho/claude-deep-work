'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {resolveSessionContext}=require('../runtime/session-store.js');
const ROOT=path.resolve(__dirname,'..');

test('modern lifecycle entries resolve state through the shared public runtime',()=>{
  for(const name of ['deep-finish','deep-resume','deep-slice','deep-implement','deep-test','deep-plan','deep-spec']){
    const body=fs.readFileSync(path.join(ROOT,'skills',name,'SKILL.md'),'utf8');
    assert.match(body,/session context/);assert.match(body,/session authority validate/);
    const reference='skills/shared/references/runtime-execution-spine.md';
    assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/'+reference));
    assert.ok(fs.realpathSync(path.join(ROOT,reference)).startsWith(fs.realpathSync(ROOT)+path.sep));
  }
});
test('actual context resolver preserves explicit and environment-selected idle sessions',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-context-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
  const target=path.join(root,'.claude','deep-work.s-abc12345.md');
  fs.writeFileSync(target,'---\nsession_id: s-abc12345\ncurrent_phase: idle\n---\n');
  for(const options of [{sessionId:'s-abc12345',env:{}},{env:{DEEP_WORK_SESSION_ID:'s-abc12345'}}]){
    const resolved=resolveSessionContext({cwd:root,...options});
    assert.equal(resolved.sessionId,'s-abc12345');assert.equal(resolved.stateCapability.path,fs.realpathSync(target));
  }
  assert.equal(fs.readFileSync(target,'utf8'),'---\nsession_id: s-abc12345\ncurrent_phase: idle\n---\n');
});
