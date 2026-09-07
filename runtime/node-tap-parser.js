'use strict';
const {resolveNodeTapPolicy,CURRENT_NODE_TAP_POLICY_SHA256}=require('./node-tap-policy.js');
function fail(){const error=new Error('[node-tap-document] Unsupported or inconsistent TAP document');error.code='node-tap-document';throw error;}
function parseNodeTapDocument(bytes,{policy,nodeVersion,root,testPath,expectedOutcome,expectedSignal}={}){
 // Registry data is authority: never accept a caller-created grammar or an ambient patch.
 const known=resolveNodeTapPolicy({policySha256:CURRENT_NODE_TAP_POLICY_SHA256,nodeVersion});
 if(!known.supported||policy?.policyId!==known.policyId||policy.grammar!==known.grammar||
  !['must-fail','must-pass'].includes(expectedOutcome))fail();
 const grammar=known.grammar;
 if(!(typeof bytes==='string'||Buffer.isBuffer(bytes))||Buffer.byteLength(bytes)>grammar.max_document_bytes)fail();
 const text=Buffer.isBuffer(bytes)?new TextDecoder('utf-8',{fatal:true}).decode(bytes):bytes;
 if(text.includes('\r')||text.includes('\t')||text.includes('\0')||!text.startsWith('TAP version 13\n')||!text.endsWith('\n'))fail();
 const b=require('./bootstrap-runtime.js'),p=b.nodeTapPrimitives;
 const lines=text.slice(0,-1).split('\n');let cursor=1,nodes=0;
 const counts={tests:0,suites:0,pass:0,failures:0},leaves=[],events=[];
 function layout(d,wanted){if(JSON.stringify(d.keys)!==JSON.stringify(wanted.keys)||
  Object.entries(wanted.constants).some(([k,v])=>d.fields[k]!==v)||
  Object.entries(wanted.forms).some(([k,v])=>d.forms[k]!==v))fail();}
 function level(indent,depth){
  if(depth>grammar.max_depth)fail();const prefix=' '.repeat(indent),result=[];
  while(lines[cursor]?.startsWith(`${prefix}# Subtest: `)){
   if(++nodes>grammar.max_nodes)fail();const name=lines[cursor++].slice(indent+11);
   if(!name||name.includes(' #'))fail();
   let children=[];
   if(lines[cursor]?.startsWith(`${prefix}    # Subtest: `))children=level(indent+4,depth+1);
   const match=lines[cursor++]?.match(new RegExp(`^ {${indent}}(not ok|ok) ([1-9][0-9]*) - (.+)$`,'u'));
   if(!match||Number(match[2])!==result.length+1||match[3]!==name)fail();
   const passed=match[1]==='ok';
   const diagnostic=p.parseTapDiagnostic(lines,cursor,indent+2,{role:children.length?(passed?'wrapper':'outer'):(passed?'wrapper':'leaf')});cursor=diagnostic.next;
   if(diagnostic.fields.duration_ms<0)fail();
   const node={name,passed,children};
   if(children.length){
    counts.suites++;
    const failing=children.filter(c=>!c.passed).length;
    if(passed!==(failing===0)||diagnostic.fields.type!=='suite')fail();
    if(passed)layout(diagnostic,{keys:['duration_ms','type'],constants:{type:'suite'},forms:{}});
    else {layout(diagnostic,{...grammar.suite_wrapper_layout,constants:{...grammar.suite_wrapper_layout.constants,error:`${failing} subtest${failing===1?'':'s'} failed`}});p.reporterLocation(diagnostic.fields.location,{root,testPath});}
   }else{
    counts.tests++;counts[passed?'pass':'failures']++;
    if(passed)layout(diagnostic,{keys:['duration_ms','type'],constants:{type:'test'},forms:{}});
    else {node.event=p.tapEventFrom({...diagnostic,testName:name,root,testPath,grammar});events.push(node.event);}
    leaves.push(node);
   }
   result.push(node);
  }
  if(!result.length||lines[cursor++]!==`${prefix}1..${result.length}`)fail();
  return result;
 }
 const tree=level(0,0);
 const summary=[`# tests ${counts.tests}`,`# suites ${counts.suites}`,`# pass ${counts.pass}`,`# fail ${counts.failures}`,'# cancelled 0','# skipped 0','# todo 0'];
 for(const line of summary)if(lines[cursor++]!==line)fail();
 if(!/^# duration_ms (?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(lines[cursor++]||'')||cursor!==lines.length)fail();
 const identity=expectedSignal?.test_identity;
 if(!identity||identity.test_file!==testPath)fail();
 const selected=leaves.filter(v=>v.name===identity.test_name);
 if(selected.length!==1)fail();
 if(expectedOutcome==='must-fail'){
  if(events.length!==1||selected[0].passed||!b.normalizedSignalMatchesExpected({
   kind:b.classifyExpectedTapSignal(events[0])?.kind,operator:events[0].operator,
   test_identity:{test_file:events[0].test_file,test_name:events[0].test_name,start_line:events[0].start_line},
   expected_digest:events[0].expected_digest,actual_digest:events[0].actual_digest,message:events[0].message},expectedSignal))fail();
 }else if(events.length||!selected[0].passed)fail();
 return {tree,selectedEvent:events[0]||null,selectedTest:{test_file:testPath,test_name:selected[0].name},counts};
}
module.exports={parseNodeTapDocument};
