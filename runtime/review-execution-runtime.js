'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const journal = require('./operation-journal.js');
const transaction = require('./transaction-runtime.js');
const platform = require('./platform.js');
const {runSupervisedProcess} = require('./process-supervisor.js');
const {validateReviewRequest, artifactSetDigest} = require('./review-envelope-runtime.js');
const {resolveModelCapability,matchesModelIdentity} = require('./model-capabilities.js');
const {buildToolIdentity} = require('./release-toolchain-runtime.js');

const KIND = 'review-execution-run-v1';
const DIGEST = /^[a-f0-9]{64}$/;
const CHANNELS = ['codex-cli', 'claude-cli', 'gemini-cli'];
const TIERS = ['light', 'standard', 'deep'];
const MAX_OUTPUT_BYTES = 1048576;
const MAX_RECORD_BYTES = 4 * MAX_OUTPUT_BYTES;
const canonical = journal.canonicalJson;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function digest(domain, value) { return hash(`${domain}\0${canonical(value)}`); }
function fail(code = 'review-execution', message = code) {
  const error = new Error(`[${code}] ${message}`); error.code = code; throw error;
}
function boundedString(value, max = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0\r\n]/u.test(value);
}
function portable(value) {
  return boundedString(value) && !path.isAbsolute(value) && !value.includes('\\') &&
    !value.split('/').some(part => part === '..' || part === '.' || !part);
}
function readRegular(state, relative, limit = MAX_RECORD_BYTES) {
  if (!portable(relative)) fail('review-execution-path');
  const target = path.join(state.projectRoot, ...relative.split('/'));
  platform.revalidatePathCapability(state,'review-execution-state');
  const root = fs.realpathSync(state.projectRoot);
  let component = root;
  for (const part of relative.split('/')) {
    component = path.join(component, part);
    if (fs.lstatSync(component).isSymbolicLink()) fail('review-execution-path');
  }
  if (fs.realpathSync(target) !== path.join(root, ...relative.split('/'))) fail('review-execution-path');
  let fd;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) fail('review-execution-file');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) fail('review-execution-file');
    return bytes;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function checkArtifacts(state, request) {
  for (const ref of request.artifact_refs) {
    if (hash(readRegular(state, ref.path)) !== ref.sha256) fail('review-execution-artifact');
  }
}
function raw(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  return {base64:value.toString('base64'), byte_length:value.length, sha256:hash(value)};
}
function decodeRaw(value, limit) {
  if (!value || typeof value.base64 !== 'string' || !Number.isSafeInteger(value.byte_length) ||
      value.byte_length < 0 || value.byte_length > limit) fail('review-execution-output');
  const bytes = Buffer.from(value.base64, 'base64');
  if (bytes.toString('base64') !== value.base64 || bytes.length !== value.byte_length ||
      hash(bytes) !== value.sha256) fail('review-execution-output');
  return bytes;
}

function parseReviewResponse(text) {
  if (typeof text !== 'string') return null;
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  try { return object(JSON.parse(text.trim())); } catch {}
  const blocks = [...text.matchAll(/^[ \t]{0,3}```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]{0,3}```[ \t]*$/gmi)];
  if (blocks.length !== 1) return null;
  let value; try { value = object(JSON.parse(blocks[0][1])); } catch { return null; }
  if (!value) return null;
  const outside = text.slice(0, blocks[0].index) + text.slice(blocks[0].index + blocks[0][0].length);
  const markers = [...outside.matchAll(/^\s*verdict\s*:\s*(PASS|FAIL|UNAVAILABLE)\s*$/gmi)];
  if (markers.some(row => row[1].toUpperCase() !== value.verdict)) return null;
  return value;
}

