'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseHookContext, extractMutationTargets } = require('./hook-context.js');

const fixtureDir = path.join(__dirname, '..', 'tests', 'fixtures', 'hook-context');
const fixtureNames = [
  'claude-write-env-direct.json',
  'claude-edit-env-direct.json',
  'claude-multiedit-env-direct.json',
  'claude-bash-wrapper.json',
  'codex-bash-wrapper.json',
  'codex-apply-patch-wrapper.json',
];

function readFixture(name, envPatch = {}) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
  return {
    fixture,
    context: parseHookContext(JSON.stringify(fixture.raw), {...fixture.env, ...envPatch}),
  };
}

test('environment tool name keeps a wrapper-looking payload flat', () => {
  const raw = JSON.stringify({tool_name:'Write', tool_input:{file_path:'inner.js'}});
  const got = parseHookContext(raw, {
    CLAUDE_PLUGIN_ROOT:'/plugins/deep-work',
    CLAUDE_TOOL_USE_TOOL_NAME:'Edit',
  });
  assert.equal(got.valid, true);
  assert.equal(got.source, 'env-direct');
  assert.equal(got.toolName, 'Edit');
  assert.deepEqual(got.toolInput, JSON.parse(raw));
});

test('environment-unset wrapper unwraps exactly once and preserves session identity', () => {
  const got = parseHookContext(JSON.stringify({
    session_id:'host-1',
    tool_name:'apply_patch',
    tool_input:{command:'*** Begin Patch\n*** Update File: src/a.js\n*** End Patch\n'},
  }), {PLUGIN_ROOT:'/plugins/deep-work'});
  assert.deepEqual([got.valid, got.source, got.host, got.canonicalTool, got.hostSessionId],
    [true, 'stdin-wrapper', 'codex', 'write', 'host-1']);
  assert.match(got.toolInput.command, /src\/a\.js/);
});

test('empty, malformed, non-object, and malformed wrapper payloads fail closed', () => {
  for (const raw of ['', ' ', '\r\n\t']) {
    const got = parseHookContext(raw, {});
    assert.deepEqual([got.valid, got.error.code], [false, 'empty-payload']);
  }
  assert.equal(parseHookContext('{bad', {}).error.code, 'invalid-json');
  for (const raw of ['null', '[]', '"text"', '42', 'true']) {
    assert.equal(parseHookContext(raw, {}).error.code, 'payload-not-object', raw);
  }
  for (const value of [null, [], 'bad', 4]) {
    const got = parseHookContext(JSON.stringify({tool_name:'Write', tool_input:value}), {});
    assert.deepEqual([got.valid, got.error.code], [false, 'invalid-wrapper']);
  }
});

test('captured Claude and Codex fixtures pin aliases, hosts, and targets', () => {
  for (const name of fixtureNames) {
    const {fixture, context} = readFixture(name);
    assert.equal(context.valid, true, fixture.name);
    assert.equal(context.host, fixture.host, fixture.name);
    assert.equal(context.canonicalTool, fixture.canonicalTool, fixture.name);
    assert.deepEqual(extractMutationTargets(context), {
      valid:true,
      targets:fixture.targets,
      errors:[],
    }, fixture.name);
  }
});

test('Bash canonicalizes to shell but host comes only from authoritative markers', () => {
  const {context:codex} = readFixture('codex-bash-wrapper.json');
  assert.equal(codex.toolInput.command, 'node -p "process.platform"');
  assert.deepEqual([codex.host, codex.canonicalTool], ['codex', 'shell']);
  const {context:claude} = readFixture('claude-bash-wrapper.json');
  assert.deepEqual([claude.host, claude.canonicalTool], ['claude', 'shell']);

  const raw = JSON.stringify({tool_name:'Bash', tool_input:{command:'node --version'}});
  assert.equal(parseHookContext(raw, {}).host, 'unknown');
  assert.equal(parseHookContext(raw, {
    PLUGIN_ROOT:'/codex/deep-work',
    CLAUDE_PLUGIN_ROOT:'/claude/deep-work',
  }).host, 'unknown');
  assert.equal(parseHookContext(raw, {CODEX_HOME:'/home/codex/.codex'}).host, 'unknown');
});

test('equal compatibility roots and data are allowed but mismatches fail host selection', () => {
  const raw = JSON.stringify({tool_name:'apply_patch', tool_input:{command:
    '*** Begin Patch\n*** Update File: a.js\n*** End Patch\n'}});
  assert.equal(parseHookContext(raw, {
    PLUGIN_ROOT:'/plugins/deep-work ', CLAUDE_PLUGIN_ROOT:'/plugins/deep-work\r',
    PLUGIN_DATA:'/data/deep-work', CLAUDE_PLUGIN_DATA:'/data/deep-work',
  }).host, 'codex');
  for (const env of [
    {PLUGIN_ROOT:'/one', CLAUDE_PLUGIN_ROOT:'/two'},
    {PLUGIN_ROOT:'/one', CLAUDE_PLUGIN_ROOT:'/one', PLUGIN_DATA:'/one', CLAUDE_PLUGIN_DATA:'/two'},
    {PLUGIN_ROOT:'/one', CLAUDE_TOOL_USE_TOOL_NAME:'Write'},
  ]) assert.equal(parseHookContext(raw, env).host, 'unknown');
});

