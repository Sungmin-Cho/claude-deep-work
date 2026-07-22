'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const runtime=require('./evidence-runtime.js');
const {canonicalJson}=require('./operation-journal.js');
const {parseSpecMarkdown}=require('./contract-runtime.js');
const {compilePlanProjectionV1}=require('./plan-runtime.js');
const {compileVerificationPlan}=require('./verification-policy-runtime.js');
const {compileReviewPlan}=require('./review-policy-runtime.js');
const {updateFrontmatterText,parseFrontmatter}=require('./frontmatter.js');
const platform=require('./platform.js');

const sentinel='dw-redaction-secret-6.13';
const bearer='ghp_abcdefghijklmnopqrstuvwxyz123456';
const pem='-----BEGIN PRIVATE KEY-----\nraw-private-key-bytes\n-----END PRIVATE KEY-----';
const commandSpec={schema_version:1,executable:{kind:'node',value:'node'},args:['verify.js',sentinel,`token=${bearer}`],
  cwd_role:'active-worktree',timeout_ms:5000,max_output_bytes:4096,red_failure_literal:'expected-red'};
const fixtureRoot=path.resolve(__dirname,'../tests/fixtures/v6.13-spec/medium-valid');
const digest=(value)=>crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');

function authority(){const specContract=parseSpecMarkdown(fs.readFileSync(path.join(fixtureRoot,'spec.md'),'utf8'));
  const planProjection=compilePlanProjectionV1({planMarkdown:fs.readFileSync(path.join(fixtureRoot,'plan.md'),'utf8'),specContract,
    sliceRiskState:{'SLICE-001':{class:'medium',score:6,triggers:['strict-admission']}}});
  const verificationPlan=compileVerificationPlan({riskProfile:{class:'medium',score:6,triggers:['strict-admission']},
    riskProfileSha256:'b'.repeat(64),policySnapshot:{risk_class:'medium',profile:'standard',
      verification_policy:{recommended:'표준 검증'}},specContract,specSha256:planProjection.contract_binding.spec_contract.spec_sha256,
    specApprovedHash:'a'.repeat(64),planProjection,capabilities:{},
    compatibilityFacts:{created_by_version:'6.13.0',spec_policy_required:true}});
  return{specContract,planProjection,verificationPlan};}
function tempRoot(){return fs.mkdtempSync(path.join(os.tmpdir(),'dw-evidence-v613-'));}
async function realRequiredRecords(root,exactSecret=sentinel){const {specContract,planProjection,verificationPlan}=authority(),records=[];
  const reviewPlan=compileReviewPlan({artifactKind:'session-final',phase:'test',riskClass:'medium',runtime:'claude',
    availableChannels:{subagent:true,codex_cli:true,gemini_cli:true,deep_review:true},tddMode:'strict'});
  const reports=reviewPlan.reviewers.map((row,index)=>({role:row.role,channel:row.channel,required:row.required,status:'completed',
    report_ref:`reports/${row.role}.json`,sha256:String(index+1).repeat(64).slice(0,64)}));
  for(const [index,gateId] of verificationPlan.evidence_required_gate_ids.entries()){const gate=verificationPlan.gates.find((row)=>row.id===gateId);
    let record;if(gate.adapter==='command')record=await runtime.captureCommandEvidence({evidence_id:`EVID-${String(index+1).padStart(4,'0')}`,
      gate_id:gateId,verification_spec:{...commandSpec,args:['verify.js',exactSecret,`token=${bearer}`]},expected_outcome:'must-pass',requirement_ids:gate.requirement_ids,
      invariant_ids:['INV-001'],failure_mode_ids:gate.failure_mode_ids,negative_test_ids:['NEG-001'],
      redaction_policy:{exact_secret_values:[exactSecret]}},{runner:async()=>({exitCode:0,stdout:`ok ${exactSecret}`,stderr:'',durationMs:1})});
    else if(gate.adapter==='contract')record=runtime.captureContractEvidence({evidence_id:`EVID-${String(index+1).padStart(4,'0')}`,
      gate_id:gateId,verificationPlan,specContract});
    else if(gate.adapter==='receipt')record=runtime.captureReceiptEvidence({evidence_id:`EVID-${String(index+1).padStart(4,'0')}`,
      gate_id:gateId,verificationPlan,plan:planProjection,receipts:[{slice_id:'SLICE-001',status:'complete'}],
      verificationResult:{pass:true,errors:[]}});
    else if(gate.adapter==='review')record=runtime.captureReviewEvidence({evidence_id:`EVID-${String(index+1).padStart(4,'0')}`,
      gate_id:gateId,verificationPlan,reviewPlan,reports});
    else if(['sensor','health'].includes(gate.adapter)){const result={status:'pass',adapter:gate.adapter};record=
      runtime.captureRuntimeProjectionEvidence({evidence_id:`EVID-${String(index+1).padStart(4,'0')}`,gate_id:gateId,
        verificationPlan,kind:gate.adapter,operation:{operationId:`op-${String(index+1).repeat(32).slice(0,32)}`},
        result,result_sha256:digest(result)});}
    else throw new Error(`unhandled required adapter ${gate.adapter}`);
    records.push(runtime.materializeRecordUnderLock({artifactRoot:root,record}));}
  return{...authority(),records};}

