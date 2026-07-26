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
      "require('./helper.js');",
      "spawnSync('git',['status']);",
      'spawnSync(process.execPath,[\'-e\',\'\']);',
      '',
    ].join('\n'),
    'runtime/nested/b.test.js':"'use strict';\n",
    'runtime/helper.js':"const {execFileSync}=require('node:child_process');\n"+
      "execFileSync('bash',['-c','true']);\n",
    'runtime/not-a-test.js':"'use strict';\n",
  },result=scanner.scanReleaseSources({committedFiles:files});
  assert.deepEqual(result.required_tools,['bash','git','node','npm']);
  assert.deepEqual(result.graph.roots,
    ['command:npm-pack-dry-run-json','package.json#scripts.test']);
  assert.equal(result.graph.rows.some((row)=>
    row.path==='runtime/a.test.js'),true);
  assert.equal(result.graph.rows.some((row)=>
    row.path==='runtime/not-a-test.js'),false);
  assert.equal(result.graph.rows.some((row)=>
    row.path==='runtime/helper.js'),true);
  assert.deepEqual(result.graph.rows.find((row)=>
    row.path==='runtime/a.test.js').outgoing,
  [{kind:'node-entry',path:'runtime/helper.js'}]);
  assert.equal(result.graph.platform_executables.length,1);
  assert.deepEqual(toolchain.validateReleaseSourceGraph(result.graph),
    result.graph);
});

test('recursive source scan follows invoked shell entrypoints and utilities',()=>{
  const files={
    'package.json':JSON.stringify({scripts:{test:
      'node --test runtime/a.test.js'}}),
    'runtime/a.test.js':[
      "'use strict';",
      "const path=require('node:path');",
      "const {spawnSync}=require('node:child_process');",
      "const script=path.join(__dirname,'check.sh');",
      "spawnSync('bash',[script]);",
      '',
    ].join('\n'),
    'runtime/check.sh':[
      '#!/usr/bin/env bash',
      '# forged-command should remain comment data',
      'ROOT="$(cd "$(dirname "$0")" && pwd)"',
      'echo "quoted-command must remain string data"',
      "cat <<'JSON'",
      'heredoc-command is data',
      'JSON',
      'if command -v flock >/dev/null 2>&1; then flock -w 2 9; fi',
      'node "$ROOT/check.js"',
      '',
    ].join('\n'),
    'runtime/check.js':"'use strict';\n",
  };
  const result=scanner.scanReleaseSources({committedFiles:files});
  assert.deepEqual(result.required_tools,
    ['bash','cat','dirname','node','npm']);
  assert.equal(result.graph.rows.some((row)=>
    row.path==='runtime/check.sh'&&row.kind==='shell-entry'),true);
  assert.equal(result.graph.rows.some((row)=>
    row.path==='runtime/check.js'&&row.kind==='node-entry'),true);
  assert.deepEqual(result.graph.rows.find((row)=>
    row.path==='runtime/a.test.js').outgoing,
  [{kind:'shell-entry',path:'runtime/check.sh'}]);
  assert.deepEqual(result.graph.rows.find((row)=>
    row.path==='runtime/check.sh').outgoing,
  [{kind:'node-entry',path:'runtime/check.js'}]);
});

test('nested fake curl factories are graph fixtures rather than release tools',()=>{
  const fixtureSource=[
    "'use strict';",
    "const fs=require('node:fs');",
    "const os=require('node:os');",
    "const path=require('node:path');",
    "const {spawnSync}=require('node:child_process');",
    "const SCRIPT=path.resolve(__dirname,'update-check.sh');",
    "const LOCAL_VERSION=require('../../package.json').version;",
    'function run(curlBody) {',
    "  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh\\n${curlBody}\\n`);",
    "  fs.chmodSync(path.join(bin, 'curl'), 0o755);",
    "  return spawnSync('bash', [SCRIPT], {env:{",
    '    PATH: `${bin}:${process.env.PATH}`,',
    '  }});',
    '}',
    "bin = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-bin-'));",
    "const r = run('exit 22');",
    "const r = run(`printf '%s' '{\"version\":\"${LOCAL_VERSION}\"}'`);",
    '',
  ].join('\n');
  const files={
    'package.json':JSON.stringify({version:'6.14.0',scripts:{test:
      'node --test hooks/scripts/update-check.test.js'}}),
    'hooks/scripts/update-check.test.js':fixtureSource,
    'hooks/scripts/update-check.sh':'#!/usr/bin/env bash\ncurl -fsSL https://example.invalid/version\n',
  };
  const result=scanner.scanReleaseSources({committedFiles:files});
  assert.deepEqual(result.required_tools,['bash','node','npm']);
  assert.equal(result.graph.test_fixture_executables.length,2);
  assert.deepEqual(result.graph.test_fixture_executables.map((row)=>
    row.factory_args),[
    ['exit 22'],
    [`printf '%s' '{"version":"6.14.0"}'`],
  ]);
  for(const row of result.graph.test_fixture_executables){
    assert.equal(row.factory_source_path,
      'hooks/scripts/update-check.test.js');
    assert.equal(row.fixture_relpath,'curl');
    assert.equal(row.invocation_kind,'child-path-owned-temp-first');
    assert.match(row.child_path_sha256,/^[0-9a-f]{64}$/);
  }
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
    'runtime/a.test.js':"const {spawnSync}=require('node:child_process');\n"+
      "spawnSync(executable,[]);\n",
  }}),/release-launch-dynamic/);
});

test('health runtime dynamic carrier requires closed-environment validation',()=>{
  const authenticated=[
    "const {spawnSync}=require('node:child_process');",
    'function runStructuredSync(spec,{environment=process.env}={}){',
    '  const checked=validateNativeSpec(spec,{environment});',
    '  validateReleaseCarrier(checked.executable,environment);',
    '  const result=spawnSync(checked.executable,checked.args,{env:environment});',
    '  validateReleaseCarrier(checked.executable,environment);',
    '  return result;',
    '}',
  ].join('\n');
  assert.doesNotThrow(()=>scanner.scanLaunchSites(
    'runtime/health-runtime.js',Buffer.from(authenticated)));
  assert.throws(()=>scanner.scanLaunchSites('runtime/health-runtime.js',
    Buffer.from(authenticated.replace(
      '  validateReleaseCarrier(checked.executable,environment);',
      '  void checked.executable;'))),/release-launch-dynamic/);
});

test('source scanner git reader requires identity revalidation',()=>{
  const authenticated=[
    "const childProcess=require('node:child_process');",
    'function gitRead(gitIdentity,args){',
    '  const identity=toolchain.validateToolIdentity(gitIdentity);',
    "  if(identity.name!=='git')throw new Error('wrong tool');",
    '  const result=childProcess.spawnSync(identity.target_path,args,{',
    "    env:{LANG:'C',LC_ALL:'C',TZ:'UTC'},shell:false});",
    '  toolchain.validateToolIdentity(identity);',
    '  return result;',
    '}',
  ].join('\n');
  assert.deepEqual(scanner.scanLaunchSites(
    'runtime/release-source-scanner.js',Buffer.from(authenticated))
    .required_tools,['git']);
  assert.throws(()=>scanner.scanLaunchSites(
    'runtime/release-source-scanner.js',Buffer.from(authenticated.replace(
      '  toolchain.validateToolIdentity(identity);','  void identity;'))),
  /release-launch-dynamic/);
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
