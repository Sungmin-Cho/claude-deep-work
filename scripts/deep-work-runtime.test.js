'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const artifactRuntime = require('../runtime/artifact-runtime.js');
const platform = require('../runtime/platform.js');
const { updateFrontmatterText } = require('../runtime/frontmatter.js');
const { DISPATCHER_GRAMMAR, PHASE5_DISPATCHER_COMMANDS, DISPATCHER_HANDLERS,
  DISPATCHER_METADATA, validateGrammarContract, parseDispatcher, dispatch } =
  require('./deep-work-runtime.js');

const ROUTE_TIMESTAMP = '2026-07-13T00:00:00Z';

function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value)}\n`); return file; }

async function semanticFixture(entry, index) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-route-semantic-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.claude'));
  const session = `s-${(index + 1).toString(16).padStart(8, '0')}`;
  const workDir = path.join(root, '.deep-work', session);
  const receipts = path.join(workDir, 'receipts');
  fs.mkdirSync(receipts, {recursive:true});
  const standalone = entry.allowedPhases[0] === 'standalone';
  let currentPhase = standalone ? 'implement' : entry.allowedPhases[0];
  if (entry.id === 'mutation round end') currentPhase = 'implement';
  const state = path.join(root, '.claude', `deep-work.${session}.md`);
  const fields = {schema_version:2,session_id:session,current_phase:currentPhase,
    work_dir:`.deep-work/${session}`,repository_mode:'current',branch:'main',head_oid:'a'.repeat(40),
    worktree_enabled:false,active_slice:'SLICE-001',tdd_state:'PENDING',test_retry_count:0,
    max_test_retries:3,debug_active:true,debug_slice:'SLICE-001',active_cluster_takeover:'C1',
    delegation_snapshot:'a'.repeat(40),
    mutation_testing:JSON.stringify({active_round:1,survived:{mutants:[]}}),
    model_routing_json:JSON.stringify({research:'main',implement:'main',test:'main',plan:'main'})};
  fs.writeFileSync(state, updateFrontmatterText('', fields));
  const planValue = {schema_version:1,slices:[{id:'SLICE-001',checked:false,scope_schema_version:1,
    files:['src/a.js','tests/a.test.js'],write_scope:{failing_test:['tests/a.test.js'],production:['src/a.js'],
      refactor:['src/a.js','tests/a.test.js']}}],quality_gates:[{id:'QG-001'}]};
  const plan = writeJson(path.join(workDir, 'plan.json'), planValue);
  fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.js'), 'test placeholder\n');
  writeJson(path.join(receipts, 'SLICE-001.json'), {slice_id:'SLICE-001',status:'complete',debug:{}});
  const registry = {version:1,shared_files:['package.json'],sessions:{[session]:{pid:process.pid,
    task_description:entry.id,work_dir:`.deep-work/${session}`,current_phase:currentPhase,
    file_ownership:[],last_activity:ROUTE_TIMESTAMP,branch:'main',head_oid:'a'.repeat(40)}}};
  writeJson(path.join(root, '.claude', 'deep-work-sessions.json'), registry);
  fs.writeFileSync(path.join(root, '.claude', 'deep-work-session'), `${session}\n`);

  const files = {
    task:path.join(workDir,'task.txt'), defaults:path.join(workDir,'defaults.json'),
    profileJson:path.join(workDir,'profile.json'), flags:path.join(workDir,'flags.json'),
    result:path.join(workDir,'result.json'), affected:path.join(workDir,'affected.json'),
    assignment:path.join(workDir,'assignment.json'), verificationSpec:path.join(workDir,'verification-spec.json'),
    gate:path.join(workDir,'gate.json'), failed:path.join(workDir,'failed.json'),
    survived:path.join(workDir,'survived.json'), verification:path.join(workDir,'verification.json'),
    structural:path.join(workDir,'structural.json'), structuralMd:path.join(workDir,'structural.md'),
    adversarial:path.join(workDir,'adversarial.json'), report:path.join(workDir,'drift.md'),
    score:path.join(workDir,'score.txt'), processSpec:path.join(workDir,'process-spec.json'),
    changed:path.join(workDir,'changed.json'), health:path.join(workDir,'health.json'),
    recommender:path.join(workDir,'recommender.json'), recommendation:path.join(workDir,'recommendation.txt'),
    capability:path.join(workDir,'capability.json'), ask:path.join(workDir,'ask.json'),
    arguments:path.join(workDir,'arguments.json'), profile:path.join(workDir,'profile.yaml'),
    cluster:path.join(workDir,'cluster.txt'), note:path.join(workDir,'root-cause.md'),
  };
  fs.writeFileSync(files.task, 'semantic route');
  writeJson(files.defaults, {}); writeJson(files.profileJson, {}); writeJson(files.flags, {});
  writeJson(files.result, {result:'recorded',status:'completed'}); writeJson(files.affected, ['SLICE-001']);
  writeJson(files.assignment, {schema_version:1,clusters:[{id:'C1',slices:['SLICE-001']}]});
  const verificationSpec = {schema_version:1,executable:{kind:'node',value:'node'},
    args:['-e','process.stdout.write("semantic\\n")'],cwd_role:'active-worktree',timeout_ms:1000,
    max_output_bytes:65536};
  writeJson(files.verificationSpec, verificationSpec); writeJson(files.gate, {complete:true,failedSlices:[]});
  writeJson(files.failed, ['SLICE-001']); writeJson(files.survived, {mutants:[]});
  writeJson(files.verification, {accepted:true}); writeJson(files.structural, {result:'recorded'});
  fs.writeFileSync(files.structuralMd, '# Structural\n'); writeJson(files.adversarial, {result:'recorded'});
  fs.writeFileSync(files.report, '# Drift\n'); fs.writeFileSync(files.score, '1');
  writeJson(files.processSpec, {kind:'native-executable',executable:process.execPath,
    args:['-e','process.stdout.write("[]")']}); writeJson(files.changed, []);
  writeJson(files.health, {topology:'generic',health_report:{status:'pass'},fitness_baseline:null,
    unresolved_required_issues:[]});
  writeJson(files.recommender, {task_description:'task',git_status:'clean',recent_commits:[],top_level_dirs:[]});
  fs.writeFileSync(files.recommendation, JSON.stringify({team_mode:{value:'solo',reason:'safe'},
    start_phase:{value:'research',reason:'safe'},tdd_mode:{value:'strict',reason:'safe'},
    git:{value:'current-branch',reason:'safe'},model_routing:{value:'default',reason:'safe'}}));
  writeJson(files.capability, {git_worktree:false,team_mode_available:false,is_git:true});
  writeJson(files.ask, {item:'git',recommendation:'current-branch',default_value:'current-branch',
    enum_values:['worktree','new-branch','current-branch'],capability:{git_worktree:false,is_git:true}});
  writeJson(files.arguments, ['--tdd=strict','semantic']);
  fs.writeFileSync(files.profile, 'version: 3\ndefault_preset: solo-strict\npresets:\n  solo-strict:\n    interactive_each_session:\n      - team_mode\n    defaults:\n      team_mode: solo\n');
  fs.writeFileSync(files.cluster, 'C1\n'); fs.writeFileSync(files.note, '# Root cause\n');

  const stateCapability = platform.issueProjectStateCapability(root, state, {role:'session-state'});
  const sessionCapability = platform.issueProjectStateCapability(root, workDir,
    {role:'session-work-dir',sessionStateCapability:stateCapability});
  const temps = new Map();
  async function temp(purpose, bytes) {
    if (temps.has(purpose)) return temps.get(purpose);
    const created = await artifactRuntime.createOwnedTemp({sessionCapability,purpose});
    await artifactRuntime.writeOwnedTemp({sessionCapability,operationId:created.operationId,purpose},bytes);
    temps.set(purpose, created.path); return created.path;
  }
  return {root,session,state,workDir,receipts,plan,files,temp};
}

async function semanticArgv(entry, fx) {
  const phase = entry.id === 'phase approve' ? 'research' : entry.id === 'phase review record' ? 'brainstorm'
    : entry.allowedPhases[0] === 'standalone' ? 'implement' : entry.allowedPhases[0];
  const values = {
    session:fx.session,parent:fx.session,base:'HEAD','paths-json':fx.files.changed,state:fx.state,
    purpose:entry.id === 'git stash publish' ? 'fork' : 'receipt-payload','temp-operation-id':`op-${'1'.repeat(64)}`,
    'expected-sha256':'a'.repeat(64),'project-root':fx.root,path:'src/a.js',at:ROUTE_TIMESTAMP,
    phase,mode:'current-branch','task-file':fx.files.task,'defaults-json':fx.files.defaults,
    'profile-json':fx.files.profileJson,'base-ref':'HEAD','from-phase':'plan','dirty-resolution':'abort',
    worktree:path.join(fx.root, '..', `${path.basename(fx.root)}-wt-${fx.session.slice(2)}`),
    'flags-json':fx.files.flags,'finished-at':ROUTE_TIMESTAMP,'result-json':fx.files.result,
    artifact:fx.files.structuralMd,from:'brainstorm',to:'research','affected-slices-json':fx.files.affected,
    plan:fx.plan,'assignment-json':fx.files.assignment,snapshot:'a'.repeat(40),slice:'SLICE-001',
    class:'failing-test','scope-sha256':'a'.repeat(64),'delegation-operation-id':`op-${'2'.repeat(64)}`,
    cluster:'C1','operation-id':`op-${'3'.repeat(64)}`,'pre-manifest-sha256':'a'.repeat(64),
    'verification-result':fx.files.verification,'verification-sha256':'a'.repeat(64),
    'verification-operation-id':`op-${'4'.repeat(64)}`,'sensor-operation-ids':JSON.stringify([`op-${'5'.repeat(64)}`]),
    'sensor-results-sha256':'a'.repeat(64),'after-write-operation-id':`op-${'6'.repeat(64)}`,
    'receipts-dir':fx.receipts,
    'cluster-file':fx.files.cluster,'delegation-snapshot':'a'.repeat(40),scope:'slice',id:'SLICE-001',
    'spec-json':fx.files.verificationSpec,expected:'must-pass','gate-id':'QG-001',
    'gate-results-json':fx.files.gate,'failed-slices-json':fx.files.failed,'survived-json':fx.files.survived,
    round:'1','verification-json':fx.files.verification,'note-file':fx.files.note,
    'structural-json':fx.files.structural,'structural-md':fx.files.structuralMd,
    'adversarial-json':fx.files.adversarial,kind:'brainstorm',
    report:fx.files.report,'score-file':fx.files.score,format:'json',model:'opus',engine:'codex','timeout-ms':'1000',
    'process-spec-json':fx.files.processSpec,parser:'generic-json','budget-ms':'1000',topology:'generic',
    'changed-files-json':fx.files.changed,'fitness-file':path.join(fx.root,'.deep-review','fitness.json'),
    'report-json':fx.files.health,'input-json':entry.id==='ask options'?fx.files.ask:fx.files.recommender,
    'result-file':fx.files.recommendation,'capability-json':fx.files.capability,'profile-file':fx.files.profile,
    'initial-preset':'solo-strict',reason:'setup',preset:'solo-strict','arguments-json':fx.files.arguments,
  };
  if (entry.id === 'implement tdd transition') values.to = 'PENDING';
  if (entry.id === 'verification run') delete values['gate-id'];
  if (entry.id === 'sensor run') values.kind = 'lint';
  if (entry.id === 'session execution set') values.mode = 'inline';
  if (entry.id === 'review run') values.mode = 'read-only';
  const tempValues = {
    'receipt-payload':()=>fx.temp('receipt-payload', Buffer.from('{"status":"complete"}\n')),
    'title-file':()=>fx.temp('pr-title', Buffer.from('Semantic PR')),
    'body-file':()=>fx.temp('pr-body', Buffer.from('Semantic body')),
    'reason-file':()=>fx.temp('reason', Buffer.from('semantic override')),
    input:()=>fx.temp('artifact-input', Buffer.from('# Artifact\n')),
    'prompt-file':()=>fx.temp('review-prompt', Buffer.from('Review this')),
  };
  const argv = [...entry.tokens];
  for (const name of entry.required) {
    argv.push(`--${name}`);
    if (!['force','include-untracked','skip-audit','stdin'].includes(name)) argv.push(
      tempValues[name] ? await tempValues[name]() : values[name]);
  }
  if (entry.id === 'session context') argv.push('--session',fx.session);
  if (entry.id === 'verification run') argv.push('--slice','SLICE-001');
  if (entry.id === 'session cleanup remove') argv.push('--force');
  return argv;
}

test('dispatcher grammar is single-source typed metadata', () => {
  assert.ok(DISPATCHER_GRAMMAR.length >= 70);
  for (const entry of DISPATCHER_GRAMMAR) {
    assert.equal(typeof entry.phase5Allowed, 'boolean', entry.id);
    assert.ok(entry.allowedPhases.length > 0, entry.id);
    assert.ok(entry.capabilityKind.length > 0, entry.id);
    assert.ok(Array.isArray(entry.lockRanks), entry.id);
  }
  assert.deepEqual(PHASE5_DISPATCHER_COMMANDS,
    DISPATCHER_GRAMMAR.filter((entry) => entry.phase5Allowed));
  assert.deepEqual(PHASE5_DISPATCHER_COMMANDS.map((entry) => entry.id),
    ['session context','git capability','git changed','temp create','temp write','temp remove']);
});

test('all route lock ranks match the global repository to target hierarchy',()=>{
  const expected=new Map([
    ['session context',[]],['git capability',[]],['git changed',[5]],
    ['temp create',[10,20,50,70]],['temp write',[10,20,50,70]],['temp remove',[10,20,50,70]],
    ['session registry read',[]],['session registry own',[10,20,30,40,50]],
    ['session registry touch',[10,20,30,40,50]],['session registry phase',[10,20,30,40,50]],
    ['session pointer select',[30,40,50]],['session repository prepare',[5,10,20,30,40,50]],
    ['session fork',[5,10,20,40,50,70]],['session finish merge',[5,10,20,30,40,50,70]],
    ['session finish publish-pr',[5,10,20,30,40,50,70]],['session finish keep',[10,20,30,40,50,70]],
    ['session finish discard',[5,10,20,30,40,50,70]],['session cleanup scan',[5,40]],
    ['session cleanup remove',[5,10,20,30,40,50]],['session cache-clear',[10,70]],
    ['session initialize',[]],['session state migrate-schema',[50]],['session execution set',[50]],
    ['session state migrate-model-routing',[50]],['session recovery worktree',[5,10,50]],
    ['session finalize',[10,20,30,40,50]],['phase begin',[10,20,50]],['phase complete',[10,20,50]],
    ['phase approve',[10,20,50]],['phase advance',[10,20,50]],['phase rerun',[10,20,50]],
    ['implement delegation set',[10,20,50,70]],['implement delegation clear',[50]],
    ['implement write begin',[10,20,50,70]],['implement write accept',[10,20,50,70]],
    ['implement tdd transition',[10,20,50]],['implement slice complete',[10,20,50,70]],
    ['implement override set',[10,20,50,70]],['implement override clear',[50]],
    ['implement takeover set',[50,70]],['implement takeover clear',[50,70]],
    ['verification migrate-spec',[10,20,50,70]],['verification run',[10,20,50,70]],
    ['test pass',[10,20,50,70]],['test retry',[10,20,50,70]],['test exhaust',[10,20,50,70]],
    ['mutation round begin',[10,20,50,70]],['mutation round end',[10,20,50,70]],
    ['mutation record',[10,20,50,70]],['debug enter',[50]],['debug complete',[10,20,50,70]],
    ['debug exit',[50]],['phase review record',[10,20,50,70]],['artifact publish',[10,20,50,70]],
    ['analysis drift record',[50]],['receipt dashboard',[]],['receipt view',[]],
    ['receipt export',[10,20,50,70]],['history list',[]],['report generate',[10,20,50,70]],
    ['git report commit',[5,10,20,50]],['slice activate',[50]],['slice spike',[50]],
    ['slice reset',[5,10,20,50,70]],['slice model',[50]],['git delegated rollback',[5,10,20,50,70]],
    ['git stash publish',[5,10,20]],['git stash apply',[5,10,20]],['git stash drop',[5,10,20]],
    ['review run',[10,20,50,70]],['sensor detect',[]],['sensor run',[10,20,50,70]],
    ['sensor review-check',[10,20,50,70]],['topology detect',[]],['health fitness-proposal',[]],
    ['health check',[70]],['health research-state',[50]],['capability detect',[]],
    ['recommender input',[]],['recommender validate',[]],['ask options',[]],['profile migrate',[70]],
    ['profile load',[]],['profile update',[70]],['flags parse',[]],
  ]);
  assert.equal(expected.size,DISPATCHER_GRAMMAR.length);
  assert.deepEqual([...expected.keys()],DISPATCHER_GRAMMAR.map((entry)=>entry.id));
  for(const entry of DISPATCHER_GRAMMAR)assert.deepEqual(entry.lockRanks,expected.get(entry.id),entry.id);
});

test('all grammar metadata is explicit and mutation-checked', () => {
  assert.equal(DISPATCHER_METADATA instanceof Map, true);
  assert.equal(DISPATCHER_METADATA.size, DISPATCHER_GRAMMAR.length);
  const fields = ['capabilityKind','readSet','writeSet','mutableFields','allowedPhases',
    'lockDomain','lockRanks','recoveryKind','operationKind','destructive','phase5Allowed'];
  for (const entry of DISPATCHER_GRAMMAR) {
    const metadata = DISPATCHER_METADATA.get(entry.id);
    assert.ok(metadata, entry.id);
    for (const field of fields) assert.ok(Object.hasOwn(metadata, field), `${entry.id}:${field}`);
    assert.doesNotThrow(() => validateGrammarContract(entry));
    for (const field of fields) {
      const mutant = {...entry, [field]: field === 'destructive' || field === 'phase5Allowed'
        ? !entry[field] : field === 'lockRanks' ? [999] : field.endsWith('Set') || field === 'mutableFields' || field === 'allowedPhases'
          ? ['mutated'] : 'mutated'};
      assert.throws(() => validateGrammarContract(mutant), undefined, `${entry.id}:${field}`);
    }
  }
  const source = fs.readFileSync(require.resolve('./deep-work-runtime.js'), 'utf8');
  assert.doesNotMatch(source, /function (?:capabilityName|routeWriteSet|routeAllowedPhases|routeLockDomain)/);
  assert.match(source, /ROUTE_CONTRACTS/);
});

test('every grammar row has one executable typed handler', () => {
  assert.equal(DISPATCHER_HANDLERS instanceof Map, true);
  assert.deepEqual([...DISPATCHER_HANDLERS.keys()].sort(),
    DISPATCHER_GRAMMAR.map((entry) => entry.id).sort());
  for (const entry of DISPATCHER_GRAMMAR) {
    assert.equal(typeof DISPATCHER_HANDLERS.get(entry.id), 'function', entry.id);
  }
  assert.doesNotMatch(require('node:fs').readFileSync(require.resolve('./deep-work-runtime.js'), 'utf8'),
    /route-not-implemented/);
});

test('parser rejects generic mutation, public reducers, duplicate and unknown flags', () => {
  for (const argv of [
    ['session','state','set'], ['session','registry','register'], ['session','registry','unregister'],
    ['temp','create','--path','x'], ['artifact','publish','--output','x'],
  ]) assert.throws(() => parseDispatcher(argv));
  assert.throws(() => parseDispatcher(['session','context','--session','s-aaaaaaaa','--session','s-bbbbbbbb']),
    /duplicate-flag/);
  const parsed = parseDispatcher(['flags','parse','--arguments-json','C:\\공백 dir\\args.json']);
  assert.equal(parsed.flags['arguments-json'], 'C:\\공백 dir\\args.json');
  for(const ref of ['HEAD --output=/tmp/owned','HEAD\n--output=x','refs/heads/main..foreign'])assert.throws(()=>
    parseDispatcher(['git','changed','--base',ref]),/git-ref/);
});

test('parser enforces grouped evidence, contextual sensor, target, and numeric contracts', () => {
  const sha = 'a'.repeat(64);
  const op = `op-${'b'.repeat(64)}`;
  const tdd = ['implement','tdd','transition','--state','state.md','--plan','plan.json',
    '--slice','SLICE-001'];
  assert.throws(() => parseDispatcher([...tdd,'--to','RED_VERIFIED']), /verification-flag-group/);
  assert.throws(() => parseDispatcher([...tdd,'--to','GREEN','--verification-result','result.json',
    '--verification-sha256',sha]), /verification-flag-group/);
  assert.throws(() => parseDispatcher([...tdd,'--to','PENDING','--verification-result','result.json',
    '--verification-sha256',sha,'--verification-operation-id',op]), /verification-flags-extra/);
  assert.throws(() => parseDispatcher([...tdd,'--to','SENSOR_CLEAN','--sensor-operation-ids',
    JSON.stringify([op]),'--sensor-results-sha256',sha]), /sensor-flag-group/);
  assert.throws(() => parseDispatcher([...tdd,'--to','SENSOR_CLEAN','--sensor-operation-ids',
    JSON.stringify([op,op]),'--sensor-results-sha256',sha,'--after-write-operation-id',op]),
  /sensor-operation-ids/);

  const sensor = ['sensor','run','--kind','lint','--process-spec-json','spec.json',
    '--parser','generic','--budget-ms','1000'];
  assert.throws(() => parseDispatcher([...sensor,'--state','state.md']), /sensor-context-group/);
  assert.throws(() => parseDispatcher(['sensor','run','--kind','lint','--process-spec-json','spec.json',
    '--parser','generic','--budget-ms','0']), /numeric-bound/);
  assert.throws(() => parseDispatcher(['review','run','--engine','codex','--prompt-file','prompt.tmp',
    '--timeout-ms','1.5','--mode','read-only']), /numeric-bound/);

  const verification = ['verification','run','--state','state.md','--plan','plan.json',
    '--spec-json','spec.json','--expected','must-pass'];
  assert.throws(() => parseDispatcher(verification), /verification-target/);
  assert.throws(() => parseDispatcher([...verification,'--slice','SLICE-001','--gate-id','QG-1']),
    /verification-target/);
  assert.throws(() => parseDispatcher(['artifact','publish','--state','state.md','--kind','research',
    '--input','input.tmp','--area','risks']), /artifact-area/);
  assert.throws(() => parseDispatcher(['artifact','publish','--state','state.md','--kind','plan-backup',
    '--input','input.tmp','--iteration','21']), /numeric-bound/);
});

test('dispatcher rejects a route outside the phase read under the state lock', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-dispatch-phase-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.claude'));
  fs.mkdirSync(path.join(root, '.deep-work', 's-aaaaaaaa'), {recursive:true});
  const state = path.join(root, '.claude', 'deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(state, '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: research\n---\n');
  await assert.rejects(() => dispatch(['slice','model','--state',state,'--slice','SLICE-001',
    '--model','opus'], {cwd:root}), /dispatcher-phase/);
});

test('review prompt authority cannot be a raw worktree file', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-review-route-')));
  fs.mkdirSync(path.join(root, '.git'));
  const prompt = path.join(root, 'prompt.md');
  fs.writeFileSync(prompt, 'review me');
  await assert.rejects(() => dispatch(['review','run','--engine','codex','--prompt-file',prompt,
    '--timeout-ms','1000','--mode','read-only'], {cwd:root}), /owned-temp-route/);
});

test('owned-temp dispatcher allocates, writes, adopts, and compare-removes its derived path', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-temp-route-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.claude'));
  fs.mkdirSync(path.join(root, '.deep-work', 's-aaaaaaaa'), {recursive:true});
  const state = path.join(root, '.claude', 'deep-work.s-aaaaaaaa.md');
  fs.writeFileSync(state, '---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\n---\n');
  const created = await dispatch(['temp','create','--state',state,'--session','s-aaaaaaaa',
    '--purpose','receipt-payload'], {cwd:root});
  assert.match(created.operationId, /^op-[0-9a-f]{64}$/);
  assert.equal(path.basename(created.path), 'receipt-payload.tmp');
  const written = await dispatch(['temp','write','--state',state,'--session','s-aaaaaaaa',
    '--temp-operation-id',created.operationId,'--stdin'], {cwd:root,stdin:'payload'});
  assert.equal(written.status, 'written');
  assert.equal((await dispatch(['temp','write','--state',state,'--session','s-aaaaaaaa',
    '--temp-operation-id',created.operationId,'--stdin'], {cwd:root,stdin:'payload'})).status, 'adopted');
  await dispatch(['temp','remove','--state',state,'--session','s-aaaaaaaa',
    '--temp-operation-id',created.operationId,'--expected-sha256',written.sha256], {cwd:root});
  assert.equal(fs.existsSync(created.path), false);
});

test('finish keep holds the full store transaction and publishes from the finalized state identity', async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-finish-keep-route-')));const session='s-aaaaaaaa';
  fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));const workDir=path.join(root,'.deep-work',session);
  fs.mkdirSync(workDir,{recursive:true});const state=path.join(root,'.claude',`deep-work.${session}.md`);
  fs.writeFileSync(state,'---\nsession_id: s-aaaaaaaa\nwork_dir: .deep-work/s-aaaaaaaa\ncurrent_phase: implement\n---\n');
  fs.writeFileSync(path.join(root,'.claude','deep-work-sessions.json'),`${JSON.stringify({version:1,shared_files:[],sessions:{
    [session]:{pid:process.pid,task_description:'finish',work_dir:`.deep-work/${session}`,current_phase:'implement',file_ownership:[],
      last_activity:ROUTE_TIMESTAMP}}})}\n`);fs.writeFileSync(path.join(root,'.claude','deep-work-current-session'),`${session}\n`);
  const stateCap=platform.issueProjectStateCapability(root,state,{role:'session-state'});const workCap=
    platform.issueProjectStateCapability(root,workDir,{role:'session-work-dir',sessionStateCapability:stateCap});
  const authored={status:'authored',note:'keep'};const temp=await artifactRuntime.createOwnedTemp({sessionCapability:workCap,
    purpose:'receipt-payload'});await artifactRuntime.writeOwnedTemp({sessionCapability:workCap,operationId:temp.operationId,
      purpose:'receipt-payload'},Buffer.from(`${JSON.stringify(authored)}\n`));
  const result=await dispatch(['session','finish','keep','--state',state,'--session',session,'--receipt-payload',temp.path],{cwd:root});
  assert.equal(result.status,'completed');assert.equal(result.outcome,'keep');assert.equal(fs.existsSync(result.resultPath),true);
  const payload=JSON.parse(fs.readFileSync(result.resultPath,'utf8'));assert.equal(payload.note,'keep');assert.equal(payload.finish_outcome,'keep');
  assert.equal(fs.existsSync(path.join(root,'.claude','deep-work-current-session')),false);const registry=JSON.parse(fs.readFileSync(
    path.join(root,'.claude','deep-work-sessions.json'),'utf8'));assert.equal(registry.sessions[session],undefined);
});

test('finish keep resumes result publication from its journal without rereading a consumed temp',async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'dw-finish-keep-resume-')));const session='s-bbbbbbbb';
  fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'.claude'));const work=path.join(root,'.deep-work',session);
  fs.mkdirSync(work,{recursive:true});const statePath=path.join(root,'.claude',`deep-work.${session}.md`);fs.writeFileSync(statePath,
    '---\nsession_id: s-bbbbbbbb\nwork_dir: .deep-work/s-bbbbbbbb\ncurrent_phase: implement\n---\n');fs.writeFileSync(
    path.join(root,'.claude','deep-work-sessions.json'),`${JSON.stringify({version:1,shared_files:[],sessions:{[session]:{pid:process.pid,
      task_description:'resume',work_dir:'.deep-work/s-bbbbbbbb',current_phase:'implement',file_ownership:[],last_activity:ROUTE_TIMESTAMP}}})}\n`);
  const state=platform.issueProjectStateCapability(root,statePath,{role:'session-state'});const sessionCap=platform.issueProjectStateCapability(root,
    work,{role:'session-work-dir',sessionStateCapability:state});const temp=await artifactRuntime.createOwnedTemp({sessionCapability:sessionCap,
    purpose:'receipt-payload'});await artifactRuntime.writeOwnedTemp({sessionCapability:sessionCap,operationId:temp.operationId,
      purpose:'receipt-payload'},Buffer.from('{"status":"authored","proof":"journal"}\n'));const argv=['session','finish','keep','--state',statePath,
    '--session',session,'--receipt-payload',temp.path];const publish=artifactRuntime.publishFinalizedReceipt;artifactRuntime.publishFinalizedReceipt=()=>{
      const error=new Error('lost-result-publication');error.code='lost-result-publication';throw error;};
  try{await assert.rejects(()=>dispatch(argv,{cwd:root}),/lost-result-publication/);}finally{artifactRuntime.publishFinalizedReceipt=publish;}
  fs.writeFileSync(temp.path,'foreign-after-consume\n');const result=await dispatch(argv,{cwd:root});const payload=JSON.parse(
    fs.readFileSync(result.resultPath,'utf8'));assert.equal(payload.proof,'journal');assert.equal(payload.finish_outcome,'keep');
});

test('all 85 grammar rows cross the parser and invoke their typed route semantics', async (t) => {
  assert.equal(DISPATCHER_GRAMMAR.length, 85);
  const outcomes = [];
  for (let index = 0; index < DISPATCHER_GRAMMAR.length; index += 1) {
    const entry = DISPATCHER_GRAMMAR[index];
    await t.test(entry.id, async () => {
      const fx = await semanticFixture(entry, index);
      const argv = await semanticArgv(entry, fx);
      assert.equal(parseDispatcher(argv).entry.id, entry.id);
      try {
        const value = await dispatch(argv, {cwd:fx.root,stdin:'semantic stdin'});
        assert.notEqual(value, undefined);
        outcomes.push({id:entry.id,status:'completed'});
      } catch (error) {
        assert.equal(typeof error.code, 'string', `${entry.id}: untyped error ${error.stack}`);
        assert.equal(error instanceof TypeError, false, `${entry.id}: ${error.stack}`);
        assert.equal(['ENOENT','ENOTDIR','EISDIR'].includes(error.code), false,
          `${entry.id}: stopped at an unprepared filesystem boundary: ${error.stack}`);
        outcomes.push({id:entry.id,status:'typed-rejection',code:error.code});
      } finally {
        fs.rmSync(fx.root, {recursive:true,force:true});
      }
    });
  }
  assert.deepEqual(outcomes.map((row) => row.id), DISPATCHER_GRAMMAR.map((entry) => entry.id));
  assert.equal(outcomes.length, 85);
});

test('CLI prints one JSON value and uses validation exit 1', () => {
  const cli = path.resolve(__dirname, 'deep-work-runtime.js');
  const good = spawnSync(process.execPath, [cli,'git','capability'], {encoding:'utf8'});
  assert.equal(good.status, 0, good.stderr);
  assert.doesNotThrow(() => JSON.parse(good.stdout));
  const bad = spawnSync(process.execPath, [cli,'unknown'], {encoding:'utf8'});
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
});
