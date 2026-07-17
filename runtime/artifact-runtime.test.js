'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const artifact=require('./artifact-runtime.js');const platform=require('./platform.js');
const { deriveArtifactName, validateArtifactRequest } = artifact;

test('artifact outputs are closed and route-derived', () => {
  assert.equal(deriveArtifactName({kind:'research-area',area:'architecture'}),
    'research-architecture.md');
  assert.equal(deriveArtifactName({kind:'plan-backup',iteration:3}), 'plan-v3.md');
  assert.equal(deriveArtifactName({kind:'test-results'}), 'test-results.md');
  assert.throws(() => validateArtifactRequest({kind:'other',output:'x'}), /artifact-kind/);
  assert.throws(() => validateArtifactRequest({kind:'plan',output:'elsewhere'}), /artifact-output/);
});

test('prepared owned-temp recovery adopts its exact consumer without returning source bytes',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-artifact-consume-'));fs.mkdirSync(path.join(root,'.git'));
  fs.mkdirSync(path.join(root,'.claude'));const work=path.join(root,'.deep-work','s-aaaaaaaa');fs.mkdirSync(work,{recursive:true});
  const statePath=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');fs.writeFileSync(statePath,
    '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\n---\n');const state=
    platform.issueProjectStateCapability(root,statePath,{role:'session-state'});const sessionCapability=platform.issueProjectStateCapability(root,
      work,{role:'session-work-dir',sessionStateCapability:state});const created=await artifact.createOwnedTemp({sessionCapability,purpose:'receipt-payload'});
  await artifact.writeOwnedTemp({sessionCapability,operationId:created.operationId,purpose:'receipt-payload'},Buffer.from('{"ok":true}\n'));
  const prepared=await artifact.prepareOwnedTempForOperation({sessionCapability,sourceOperationId:created.operationId,purpose:'receipt-payload'});
  const consumerOperationId=`op-${'a'.repeat(64)}`;const first=await artifact.consumeOwnedTempForOperation({sessionCapability,
    sourceOperationId:created.operationId,purpose:'receipt-payload',consumerOperationId,expectedDigest:prepared.sha256,adoptWithoutRead:true});
  assert.equal(first.adopted,false);assert.equal(first.bytes,null);const second=await artifact.consumeOwnedTempForOperation({sessionCapability,
    sourceOperationId:created.operationId,purpose:'receipt-payload',consumerOperationId,expectedDigest:prepared.sha256,adoptWithoutRead:true});
  assert.equal(second.adopted,true);assert.equal(second.bytes,null);
});
