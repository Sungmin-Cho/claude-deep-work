'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');
const journal=require('./operation-journal.js');

const DIGEST=/^[0-9a-f]{64}$/;
const OPERATION=/^op-[0-9a-f]{64}$/;
function fail(code,message=code){const error=new Error(`[${code}] ${message}`);
  error.code=code;throw error;}
function canonical(value){return journal.canonicalJson(value);}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function semanticDigest(domain,value,omitted){
  const copy=structuredClone(value);if(omitted)delete copy[omitted];
  return sha256(Buffer.concat([Buffer.from(`${domain}\0`),
    Buffer.from(canonical(copy))]));
}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  canonical(Object.keys(value).sort())===canonical([...keys].sort());}
function decimal(value){return String(typeof value==='bigint'?value:BigInt(value));}
function statNanos(stat){return decimal(stat.mtimeNs===undefined?
  BigInt(Math.trunc(stat.mtimeMs*1e6)):stat.mtimeNs);}
function byteCompare(left,right){return Buffer.compare(Buffer.from(left),Buffer.from(right));}
function portable(value){return typeof value==='string'&&value.length>0&&
  !value.startsWith('/')&&!value.includes('\\')&&!value.split('/').includes('..');}

function buildToolIdentity({name,targetPath,shimKind='none',shimPath=null,
  shimSha256=null}={}){
  if(typeof name!=='string'||!/^[A-Za-z0-9._-]+$/.test(name)||
      !require('node:path').isAbsolute(targetPath||''))fail('release-tool-identity');
  let physical,stat,bytes;try{physical=fs.realpathSync(targetPath);
    stat=fs.lstatSync(physical,{bigint:true});bytes=fs.readFileSync(physical);}
  catch{fail('release-tool-identity');}
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o111n)===0n)
    fail('release-tool-identity');
  return validateToolIdentity({name,target_path:physical,target_sha256:sha256(bytes),
    target_dev:decimal(stat.dev),target_ino:decimal(stat.ino),
    target_mode:decimal(stat.mode),target_size:decimal(stat.size),
    target_mtime_ns:statNanos(stat),shim_kind:shimKind,shim_path:shimPath,
    shim_sha256:shimSha256});
}
function validateToolIdentity(value){
  const keys=['name','target_path','target_sha256','target_dev','target_ino',
    'target_mode','target_size','target_mtime_ns','shim_kind','shim_path',
    'shim_sha256'];
  if(!exactKeys(value,keys)||!/^[A-Za-z0-9._-]+$/.test(value.name||'')||
      !require('node:path').isAbsolute(value.target_path||'')||
      !DIGEST.test(value.target_sha256||'')||
      ![value.target_dev,value.target_ino,value.target_mode,value.target_size,
        value.target_mtime_ns].every((row)=>/^(?:0|[1-9]\d*)$/.test(row||''))||
      !['none','posix-symlink','windows-cmd'].includes(value.shim_kind)||
      (value.shim_kind==='none'?
        value.shim_path!==null||value.shim_sha256!==null:
        !require('node:path').isAbsolute(value.shim_path||'')||
          !DIGEST.test(value.shim_sha256||'')))
    fail('release-tool-identity');
  let physical,stat,bytes;try{physical=fs.realpathSync(value.target_path);
    stat=fs.lstatSync(physical,{bigint:true});bytes=fs.readFileSync(physical);}
  catch{fail('release-tool-identity');}
  if(physical!==value.target_path||!stat.isFile()||stat.isSymbolicLink()||
      (stat.mode&0o111n)===0n||sha256(bytes)!==value.target_sha256||
      decimal(stat.dev)!==value.target_dev||decimal(stat.ino)!==value.target_ino||
      decimal(stat.mode)!==value.target_mode||decimal(stat.size)!==value.target_size||
      statNanos(stat)!==value.target_mtime_ns)fail('release-tool-identity');
  return structuredClone(value);
}
function graphIdentity(row){return{kind:row.kind,path:row.path};}
function compareGraphIdentity(left,right){return byteCompare(left.kind,right.kind)||
  byteCompare(left.path,right.path);}
function compareGraphRows(left,right){return compareGraphIdentity(left,right);}
function commandRootRow(id,argv,outgoing=[]){
  if(id!=='npm-pack-dry-run-json'||canonical(argv)!==
      canonical(require('./release-gate-runtime.js').RELEASE_GATE_CATALOG.pack.argv))
    fail('release-source-graph');
  return{path:`command:${id}`,kind:'command-root',
    sha256:semanticDigest('release-command-root-v1',argv),
    outgoing:structuredClone(outgoing).sort(compareGraphIdentity)};
}
function graphDigest(value){return semanticDigest('release-source-graph-v1',value,
  'source_graph_sha256');}
