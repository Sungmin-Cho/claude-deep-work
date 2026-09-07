'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPlatformRuntimeForTest,resolveNodePackageBin}=require('./platform.js');
function fixture(t,formula='node@22'){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-versioned-brew-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const prefix=path.join(root,'opt/homebrew'),node=path.join(prefix,'Cellar',formula,'22.23.2','bin/node'),packages=path.join(prefix,'lib/node_modules'),pkg=path.join(packages,'@openai/codex');fs.mkdirSync(path.dirname(node),{recursive:true});fs.writeFileSync(node,'fixture Node identity');fs.chmodSync(node,0o755);fs.mkdirSync(path.join(pkg,'bin'),{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@openai/codex',bin:{codex:'bin/codex.js'}}));fs.writeFileSync(path.join(pkg,'bin/codex.js'),'// declared JavaScript entry\n');return{root,prefix,node,packages,pkg};
}
async function resolve(f,platform='darwin'){const capability=await createPlatformRuntimeForTest({platform}).issueNodeToolchainCapability({nodeExecutable:f.node,home:f.root,environment:{}});return resolveNodePackageBin(capability,{package:'@openai/codex',bin:'codex',args:['--version']});}
for(const formula of ['node','node@22','node@24','node@26'])test(`Homebrew ${formula} resolves its physical prefix global package`,async t=>{
 const f=fixture(t,formula);assert.deepEqual(await resolve(f),{executable:fs.realpathSync(f.node),argv:[fs.realpathSync(path.join(f.pkg,'bin/codex.js')),'--version']});
});
for(const formula of ['node@','node@lts','node@22x','node@22.1','node@22-extra','node@22\u2028','node22','nodejs','node@22/nested'])test(`Homebrew formula near-match ${formula} does not acquire global package authority`,async t=>{
 const f=fixture(t,formula);await assert.rejects(()=>resolve(f),/node-toolchain-package-unavailable/);
});
test('versioned Homebrew derivation stays Darwin-only',async t=>{const f=fixture(t);await assert.rejects(()=>resolve(f,'linux'),/node-toolchain-package-unavailable/);});
for(const link of ['global-root','package-scope','declared-bin'])test(`versioned Homebrew rejects ${link} symlink substitution`,async t=>{
 if(process.platform==='win32'){t.skip('Windows symlink creation requires privilege; platform logic is tested through existing Windows harness');return;}
 const f=fixture(t);
 if(link==='global-root'){const moved=path.join(f.root,'foreign-packages');fs.renameSync(f.packages,moved);fs.symlinkSync(moved,f.packages,'dir');}
 if(link==='package-scope'){const scope=path.join(f.packages,'@openai'),moved=path.join(f.packages,'real-openai');fs.renameSync(scope,moved);fs.symlinkSync(moved,scope,'dir');}
 if(link==='declared-bin'){const target=path.join(f.pkg,'bin/codex.js'),moved=path.join(f.pkg,'bin/actual.js');fs.renameSync(target,moved);fs.symlinkSync(moved,target);}
 await assert.rejects(()=>resolve(f),/node-toolchain-package-unavailable|path-capability-link/);
});
