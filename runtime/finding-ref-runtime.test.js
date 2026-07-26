'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const platform=require('./platform.js');
const frontmatter=require('./frontmatter.js');
const journal=require('./operation-journal.js');
const {publishFindingRef,validateFindingRefV1,loadFindingProjection}=
  require('./finding-ref-runtime.js');

function finding(){
  return{id:'REV-SEMANTIC-001',severity:'major',confidence:0.9,
    review_role:'semantic',channel:'subagent',model:'reviewer',effort:'high',
    artifact:'research.md',location:'L1',violated_contract:'REQ-001',
    evidence:['research.md:1'],failure_scenario:'contract drifts',
    verification:'rerun review',status:'fixed',disposition_reason:'implemented',
    round:1,blind:true};
}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-finding-ref-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.claude'));
  const work=path.join(root,'.deep-work','s-aaaaaaaa');
  fs.mkdirSync(path.join(work,'reviews'),{recursive:true});
  const statePath=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(statePath,frontmatter.updateFrontmatterText('',{
    session_id:'s-aaaaaaaa',work_dir:'.deep-work/s-aaaaaaaa',
    current_phase:'research'}));
  const findingPath=path.join(work,'reviews','research-round1-findings.json');
  fs.writeFileSync(findingPath,JSON.stringify({schema_version:1,point:'research',
    round:1,findings:[finding()]},null,2)+'\n');
  const artifactPath=path.join(work,'research.md');
  fs.writeFileSync(artifactPath,'# Research\n');
  return{root,statePath,findingPath,artifactPath,state:()=>platform
    .issueProjectStateCapability(root,statePath,{role:'session-state'})};
}

test('finding-publish creates exact content-addressed authority and adopts replay',
  async(t)=>{
    const f=fixture(t);
    const first=await publishFindingRef({stateCapability:f.state(),point:'research',
      round:1,findingPath:f.findingPath,artifactPath:f.artifactPath,
      artifactKind:'research-document'});
    assert.equal(first.adopted,false);
    assert.match(first.finding_ref_sha256,/^[0-9a-f]{64}$/);
    const wrapper=JSON.parse(fs.readFileSync(path.join(f.root,
      ...first.finding_ref_path.split('/')),'utf8'));
    assert.equal(validateFindingRefV1(wrapper.finding_ref).finding_ref_sha256,
      first.finding_ref_sha256);
    assert.equal(wrapper.finding_ref.producer_operation_id,first.operation_id);
    assert.equal(wrapper.finding_ref.plan_authority_sha256,null);
    assert.equal(wrapper.finding_ref.spec_sha256,null);
    const receipt=await journal.resumeOperation({projectCapability:platform
      .issueProjectStateCapability(f.root,f.root,{role:'project-root'}),
    operationId:first.operation_id,sessionId:'s-aaaaaaaa',kind:'finding-publish'});
    assert.equal(receipt.stage,'completed-ledger');
    assert.deepEqual(Object.keys(receipt.result).sort(),[
      'artifact_sha256','finding_ref_artifact_sha256','finding_ref_path',
      'finding_ref_sha256','path','plan_authority_sha256','point',
      'post_state_sha256','replan_epoch','round','sha256','spec_approved_hash'
    ].sort());
    const second=await publishFindingRef({stateCapability:f.state(),point:'research',
      round:1,findingPath:f.findingPath,artifactPath:f.artifactPath,
      artifactKind:'research-document'});
    assert.equal(second.adopted,true);
    assert.equal(second.operation_id,first.operation_id);
    const fields=frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
    assert.deepEqual(loadFindingProjection({stateCapability:f.state(),plan:null,fields,
      workDir:path.dirname(f.artifactPath)}),{projection:{status:'complete',points:[{
      point:'research',round:1,open_ids:[],resolved_ids:['REV-SEMANTIC-001'],
      unknown_ids:[]}]},warnings:[]});
  });

test('finding-publish rejects a finding document outside the session review directory',
  async(t)=>{
    const f=fixture(t);
    const outside=path.join(f.root,'outside.json');
    fs.copyFileSync(f.findingPath,outside);
    await assert.rejects(()=>publishFindingRef({stateCapability:f.state(),
      point:'research',round:1,findingPath:outside,artifactPath:f.artifactPath,
      artifactKind:'research-document'}),/finding-ref-document/);
  });

test('FindingRefV1 rejects semantic digest tampering',(t)=>{
  const f=fixture(t);
  return publishFindingRef({stateCapability:f.state(),point:'research',round:1,
    findingPath:f.findingPath,artifactPath:f.artifactPath,
    artifactKind:'research-document'}).then((result)=>{
    const wrapper=JSON.parse(fs.readFileSync(path.join(f.root,
      ...result.finding_ref_path.split('/')),'utf8'));
    assert.throws(()=>validateFindingRefV1({...wrapper.finding_ref,
      artifact_sha256:'f'.repeat(64)}),/finding-ref-schema/);
  });
});

test('governed finding loader converts wrapper tampering to explicit unknown',(t)=>{
  const f=fixture(t);
  return publishFindingRef({stateCapability:f.state(),point:'research',round:1,
    findingPath:f.findingPath,artifactPath:f.artifactPath,
    artifactKind:'research-document'}).then((result)=>{
    fs.appendFileSync(path.join(f.root,...result.finding_ref_path.split('/')),' ');
    const fields=frontmatter.parseFrontmatter(fs.readFileSync(f.statePath,'utf8')).fields;
    assert.deepEqual(loadFindingProjection({stateCapability:f.state(),plan:null,fields,
      workDir:path.dirname(f.artifactPath)}),{projection:{status:'unknown',points:[]},
    warnings:['finding-ref-invalid']});
  });
});
