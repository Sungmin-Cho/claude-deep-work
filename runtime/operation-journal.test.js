'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OPERATION_KINDS, beginOperation, recordOperationStage, completeOperation,
  resumeOperation, WORKFLOW_STAGE_RULES } = require('./operation-journal.js');
const { issueProjectStateCapability } = require('./platform.js');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-journal-'));
  fs.mkdirSync(path.join(root, '.git')); fs.mkdirSync(path.join(root, '.claude'));
  const projectCapability = issueProjectStateCapability(root, root, {role:'project-root'});
  return {root, projectCapability};
}

test('closed operation enum includes every Task 2 side effect', () => {
  for (const kind of ['fork-create','cleanup-remove','registry-own','phase-checkpoint',
    'verification-run','sensor-run','test-retry','debug-complete','report-commit']) {
    assert.equal(OPERATION_KINDS.has(kind), true, kind);
  }
  assert.equal(OPERATION_KINDS.has('generic-patch'), false);
  assert.deepEqual(Object.keys(WORKFLOW_STAGE_RULES).sort(), [...OPERATION_KINDS].sort());
  for (const [kind, stages] of Object.entries(WORKFLOW_STAGE_RULES)) {
    assert.ok(stages.length > 0, kind);
    assert.equal(new Set(stages).size, stages.length, kind);
  }
});

test('same typed preconditions adopt one pending journal and reject foreign stages', async () => {
  const {projectCapability}=setup();
  const first=await beginOperation({projectCapability,sessionId:'s-aaaaaaaa',kind:'registry-touch',
    preconditions:{at:'2026-07-13T00:00:00Z'}});
  const resumed=await beginOperation({projectCapability,sessionId:'s-aaaaaaaa',kind:'registry-touch',
    preconditions:{at:'2026-07-13T00:00:00Z'}});
  assert.equal(resumed.operationId,first.operationId);
  await assert.rejects(()=>recordOperationStage(first,'plan-written'),/operation-stage-kind/);
});

test('journal stages and terminal ledger replay exactly once', async () => {
  const {projectCapability} = setup();
  const begun = await beginOperation({projectCapability, sessionId:'s-aaaaaaaa',
    kind:'registry-touch', preconditions:{at:'2026-07-13T00:00:00Z'}});
  await recordOperationStage(begun, 'registry-written', {owned:{sessionId:'s-aaaaaaaa'}});
  const done = await completeOperation(begun, {status:'completed', touched:'s-aaaaaaaa'});
  assert.match(done.resultSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await resumeOperation({projectCapability, operationId:begun.operationId}), done);
  await assert.rejects(() => beginOperation({projectCapability, sessionId:'s-aaaaaaaa',
    kind:'registry-touch', operationId:begun.operationId, preconditions:{}}), /operation-id-complete/);
});

test('completed ledger fails closed at capacity and preserves the oldest nonreuse tombstone', async () => {
  const {root,projectCapability}=setup();const sessionId='s-aaaaaaaa';
  const rows=Array.from({length:512},(_,index)=>({version:1,
    operationId:`op-${index.toString(16).padStart(64,'0')}`,sessionId,kind:'registry-touch',
    stage:'completed-ledger',result:{index},resultSha256:'a'.repeat(64),completedAt:'2026-07-13T00:00:00Z'}));
  fs.writeFileSync(path.join(root,'.claude',`deep-work.${sessionId}.completed-operations.json`),
    JSON.stringify({version:1,receipts:rows}));
  const next=await beginOperation({projectCapability,sessionId,kind:'registry-touch',
    preconditions:{at:'2026-07-13T00:00:01Z'}});
  await assert.rejects(()=>completeOperation(next,{status:'completed'}),/operation-ledger-full/);
  const oldest=await resumeOperation({projectCapability,operationId:rows[0].operationId});
  assert.equal(oldest.operationId,rows[0].operationId);
  await assert.rejects(()=>beginOperation({projectCapability,sessionId,kind:'registry-touch',
    operationId:rows[0].operationId,preconditions:{}}),/operation-id-complete/);
});
