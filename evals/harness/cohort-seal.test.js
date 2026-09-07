'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {freeze,runAttempt,plans,invocationFor}=require('./run.js'),seal=require('./cohort-seal.js');
function fixture(t,{lock=true,config=true,postDrift=false}={}){
 const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-eval-seal-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,'plugin'),output=path.join(base,'cohort'),home=path.join(base,'home'),codexHome=path.join(home,'.codex');fs.mkdirSync(codexHome,{recursive:true});
 for(const dir of ['runtime','scripts','hooks','skills','agents','templates','tests','.claude-plugin','.codex-plugin','health','sensors','schemas','evals/harness'])fs.mkdirSync(path.join(root,dir),{recursive:true});
 for(const file of ['.claude-plugin/plugin.json','.codex-plugin/plugin.json','package.json','AGENTS.md','CLAUDE.md','README.md','README.ko.md','assumptions.json'])fs.writeFileSync(path.join(root,file),file.endsWith('.json')?'{}':'fixture source');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json')));manifest.timeout_ms=5000;fs.writeFileSync(path.join(root,'evals/harness/manifest.json'),JSON.stringify(manifest));
 for(const dir of ['task-fixtures','oracles'])fs.cpSync(path.join(__dirname,dir),path.join(root,'evals/harness',dir),{recursive:true});
 if(lock)fs.writeFileSync(path.join(root,'package-lock.json'),'{"version":1}');if(config)fs.writeFileSync(path.join(codexHome,'config.toml'),'model = "fixture"\nprivate_test = "not-recorded-config"\n');
 const executable=path.join(base,'codex-fixture'),version=path.join(base,'version.txt'),marker=path.join(base,'executed');fs.writeFileSync(version,'1.2.3');
 fs.writeFileSync(executable,`#!${process.execPath}\nconst fs=require('node:fs'),crypto=require('node:crypto');if(process.argv.includes('--approve-for-me')&&process.argv.includes('--sandbox')){process.stderr.write('mutually exclusive approval and sandbox flags');process.exit(2);}if(process.argv[2]==='--version'){process.stdout.write('codex-cli '+fs.readFileSync(process.env.TEST_VERSION_PATH,'utf8'));process.exit(0);}fs.writeFileSync(process.env.TEST_RUN_MARKER,'executed');const env=Object.fromEntries(Object.keys(process.env).sort().map(k=>[k,process.env[k]]));fs.writeFileSync('child-observation.json',JSON.stringify({env_sha256:crypto.createHash('sha256').update(JSON.stringify(env)).digest('hex'),keys:Object.keys(env),argv:process.argv.slice(2)}));if(process.env.TEST_DRIFT_PATH)fs.writeFileSync(process.env.TEST_DRIFT_PATH,'changed during child execution');const settings=JSON.parse(fs.readFileSync('settings.json'));settings.retry_count=3;fs.writeFileSync('settings.json',JSON.stringify(settings));fs.appendFileSync('README.md','\\nretry_count controls retries.\\n');process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'fake-transport-test'})+'\\n'+JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'goal-complete:true'}})+'\\n'+JSON.stringify({type:'turn.completed'})+'\\n');\n`,{mode:0o700});
 const env={PATH:process.env.PATH||'/usr/bin:/bin',HOME:home,CODEX_HOME:codexHome,LANG:'C',LC_ALL:'C',TZ:'UTC',TEST_VERSION_PATH:version,TEST_RUN_MARKER:marker,SECRET_TEST_VALUE:'never-serialize-me',PWD:'volatile',OLDPWD:'volatile',SHLVL:'2',_:'volatile',DEEP_WORK_SESSION_ID:'inherited-session'};
 if(process.env.__CF_USER_TEXT_ENCODING)env.__CF_USER_TEXT_ENCODING=process.env.__CF_USER_TEXT_ENCODING;
 if(postDrift)env.TEST_DRIFT_PATH=path.join(root,'package-lock.json');
 return{root,output,executable,env,marker,version,config:path.join(codexHome,'config.toml'),lock:path.join(root,'package-lock.json'),options:{codexExecutable:executable,env,pluginRoot:root},id:plans(manifest)[0].id};
}
function freezeFixture(f){return freeze(f.output,f.options);}
async function attempt(f,extra={}){return runAttempt({output:f.output,id:f.id,...f.options,...extra});}
test('v2 freezes all12 concrete invocations and hashes configuration/environment without exposing values',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 const f=fixture(t),frozen=freezeFixture(f);assert.equal(frozen.schema_version,2);assert.equal(frozen.attempts.length,12);assert.equal(frozen.cli.path,fs.realpathSync(f.executable));assert.equal(frozen.cli.version,'codex-cli 1.2.3');assert.equal(frozen.package_lock.present,true);assert.equal(frozen.user_config.present,true);
 for(const row of frozen.attempts){assert(row.argv.includes('--approve-for-me'));assert(!row.argv.includes('--sandbox'));assert.equal(row.sandbox.mode,'workspace-write');assert.equal(row.sandbox.configuration,'approve-for-me-cli-default');assert.equal(row.sandbox.enforcement,'unobserved');assert(!row.argv.some(x=>x.includes('dangerously-bypass')));assert.equal(row.argv.filter(x=>x==='--disable').length,2);assert.equal(row.prompt_sha256.length,64);assert.equal(row.argv_sha256.length,64);}
 const text=fs.readFileSync(path.join(f.output,'frozen.json'),'utf8');assert(!text.includes('never-serialize-me'));assert(!text.includes('not-recorded-config'));assert.equal(frozen.environment.credential_store.status,'unobserved');
 const alternate={...f.env,PWD:'other',OLDPWD:'other',SHLVL:'10',_:'other',DEEP_WORK_SESSION_ID:'other'};assert.equal(freeze(f.output,{...f.options,env:alternate}).cohort_sha256,frozen.cohort_sha256);
 const receipt=await attempt(f,{env:alternate});assert.equal(receipt.status,'finished');assert.equal(receipt.cohort_unchanged,true);assert.equal(receipt.grading.task_complete,true);const observed=JSON.parse(fs.readFileSync(path.join(f.output,f.id,'workspace/child-observation.json')));assert.equal(observed.env_sha256,frozen.environment.sha256,JSON.stringify({observed:observed.keys,expected:frozen.environment.keys}));for(const key of ['PWD','OLDPWD','SHLVL','_','DEEP_WORK_SESSION_ID'])assert(!observed.keys.includes(key));assert(observed.keys.includes('SECRET_TEST_VALUE'));assert.deepEqual(observed.argv,frozen.attempts[0].argv);
});
for(const mutation of ['binary','version','lock','config','environment','source','test-example','argv'])test(`${mutation} drift rejects before task execution and persists unavailable receipt`,async t=>{
 const f=fixture(t),frozen=freezeFixture(f),original=fs.readFileSync(path.join(f.output,'frozen.json'));let extra={};
 if(mutation==='binary')fs.writeFileSync(f.executable,`#!${process.execPath}\nrequire('fs').writeFileSync(process.env.TEST_RUN_MARKER,'replaced executable ran');`);
 if(mutation==='version')fs.writeFileSync(f.version,'1.2.4');
 if(mutation==='lock')fs.appendFileSync(f.lock,' ');
 if(mutation==='config')fs.appendFileSync(f.config,'# drift');
 if(mutation==='environment')extra.env={...f.env,SECRET_TEST_VALUE:'different-private-value'};
 if(mutation==='source')fs.appendFileSync(path.join(f.root,'README.md'),' drift');
 if(mutation==='test-example')fs.writeFileSync(path.join(f.root,'tests','changed-example.js'),'fixture example changed');
 if(mutation==='argv'){frozen.attempts[0].argv.push('--dangerously-bypass-approvals-and-sandbox');const content={...frozen};delete content.cohort_sha256;frozen.cohort_sha256=seal.digest(seal.canonical(content));fs.writeFileSync(path.join(f.output,'frozen.json'),JSON.stringify(frozen));}
 const expectedFrozen=fs.readFileSync(path.join(f.output,'frozen.json'));const receipt=await attempt(f,extra);assert.equal(receipt.status,'unavailable');assert.equal(receipt.grading.task_complete,false);assert.equal(fs.existsSync(f.marker),false);assert.deepEqual(fs.readFileSync(path.join(f.output,'frozen.json')),expectedFrozen);assert.equal(fs.existsSync(path.join(f.output,f.id,'workspace')),false);assert(!JSON.stringify(receipt).includes('different-private-value'));
 if(mutation!=='argv')assert.deepEqual(expectedFrozen,original);
});
test('explicit missing lock/config identities drift when those files appear',async t=>{
 for(const which of ['lock','config']){const f=fixture(t,{lock:false,config:false});const frozen=freezeFixture(f);assert.equal(frozen.package_lock.present,false);assert.equal(frozen.user_config.present,false);fs.writeFileSync(f[which],'new');assert.equal((await attempt(f)).status,'unavailable');assert.equal(fs.existsSync(f.marker),false);}
});
test('post-execution drift invalidates a normal successful process without grading it as completion',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 const f=fixture(t,{postDrift:true});freezeFixture(f);const receipt=await attempt(f);assert.equal(receipt.process.exit_code,0);assert.equal(receipt.termination_confirmed,true);assert.equal(receipt.status,'unavailable');assert.equal(receipt.cohort_unchanged,false);assert.equal(receipt.grading.reason,'cohort-drift');assert.equal(receipt.grading.task_complete,false);
});
test('freeze requires a versioned executable; attempt neither creates nor upgrades a seal',async t=>{
 const f=fixture(t);assert.throws(()=>freeze(f.output,{env:f.env,pluginRoot:f.root}),/eval-codex-executable/);assert.equal(fs.existsSync(path.join(f.output,'frozen.json')),false);assert.equal((await attempt(f)).status,'unavailable');assert.equal(fs.existsSync(path.join(f.output,'frozen.json')),false);
 const old=fixture(t);fs.mkdirSync(old.output);fs.writeFileSync(path.join(old.output,'frozen.json'),'{"schema_version":1}');const bytes=fs.readFileSync(path.join(old.output,'frozen.json'));assert.equal((await attempt(old)).status,'unavailable');assert.deepEqual(fs.readFileSync(path.join(old.output,'frozen.json')),bytes);
});

test('current treatment retains product success but cannot complete without real Keep and approval authority',{
 skip:process.platform==='linux'?'linux process identity unconfirmed':false,
},async t=>{
 const f=fixture(t);const frozen=freezeFixture(f);f.id=frozen.attempts.find(row=>row.task==='doc-config'&&row.variant==='current').id;
 const receipt=await attempt(f);assert.equal(receipt.status,'finished');assert.equal(receipt.grading.product_pass,true);assert.equal(receipt.grading.product_task_complete,true);assert.equal(receipt.grading.task_complete,false);assert.equal(receipt.treatment_compliance.complete,false);assert.equal(receipt.grading.false_completion,true);
});