// Only transport-defined metadata fields establish identity. Assistant prose is
// parsed separately as review content and can never establish model/session.
function parseReviewOutput({channel, stdout} = {}) {
  const observation = {provider:'unknown', model:null, effort:null, session_id:null,
    terminal_success:false, identity_conflict:false, conclusions:[], response:null};
  const messages = [];
  let terminalError = false;
  function identity(field, value) {
    if (!boundedString(value)) return;
    if (observation[field] !== null && observation[field] !== value) observation.identity_conflict = true;
    else observation[field] = value;
  }
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    if (channel === 'codex-cli') {
      if (event.type === 'thread.started') {
        observation.provider = 'openai'; identity('session_id', event.thread_id);
        identity('model', event.model); identity('effort', event.reasoning_effort);
      }
      if (event.type === 'turn.completed') observation.terminal_success = true;
      if (event.type === 'turn.failed' || event.type === 'error') terminalError = true;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' &&
          typeof event.item.text === 'string') messages.push(event.item.text);
    } else if (channel === 'claude-cli') {
      if (event.type === 'system' && event.subtype === 'init') {
        observation.provider = 'anthropic'; identity('model', event.model); identity('session_id', event.session_id);
      }
      if (event.type === 'assistant') {
        identity('model', event.message?.model);
        for (const block of event.message?.content || []) if (block.type === 'text' && typeof block.text === 'string') messages.push(block.text);
      }
      if (event.type === 'result') {
        identity('session_id', event.session_id);
        observation.terminal_success = event.subtype === 'success' && event.is_error !== true;
        if(!observation.terminal_success)terminalError=true;
        messages.push(typeof event.result === 'string' ? event.result : '');
      }
    } else if (channel === 'gemini-cli') {
      if (event.type === 'init') {
        observation.provider = 'google'; identity('model', event.model); identity('session_id', event.session_id);
      }
      if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') messages.push(event.content);
      if (event.type === 'result') observation.terminal_success = event.status === 'success';
    }
  }
  // The final transport answer owns the verdict. Never salvage an earlier PASS
  // after an unavailable or ambiguous final answer.
  observation.response = parseReviewResponse(messages.at(-1));
  if (Array.isArray(observation.response?.conclusions)) observation.conclusions = observation.response.conclusions;
  if (observation.identity_conflict || terminalError) observation.terminal_success = false;
  return observation;
}

async function resolveReviewerCommand(reviewer, env, {readOnlyRefs=false} = {}) {
  let request;
  if (reviewer.channel === 'codex-cli') {
    const capability = resolveModelCapability({runtime:'codex', model:reviewer.model});
    if (capability.status !== 'recognized' || !capability.supported_efforts.includes(reviewer.effort))
      fail('review-execution-model', 'model or effort unverified');
    request = {package:'@openai/codex', bin:'codex', args:['exec','--disable','hooks','--disable','plugin_hooks','-c','plugins."deep-work@claude-deep-suite".enabled=false','--sandbox','read-only','--skip-git-repo-check','--json',
      '--model', reviewer.model, '-c', `model_reasoning_effort=${reviewer.effort}`, '-']};
  } else if (reviewer.channel === 'claude-cli') {
    if (resolveModelCapability({runtime:'claude', model:reviewer.model}).status !== 'recognized') fail('review-execution-model');
    request = {package:'@anthropic-ai/claude-code', bin:'claude', args:['-p', '--verbose', '--output-format',
      'stream-json', '--permission-mode', 'default', '--strict-mcp-config', '--setting-sources', '',
      '--tools', readOnlyRefs?'Read,Grep,Glob':'', ...(readOnlyRefs?['--allowedTools','Read,Grep,Glob']:[]), '--model', reviewer.model,
      ...(reviewer.effort?['--effort',reviewer.effort]:[])]};
  } else fail('review-execution-model', 'Gemini model/tier capability is unverified');
  if(reviewer.channel==='claude-cli'){try{return require('./reviewer-toolchain-runtime.js').resolveNativeClaude({home:os.homedir(),args:request.args});}
    catch(error){if(error.code!=='reviewer-native-unavailable')throw error;}}
  const toolchain = await platform.issueNodeToolchainCapability({nodeExecutable:process.execPath,
    home:os.homedir(), environment:env});
  return platform.resolveNodePackageBin(toolchain, request);
}
function validateReviewer(reviewer) {
  if (!reviewer || !CHANNELS.includes(reviewer.channel)) fail('review-execution-channel');
  if (!['structural','semantic','executability'].includes(reviewer.role) || !TIERS.includes(reviewer.tier) ||
      !boundedString(reviewer.model) || !/^[A-Za-z0-9._-]+$/u.test(reviewer.model) ||
      !(reviewer.effort === null || ['low','medium','high','xhigh','max','ultra'].includes(reviewer.effort))) fail('review-execution-reviewer');
}
function executionHash(value) { const copy = {...value}; delete copy.execution_sha256; return digest('review-execution-v1', copy); }
function terminalSuccess(processRecord, observation) {
  return processRecord.exit_code === 0 && processRecord.signal === null && processRecord.timed_out === false &&
    processRecord.output_overflow === false && processRecord.spawn_error === null && observation.terminal_success === true && (!Object.hasOwn(processRecord,'termination')||processRecord.termination?.confirmed===true);
}
function qualifies(value, observation) {
  const runtime = value.channel === 'codex-cli' ? 'codex' : value.channel === 'claude-cli' ? 'claude' : 'gemini';
  const capability = resolveModelCapability({runtime, model:observation.model});
  return value.evidence_kind === 'provider-cli' && value.terminal_success && value.fresh_session &&
    boundedString(observation.session_id) && observation.provider !== 'unknown' &&
    capability.status === 'recognized' && TIERS.indexOf(capability.nominal_tier) >= TIERS.indexOf(value.tier) &&
    matchesModelIdentity({runtime,requested:value.effective_model,observed:observation.model});
}

