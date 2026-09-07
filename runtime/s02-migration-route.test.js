'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {updateFrontmatterText,parseFrontmatter}=require('./frontmatter.js');
test('public migration route preserves explicit main without rewriting state',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'s02-route-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
 const file=path.join(root,'.claude/deep-work.s-1234abcd.md');
 const text=updateFrontmatterText('---\nsession_id: s-1234abcd\ncurrent_phase: plan\n---\n',{model_routing_json:JSON.stringify({research:'main',implement:'main',test:'gpt-6-astra'})});fs.writeFileSync(file,text);
 execFileSync(process.execPath,[path.join(__dirname,'../scripts/deep-work-runtime.js'),'session','state','migrate-model-routing','--state',file,'--session','s-1234abcd'],{cwd:root,encoding:'utf8'});
 assert.equal(fs.readFileSync(file,'utf8'),text);
 assert.equal(JSON.parse(parseFrontmatter(fs.readFileSync(file,'utf8')).fields.model_routing_json).implement,'main');
});