function validateExecutableRows(rows,code){
  if(!Array.isArray(rows)||canonical(rows)!==canonical([...rows].sort((a,b)=>
      byteCompare(canonical(a),canonical(b)))))fail(code);
  return rows;
}
function validateReleaseSourceGraph(value){
  const rowKeys=['path','kind','sha256','outgoing'];
  if(!exactKeys(value,['schema_version','roots','rows','platform_executables',
      'test_fixture_executables','source_graph_sha256'])||
      value.schema_version!==1||canonical(value.roots)!==canonical(
        ['command:npm-pack-dry-run-json','package.json#scripts.test'])||
      !Array.isArray(value.rows)||value.rows.length<2||
      canonical(value.rows)!==canonical([...value.rows].sort(compareGraphRows))||
      new Set(value.rows.map((row)=>`${row.kind}\0${row.path}`)).size!==
        value.rows.length||!DIGEST.test(value.source_graph_sha256||''))
    fail('release-source-graph');
  const identities=new Set(value.rows.map((row)=>`${row.kind}\0${row.path}`));
  for(const row of value.rows){
    if(!exactKeys(row,rowKeys)||
        !['command-root','package-document','package-script','node-entry',
          'shell-entry'].includes(row.kind)||
        !(row.kind==='command-root'?/^command:[a-z0-9-]+$/.test(row.path):
          portable(row.path))||!DIGEST.test(row.sha256||'')||
        !Array.isArray(row.outgoing)||
        canonical(row.outgoing)!==canonical([...row.outgoing]
          .sort(compareGraphIdentity))||
        new Set(row.outgoing.map((edge)=>`${edge.kind}\0${edge.path}`)).size!==
          row.outgoing.length||
        row.outgoing.some((edge)=>!exactKeys(edge,['kind','path'])||
          !identities.has(`${edge.kind}\0${edge.path}`)))
      fail('release-source-graph');
    if(row.path==='command:npm-pack-dry-run-json'&&row.sha256!==
        commandRootRow('npm-pack-dry-run-json',
          require('./release-gate-runtime.js').RELEASE_GATE_CATALOG.pack.argv).sha256)
      fail('release-source-graph');
  }
  if(!value.rows.some((row)=>row.path==='command:npm-pack-dry-run-json')||
      !value.rows.some((row)=>row.path==='package.json#scripts.test')||
      graphDigest(value)!==value.source_graph_sha256)
    fail('release-source-graph');
  validateExecutableRows(value.platform_executables,'release-source-graph');
  validateExecutableRows(value.test_fixture_executables,'release-source-graph');
  return structuredClone(value);
}
function buildReleaseSourceGraph({rows,platformExecutables=[],
  testFixtureExecutables=[]}={}){
  const graph={schema_version:1,
    roots:['command:npm-pack-dry-run-json','package.json#scripts.test'],
    rows:structuredClone(rows),platform_executables:
      structuredClone(platformExecutables),test_fixture_executables:
      structuredClone(testFixtureExecutables),source_graph_sha256:null};
  graph.source_graph_sha256=graphDigest(graph);
  return validateReleaseSourceGraph(graph);
}
function validateSourceGraphRef(value){
  return exactKeys(value,['kind','path','sha256','producer_operation_id'])&&
    value.kind==='release-source-graph'&&portable(value.path)&&
    DIGEST.test(value.sha256||'')&&OPERATION.test(value.producer_operation_id||'');
}
function manifestDigest(value){return semanticDigest('release-toolchain-manifest-v1',
  value,'manifest_sha256');}
function validateToolchainManifest(value){
  if(!exactKeys(value,['schema_version','platform','source_graph_ref',
      'source_graph_sha256','entries','manifest_sha256'])||
      value.schema_version!==1||typeof value.platform!=='string'||!value.platform||
      !validateSourceGraphRef(value.source_graph_ref)||
      !DIGEST.test(value.source_graph_sha256||'')||
      !Array.isArray(value.entries)||value.entries.length===0||
      canonical(value.entries)!==canonical([...value.entries].sort((a,b)=>
        byteCompare(a.name,b.name)))||
      new Set(value.entries.map((row)=>row.name)).size!==value.entries.length||
      !DIGEST.test(value.manifest_sha256||'')||
      manifestDigest(value)!==value.manifest_sha256)
    fail('release-toolchain-manifest');
  for(const entry of value.entries)validateToolIdentity(entry);
  return structuredClone(value);
}
function buildToolchainManifest({platform,sourceGraphRef,sourceGraphSha256,
  entries}={}){
  const value={schema_version:1,platform,
    source_graph_ref:structuredClone(sourceGraphRef),
    source_graph_sha256:sourceGraphSha256,
    entries:structuredClone(entries).sort((a,b)=>byteCompare(a.name,b.name)),
    manifest_sha256:null};
  value.manifest_sha256=manifestDigest(value);
  return validateToolchainManifest(value);
}

module.exports={canonical,sha256,buildToolIdentity,validateToolIdentity,
  commandRootRow,compareGraphRows,buildReleaseSourceGraph,
  validateReleaseSourceGraph,buildToolchainManifest,validateToolchainManifest};