function validateBoundReviewPacket({stateCapability,binding,promptSha256,request,historical=false}) {
  const packet=binding?.review_packet;
  if(!packet){if(!historical&&binding?.authority==='global-goal-review-v1')fail('global-review-packet-required');if(!historical&&binding?.authority==='artifact-source-review-v1')fail('artifact-review-packet-required');return;}
  if(!packet||typeof packet!=='object'||Array.isArray(packet)||canonical(Object.keys(packet).sort())!==canonical(['schema_version','kind','packet_sha256','prompt_sha256'].sort())||packet.schema_version!==1||!['artifact-source-review','global-semantic-review'].includes(packet.kind)||!DIGEST.test(packet.packet_sha256||'')||!DIGEST.test(packet.prompt_sha256||'')||packet.prompt_sha256!==promptSha256)fail('review-packet-prompt');
  const runtime=packet.kind==='global-semantic-review'?require('./global-review-packet-runtime.js'):require('./artifact-approval-runtime.js');
  runtime.validateReviewPacketBinding({stateCapability,binding,promptSha256});
  if(packet.kind==='global-semantic-review'&&binding.review_artifact_refs.some(ref=>!request?.artifact_refs?.some(actual=>actual.path===ref.path&&actual.sha256===ref.sha256)))fail('review-packet-artifacts');
}

