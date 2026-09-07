'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// Recall is a prompt-level optional consumer, not a runtime memory writer.
// Test its actual privacy/provenance instructions, not a test-local ULID regex
// or obsolete requirements to copy every brief into research.md/state.
test('Research retains optional external-context identity, freshness and citation provenance',()=>{
  const body=read('skills/deep-research/SKILL.md');
  for(const field of ['producer','artifact_kind','schema.name'])assert.ok(body.includes(field),field);
  assert.match(body,/disclose stale\/unavailable evidence/);
  assert.match(body,/already materialized deep-memory brief only when relevant and authorized/);
  assert.match(body,/Retain its provenance if cited/);
  assert.match(body,/do not automatically retrieve\/export\/harvest memories or write memory state/);
});
test('optional integration and harvest cannot become mandatory finish work or new permission',()=>{
  const integrate=read('skills/deep-integrate/SKILL.md'),finish=read('skills/deep-finish/SKILL.md');
  assert.match(integrate,/optional recommendation does not become a new required goal or external permission/);
  assert.match(integrate,/proceed to Finish without opening a recommendation questionnaire/);
  assert.match(finish,/memory\/wiki ingestion follows explicit applicable authorization/);
});