function wrapperFixture(){const root=tempRoot();fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));
  const work=path.join(root,'.deep-work','s-aaaaaaaa');fs.mkdirSync(work,{recursive:true});return{root,work,
    state:path.join(root,'.claude','deep-work.s-aaaaaaaa.md'),payload:path.join(work,'payload.json'),output:path.join(work,'receipt.json')};}
function runEvidenceWrapper(fixture){return spawnSync(process.execPath,[path.resolve(__dirname,'../hooks/scripts/wrap-receipt-envelope.js'),
  '--artifact-kind','session-receipt','--payload-file',fixture.payload,'--output',fixture.output,
  '--evidence-state-file',fixture.state],{cwd:fixture.root,encoding:'utf8'});}

test('raw stdout and stderr never leave captureCommandEvidence',async()=>{const record=await runtime.captureCommandEvidence({
  evidence_id:'EVID-COMMAND-0001',gate_id:'GATE-negative-tests',verification_spec:commandSpec,expected_outcome:'must-pass',
  requirement_ids:['REQ-001'],invariant_ids:['INV-001'],failure_mode_ids:[],negative_test_ids:['NEG-001'],
  redaction_policy:{exact_secret_values:[sentinel]}},{runner:async()=>({exitCode:0,stdout:`secret=${sentinel} Authorization: Bearer ${bearer}`,
    stderr:`${pem}\n{"api_key":"${sentinel}"}`,durationMs:3})});const serialized=JSON.stringify(record);
  for(const raw of [sentinel,bearer,'raw-private-key-bytes'])assert.doesNotMatch(serialized,new RegExp(raw));
  assert.equal(record.redaction.passed,true);assert.equal(record.status,'pass');assert.match(serialized,/<REDACTED:/);});

test('redaction is deterministic and idempotent across broad token families',()=>{const raw=
  `${sentinel}\nAuthorization: Basic abc123\n${pem}\ntoken=${bearer}\nxoxb-12345678901234567890`;
  const once=runtime.redactEvidenceText(raw,{exact_secret_values:[sentinel],home:'/Users/example'}),
    twice=runtime.redactEvidenceText(once.text,{exact_secret_values:[sentinel],home:'/Users/example'});
  assert.equal(twice.text,once.text);assert.equal(runtime.secretHits(once.text).length,0);assert.ok(once.match_count>=5);});

test('actual per-kind producers satisfy the complete Medium evidence catalog',async()=>{const root=tempRoot(),built=await realRequiredRecords(root);
  assert.deepEqual([...new Set(built.records.map((row)=>row.kind))].sort(),['command','contract','health','receipt','review','sensor']);
  const pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},verificationPlan:built.verificationPlan,
    records:built.records,artifactRoot:root});const result=runtime.validateEvidencePackage(pkg,built.verificationPlan,{artifactRoot:root});
  assert.equal(result.pass,true,JSON.stringify(result.errors));assert.equal(pkg.completeness.complete,true);
  assert.equal(pkg.coverage.requirements.ratio,1);assert.equal(pkg.coverage.failure_matrix.ratio,null);});