async function runReviewExecution({stateCapability, request, prompt, reviewer, binding,
  timeoutMs = 120000, maxOutputBytes = MAX_OUTPUT_BYTES, resolved, env = {...process.env}} = {}) {
  validateReviewer(reviewer);
  const checked = validateReviewRequest(request);
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) ||
      !DIGEST.test(binding.contract_sha256 || '') || !DIGEST.test(binding.policy_sha256 || '') ||
      Buffer.byteLength(canonical(binding)) > 65536) fail('review-execution-binding');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 900000 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || maxOutputBytes > MAX_OUTPUT_BYTES) fail('review-execution-budget');
  const promptBytes = Buffer.isBuffer(prompt) ? Buffer.from(prompt) : typeof prompt === 'string' ? Buffer.from(prompt) : null;
  if (!promptBytes || !promptBytes.length || promptBytes.length > MAX_OUTPUT_BYTES) fail('review-execution-prompt');
  validateBoundReviewPacket({stateCapability,binding,promptSha256:hash(promptBytes),request:checked});
  checkArtifacts(stateCapability, checked);
  // An injected executable is useful for deterministic process conformance, but
  // it is ALWAYS a labelled test double and cannot establish provider identity.
  const evidenceKind = resolved === undefined ? 'provider-cli' : 'test-double';
  const command = resolved || await resolveReviewerCommand(reviewer, env, {readOnlyRefs:Boolean(binding.review_packet)});
  if (!command || !path.isAbsolute(command.executable || '') || !Array.isArray(command.argv) ||
      command.argv.some(arg => typeof arg !== 'string' || arg.includes('\0'))) fail('review-execution-command');
  const identity = buildToolIdentity({name:'reviewer', targetPath:command.executable});
  const carriers=[];
  if(path.isAbsolute(command.argv[0]||'')){const carrierPath=fs.realpathSync(command.argv[0]);
    const stat=fs.lstatSync(carrierPath);if(!stat.isFile()||stat.size>16*MAX_OUTPUT_BYTES)fail('review-execution-carrier');
    carriers.push({path:carrierPath,sha256:hash(fs.readFileSync(carrierPath))});}
  const sessionId = transaction.sessionIdFromState(stateCapability);
  const project = transaction.projectCapabilityFor(stateCapability);
  const launchId = crypto.randomUUID();
  const traceStartedAt=reviewer.channel==='codex-cli'&&evidenceKind==='provider-cli'?new Date().toISOString():null;
  const preconditions = {track_descendants:true,...(traceStartedAt?{trace_launch_started_at:traceStartedAt}:{}),session_id:sessionId, request_sha256:checked.request_sha256,
    artifact_sha256:artifactSetDigest(checked.artifact_refs), prompt_sha256:hash(promptBytes),
    binding:structuredClone(binding), reviewer:structuredClone(reviewer), fresh_launch_id:launchId,
    command_sha256:digest('review-command-v1', {executable_identity:identity, argv:command.argv,command_carriers:carriers}),
    environment_sha256:digest('review-environment-v1', env), timeout_ms:timeoutMs,
    max_output_bytes:maxOutputBytes, evidence_kind:evidenceKind};
  const operationId = `op-${digest('review-execution-operation-v1', preconditions)}`;
  const operation = await journal.beginOperation({projectCapability:project, sessionId,
    kind:KIND, operationId, preconditions});
  let ran;
  try {
    ran = await runSupervisedProcess({executable:command.executable, args:command.argv},
      {cwd:stateCapability.projectRoot, env, input:promptBytes, timeoutMs, maxOutputBytes, rawOutput:true,trackDescendants:true});
  } catch (error) {
    ran = error.partialResult?{...error.partialResult,termination:error.termination||null}:{exitCode:null, signal:null, timedOut:false, outputOverflow:false, durationMs:0,
      stdout:Buffer.alloc(0), stderr:Buffer.alloc(0), spawnError:{code:error.code || 'spawn-failed', message_sha256:hash(String(error.message))}};
  }
  const processRecord = {exit_code:ran.exitCode ?? null, signal:ran.signal ?? null,
    timed_out:ran.timedOut === true, output_overflow:ran.outputOverflow === true,
    duration_ms:ran.durationMs || 0, spawn_error:ran.spawnError || null,termination:ran.termination||{confirmed:false,scope:'unavailable',descendant_discovery:'unknown',unobserved_descendants:'unknown'}};
  const stdout = raw(ran.stdout), stderr = raw(ran.stderr);
  let observation = parseReviewOutput({channel:reviewer.channel, stdout:Buffer.from(stdout.base64, 'base64').toString('utf8')});
  const traceFinishedAt=traceStartedAt?new Date().toISOString():null;let hostTrace=null;
  if(traceStartedAt){const traceRuntime=require('./codex-review-trace-runtime.js'),expected={sessionId:observation.session_id,cwd:stateCapability.projectRoot,startedAt:traceStartedAt,finishedAt:traceFinishedAt};hostTrace=traceRuntime.captureCodexReviewTrace(expected);observation=traceRuntime.enrichCodexObservation(observation,hostTrace,expected);}
  const duplicateSession = observation.session_id && journal.listCompletedOperations({projectCapability:project,
    sessionId, kind:KIND}).some(row => row.result?.channel === reviewer.channel && row.result?.observed_session_id === observation.session_id);
  const execution = {schema_version:1, authority:'review-execution-v1', session_id:sessionId,
    review_operation_id:operationId, preconditions, request:checked, request_sha256:checked.request_sha256,
    artifact_sha256:preconditions.artifact_sha256, prompt_sha256:preconditions.prompt_sha256,
    command_sha256:preconditions.command_sha256, executable_identity:identity, argv:[...command.argv],command_carriers:carriers,
    binding:structuredClone(binding), role:reviewer.role, tier:reviewer.tier, channel:reviewer.channel,
    identity_source:evidenceKind==='test-double'?'test-double-output':hostTrace?.status==='captured'?'host-session-trace':observation.model?'cli-output':'unavailable',served_model_attestation:null,
    requested_model:reviewer.model, effective_model:evidenceKind==='provider-cli'?reviewer.model:null, observed_model:observation.model,
    requested_effort:reviewer.effort, effective_effort:evidenceKind==='provider-cli' ? reviewer.effort : null,
    observed_effort:observation.effort, observed_provider:observation.provider,
    observed_session_id:observation.session_id, fresh_launch_id:launchId,
    fresh_session:!duplicateSession && Boolean(observation.session_id), evidence_kind:evidenceKind,
    timeout_ms:timeoutMs, max_output_bytes:maxOutputBytes, process:processRecord,
    ...(traceStartedAt?{host_trace:hostTrace,trace_launch_finished_at:traceFinishedAt}:{}),raw_stdout:stdout, raw_stderr:stderr, observation, terminal_success:terminalSuccess(processRecord, observation)};
  execution.qualifying_independent = qualifies(execution, observation);
  // Artifact drift during review invalidates success even when the CLI exits 0.
  try { checkArtifacts(stateCapability, checked);
    if(carriers.some(carrier=>hash(fs.readFileSync(carrier.path))!==carrier.sha256))fail('review-execution-carrier');
    if(canonical(buildToolIdentity({name:'reviewer',targetPath:command.executable}))!==canonical(identity))fail('review-execution-command-drift');
    execution.artifacts_unchanged = true; }
  catch { execution.artifacts_unchanged = false; execution.terminal_success = false; execution.qualifying_independent = false; }
  execution.execution_sha256 = executionHash(execution);
  await journal.recordOperationStage(operation, 'process-completed', {owned:{execution_sha256:execution.execution_sha256}});
  const relative = `.claude/deep-work.${sessionId}.review-execution.${operationId}.json`;
  const bytes = Buffer.from(canonical(execution));
  if (bytes.length > MAX_RECORD_BYTES) fail('review-execution-size');
  const capability = platform.issueProjectStateCapability(stateCapability.projectRoot,
    path.join(stateCapability.projectRoot, relative), {role:'operation-result',allowMissingLeaf:true});
  platform.revalidatePathCapability(capability, 'review-execution-write');
  const fd = fs.openSync(capability.path, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const ref = {path:relative, sha256:hash(bytes), producer_operation_id:operationId};
  await journal.recordOperationStage(operation, 'result-published', {owned:ref});
  const operationReceipt = await journal.completeOperation(operation, {ref, execution_sha256:execution.execution_sha256,
    preconditions_sha256:digest('review-execution-preconditions-v1', preconditions),
    observed_session_id:execution.observed_session_id, channel:execution.channel});
  return {ref, execution, operation_receipt:operationReceipt};
}

