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
  if(value.shim_kind==='posix-symlink'){
    let shimStat,link,shimTarget;try{shimStat=fs.lstatSync(value.shim_path);
      link=fs.readlinkSync(value.shim_path);shimTarget=fs.realpathSync(value.shim_path);}
    catch{fail('release-tool-identity');}
    if(!shimStat.isSymbolicLink()||shimTarget!==value.target_path||
        sha256(Buffer.from(link))!==value.shim_sha256)
      fail('release-tool-identity');
  }
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
function materializeOwnedBin({parent,entries,platformName=process.platform}={}){
  let physicalParent,parentStat;try{physicalParent=fs.realpathSync(parent);
    parentStat=fs.lstatSync(physicalParent);}catch{fail('release-owned-bin');}
  if(!require('node:path').isAbsolute(parent||'')||!parentStat.isDirectory()||
      parentStat.isSymbolicLink()||!Array.isArray(entries)||entries.length===0)
    fail('release-owned-bin');
  if(!['posix','darwin','linux','freebsd','openbsd','aix','sunos'].includes(
      platformName))fail('release-owned-bin-platform');
  const binPath=fs.mkdtempSync(require('node:path').join(physicalParent,'bin-'));
  const names=new Set(),materialized=[];
  try{
    for(const source of [...entries].sort((a,b)=>byteCompare(a.name,b.name))){
      const identity=validateToolIdentity(source);
      if(names.has(identity.name))fail('release-owned-bin');names.add(identity.name);
      const shimPath=require('node:path').join(binPath,identity.name);
      fs.symlinkSync(identity.target_path,shimPath,'file');
      const link=fs.readlinkSync(shimPath);
      materialized.push(validateToolIdentity({...identity,
        shim_kind:'posix-symlink',shim_path:shimPath,
        shim_sha256:sha256(Buffer.from(link))}));
    }
    validateMaterializedBin(binPath,materialized);
    return{binPath,entries:materialized};
  }catch(error){fs.rmSync(binPath,{recursive:true,force:true});throw error;}
}
function validateMaterializedBin(binPath,entries){
  let stat,names;try{stat=fs.lstatSync(binPath);names=fs.readdirSync(binPath)
    .sort(byteCompare);}catch{fail('release-owned-bin');}
  const expected=entries.map((row)=>row.name).sort(byteCompare);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
      canonical(names)!==canonical(expected))fail('release-owned-bin');
  for(const entry of entries){
    validateToolIdentity(entry);
    if(entry.shim_path!==require('node:path').join(binPath,entry.name))
      fail('release-owned-bin');
  }
  return true;
}
function pathIdentity(target,kind){
  let physical,stat,bytes=null;try{physical=fs.realpathSync(target);
    stat=fs.lstatSync(physical,{bigint:true});if(kind==='file')bytes=fs.readFileSync(physical);}
  catch{fail('release-path-identity');}
  if(kind==='file'&&(!stat.isFile()||stat.isSymbolicLink())||
      kind==='directory'&&(!stat.isDirectory()||stat.isSymbolicLink())||
      !['file','directory'].includes(kind))fail('release-path-identity');
  return{path:physical,kind,dev:decimal(stat.dev),ino:decimal(stat.ino),
    mode:decimal(stat.mode),size:decimal(stat.size),mtime_ns:statNanos(stat),
    sha256:bytes?sha256(bytes):null};
}
function validatePathIdentity(value){
  if(!exactKeys(value,['path','kind','dev','ino','mode','size','mtime_ns',
      'sha256'])||!['file','directory'].includes(value.kind)||
      !require('node:path').isAbsolute(value.path||'')||
      ![value.dev,value.ino,value.mode,value.size,value.mtime_ns].every((row)=>
        /^(?:0|[1-9]\d*)$/.test(row||''))||
      (value.kind==='file'?!DIGEST.test(value.sha256||''):value.sha256!==null)||
      canonical(pathIdentity(value.path,value.kind))!==canonical(value))
    fail('release-path-identity');
  return structuredClone(value);
}
function validateDirectoryAnchor(value){
  if(!exactKeys(value,['path','kind','dev','ino','mode','size','mtime_ns',
      'sha256'])||value.kind!=='directory'||value.sha256!==null)
    fail('release-path-identity');
  const current=pathIdentity(value.path,'directory');
  for(const key of ['path','kind','dev','ino','mode'])
    if(current[key]!==value[key])fail('release-path-identity');
  return structuredClone(value);
}
function environmentDigest(value){return semanticDigest('release-command-env-v1',
  value);}
