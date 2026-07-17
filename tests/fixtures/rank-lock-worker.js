'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {issueProjectStateCapability}=require('../../runtime/platform.js');
const {withRankedLocks,RANKS}=require('../../runtime/transaction-runtime.js');
const [root,id]=process.argv.slice(2);
const cap=(name)=>issueProjectStateCapability(root,path.join(root,'.claude',`${name}.lock`),{allowMissingLeaf:true,role:'lock'});
void withRankedLocks([{rank:RANKS.git,capability:cap('git')},{rank:RANKS.state,capability:cap('state')}],async()=>{
  const target=path.join(root,'.claude','rank-results.jsonl');let rows='';try{rows=fs.readFileSync(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  fs.writeFileSync(target,`${rows}${JSON.stringify({id})}\n`);
});