test('removing every required real producer record independently blocks completeness',async()=>{const root=tempRoot(),built=await realRequiredRecords(root);
  for(const record of built.records){const pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},
      verificationPlan:built.verificationPlan,records:built.records.filter((row)=>row.evidence_id!==record.evidence_id),artifactRoot:root});
    assert.equal(runtime.evaluateEvidenceCompleteness(pkg,built.verificationPlan,{artifactRoot:root}).complete,false,record.gate_id);}});

test('gate adapter and exact contract trace cannot be changed after producer authentication',async()=>{const root=tempRoot(),built=await realRequiredRecords(root);
  const command=built.records.find((row)=>row.kind==='command'),contractGate=built.verificationPlan.gates.find((row)=>row.adapter==='contract'&&row.disposition==='required');
  const adapterForgery={...command,gate_id:contractGate.id};assert.throws(()=>runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},
    verificationPlan:built.verificationPlan,records:[adapterForgery],artifactRoot:root}),/evidence-record-adapter/);
  const traceForgery={...command,requirement_ids:[]};assert.throws(()=>runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},
    verificationPlan:built.verificationPlan,records:[traceForgery],artifactRoot:root}),/evidence-record-trace/);});

test('persistent command artifact is content addressed and package contains no inline output',async()=>{const root=tempRoot(),built=await realRequiredRecords(root),
  command=built.records.find((row)=>row.kind==='command');assert.equal(Object.hasOwn(command,'redacted_output'),false);
  assert.match(command.artifact_ref,/^evidence\/commands\/EVID-/);const artifact=JSON.parse(fs.readFileSync(path.join(root,command.artifact_ref),'utf8'));
  assert.equal(digest(artifact),command.artifact_sha256);assert.equal(runtime.secretHits(artifact).length,0);
  fs.writeFileSync(path.join(root,command.artifact_ref),canonicalJson({...artifact,leak:`sk-${'x'.repeat(32)}`}));
  const pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},verificationPlan:built.verificationPlan,
    records:built.records.filter((row)=>row!==command),artifactRoot:root});pkg.records.push(command);pkg.records.sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
  const preimage=structuredClone(pkg);delete preimage.package_sha256;pkg.package_sha256=digest(preimage);
  const validation=runtime.validateEvidencePackage(pkg,built.verificationPlan,{artifactRoot:root});assert.equal(validation.pass,false);
  assert.ok(validation.errors.some((row)=>['evidence-artifact-digest','evidence-artifact-authentication'].includes(row.code)));});

test('persisted exact-secret policy rejects an arbitrary raw secret replanted into a package surface',async()=>{
  const root=tempRoot(),built=await realRequiredRecords(root),pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},
    verificationPlan:built.verificationPlan,records:built.records,artifactRoot:root});pkg.unverified_areas=[{gate_id:'GATE-host-smoke',
      reason:`attacker-replanted:${sentinel}`}];delete pkg.package_sha256;pkg.package_sha256=digest(pkg);
  const validation=runtime.validateEvidencePackage(pkg,built.verificationPlan,{artifactRoot:root});assert.equal(validation.pass,false);
  assert.ok(validation.errors.some((row)=>row.code==='evidence-redaction'),JSON.stringify(validation.errors));
});

test('package validation re-searches every persisted surface for an arbitrary exact secret',async()=>{
  const root=tempRoot(),secret=`opaque secret:${crypto.randomBytes(18).toString('base64url')} / end`,built=await realRequiredRecords(root,secret);
  const pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},verificationPlan:built.verificationPlan,
    records:built.records,artifactRoot:root});pkg.reviews.findings=[{severity:'note',detail:`unexpected raw ${secret} persisted`}];
  const preimage=structuredClone(pkg);delete preimage.package_sha256;pkg.package_sha256=digest(preimage);
  const validation=runtime.validateEvidencePackage(pkg,built.verificationPlan,{artifactRoot:root});assert.equal(validation.pass,false);
  assert.ok(validation.errors.some((row)=>row.code==='evidence-redaction'));assert.equal(runtime.evaluateEvidenceCompleteness(
    pkg,built.verificationPlan,{artifactRoot:root}).redaction.passed,false);
});