function buildReleaseEnvironment({platformName=process.platform,homePath,binPath,
  manifestPath,manifest}={}){
  if(!['posix','darwin','linux','freebsd','openbsd','aix','sunos'].includes(
      platformName))fail('release-environment-platform');
  const home=pathIdentity(homePath,'directory'),ownedBin=
    pathIdentity(binPath,'directory'),manifestIdentity=pathIdentity(manifestPath,'file');
  if(manifestIdentity.sha256!==sha256(canonical(manifest)))fail('release-environment');
  const environment={platform:'posix',mode:'closed',values:{LANG:'C',LC_ALL:'C',
    TZ:'UTC',HOME:home.path,PATH:ownedBin.path},identities:{home,owned_bin:ownedBin,
    toolchain_manifest:{path:manifestIdentity.path,sha256:manifestIdentity.sha256,
      source_graph_sha256:manifest.source_graph_sha256}}};
  return{...environment,release_environment_sha256:
    environmentDigest(environment)};
}
function validateReleaseEnvironment(value,manifest,{allowHomeMetadataDrift=false}={}){
  const core={platform:value?.platform,mode:value?.mode,values:value?.values,
    identities:value?.identities};
  if(!exactKeys(value,['platform','mode','values','identities',
      'release_environment_sha256'])||value.platform!=='posix'||
      value.mode!=='closed'||!exactKeys(value.values,
        ['LANG','LC_ALL','TZ','HOME','PATH'])||
      canonical({LANG:value.values.LANG,LC_ALL:value.values.LC_ALL,
        TZ:value.values.TZ})!==canonical({LANG:'C',LC_ALL:'C',TZ:'UTC'})||
      !exactKeys(value.identities,['home','owned_bin','toolchain_manifest'])||
      (allowHomeMetadataDrift?validateDirectoryAnchor(value.identities.home):
        validatePathIdentity(value.identities.home)).path!==value.values.HOME||
      validatePathIdentity(value.identities.owned_bin).path!==value.values.PATH||
      !exactKeys(value.identities.toolchain_manifest,
        ['path','sha256','source_graph_sha256'])||
      value.identities.toolchain_manifest.sha256!==sha256(canonical(manifest))||
      value.identities.toolchain_manifest.source_graph_sha256!==
        manifest.source_graph_sha256||
      environmentDigest(core)!==value.release_environment_sha256)
    fail('release-environment');
  return structuredClone(value);
}
async function runHermetic({manifest,environment,executableName,args,cwd,
  timeoutMs,maxOutputBytes}={}){
  validateToolchainManifest(manifest);validateReleaseEnvironment(environment,manifest);
  validateMaterializedBin(environment.values.PATH,manifest.entries);
  const entry=manifest.entries.find((row)=>row.name===executableName);
  if(!entry||entry.shim_path!==require('node:path').join(environment.values.PATH,
      executableName)||!Array.isArray(args)||args.some((arg)=>typeof arg!=='string'))
    fail('release-command');
  const result=await require('./process-supervisor.js').runSupervisedProcess({
    executable:entry.shim_path,args},{cwd,timeoutMs,maxOutputBytes,
    env:structuredClone(environment.values)});
  validateMaterializedBin(environment.values.PATH,manifest.entries);
  validateReleaseEnvironment(environment,manifest,{allowHomeMetadataDrift:true});
  return result;
}
async function executeCatalogCommand({commandId,cwd,sourceGraphRef,
  sourceGraphSha256,entries,platformName=process.platform,timeoutMs=120000,
  maxOutputBytes=1048576}={}){
  const catalog=require('./release-gate-runtime.js').RELEASE_GATE_CATALOG[commandId];
  let physicalCwd,cwdStat;try{physicalCwd=fs.realpathSync(cwd);
    cwdStat=fs.lstatSync(physicalCwd);}catch{fail('release-command');}
  if(!catalog||!cwdStat.isDirectory()||cwdStat.isSymbolicLink()||
      !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000||
      !Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<1024||
      maxOutputBytes>1048576)fail('release-command');
  const executableName=catalog.argv[0],args=catalog.argv.slice(1);
  if(!Array.isArray(entries)||!entries.some((row)=>row.name===executableName))
    fail('release-command-tool');
  const parent=fs.mkdtempSync(require('node:path').join(
    require('node:os').tmpdir(),'deep-work-release-'));
  let materialized,home,manifestPath,manifest,environment;
  try{
    materialized=materializeOwnedBin({parent,entries,platformName});
    home=fs.mkdtempSync(require('node:path').join(parent,'home-'));
    manifest=buildToolchainManifest({platform:platformName,sourceGraphRef,
      sourceGraphSha256,entries:materialized.entries});
    manifestPath=require('node:path').join(parent,'toolchain.json');
    fs.writeFileSync(manifestPath,canonical(manifest),{flag:'wx',mode:0o600});
    environment=buildReleaseEnvironment({platformName,homePath:home,
      binPath:materialized.binPath,manifestPath,manifest});
    const result=await runHermetic({manifest,environment,executableName,args,
      cwd:physicalCwd,timeoutMs,maxOutputBytes});
    return{command_id:commandId,argv:[...catalog.argv],
      release_environment_sha256:environment.release_environment_sha256,
      process_result:{exit_code:result.exitCode,signal:result.signal,
        timed_out:result.timedOut,output_overflow:result.outputOverflow,
        stdout_sha256:sha256(Buffer.from(result.stdout)),
        stderr_sha256:sha256(Buffer.from(result.stderr))},
      stdout:result.stdout,stderr:result.stderr};
  }finally{
    if(materialized)validateMaterializedBin(materialized.binPath,
      manifest?.entries||materialized.entries);
    if(environment&&manifest)validateReleaseEnvironment(environment,manifest,
      {allowHomeMetadataDrift:true});
    fs.rmSync(parent,{recursive:true,force:true});
    if(fs.existsSync(parent))fail('release-command-cleanup');
  }
}

module.exports={canonical,sha256,buildToolIdentity,validateToolIdentity,
  commandRootRow,compareGraphRows,buildReleaseSourceGraph,
  validateReleaseSourceGraph,buildToolchainManifest,validateToolchainManifest,
  materializeOwnedBin,validateMaterializedBin,pathIdentity,
  validatePathIdentity,buildReleaseEnvironment,validateReleaseEnvironment,
  runHermetic,executeCatalogCommand};