function authenticateReviewExecution({stateCapability, ref, expected = {}, requireSuccess = true} = {}) {
  if (!ref || !DIGEST.test(ref.sha256 || '') || !/^op-[a-f0-9]{64}$/u.test(ref.producer_operation_id || '')) fail();
  const bytes = readRegular(stateCapability, ref.path);
  if (hash(bytes) !== ref.sha256) fail();
  let value; try { value = JSON.parse(bytes); } catch { fail(); }
  const sessionId = transaction.sessionIdFromState(stateCapability);
  if (value.schema_version !== 1 || value.authority !== 'review-execution-v1' || value.session_id !== sessionId ||
      value.review_operation_id !== ref.producer_operation_id || value.execution_sha256 !== executionHash(value)) fail();
  validateReviewRequest(value.request); validateReviewer(value.preconditions?.reviewer);
  const pre = value.preconditions;
  if(pre.track_descendants!==undefined){if(pre.track_descendants!==true||!value.process?.termination||typeof value.process.termination.confirmed!=='boolean')fail('review-execution-termination');}
  else if(value.process?.termination!==undefined)fail('review-execution-termination');
  if (value.review_operation_id !== `op-${digest('review-execution-operation-v1', pre)}` || pre.session_id !== sessionId ||
      value.request_sha256 !== value.request.request_sha256 || pre.request_sha256 !== value.request_sha256 ||
      value.artifact_sha256 !== artifactSetDigest(value.request.artifact_refs) || pre.artifact_sha256 !== value.artifact_sha256 ||
      canonical(pre.binding) !== canonical(value.binding) || pre.prompt_sha256 !== value.prompt_sha256 ||
      pre.command_sha256 !== value.command_sha256 || value.command_sha256 !== digest('review-command-v1', {executable_identity:value.executable_identity, argv:value.argv,command_carriers:value.command_carriers}) ||
      pre.fresh_launch_id !== value.fresh_launch_id || pre.evidence_kind !== value.evidence_kind ||
      pre.timeout_ms !== value.timeout_ms || pre.max_output_bytes !== value.max_output_bytes) fail();
  for (const key of ['role','tier','channel']) if (value[key] !== pre.reviewer[key]) fail();
  if(value.effective_effort!==(value.evidence_kind==='provider-cli'?pre.reviewer.effort:null))fail();
  if (value.requested_model !== pre.reviewer.model || value.effective_model !== (value.evidence_kind==='provider-cli'?pre.reviewer.model:null) || value.requested_effort !== pre.reviewer.effort) fail();
  const stdout = decodeRaw(value.raw_stdout, value.max_output_bytes);
  decodeRaw(value.raw_stderr, value.max_output_bytes);
  let observation = parseReviewOutput({channel:value.channel, stdout:stdout.toString('utf8')});
  if(pre.trace_launch_started_at!==undefined){if(value.channel!=='codex-cli'||value.evidence_kind!=='provider-cli'||!value.host_trace)fail('review-execution-host-trace');observation=require('./codex-review-trace-runtime.js').enrichCodexObservation(observation,value.host_trace,{sessionId:observation.session_id,cwd:stateCapability.projectRoot,startedAt:pre.trace_launch_started_at,finishedAt:value.trace_launch_finished_at});}
  else if(value.host_trace!==undefined||value.trace_launch_finished_at!==undefined)fail('review-execution-host-trace');
  if(pre.track_descendants===true){const identitySource=value.evidence_kind==='test-double'?'test-double-output':value.host_trace?.status==='captured'?'host-session-trace':observation.model?'cli-output':'unavailable';if(value.identity_source!==identitySource||value.served_model_attestation!==null)fail('review-execution-identity-source');}
  if (canonical(observation) !== canonical(value.observation) || value.observed_model !== observation.model ||
      value.observed_provider !== observation.provider || value.observed_effort !== observation.effort ||
      value.observed_session_id !== observation.session_id ||
      value.terminal_success !== (terminalSuccess(value.process, observation) && value.artifacts_unchanged === true) ||
      value.qualifying_independent !== (qualifies(value, observation) && value.artifacts_unchanged === true)) fail();
  const completed = journal.lookupCompletedOperation({projectCapability:transaction.projectCapabilityFor(stateCapability),
    sessionId, kind:KIND, operationId:value.review_operation_id});
  const expectedResult = {ref, execution_sha256:value.execution_sha256,
    preconditions_sha256:digest('review-execution-preconditions-v1', pre), observed_session_id:value.observed_session_id, channel:value.channel};
  if (completed?.stage !== 'completed-ledger' || canonical(completed.result) !== canonical(expectedResult)) fail();
  for (const [key, wanted] of Object.entries(expected)) if (canonical(value[key]) !== canonical(wanted)) fail('review-execution-binding');
  if (requireSuccess && !value.terminal_success) fail('review-execution-unsuccessful');
  validateBoundReviewPacket({stateCapability,binding:value.binding,promptSha256:value.prompt_sha256,request:value.request,historical:true});
  checkArtifacts(stateCapability, value.request);
  return value;
}

