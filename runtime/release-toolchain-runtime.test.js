'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const gate=require('./release-gate-runtime.js');
const toolchain=require('./release-toolchain-runtime.js');

test('ReleaseToolIdentityV1 binds the active Node executable physical identity',()=>{
  const identity=toolchain.buildToolIdentity({name:'node',
    targetPath:process.execPath});
  assert.equal(identity.target_path,fs.realpathSync(process.execPath));
  assert.equal(identity.shim_kind,'none');
  assert.equal(identity.shim_path,null);
  assert.deepEqual(toolchain.validateToolIdentity(identity),identity);
  assert.throws(()=>toolchain.validateToolIdentity({...identity,target_size:'0'}),
    /release-tool-identity/);
});

test('ReleaseSourceGraphV1 authenticates exact roots, rows, edges, and digest',()=>{
  const packageBytes=Buffer.from('{"scripts":{"test":"npm run test:all"}}\n');
  const rows=[
    toolchain.commandRootRow('npm-pack-dry-run-json',
      gate.RELEASE_GATE_CATALOG.pack.argv,[{kind:'package-document',
        path:'package.json#document'}]),
    {path:'package.json#document',kind:'package-document',
      sha256:toolchain.sha256(packageBytes),outgoing:[]},
    {path:'package.json#scripts.test',kind:'package-script',
      sha256:toolchain.sha256(Buffer.from('npm run test:all')),outgoing:[]},
  ].sort(toolchain.compareGraphRows);
  const graph=toolchain.buildReleaseSourceGraph({rows,
    platformExecutables:[],testFixtureExecutables:[]});
  assert.deepEqual(graph.roots,
    ['command:npm-pack-dry-run-json','package.json#scripts.test']);
  assert.deepEqual(toolchain.validateReleaseSourceGraph(graph),graph);
  const tampered=structuredClone(graph);tampered.rows[0].outgoing=[];
  assert.throws(()=>toolchain.validateReleaseSourceGraph(tampered),
    /release-source-graph/);
});

test('ReleaseToolchainManifestV1 rejects an unsorted or graph-drifted entry set',()=>{
  const graph=toolchain.buildReleaseSourceGraph({rows:[
    toolchain.commandRootRow('npm-pack-dry-run-json',
      gate.RELEASE_GATE_CATALOG.pack.argv,[]),
    {path:'package.json#scripts.test',kind:'package-script',
      sha256:'1'.repeat(64),outgoing:[]},
  ].sort(toolchain.compareGraphRows),platformExecutables:[],
  testFixtureExecutables:[]});
  const node=toolchain.buildToolIdentity({name:'node',
    targetPath:process.execPath});
  const manifest=toolchain.buildToolchainManifest({platform:process.platform,
    sourceGraphRef:{kind:'release-source-graph',
      path:'.deep-work/s-aaaaaaaa/release/source-graph.json',
      sha256:toolchain.sha256(toolchain.canonical(graph)),
      producer_operation_id:`op-${'2'.repeat(64)}`},
    sourceGraphSha256:graph.source_graph_sha256,entries:[node]});
  assert.deepEqual(toolchain.validateToolchainManifest(manifest),manifest);
  assert.throws(()=>toolchain.validateToolchainManifest({
    ...manifest,source_graph_sha256:'3'.repeat(64)}),/release-toolchain-manifest/);
});
