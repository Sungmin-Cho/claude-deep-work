'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {wrapEnvelope,unwrapEnvelope}=require('../hooks/scripts/envelope.js');
const root=path.resolve(__dirname,'..');

test('receipt readers enforce all three envelope identity fields',()=>{
  const wrapped=wrapEnvelope({artifactKind:'slice-receipt',payload:{schema_version:'1.0',slice_id:'SLICE-001'},
    runId:'01J00000000000000000000000',producerVersion:require('../package.json').version,
    generatedAt:'2026-09-06T00:00:00Z',git:{head:'abcdef0',branch:'test',dirty:false}});
  assert.equal(unwrapEnvelope(wrapped,'slice-receipt').slice_id,'SLICE-001');
  for(const mutate of [x=>x.envelope.producer='other-plugin',x=>x.envelope.artifact_kind='session-receipt',x=>x.envelope.schema.name='session-receipt']){
    const wrong=structuredClone(wrapped);mutate(wrong);assert.equal(unwrapEnvelope(wrong,'slice-receipt'),null);
  }
});
test('maintainer mechanics and Node floor remain centralized without duplicate skill payload schemas',()=>{
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const agents=read('AGENTS.md'),contributing=read('CONTRIBUTING.md');
  assert.ok(contributing.includes('`AGENTS.md` is the authority for agent-only mechanics'));
  assert.ok(contributing.includes('never `git add -A`'));assert.equal(require('../package.json').engines.node,'>=22');
  assert.match(agents,/Node ≥ 22/);assert.match(agents,/sole M3 writer/);
  for(const file of ['skills/deep-implement/SKILL.md','agents/implement-slice-worker.md'])assert.doesNotMatch(read(file),/"envelope": \{/);
});