function compactReviewExecutionResult(result){const e=result.execution||{},p=e.process||{};let diagnostic='',truncated=false;if(e.raw_stderr){const bytes=decodeRaw(e.raw_stderr,e.max_output_bytes||MAX_OUTPUT_BYTES);truncated=bytes.length>2048;diagnostic=require('./evidence-runtime.js').redactEvidenceText(bytes.subarray(0,2048).toString('utf8'),{home:os.homedir()}).text;}const termination=p.termination?{confirmed:p.termination.confirmed,scope:p.termination.scope,descendant_discovery:p.termination.descendant_discovery,unobserved_descendants:p.termination.unobserved_descendants}:undefined;return{ref:result.ref,operation_id:e.review_operation_id||result.ref?.producer_operation_id,execution:{terminal_success:e.terminal_success===true,qualifying_independent:e.qualifying_independent===true,requested_model:e.requested_model??null,effective_model:e.effective_model??null,observed_model:e.observed_model??null,requested_effort:e.requested_effort??null,effective_effort:e.effective_effort??null,observed_effort:e.observed_effort??null,identity_source:e.identity_source||'unavailable',observed_provider:e.observed_provider??null,identity_diagnostic:e.host_trace?.status==='unavailable'?e.host_trace.reason:null,served_model_attestation:e.served_model_attestation??null,role:e.role,tier:e.tier,channel:e.channel,observed_session_id:e.observed_session_id??null,evidence_kind:e.evidence_kind,process:{exit_code:p.exit_code??null,signal:p.signal??null,timed_out:p.timed_out===true,output_overflow:p.output_overflow===true,spawn_error:p.spawn_error||null,duration_ms:p.duration_ms??null,...(termination?{termination}:{})},observation:{response:e.observation?.response||null,conclusions:e.observation?.conclusions||[]},stderr_diagnostic:diagnostic,stderr_excerpted:truncated}};}

module.exports = {runReviewExecution, authenticateReviewExecution, parseReviewOutput, resolveReviewerCommand, validateBoundReviewPacket, compactReviewExecutionResult};