test('aliases are exact, conflicting fields and invalid MultiEdit lists fail closed', () => {
  const base = {valid:true, source:'stdin-wrapper', host:'claude', toolName:'Write',
    canonicalTool:'write', hostSessionId:'', error:null};
  assert.equal(extractMutationTargets({...base, toolInput:{file_path:'a', path:'b'}}).errors[0].code,
    'ambiguous-field');
  assert.equal(extractMutationTargets({...base, toolName:'MultiEdit', toolInput:{edits:'bad'}})
    .errors[0].code, 'invalid-edits');
  assert.equal(extractMutationTargets({...base, toolName:'Write', toolInput:{}})
    .errors[0].code, 'missing-mutation-field');
  assert.equal(extractMutationTargets({...base, toolName:'write', toolInput:{file_path:'a'}})
    .errors[0].code, 'unsupported-tool');
});

test('apply_patch accepts command and legacy patch but rejects malformed headers', () => {
  const base = parseHookContext(JSON.stringify({tool_name:'apply_patch', tool_input:{
    patch:'*** Begin Patch\n*** Delete File: old.js\n*** End Patch\n',
  }}), {PLUGIN_ROOT:'/plugins/deep-work'});
  assert.deepEqual(extractMutationTargets(base).targets, ['old.js']);
  const conflict = {...base, toolInput:{command:'*** Update File: a', patch:'*** Update File: b'}};
  assert.equal(extractMutationTargets(conflict).errors[0].code, 'ambiguous-field');
  const malformed = {...base, toolInput:{command:'hello'}};
  assert.equal(extractMutationTargets(malformed).errors[0].code, 'invalid-patch-header');
});

test('mutation extraction never turns a malformed context into empty success', () => {
  assert.deepEqual(extractMutationTargets({valid:false}), {
    valid:false,
    targets:[],
    errors:[{code:'invalid-context', message:'hook context is invalid'}],
  });
  const got = extractMutationTargets({valid:true, canonicalTool:'write', toolName:'Write', toolInput:null});
  assert.equal(got.valid, false);
  assert.equal(got.targets.length, 0);
});

test('CRLF apply_patch and multiline Bash remain cross-platform inputs', () => {
  const patchContext = parseHookContext(JSON.stringify({tool_name:'apply_patch', tool_input:{
    command:'*** Begin Patch\r\n*** Update File: src/a.js\r\n*** Move to: src/b.js\r\n*** End Patch\r\n',
  }}), {PLUGIN_ROOT:'C:\\Users\\codex\\plugin'});
  assert.deepEqual(extractMutationTargets(patchContext), {
    valid:true, targets:['src/a.js','src/b.js'], errors:[],
  });
  const shell = parseHookContext(JSON.stringify({tool_name:'Bash', tool_input:{
    command:'printf one > src/a.txt\r\nprintf two > src/b.txt',
  }}), {PLUGIN_ROOT:'C:\\Users\\codex\\plugin'});
  assert.deepEqual(extractMutationTargets(shell).targets, ['src/a.txt','src/b.txt']);
});

test('one native data marker is valid but cross-host orphan data stays unknown', () => {
  const raw = JSON.stringify({tool_name:'Bash', tool_input:{command:'node --version'}});
  assert.equal(parseHookContext(raw, {PLUGIN_ROOT:'/codex', PLUGIN_DATA:'/codex/data'}).host,
    'codex');
  assert.equal(parseHookContext(raw, {CLAUDE_PLUGIN_ROOT:'/claude',
    CLAUDE_PLUGIN_DATA:'/claude/data'}).host, 'claude');
  assert.equal(parseHookContext(raw, {PLUGIN_ROOT:'/codex', CLAUDE_PLUGIN_DATA:'/claude/data'}).host,
    'unknown');
});

test('host-specific incoming tool matrix rejects every cross-host mismatch', () => {
  const names = ['Bash', 'apply_patch', 'Write', 'Edit', 'MultiEdit', 'write', 'bash'];
  for (const name of names) {
    const input = name === 'Bash' ? {command:'node --version'}
      : name === 'apply_patch' ? {command:'*** Begin Patch\n*** Update File: a.js\n*** End Patch\n'}
        : {file_path:'a.js'};
    const raw = JSON.stringify({tool_name:name, tool_input:input});
    const codex = parseHookContext(raw, {PLUGIN_ROOT:'/codex'});
    assert.equal(codex.host, ['Bash','apply_patch'].includes(name) ? 'codex' : 'unknown',
      `codex ${name}`);
    const claude = parseHookContext(raw, {CLAUDE_PLUGIN_ROOT:'/claude'});
    assert.equal(claude.host, ['Bash','Write','Edit','MultiEdit'].includes(name) ? 'claude' : 'unknown',
      `claude ${name}`);
  }
});
