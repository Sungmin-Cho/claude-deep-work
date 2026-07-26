'use strict';

const fs=require('node:fs');
const path=require('node:path');
const childProcess=require('node:child_process');
const toolchain=require('./release-toolchain-runtime.js');

function fail(code,message=code){const error=new Error(`[${code}] ${message}`);
  error.code=code;throw error;}
function byteCompare(left,right){return Buffer.compare(Buffer.from(left),
  Buffer.from(right));}
function portable(value){return typeof value==='string'&&value.length>0&&
  !value.startsWith('/')&&!value.includes('\\')&&
  !value.split('/').includes('..');}
function shellWords(source){
  if(typeof source!=='string'||!source.trim())fail('release-shell-parse');
  const words=[];let word='',quote=null,escaped=false,active=false;
  for(let index=0;index<source.length;index++){
    const char=source[index];
    if(escaped){word+=char;escaped=false;active=true;continue;}
    if(char==='\\'&&quote!=="'"){escaped=true;active=true;continue;}
    if(quote){
      if(char===quote){quote=null;active=true;}else word+=char;
      continue;
    }
    if(char==="'"||char==='"'){quote=char;active=true;continue;}
    if(/\s/.test(char)){if(active){words.push(word);word='';active=false;}
      continue;}
    if(/[;&|<>`$(){}]/.test(char))fail('release-shell-parse');
    word+=char;active=true;
  }
  if(escaped||quote)fail('release-shell-parse');
  if(active)words.push(word);
  if(words.length===0)fail('release-shell-parse');
  return words;
}
function globRegex(pattern){
  if(!portable(pattern)||!pattern.endsWith('.test.js'))
    fail('release-source-glob');
  let value='^';
  for(let index=0;index<pattern.length;index++){
    const char=pattern[index];
    if(char==='*'&&pattern[index+1]==='*'&&pattern[index+2]==='/'){
      value+='(?:.*/)?';index+=2;
    }else if(char==='*')value+='[^/]*';
    else value+=char.replace(/[.+?^${}()|[\]\\]/g,'\\$&');
  }
  return new RegExp(`${value}$`);
}
function expandTargets(words,files){
  const targets=[];
  for(const word of words){
    const matches=word.includes('*')?[...files.keys()].filter((candidate)=>
      globRegex(word).test(candidate)):[word];
    if(matches.length===0)fail('release-source-glob');
    for(const match of matches.sort(byteCompare)){
      if(!portable(match)||!files.has(match)||!match.endsWith('.test.js'))
        fail('release-source-target');
      targets.push(match);
    }
  }
  const sorted=[...new Set(targets)].sort(byteCompare);
  if(sorted.length!==targets.length)fail('release-source-target');
  return sorted;
}
function fileMap(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    fail('release-source-files');
  const result=new Map();
  for(const [name,value] of Object.entries(input).sort((a,b)=>
    byteCompare(a[0],b[0]))){
    if(!portable(name)||result.has(name)||
        !(Buffer.isBuffer(value)||typeof value==='string'))
      fail('release-source-files');
    result.set(name,Buffer.isBuffer(value)?Buffer.from(value):
      Buffer.from(value));
  }
  return result;
}
function packageDocument(files){
  const bytes=files.get('package.json');if(!bytes)fail('release-package');
  let value;try{value=JSON.parse(bytes);}catch{fail('release-package');}
  if(!value||typeof value!=='object'||Array.isArray(value)||
      !value.scripts||typeof value.scripts!=='object'||
      Array.isArray(value.scripts))fail('release-package');
  return{bytes,value};
}
function scanPackageScripts(files,document){
  const scripts=document.value.scripts,visiting=new Set(),rows=new Map(),
    nodeTargets=new Set();
  function visit(name){
    if(visiting.has(name))fail('release-source-cycle');
    if(rows.has(name))return;
    const script=scripts[name];
    if(typeof script!=='string'||!script)fail('release-package-script');
    visiting.add(name);const words=shellWords(script),outgoing=[];
    if(words[0]==='npm'&&words[1]==='run'&&words.length===3){
      const target=words[2];visit(target);outgoing.push({
        kind:'package-script',path:`package.json#scripts.${target}`});
    }else if(words[0]==='node'&&words[1]==='--test'){
      const targetWords=words.slice(2).filter((word)=>
        !word.startsWith('--test-concurrency='));
      if(targetWords.length===0||words.slice(2).some((word)=>
        word.startsWith('-')&&!word.startsWith('--test-concurrency=')))
        fail('release-package-script');
      for(const target of expandTargets(targetWords,files)){
        nodeTargets.add(target);outgoing.push({kind:'node-entry',path:target});
      }
      outgoing.sort((a,b)=>byteCompare(a.path,b.path));
    }else fail('release-package-script');
    rows.set(name,{path:`package.json#scripts.${name}`,
      kind:'package-script',sha256:toolchain.sha256(Buffer.from(script)),
      outgoing});visiting.delete(name);
  }
  visit('test');
  return{rows,nodeTargets};
}
function jsTokens(source){
  const tokens=[];let index=0;
  while(index<source.length){
    const char=source[index],next=source[index+1];
    if(/\s/.test(char)){index++;continue;}
    if(char==='/'&&next==='/'){index+=2;while(index<source.length&&
        source[index]!=='\n')index++;continue;}
    if(char==='/'&&next==='*'){index+=2;while(index<source.length&&
        !(source[index]==='*'&&source[index+1]==='/'))index++;
      if(index>=source.length)fail('release-source-js',String(index));index+=2;continue;}
    if(char==='/'&&(()=>{
      const prior=tokens.at(-1);
      return !prior||prior.type==='punct'&&
        ['(','[','{','=',':',',',';','!','?','&','|','+','-','*','%',
          '^','~','>'].includes(prior.value)||
        prior.type==='identifier'&&['return','case','throw','yield']
          .includes(prior.value);
    })()){
      const start=index++;let escaped=false,inClass=false,closed=false;
      for(;index<source.length;index++){
        const current=source[index];
        if(escaped){escaped=false;continue;}
        if(current==='\\'){escaped=true;continue;}
        if(current==='['){inClass=true;continue;}
        if(current===']'){inClass=false;continue;}
        if(current==='/'&&!inClass){index++;closed=true;break;}
        if(current==='\n'||current==='\r')break;
      }
      if(!closed)fail('release-source-js',String(index));
      while(index<source.length&&/[A-Za-z]/.test(source[index]))index++;
      tokens.push({type:'regex',value:null,start});continue;
    }
    if(char==="'"||char==='"'){
      const quote=char,start=index++;let value='',escaped=false;
      for(;index<source.length;index++){
        const current=source[index];
        if(escaped){value+=current;escaped=false;continue;}
        if(current==='\\'){escaped=true;continue;}
        if(current===quote){index++;break;}
        if(current==='\n'||current==='\r')fail('release-source-js',String(index));
        value+=current;
      }
      if(source[index-1]!==quote)fail('release-source-js',String(index));
      tokens.push({type:'string',value,start});continue;
    }
    if(char==='`'){
      const start=index++;let escaped=false;
      for(;index<source.length;index++){
        const current=source[index];
        if(escaped){escaped=false;continue;}
        if(current==='\\'){escaped=true;continue;}
        if(current==='`'){index++;break;}
      }
      if(source[index-1]!=='`')fail('release-source-js',String(index));
      tokens.push({type:'template',value:null,start});continue;
    }
    if(/[A-Za-z_$]/.test(char)){
      const start=index++;while(index<source.length&&
        /[A-Za-z0-9_$]/.test(source[index]))index++;
      tokens.push({type:'identifier',value:source.slice(start,index),start});
      continue;
    }
    tokens.push({type:'punct',value:char,start:index});index++;
  }
  return tokens;
}
function scanLaunchSites(path,bytes,{platformName=process.platform}={}){
  const source=bytes.toString('utf8');
  if(!Buffer.from(source).equals(bytes))fail('release-source-utf8');
  const required=new Set(),platform=[];let activeNode=false;
  let tokens;try{tokens=jsTokens(source);}catch(error){
    if(error.code==='release-source-js')
      fail('release-source-js',`${path}:${error.message}`);throw error;}
  const kinds=new Set(['spawn','spawnSync','execFile','execFileSync','fork']);
  for(let index=0;index<tokens.length-2;index++){
    const call=tokens[index],open=tokens[index+1],first=tokens[index+2];
    if(call.type!=='identifier'||!kinds.has(call.value)||
        open.type!=='punct'||open.value!=='(')continue;
    if(call.value==='fork'){activeNode=true;continue;}
    if(first.type==='identifier'&&first.value==='process'&&
        tokens[index+3]?.value==='.'&&tokens[index+4]?.value==='execPath'){
      activeNode=true;continue;
    }
    if(first.type==='identifier'&&first.value==='executable'&&
        path==='runtime/platform.test.js'&&
        /const executable = path\.win32\.join\(systemRoot,\s*'System32',\s*'WindowsPowerShell',\s*'v1\.0',\s*'powershell\.exe'\);/m
          .test(source)&&platformName!=='win32')continue;
    if(first.type!=='string'||!/^[A-Za-z0-9._/-]+$/.test(first.value))
      fail('release-launch-dynamic',`${path}:${first.value||first.type}`);
    required.add(first.value);
  }
  if(activeNode)platform.push(toolchain.buildActiveNodeExecutable({
    sourcePath:path,sourceSha256:toolchain.sha256(bytes)}));
  return{required_tools:[...required].sort(byteCompare),
    platform_executables:platform};
}
function scanReleaseSources({committedFiles}={}){
  const files=fileMap(committedFiles),document=packageDocument(files),
    scanned=scanPackageScripts(files,document),rows=[
      toolchain.commandRootRow('npm-pack-dry-run-json',
        require('./release-gate-runtime.js').RELEASE_GATE_CATALOG.pack.argv,
      [{kind:'package-document',path:'package.json#document'}]),
      {path:'package.json#document',kind:'package-document',
        sha256:toolchain.sha256(document.bytes),outgoing:[]},
      ...scanned.rows.values(),
    ],required=new Set(['node','npm']),platform=[];
  for(const target of [...scanned.nodeTargets].sort(byteCompare)){
    const bytes=files.get(target),launch=scanLaunchSites(target,bytes);
    rows.push({path:target,kind:'node-entry',
      sha256:toolchain.sha256(bytes),outgoing:[]});
    for(const name of launch.required_tools)required.add(name);
    platform.push(...launch.platform_executables);
  }
  platform.sort((a,b)=>byteCompare(toolchain.canonical(a),
    toolchain.canonical(b)));
  return{graph:toolchain.buildReleaseSourceGraph({rows:rows.sort(
    toolchain.compareGraphRows),platformExecutables:platform,
  testFixtureExecutables:[]}),required_tools:[...required].sort(byteCompare)};
}
function gitRead(gitIdentity,args,{cwd,maxBuffer=32*1024*1024}={}){
  const identity=toolchain.validateToolIdentity(gitIdentity);
  if(identity.name!=='git'||identity.shim_kind!=='none')
    fail('release-source-git');
  const result=childProcess.spawnSync(identity.target_path,args,{cwd,
    env:{LANG:'C',LC_ALL:'C',TZ:'UTC'},encoding:null,shell:false,
    windowsHide:true,maxBuffer});
  toolchain.validateToolIdentity(identity);
  if(result.error||result.status!==0||result.signal!==null)
    fail('release-source-git');
  return Buffer.from(result.stdout);
}
function loadCommittedFiles({root,gitIdentity,
  requireWorktreeMatch=true}={}){
  let physical,stat;try{physical=fs.realpathSync(root);
    stat=fs.lstatSync(physical);}catch{fail('release-source-root');}
  if(!stat.isDirectory()||stat.isSymbolicLink()||
      typeof requireWorktreeMatch!=='boolean')fail('release-source-root');
  const listed=gitRead(gitIdentity,['-C',physical,'ls-files','-z'],{
    cwd:physical}),names=listed.subarray(0,listed.length-
      (listed.at(-1)===0?1:0)).toString('utf8').split('\0');
  if(names.length===0||names.some((name)=>!portable(name))||
      canonicalNames(names)!==canonicalNames([...names].sort(byteCompare)))
    fail('release-source-index');
  const files={};
  for(const name of names){
    const bytes=gitRead(gitIdentity,['-C',physical,'show',`HEAD:${name}`],
      {cwd:physical}),candidate=path.join(physical,...name.split('/'));
    if(requireWorktreeMatch){
      let current,currentStat;try{currentStat=fs.lstatSync(candidate);
        current=fs.readFileSync(candidate);}catch{fail('release-source-drift');}
      if(!currentStat.isFile()||currentStat.isSymbolicLink()||
          !current.equals(bytes))fail('release-source-drift');
    }
    files[name]=bytes;
  }
  return files;
}
function canonicalNames(values){return JSON.stringify(values);}

module.exports={shellWords,globRegex,jsTokens,scanLaunchSites,scanReleaseSources,
  loadCommittedFiles};
