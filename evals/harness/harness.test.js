'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {grade}=require('./grade.js');
const {parseOutput,promptFor,plans}=require('./run.js');
test('independent oracle rejects always-zero implementation and claimed success',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-eval-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'range.js'),'module.exports=()=>false;');fs.writeFileSync(path.join(root,'range.test.js'),'');
  const failed=await grade({workspace:root,oracle:{kind:'regression'},processResult:{ok:true},claim:true});
  assert.equal(failed.task_complete,false);assert.equal(failed.false_completion,true);
  fs.writeFileSync(path.join(root,'range.js'),'module.exports=(n,l,h)=>l<=h&&n>=l&&n<=h;');
  assert.equal((await grade({workspace:root,oracle:{kind:'regression'},processResult:{ok:true},claim:true})).task_complete,false);
  fs.writeFileSync(path.join(root,'range.test.js'),"const t=require('node:test'),a=require('node:assert/strict'),f=require('./range.js');t('interior',()=>a.equal(f(5,1,9),true));t('reversed',()=>a.equal(f(5,9,1),false));t('boundaries',()=>{a.equal(f(1,1,9),true);a.equal(f(9,1,9),true);});");
  const passed=await grade({workspace:root,oracle:{kind:'regression'},processResult:{ok:true},claim:true});
  assert.equal(passed.task_complete,true);assert.equal(passed.false_completion,false);
  assert.equal((await grade({workspace:root,oracle:{kind:'regression'},processResult:{ok:false,timedOut:true},claim:true})).task_complete,false);
  fs.writeFileSync(path.join(root,'range.js'),'process.exit(0);');
  assert.equal((await grade({workspace:root,oracle:{kind:'regression'},processResult:{ok:true},claim:true})).false_completion,true);
});
test('manifest has exactly twelve live attempts and labels other cases as runtime tests',()=>{
  const m=require('./manifest.json');assert.equal(m.models.length*m.variants.length*m.trials*m.tasks.filter(t=>t.live).length,12);
  assert.equal(m.tasks.length,6);assert.equal(m.timeout_ms,600000);
});
test('pilot identity comes only from provider metadata and current treatment loads the real entry',()=>{
  const output=JSON.stringify({type:'thread.started',thread_id:'thread-1'})+'\n'+JSON.stringify({type:'item.completed',
    item:{type:'agent_message',text:'I am gpt-6-astra.\ngoal-complete:true'}})+'\n';
  const parsed=parseOutput(output);assert.equal(parsed.observed_model,null);assert.equal(parsed.claim,true);
  assert.equal(parsed.session_id,'thread-1');assert.equal(parsed.cost,null);
  const m=require('./manifest.json'),rows=plans(m);assert.equal(new Set(rows.map(r=>r.id)).size,12);
  assert.match(promptFor(rows.find(r=>r.variant==='current'),'/verified/plugin'),/\/verified\/plugin\/skills\/deep-work\/SKILL.md/);
  assert.doesNotMatch(promptFor(rows.find(r=>r.variant==='baseline'),'/verified/plugin'),/\/verified\/plugin/);
});
