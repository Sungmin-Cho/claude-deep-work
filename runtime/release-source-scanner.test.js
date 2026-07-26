'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const scanner=require('./release-source-scanner.js');
const toolchain=require('./release-toolchain-runtime.js');

test('restricted package shell parsing preserves quoted globs and rejects operators',()=>{
  assert.deepEqual(scanner.shellWords(
    'node --test --test-concurrency=1 "runtime/**/*.test.js"'),
  ['node','--test','--test-concurrency=1','runtime/**/*.test.js']);
  assert.throws(()=>scanner.shellWords('node --test a.test.js && echo forged'),
    /release-shell-parse/);
  assert.throws(()=>scanner.shellWords('node --test $(caller)'),
    /release-shell-parse/);
});

test('recursive source scan follows exact test scripts, globs, and launch literals',()=>{
  const files={
    'package.json':JSON.stringify({scripts:{test:'npm run test:all',
      'test:all':'node --test --test-concurrency=1 "runtime/**/*.test.js"'}}),
    'runtime/a.test.js':[
      "'use strict';",
      "const {spawnSync}=require('node:child_process');",
      "spawnSync('git',['status']);",
      'spawnSync(process.execPath,[\'-e\',\'\']);',
      '',
    ].join('\n'),
    'runtime/nested/b.test.js':"'use strict';\n",
    'runtime/not-a-test.js':"'use strict';\n",
  },result=scanner.scanReleaseSources({committedFiles:files});
  assert.deepEqual(result.required_tools,['git','node','npm']);
  assert.deepEqual(result.graph.roots,
    ['command:npm-pack-dry-run-json','package.json#scripts.test']);
  assert.equal(result.graph.rows.some((row)=>
    row.path==='runtime/a.test.js'),true);
  assert.equal(result.graph.rows.some((row)=>
    row.path==='runtime/not-a-test.js'),false);
  assert.equal(result.graph.platform_executables.length,1);
  assert.deepEqual(toolchain.validateReleaseSourceGraph(result.graph),
    result.graph);
});

test('recursive scripts fail closed on cycles, missing targets, and dynamic roots',()=>{
  assert.throws(()=>scanner.scanReleaseSources({committedFiles:{
    'package.json':JSON.stringify({scripts:{test:'npm run test:all',
      'test:all':'npm run test'}})}}),/release-source-cycle/);
  assert.throws(()=>scanner.scanReleaseSources({committedFiles:{
    'package.json':JSON.stringify({scripts:{test:
      'node --test "missing/**/*.test.js"'}})}}),/release-source-glob/);
  assert.throws(()=>scanner.scanReleaseSources({committedFiles:{
    'package.json':JSON.stringify({scripts:{test:
      'node --test runtime/a.test.js'}}),
    'runtime/a.test.js':"spawnSync(executable,[]);\n",
  }}),/release-launch-dynamic/);
});

test('committed source loading binds an authenticated git and rejects worktree drift',
  {skip:process.platform==='win32'},t=>{
    const gitPath=process.env.PATH.split(path.delimiter).map((directory)=>
      path.join(directory,'git')).find((candidate)=>{
      try{return fs.lstatSync(candidate).isFile()||
        fs.lstatSync(candidate).isSymbolicLink();}catch{return false;}
    });
    assert.ok(gitPath);const gitIdentity=toolchain.buildToolIdentity({
      name:'git',targetPath:gitPath}),root=fs.realpathSync(fs.mkdtempSync(
      path.join(os.tmpdir(),'dw-source-git-')));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const run=(args)=>{
      const result=spawnSync('git',args,{cwd:root});
      assert.equal(result.status,0,result.stderr?.toString());
    };
    run(['init','-q']);run(['config','user.email','test@example.invalid']);
    run(['config','user.name','Test']);
    fs.mkdirSync(path.join(root,'runtime'));
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{
      test:'node --test runtime/a.test.js'}}));
    fs.writeFileSync(path.join(root,'runtime','a.test.js'),"'use strict';\n");
    run(['add','-A']);run(['commit','-qm','base']);
    const files=scanner.loadCommittedFiles({root,gitIdentity});
    assert.equal(files['runtime/a.test.js'].toString(),"'use strict';\n");
    fs.appendFileSync(path.join(root,'runtime','a.test.js'),'// drift\n');
    assert.throws(()=>scanner.loadCommittedFiles({root,gitIdentity}),
      /release-source-drift/);
  });
