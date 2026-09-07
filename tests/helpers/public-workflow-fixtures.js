'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {canonicalJson,sha256}=require('../../runtime/operation-journal.js');
const runtime=path.resolve(__dirname,'../../scripts/deep-work-runtime.js');
async function createPublicWorkflowFixture(t,{method='adaptive',checkpoint='implement',basis='outcome-v1',initialReadme='Old heading\n',planMutator,specMutator,initialFiles={},approvalMode='simulated-human',gitFixture='real',parsedArguments=null,taskDescription='Update README heading'}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-public-workflow-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const cli=(args)=>{const result=cp.spawnSync(process.execPath,[runtime,...args],{cwd:root,encoding:'utf8',env:{...process.env,DEEP_WORK_SESSION_ID:'',NO_COLOR:'1',FORCE_COLOR:''}});if(result.status!==0)throw new Error(`${args.slice(0,3).join(' ')}: ${result.stderr}`);return JSON.parse(result.stdout);};
 const write=(name,value)=>{const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));return target;};
 if(gitFixture==='marker'){fs.mkdirSync(path.join(root,'.git'));fs.writeFileSync(path.join(root,'.git','HEAD'),'a'.repeat(40)+'\n');write('README.md',initialReadme);for(const [file,value]of Object.entries(initialFiles))write(file,value);}
 else{cp.execFileSync('git',['init','-q'],{cwd:root});cp.execFileSync('git',['config','user.name','Fixture'],{cwd:root});cp.execFileSync('git',['config','user.email','fixture@example.invalid'],{cwd:root});write('README.md',initialReadme);for(const [file,value]of Object.entries(initialFiles))write(file,value);cp.execFileSync('git',['add','README.md',...Object.keys(initialFiles)],{cwd:root});cp.execFileSync('git',['commit','-qm','fixture'],{cwd:root});}
 const task=write('task.txt',taskDescription),flags=write('flags.json',parsedArguments?cli(['flags','parse','--arguments-json',write('parsed-arguments.json',parsedArguments)]):{tdd:method}),profile=write('profile.json',{}),defaults=write('defaults.json',{tdd:method,...(approvalMode==='simulated-human'?{artifact_approval_policy:{schema_version:1,mode:'explicit-gates',source:'user-explicit',task_sha256:sha256(Buffer.from(taskDescription.trim())),project_root:root}}:{})});
 const init=cli(['session','initialize','--task-file',task,'--flags-json',flags,'--profile-json',profile]);
 write('defaults.json',{...JSON.parse(fs.readFileSync(defaults)),...init.defaults});
 const prepared=cli(['session','repository','prepare','--session',init.sessionId,'--mode','current-branch','--task-file',task,'--defaults-json',defaults]);
 const state=prepared.stateCapability.path,sessionId=init.sessionId,workDir=path.join(root,'.deep-work',sessionId);
 const fields=()=>require('../../runtime/frontmatter.js').parseFrontmatter(fs.readFileSync(state,'utf8')).fields;
 const result={root,state,sessionId,workDir,cli,write,fields,planPath:path.join(workDir,'plan.json')};
 if(checkpoint==='brainstorm')return result;cli(['phase','continue','--state',state]);if(checkpoint==='research')return result;
 cli(['phase','continue','--state',state]);
 const spec={schema_version:1,spec_id:'SPEC-EXECUTION',risk_class:'low',requirements:[{id:'REQ-001',statement:'README has new heading',acceptance:'README includes New heading',priority:'must',negative_test_ids:[],evidence_gate_ids:['GATE-outcome-verification']}],invariants:[],failure_matrix:[],negative_tests:[],compatibility:{legacy_inputs:'none',migration:'none'},open_questions:[]};
 if(basis==='strict-tdd-v2')spec.requirements[0].evidence_gate_ids=['GATE-tdd-red','GATE-tdd-green'];
 if(specMutator)specMutator(spec);
 const specBytes=['# Executable Spec: README','## Scope','README','## Non-goals','Other files','## Contract','```json spec-contract',JSON.stringify(spec,null,2),'```','## Requirement Notes','REQ-001: heading','## Failure and Recovery Notes','Restore previous text','## Decisions and Trade-offs','Keep text simple','## Open Questions','None','## Spec Gate Result','Validation is recorded by the phase spec approve runtime operation.'].join('\n');write(path.relative(root,path.join(workDir,'spec.md')),specBytes);
 const plan=require('./execution-fixtures.js').makeExecutionPlanFixture({method,basis,strictRequired:basis==='strict-tdd-v2'?['SLICE-001']:[]});
 if(basis==='strict-tdd-v2'){const v=plan.slices[0].verification_spec;v.executable.supported_patches_sha256=require('../../runtime/node-tap-policy.js').CURRENT_NODE_TAP_POLICY_SHA256;plan.slices[0].verification_spec_sha256=sha256(canonicalJson(v));}delete plan.contract_binding.source_plan_sha256;
 plan.contract_binding.created_by_version=fields().created_by_version;
 plan.contract_binding.spec_contract={spec_id:spec.spec_id,spec_sha256:require('../../runtime/contract-runtime.js').specContractDigest(spec),spec_approved_hash:sha256(specBytes)};
 plan.contract_binding.risk_profile_sha256=fields().risk_profile_sha256;
 if(planMutator)planMutator(plan,{spec,fields:fields(),root,workDir});
 const planBytes=['# Plan','## Execution Plan','```json',JSON.stringify(plan,null,2),'```'].join('\n');write(path.relative(root,path.join(workDir,'plan.md')),planBytes);
 // Test-only explicit simulation. The receipt is stamped simulated and cannot
 // satisfy assertAutonomousArtifactApprovals or a LIVE current-treatment grade.
 if(checkpoint==='authored')return result;
 let approvalArgs=[];
 if(approvalMode==='simulated-human'){
  const packet=cli(['artifact','approval','packet-publish','--state',state,'--phases','spec,plan']);
  const packetRef=write(path.relative(root,path.join(workDir,'approval-packet-ref.json')),packet.ref);
  const declaration=write(path.relative(root,path.join(workDir,'simulated-declaration.json')),{schema_version:1,source:'human',identity_authenticated:false,evidence_mode:'simulated',bundle_sha256:packet.bundle.bundle_sha256,packet_sha256:packet.packet.packet_sha256,phases:['spec','plan'],confirmed:true,confirmation_reference:'test-fixture-simulated-confirmation',confirmation_text:'Simulated host explicitly approves this exact test fixture bundle; no actual user confirmation is claimed.'});
  const approved=cli(['artifact','approval','publish','--state',state,'--packet-ref-json',packetRef,'--human-declaration-json',declaration]);
  const approvalRef=write(path.relative(root,path.join(workDir,'artifact-approval-ref.json')),approved.ref);approvalArgs=['--approval-ref-json',approvalRef];result.approval=approved;result.packet=packet;result.approvalRefPath=approvalRef;
 }
 cli(['phase','spec','approve','--state',state,'--artifact',path.join(workDir,'spec.md'),'--at','2026-09-06T00:00:00Z',...approvalArgs]);if(checkpoint==='spec')return result;
 cli(['phase','continue','--state',state]);
 cli(['phase','approve','--state',state,'--phase','plan','--artifact',path.join(workDir,'plan.md'),'--at','2026-09-06T00:00:00Z',...approvalArgs]);
 result.plan=JSON.parse(fs.readFileSync(result.planPath));if(checkpoint==='plan')return result;
 cli(['phase','continue','--state',state]);if(checkpoint==='outcome-complete')completeBuiltinOutcome(result);return result;
}
function completeBuiltinOutcome(f,sliceId='SLICE-001'){const args=['--state',f.state,'--plan',f.planPath,'--slice',sliceId];f.cli(['slice','activate',...args]);const scope=require('../../runtime/plan-runtime.js').deriveScopedWriteAuthority({plan:f.plan,sliceId,writeClass:'production'});const write=f.cli(['implement','write','begin',...args,'--class','production','--scope-sha256',scope.sha256]);fs.writeFileSync(path.join(f.root,'README.md'),'New heading\n');f.cli(['implement','write','accept',...args,'--operation-id',write.operationId,'--pre-manifest-sha256',write.preManifestSha256]);const prepared=f.cli(['verification','outcome-explain',...args,'--oracle','ORACLE-001']),pair=f.cli(['verification','outcome-run',...args,'--oracle','ORACLE-001','--prepared-digest',prepared.prepared_sha256]);const data=(name,value)=>f.write(path.relative(f.root,path.join(f.workDir,name)),value);const positives=data('positive-refs.json',[pair.positiveRef]),controls=data('control-refs.json',[pair.controlRef]),empty=data('review-execution-refs.json',[]);const review=f.cli(['outcome','review','publish',...args,'--positive-refs-json',positives,'--control-refs-json',controls,'--review-execution-refs-json',empty]);const source=data('source-evidence.json',{kind:'accepted-write',refs:[{path:'.claude/deep-work.'+f.sessionId+'.scoped-write.'+write.operationId+'.json',sha256:sha256(fs.readFileSync(path.join(f.root,'.claude','deep-work.'+f.sessionId+'.scoped-write.'+write.operationId+'.json'))),producer_operation_id:write.operationId}]});f.completion=f.cli(['implement','outcome-complete',...args,'--positive-refs-json',positives,'--control-refs-json',controls,'--review-ref-json',data('oracle-review-ref.json',review.ref),'--source-evidence-json',source]);f.plan=JSON.parse(fs.readFileSync(f.planPath));return f;}
module.exports={createPublicWorkflowFixture,completeBuiltinOutcome};
