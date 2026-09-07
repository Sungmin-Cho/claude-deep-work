'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPlatformRuntimeForTest,resolveNodePackageBin}=require('./platform.js');
test('declared Claude CLI bin uses closed authenticated Node package resolver',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'s02-toolchain-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bin=path.join(root,'bin'),executable=path.join(bin,process.platform==='win32'?'node.exe':'node'),pkg=path.join(bin,'node_modules/@anthropic-ai/claude-code');
 fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(executable,'test-double');fs.chmodSync(executable,0o755);
 fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@anthropic-ai/claude-code',bin:{claude:'cli.js'}}));fs.writeFileSync(path.join(pkg,'cli.js'),'// test-double');
 const cap=await createPlatformRuntimeForTest().issueNodeToolchainCapability({nodeExecutable:executable,home:root,environment:{}});
 const command=resolveNodePackageBin(cap,{package:'@anthropic-ai/claude-code',bin:'claude',args:['--version']});assert.equal(command.argv[0],fs.realpathSync(path.join(pkg,'cli.js')));
 assert.throws(()=>resolveNodePackageBin(cap,{package:'@unknown/arbitrary',bin:'run',args:[]}),/node-toolchain-package-unavailable/);
});