test('publisher rebases two same-base real captures without loss',async()=>{const root=tempRoot(),built=await realRequiredRecords(root),
  base=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},verificationPlan:built.verificationPlan,
    records:built.records.slice(0,-2),artifactRoot:root});let current={sha256:base.package_sha256,package:base};const deps={
    readCurrentBase:async()=>structuredClone(current),commitCandidate:async(candidate)=>{current={sha256:candidate.package.package_sha256,
      package:candidate.package};}};await Promise.all(built.records.slice(-2).map((record)=>runtime.publishEvidenceUpdate({
        expectedBase:{sha256:base.package_sha256},basePackage:base,record,packageInput:{scope:{kind:'session',id:'s-aaaaaaaa'},
          verificationPlan:built.verificationPlan,artifactRoot:root}},deps)));
  for(const record of built.records.slice(-2))assert.ok(current.package.records.some((row)=>row.evidence_id===record.evidence_id));});

test('production publisher journals immutable package and commits the review evidence pointer under the state lock',async()=>{
  const root=tempRoot();fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));const work=path.join(root,'.deep-work','s-aaaaaaaa');
  fs.mkdirSync(work,{recursive:true});const built=await realRequiredRecords(work),statePath=path.join(root,'.claude','deep-work.s-aaaaaaaa.md');
  const stateText=updateFrontmatterText('---\n\n---\n',{session_id:'s-aaaaaaaa',work_dir:'.deep-work/s-aaaaaaaa',current_phase:'test',
    verification_plan_json:canonicalJson(built.verificationPlan),verification_plan_sha256:built.verificationPlan.plan_sha256,
    risk_profile_json:canonicalJson({class:'medium',score:6,triggers:['strict-admission']}),methodology_policy_json:canonicalJson({
      risk_class:'medium',profile:'standard',verification_policy:{recommended:'표준 검증'}}),review_execution_json:'{}'});
  fs.writeFileSync(statePath,stateText);const stateCapability=platform.issueProjectStateCapability(root,statePath,{role:'session-state'}),
    record=built.records.find((row)=>row.kind==='contract');const published=await runtime.publishAuthenticatedRecord(record,
      {stateCapability,verificationPlan:built.verificationPlan,plan:built.planProjection,scope:{kind:'session',id:'s-aaaaaaaa'}});
  assert.match(published.pointer.package_ref,/^evidence\/packages\/[0-9a-f]{64}\.json$/);assert.ok(fs.existsSync(path.join(work,
    published.pointer.package_ref)));const fields=parseFrontmatter(fs.readFileSync(statePath,'utf8')).fields,
    review=JSON.parse(fields.review_execution_json);assert.equal(review.evidence.package_sha256,published.package.package_sha256);
  assert.equal(review.evidence.verification_plan_sha256,built.verificationPlan.plan_sha256);
  assert.ok(fs.readdirSync(path.join(root,'.claude')).some((name)=>name.includes('.op.evidence-publish.')));});

test('forged producer proof and same-digest dual review fail closed',async()=>{const root=tempRoot(),built=await realRequiredRecords(root),
  forged=structuredClone(built.records[0]);forged.producer_proof.proof_sha256='f'.repeat(64);
  assert.throws(()=>runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},verificationPlan:built.verificationPlan,
    records:[forged],artifactRoot:root}),/protected-evidence-producer/);const review=built.records.find((row)=>row.kind==='review'),dual={...review,
      review_policy:'dual',reports:[review.reports[0],{...review.reports[0],role:'executability'}]};
  assert.throws(()=>runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},verificationPlan:built.verificationPlan,
    records:[dual],artifactRoot:root}),/protected-evidence-producer|review-evidence-authority/);});

test('evidence-bearing receipt remains schema 1.0 and revalidates package-plan identity',async()=>{const root=tempRoot(),built=await realRequiredRecords(root),
  pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},verificationPlan:built.verificationPlan,
    records:built.records,artifactRoot:root}),summary=runtime.evaluateEvidenceCompleteness(pkg,built.verificationPlan,{artifactRoot:root});
  const receipt=runtime.attachEvidenceToReceipt({schema_version:'1.0',slice_id:'SLICE-001'},
    {package:pkg,summary,verificationPlan:built.verificationPlan,artifactRoot:root});assert.equal(receipt.schema_version,'1.0');
  assert.equal(receipt.evidence.schema_version,2);for(const key of ['verification_summary','residual_risk'])
    assert.equal(Object.hasOwn(receipt,key),false);const stale={...built.verificationPlan,spec_sha256:'f'.repeat(64)};
  assert.throws(()=>runtime.attachEvidenceToReceipt({schema_version:'1.0'},{package:pkg,summary,verificationPlan:stale,artifactRoot:root}),
    /receipt-evidence-incomplete/);});

