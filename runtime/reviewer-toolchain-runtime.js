'use strict';
const fs=require('node:fs'),path=require('node:path');
function fail(){throw Object.assign(new Error('[reviewer-native-unavailable]'),{code:'reviewer-native-unavailable'});}
function resolveNativeClaude({home,args}={}){
  if(!path.isAbsolute(home||'')||!Array.isArray(args))fail();
  // Native installer authority is the user's installation, never workspace PATH.
  const root=path.join(fs.realpathSync(home),'.local','share','claude','versions');
  const candidate=path.join(home,'.local','bin','claude');
  let real,stat,fd;try{
    const physicalRoot=fs.realpathSync(root);
    if(physicalRoot!==root)fail();
    real=fs.realpathSync(candidate);stat=fs.lstatSync(real);
    if(path.dirname(real)!==root||!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*$/.test(path.basename(real))||
      !stat.isFile()||stat.isSymbolicLink()||stat.size<4||stat.size>512*1024*1024)fail();
    fs.accessSync(real,fs.constants.X_OK);fd=fs.openSync(real,'r');const magic=Buffer.alloc(4);fs.readSync(fd,magic,0,4,0);
    if(!['7f454c46','cffaedfe','cefaedfe','feedfacf','feedface','cafebabe','bebafeca'].includes(magic.toString('hex')))fail();
  }catch{fail();}finally{if(fd!==undefined)fs.closeSync(fd);}
  return {executable:real,argv:[...args],installation_kind:'claude-native'};
}
module.exports={resolveNativeClaude};