test('receipt wrapper consumes the top-level committed session pointer and revalidates package-plan identity',async()=>{
  const fixture=wrapperFixture(),built=await realRequiredRecords(fixture.work),pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},
    verificationPlan:built.verificationPlan,records:built.records,artifactRoot:fixture.work}),summary=
    runtime.evaluateEvidenceCompleteness(pkg,built.verificationPlan,{artifactRoot:fixture.work});const packageRef=
    `evidence/packages/${pkg.package_sha256}.json`;fs.mkdirSync(path.join(fixture.work,'evidence','packages'),{recursive:true});
  fs.writeFileSync(path.join(fixture.work,packageRef),canonicalJson(pkg));fs.writeFileSync(fixture.payload,canonicalJson({schema_version:'1.0',
    session_id:'s-aaaaaaaa',started_at:'2026-07-13T00:00:00Z',outcome:'keep',slices:{total:1}}));const pointer={schema_version:2,
    package_ref:packageRef,package_sha256:pkg.package_sha256,verification_plan_sha256:built.verificationPlan.plan_sha256,
    summary,complete:true,missing_gate_ids:[],slice_packages:{}};fs.writeFileSync(fixture.state,updateFrontmatterText('',{
      session_id:'s-aaaaaaaa',work_dir:'.deep-work/s-aaaaaaaa',current_phase:'test',
      verification_plan_json:canonicalJson(built.verificationPlan),verification_plan_sha256:built.verificationPlan.plan_sha256,
      review_execution_json:canonicalJson({evidence:pointer})}));const result=runEvidenceWrapper(fixture);
  assert.equal(result.status,0,result.stderr);const wrapped=JSON.parse(fs.readFileSync(fixture.output,'utf8'));
  assert.equal(wrapped.payload.schema_version,'1.0');assert.equal(wrapped.payload.evidence.package_sha256,pkg.package_sha256);
});

test('receipt wrapper rejects a committed package whose identity does not match the state verification plan',async()=>{
  const fixture=wrapperFixture(),built=await realRequiredRecords(fixture.work),pkg=runtime.buildEvidencePackage({scope:{kind:'session',id:'s-aaaaaaaa'},
    verificationPlan:built.verificationPlan,records:built.records,artifactRoot:fixture.work});const forged=structuredClone(pkg);
  forged.verification_plan_sha256='f'.repeat(64);delete forged.package_sha256;forged.package_sha256=digest(forged);const packageRef=
    `evidence/packages/${forged.package_sha256}.json`;fs.mkdirSync(path.join(fixture.work,'evidence','packages'),{recursive:true});
  fs.writeFileSync(path.join(fixture.work,packageRef),canonicalJson(forged));fs.writeFileSync(fixture.payload,canonicalJson({schema_version:'1.0',
    session_id:'s-aaaaaaaa',started_at:'2026-07-13T00:00:00Z',outcome:'keep',slices:{total:1}}));const pointer={schema_version:2,
    package_ref:packageRef,package_sha256:forged.package_sha256,verification_plan_sha256:built.verificationPlan.plan_sha256,
    summary:{complete:true,redaction:{passed:true},unverified_areas:[]},complete:true,missing_gate_ids:[],slice_packages:{}};
  fs.writeFileSync(fixture.state,updateFrontmatterText('',{session_id:'s-aaaaaaaa',work_dir:'.deep-work/s-aaaaaaaa',current_phase:'test',
    verification_plan_json:canonicalJson(built.verificationPlan),verification_plan_sha256:built.verificationPlan.plan_sha256,
    review_execution_json:canonicalJson({evidence:{...pointer,session:pointer}})}));const result=runEvidenceWrapper(fixture);
  assert.notEqual(result.status,0);assert.match(result.stderr,/committed evidence package is invalid/i);
});
