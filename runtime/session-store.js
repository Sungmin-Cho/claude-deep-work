'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  resolveProjectRoot,
  issueProjectStateCapability,
  issueInitialWorktreeCapability,
  revalidatePathCapability,
  atomicWriteFile,
  withDirectoryLock,
} = require('./platform.js');
const { parseFrontmatter, updateFrontmatterText } = require('./frontmatter.js');
const { beginOperation, recordOperationStage, completeOperation, resumeOperation, canonicalJson, sha256 } = require('./operation-journal.js');
const transaction = require('./transaction-runtime.js');

const DEFAULT_SHARED_FILES = Object.freeze([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '*.config.js', '*.config.ts', 'tsconfig.json', '.gitignore',
]);
const LOCK_OPTIONS = Object.freeze({timeoutMs:10_000, staleMs:30_000, heartbeatMs:1_000,
  processIdentity:crypto.createHash('sha256').update(`session-store:${process.pid}`).digest('hex').slice(0,32)});
const SESSION_RE = /^s-[0-9a-f]{8}$/;
const NODE_AUTHORITY = Object.freeze({runtime:'node',shell:false,authority:'session-store-v1'});
const LOCK_WAIT_ARRAY=new Int32Array(new SharedArrayBuffer(4));
const ACTIVE_FINISH_CONTEXTS=new WeakMap();

function fail(code, message) {
  const error = new Error(`[${code}] ${message || code}`);
  error.code = code;
  throw error;
}

function requireSessionId(value) {
  if (!SESSION_RE.test(value || '')) fail('session-id', `invalid session ID: ${value}`);
  return value;
}

function withStableLock(lockCapability,callback){const deadline=Date.now()+LOCK_OPTIONS.timeoutMs;
  for(;;){let entered=false;try{const refreshed=issueProjectStateCapability(lockCapability.projectRoot,lockCapability.path,
      {allowMissingLeaf:true,role:'lock'});return withDirectoryLock(refreshed,LOCK_OPTIONS,()=>{entered=true;return callback();});}
    catch(error){if(entered||!['lock-ambiguous','lock-chain-invalid','ENOENT'].includes(error.code)||Date.now()>=deadline)throw error;
      Atomics.wait(LOCK_WAIT_ARRAY,0,0,2);}}}
function issueStableLockCapability(projectRoot,target){const deadline=Date.now()+LOCK_OPTIONS.timeoutMs;for(;;){try{
    return issueProjectStateCapability(projectRoot,target,{allowMissingLeaf:true,role:'lock'});}catch(error){
    if(error.code!=='ENOENT'||Date.now()>=deadline)throw error;Atomics.wait(LOCK_WAIT_ARRAY,0,0,2);}}}

function requireProject(projectCapability) {
  if (!projectCapability || projectCapability.kind !== 'project-state' ||
      projectCapability.role !== 'project-root') fail('session-project-capability');
  revalidatePathCapability(projectCapability, 'session-project');
  return projectCapability;
}

function capabilities(projectCapability) {
  const root = requireProject(projectCapability).path;
  const registryPath = path.join(root, '.claude', 'deep-work-sessions.json');
  const pointerPath = path.join(root, '.claude', 'deep-work-current-session');
  return {
    registry:issueProjectStateCapability(root, registryPath, {allowMissingLeaf:true, role:'registry'}),
    registryLock:issueStableLockCapability(root, `${registryPath}.lock`),
    pointer:issueProjectStateCapability(root, pointerPath, {allowMissingLeaf:true, role:'pointer'}),
    pointerLock:issueStableLockCapability(root, `${pointerPath}.lock`),
  };
}

function defaultRegistry() {
  return {version:1, shared_files:[...DEFAULT_SHARED_FILES], sessions:{}};
}

function validateRegistry(registry) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.shared_files) ||
      !registry.sessions || typeof registry.sessions !== 'object' || Array.isArray(registry.sessions)) {
    fail('registry-schema', 'session registry must use version 1 schema');
  }
  for (const [sessionId, session] of Object.entries(registry.sessions)) {
    requireSessionId(sessionId);
    if (!session || typeof session !== 'object' || !Array.isArray(session.file_ownership || [])) {
      fail('registry-schema', `invalid registry session: ${sessionId}`);
    }
  }
  return registry;
}

function readRegistryUnlocked(registryCapability) {
  revalidatePathCapability(registryCapability, 'registry-read');
  try { return validateRegistry(JSON.parse(fs.readFileSync(registryCapability.path, 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return defaultRegistry();
    if (error instanceof SyntaxError) fail('registry-json', 'registry is not valid JSON');
    throw error;
  }
}

function readRegistry(projectCapability) {
  const caps = capabilities(projectCapability);
  return withStableLock(caps.registryLock, () => {
    const registryCapability=issueProjectStateCapability(projectCapability.path,caps.registry.path,{allowMissingLeaf:true,role:'registry'});
    const registry = readRegistryUnlocked(registryCapability);
    if (!fs.existsSync(registryCapability.path)) atomicWriteFile(registryCapability, `${JSON.stringify(registry)}\n`);
    return structuredClone(registry);
  });
}

function mutateRegistry(projectCapability, context, transform) {
  if (typeof transform !== 'function') fail('registry-transform');
  const caps = capabilities(projectCapability);
  return withStableLock(caps.registryLock, () => {
    if(context?.afterLock){if(typeof context.afterLock!=='function')fail('registry-seam');context.afterLock();}
    const registryCapability=issueProjectStateCapability(projectCapability.path,caps.registry.path,{allowMissingLeaf:true,role:'registry'});
    const current = readRegistryUnlocked(registryCapability);
    if (context && context.pointerBefore !== undefined && readPointer(projectCapability) !== context.pointerBefore) {
      fail('registry-pointer-drift', 'session pointer changed before registry mutation');
    }
    const next = transform(structuredClone(current));
    validateRegistry(next);
    if (context && context.pointerBefore !== undefined && readPointer(projectCapability) !== context.pointerBefore) {
      fail('registry-pointer-drift', 'session pointer changed during registry mutation');
    }
    atomicWriteFile(registryCapability, `${JSON.stringify(next)}\n`);
    return structuredClone(next);
  });
}

function generateSessionId() { return `s-${crypto.randomBytes(4).toString('hex')}`; }

function initializeSession({task,flags={},profile={}}={}) {
  if(typeof task!=='string'||!task.trim()||!flags||typeof flags!=='object'||Array.isArray(flags)||
      !profile||typeof profile!=='object'||Array.isArray(profile))fail('session-initialize-input');
  const mode=flags.repositoryMode||profile.repositoryMode||'current-branch';
  if(!['worktree','new-branch','current-branch'].includes(mode))fail('session-repository-mode');
  return {sessionId:generateSessionId(),task:task.trim(),mode,
    defaults:structuredClone(profile.defaults||{}),flags:structuredClone(flags),profile:structuredClone(profile)};
}

function buildSessionState({sessionId,task,defaults={},profile={},repositoryContext}={}) {
  requireSessionId(sessionId);if(typeof task!=='string'||!task.trim()||!repositoryContext)fail('session-state-input');
  const workDir=`.deep-work/${sessionId}`;const repositoryMode=repositoryContext.repositoryMode;
  if(!['worktree','new-branch','current-branch','fork'].includes(repositoryMode))fail('session-repository-context');
  const worktreeEnabled=repositoryMode==='worktree'||repositoryMode==='fork';
  if(worktreeEnabled&&(typeof repositoryContext.worktreePath!=='string'||!path.isAbsolute(repositoryContext.worktreePath)))
    fail('session-worktree-context');
  return {schema_version:2,session_id:sessionId,task_description:task.trim(),created_by_version:'6.13.0',
    current_phase:'brainstorm',subphase:null,spec_policy_required:null,spec_completed_at:null,
    spec_approved_hash:null,spec_contract_json:null,spec_gate_result_json:null,
    verification_plan_json:null,verification_plan_sha256:null,plan_spec_gate_result_json:null,
    work_dir:workDir,repository_mode:repositoryMode,worktree_enabled:worktreeEnabled,
    worktree_path:worktreeEnabled?repositoryContext.worktreePath:null,
    branch:repositoryContext.branch||null,head_oid:repositoryContext.headOid||null,
    execution_override:null,tdd_state:'PENDING',defaults_json:JSON.stringify(defaults),
    profile_json:JSON.stringify(profile)};
}

function readPointer(projectCapability) {
  const pointer = capabilities(projectCapability).pointer;
  revalidatePathCapability(pointer, 'pointer-read');
  try {
    const value = fs.readFileSync(pointer.path, 'utf8').trim();
    return value ? requireSessionId(value) : null;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function readPointerUnlocked(pointerCapability) {
  revalidatePathCapability(pointerCapability, 'pointer-read-locked');
  try {
    const value = fs.readFileSync(pointerCapability.path, 'utf8').trim();
    return value ? requireSessionId(value) : null;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function writePointer(projectCapability, sessionId) {
  requireSessionId(sessionId);
  const caps = capabilities(projectCapability);
  return withStableLock(caps.pointerLock, () => {
    const pointer=issueProjectStateCapability(projectCapability.path,caps.pointer.path,{allowMissingLeaf:true,role:'pointer'});
    atomicWriteFile(pointer, `${sessionId}\n`);
    return sessionId;
  });
}

async function selectSessionPointer({projectCapability,sessionId,stateCapability}={}) {
  requireSessionId(sessionId);
  if (!stateCapability) {
    const target=path.join(requireProject(projectCapability).path,'.claude',`deep-work.${sessionId}.md`);
    stateCapability=issueProjectStateCapability(projectCapability.path,target,{role:'session-state'});
  }
  requireProject(projectCapability);if(stateCapability.projectRoot!==projectCapability.path)fail('registry-session-state-mismatch');
  const caps=capabilities(projectCapability);return transaction.withRankedLocks([
    {rank:transaction.RANKS.pointer,capability:caps.pointerLock},
    {rank:transaction.RANKS.registry,capability:caps.registryLock},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}],()=>{
    const registryCapability=issueProjectStateCapability(projectCapability.path,caps.registry.path,{allowMissingLeaf:true,role:'registry'});
    const pointerCapability=issueProjectStateCapability(projectCapability.path,caps.pointer.path,{allowMissingLeaf:true,role:'pointer'});
    const fields=sessionFromState(stateCapability,sessionId);const row=readRegistryUnlocked(registryCapability).sessions[sessionId];
    if(!row)fail('registry-session-missing');if(fields.work_dir&&row.work_dir&&fields.work_dir!==row.work_dir)
      fail('registry-worktree-mismatch');if(fields.current_phase==='idle'||row.current_phase==='idle')fail('session-pointer-idle');
    atomicWriteFile(pointerCapability,`${sessionId}\n`);return sessionId;
  });
}

function resolveSessionContext({cwd, env = process.env, sessionId} = {}) {
  const projectRoot = resolveProjectRoot(cwd || process.cwd());
  const projectCapability = issueProjectStateCapability(projectRoot, projectRoot, {role:'project-root'});
  const selected = sessionId || env.DEEP_WORK_SESSION_ID || readPointer(projectCapability);
  if (selected) {
    requireSessionId(selected);
    const statePath = path.join(projectRoot, '.claude', `deep-work.${selected}.md`);
    const stateCapability = issueProjectStateCapability(projectRoot, statePath,
      {allowMissingLeaf:true, role:'session-state'});
    return {projectRoot, sessionId:selected, stateCapability, legacy:false};
  }
  const legacyPath = path.join(projectRoot, '.claude', 'deep-work.local.md');
  const stateCapability = issueProjectStateCapability(projectRoot, legacyPath,
    {allowMissingLeaf:true, role:'state'});
  return {projectRoot, sessionId:null, stateCapability, legacy:true};
}

function registerSession(projectCapability, {sessionId, pid = process.pid, taskDescription = '', workDir,
  currentPhase = 'plan', extra = {}}) {
  requireSessionId(sessionId);
  if (!Number.isSafeInteger(pid) || pid <= 0) fail('registry-pid');
  if (typeof workDir !== 'string' || !workDir) fail('registry-work-dir');
  return mutateRegistry(projectCapability, null, (registry) => {
    if (registry.sessions[sessionId]) fail('registry-session-exists');
    registry.sessions[sessionId] = {pid, task_description:taskDescription, work_dir:workDir,
      current_phase:currentPhase, file_ownership:[], last_activity:new Date().toISOString(), ...extra};
    return registry;
  });
}

function unregisterSession(projectCapability, sessionId) {
  requireSessionId(sessionId);
  return mutateRegistry(projectCapability, null, (registry) => {
    delete registry.sessions[sessionId];
    return registry;
  });
}

function globMatch(pattern, candidate) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*');
  return new RegExp(`^${escaped}$`).test(candidate);
}

function sessionFromState(stateCapability, sessionId) {
  if (!stateCapability || stateCapability.role !== 'session-state' ||
      stateCapability.projectRoot === undefined) fail('registry-state-capability');
  revalidatePathCapability(stateCapability, 'registry-state');
  if (!stateCapability.path.endsWith(`deep-work.${sessionId}.md`)) fail('registry-session-state-mismatch');
  const fields = parseFrontmatter(fs.readFileSync(stateCapability.path, 'utf8')).fields;
  if (fields.session_id !== undefined && fields.session_id !== sessionId) fail('registry-session-state-mismatch');
  return fields;
}

function validateExplicitTuple({sessionId, stateCapability}) {
  requireSessionId(sessionId);
  const fields = sessionFromState(stateCapability, sessionId);
  const projectCapability = issueProjectStateCapability(stateCapability.projectRoot,
    stateCapability.projectRoot, {role:'project-root'});
  const registry = readRegistry(projectCapability);
  const row = registry.sessions[sessionId];
  if (!row) fail('registry-session-missing');
  if (fields.work_dir && row.work_dir && fields.work_dir !== row.work_dir) {
    fail('registry-worktree-mismatch');
  }
  return {projectCapability, fields, row};
}

function checkFileOwnership({sessionId, stateCapability, pathCapability, portablePath} = {}) {
  if (pathCapability) revalidatePathCapability(pathCapability, 'registry-ownership-path');
  const {projectCapability} = validateExplicitTuple({sessionId,stateCapability});
  if (typeof portablePath !== 'string' || !portablePath || portablePath.startsWith('/') ||
      portablePath.includes('..') || portablePath.includes('\\')) fail('registry-portable-path');
  const registry = readRegistry(projectCapability);
  if (registry.shared_files.some((pattern) => globMatch(pattern, portablePath))) {
    return {allowed:true, shared:true};
  }
  for (const [owner, entry] of Object.entries(registry.sessions)) {
    if (owner === sessionId) continue;
    if ((entry.file_ownership || []).some((pattern) => globMatch(pattern, portablePath))) {
      return {allowed:false, owner, taskDescription:entry.task_description || ''};
    }
  }
  return {allowed:true, shared:false};
}

function promotedOwnership(current, portablePath) {
  if (current.some((pattern) => globMatch(pattern, portablePath))) return [...current];
  const next = [...current, portablePath];
  const directory = path.posix.dirname(portablePath);
  const direct = next.filter((entry) => path.posix.dirname(entry) === directory && !entry.includes('*'));
  if (direct.length >= 3) {
    const glob = `${directory}/**`;
    return [...next.filter((entry) => !direct.includes(entry)), glob]
      .sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)));
  }
  return next.sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)));
}

async function journaledRegistryMutation(kind,{sessionId,stateCapability,pathCapability},binding,transform,seam) {
  requireSessionId(sessionId);if(typeof transform!=='function')fail('registry-transform');const projectCapability=
    issueProjectStateCapability(stateCapability.projectRoot,stateCapability.projectRoot,{role:'project-root'});const caps=capabilities(projectCapability);
  const pointerBefore=readPointer(projectCapability);seam?.('after-pointer-snapshot',{kind,binding,pointerBefore});const root=projectCapability.path;
  const sessionLock=issueProjectStateCapability(root,path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),
    {allowMissingLeaf:true,role:'lock'});const journalLock=issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'});
  return transaction.withRankedLocks([{rank:transaction.RANKS.session,capability:sessionLock},
    {rank:transaction.RANKS.journal,capability:journalLock},{rank:transaction.RANKS.pointer,capability:caps.pointerLock},
    {rank:transaction.RANKS.registry,capability:caps.registryLock},{rank:transaction.RANKS.state,
      capability:transaction.stateLock(stateCapability)}],async()=>{const pointerCapability=issueProjectStateCapability(root,caps.pointer.path,
      {allowMissingLeaf:true,role:'pointer'});if(readPointerUnlocked(pointerCapability)!==pointerBefore)fail('registry-pointer-drift');
    if(pathCapability)revalidatePathCapability(pathCapability,'registry-mutation-path');const fields=sessionFromState(stateCapability,sessionId);
    const registryCapability=issueProjectStateCapability(root,caps.registry.path,{allowMissingLeaf:true,role:'registry'});
    const current=readRegistryUnlocked(registryCapability);const row=current.sessions[sessionId];if(!row)fail('registry-session-missing');
    if(fields.work_dir&&row.work_dir&&fields.work_dir!==row.work_dir)fail('registry-worktree-mismatch');const operation=
      await beginOperation({projectCapability,sessionId,kind,preconditions:binding});const next=transform(structuredClone(current));
    validateRegistry(next);if(readPointerUnlocked(pointerCapability)!==pointerBefore)fail('registry-pointer-drift');
    if(canonicalJson(current)!==canonicalJson(next)){atomicWriteFile(registryCapability,`${JSON.stringify(next)}\n`);
      seam?.('after-registry-write-before-stage',{kind,binding});}
    await recordOperationStage(operation,'registry-written',{owned:binding});await completeOperation(operation,
      {status:'completed',binding});return structuredClone(next);});
}

async function registerFileOwnership({sessionId,stateCapability,pathCapability,portablePath,seam}) {
  if (pathCapability) revalidatePathCapability(pathCapability, 'registry-own-path');
  return journaledRegistryMutation('registry-own',{sessionId,stateCapability,pathCapability},{sessionId,portablePath}, (registry) => {
    const row = registry.sessions[sessionId];
    row.file_ownership = promotedOwnership(row.file_ownership || [], portablePath);
    return registry;
  },seam);
}

async function updateLastActivity({sessionId,stateCapability,at = new Date().toISOString(),seam}) {
  if (!Number.isFinite(Date.parse(at))) fail('registry-timestamp');
  return journaledRegistryMutation('registry-touch',{sessionId,stateCapability},{sessionId,at}, (registry) => {
    registry.sessions[sessionId].last_activity = at;
    return registry;
  },seam);
}

async function updateRegistryPhase({sessionId,stateCapability,phase,at = new Date().toISOString(),seam}) {
  if (!['brainstorm','research','plan','implement','test','idle'].includes(phase)) fail('registry-phase');
  if (!Number.isFinite(Date.parse(at))) fail('registry-timestamp');
  return journaledRegistryMutation('registry-phase',{sessionId,stateCapability},{sessionId,phase,at}, (registry) => {
    registry.sessions[sessionId].current_phase = phase;
    registry.sessions[sessionId].last_activity = at;
    return registry;
  },seam);
}

function detectStaleSessions(registry, {now = Date.now(), staleMs = 24 * 60 * 60 * 1000,
  kill = process.kill} = {}) {
  validateRegistry(registry);
  const result = [];
  for (const [sessionId, entry] of Object.entries(registry.sessions)) {
    let alive = false;
    if (Number.isSafeInteger(entry.pid) && entry.pid > 0) {
      try { kill(entry.pid, 0); alive = true; }
      catch (error) { if (error.code === 'EPERM') alive = true; else if (error.code !== 'ESRCH') throw error; }
    }
    const last = Date.parse(entry.last_activity || '1970-01-01T00:00:00Z');
    if (!alive && now - last > staleMs) result.push({sessionId,pid:entry.pid || null,lastActivity:entry.last_activity || null});
  }
  return result.sort((a,b) => Buffer.compare(Buffer.from(a.sessionId),Buffer.from(b.sessionId)));
}

function validateForkTarget(registry, sessionId) {
  requireSessionId(sessionId);
  const entry = validateRegistry(registry).sessions[sessionId];
  if (!entry) fail('fork-parent-missing');
  if (entry.current_phase === 'idle') fail('fork-parent-idle');
  return structuredClone(entry);
}

function getForkGeneration(registry, sessionId) {
  const entry = validateForkTarget(registry, sessionId);
  return Number.isSafeInteger(entry.fork_generation) ? entry.fork_generation : 0;
}

function migrateLegacyState(projectCapability) {
  const root = requireProject(projectCapability).path;
  const legacy = path.join(root,'.claude','deep-work.local.md');
  if (!fs.existsSync(legacy)) return null;
  const text = fs.readFileSync(legacy,'utf8');
  const parsed = parseFrontmatter(text);
  if (parsed.fields.current_phase === 'idle') return null;
  const sessionId = generateSessionId();
  const output = path.join(root,'.claude',`deep-work.${sessionId}.md`);
  const next=text.replace(/^---\n/u, `---\nsession_id: ${sessionId}\n`);
  atomicWriteFile(issueProjectStateCapability(root,output,{allowMissingLeaf:true,role:'session-state'}),next);
  const fields=parseFrontmatter(next).fields;const workDir=fields.work_dir||`.deep-work/${sessionId}`;
  registerSession(projectCapability,{sessionId,taskDescription:fields.task_description||'',workDir,
    currentPhase:fields.current_phase||'plan'});
  revalidatePathCapability(issueProjectStateCapability(root,legacy,{role:'state'}),'legacy-state-remove');
  fs.unlinkSync(legacy);
  return sessionId;
}

async function migrateKnownSessionSchema({stateCapability,sessionId,_locksHeld=false}={}) {
  requireSessionId(sessionId);
  if(!_locksHeld)return transaction.withRankedLocks([{rank:transaction.RANKS.state,
    capability:transaction.stateLock(stateCapability)}],()=>migrateKnownSessionSchema({stateCapability,sessionId,_locksHeld:true}));
  revalidatePathCapability(stateCapability,'session-schema-state');
  if (!stateCapability.path.endsWith(`deep-work.${sessionId}.md`)) fail('session-schema-identity');
  const text=fs.readFileSync(stateCapability.path,'utf8');
  const fields=parseFrontmatter(text).fields;
  const version=fields.schema_version===undefined?1:Number(fields.schema_version);
  if (![1,2].includes(version)) fail('session-schema-unknown');
  const patch={};if(version!==2)patch.schema_version=2;if(fields.session_id!==sessionId)patch.session_id=sessionId;
  if(fields.phase_review===undefined)patch.phase_review='{}';
  for(const key of ['created_by_version','subphase','spec_policy_required','spec_completed_at','spec_approved_hash',
    'spec_contract_json','spec_gate_result_json','verification_plan_json','verification_plan_sha256',
    'plan_spec_gate_result_json'])if(fields[key]===undefined)patch[key]=null;
  const changedKeys=Object.keys(patch).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  if(!changedKeys.length)return {status:'current',schemaVersion:2,changedKeys:[]};
  atomicWriteFile(stateCapability,updateFrontmatterText(text,patch));
  return {status:'migrated',from:version,to:2,changedKeys};
}

async function recoverSessionWorktree({stateCapability,sessionId,_locksHeld=false}={}) {
  requireSessionId(sessionId);const root=stateCapability?.projectRoot;if(!_locksHeld){return transaction.withRankedLocks([{rank:transaction.RANKS.repository,
        capability:issueProjectStateCapability(root,path.join(root,'.claude','deep-work.git.lock'),{allowMissingLeaf:true,role:'lock'})},
      {rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,path.join(root,'.claude',
        `deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},{rank:transaction.RANKS.state,
        capability:transaction.stateLock(stateCapability)}],()=>recoverSessionWorktree({stateCapability,sessionId,_locksHeld:true}));}
  const fields=sessionFromState(stateCapability,sessionId);const projectCapability=issueProjectStateCapability(root,root,{role:'project-root'});
  if(fields.worktree_enabled===false)return{sessionId,restored:false,worktreePath:projectCapability.path,branch:fields.branch||null,
    headOid:fields.head_oid||null,status:'already-current',projectCapability};const recorded=fields.worktree_path;
  if (typeof recorded!=='string'||!recorded) fail('recovery-worktree-missing');const resolved=path.resolve(projectCapability.path,recorded);
  let capability;if(fields.parent_branch)capability=require('./git-runtime.js').resolveForkWorktreeCapability({projectCapability,
    stateCapability,sessionId,comparisonPath:resolved});else capability=issueInitialWorktreeCapability({projectRoot:root,candidate:resolved,
    sessionId,branch:fields.branch,baseRef:fields.head_oid||'HEAD',allowMissingLeaf:true});let stat;
  try{stat=fs.lstatSync(resolved);}catch(error){if(error.code!=='ENOENT')throw error;
    const text=fs.readFileSync(stateCapability.path,'utf8');
    if(fields.worktree_enabled!==false)atomicWriteFile(stateCapability,updateFrontmatterText(text,{worktree_enabled:false}));
    return {sessionId,restored:false,worktreePath:projectCapability.path,branch:fields.branch||null,
      headOid:fields.head_oid||null,status:'disabled-missing',projectCapability};}
  if(!stat.isDirectory()||stat.isSymbolicLink())fail('recovery-worktree-unsafe');revalidatePathCapability(capability,'recovery-worktree');
  return {sessionId,worktreePath:capability.path,branch:capability.branch,headOid:fields.head_oid||null,status:'recovered',restored:true,
    worktreeCapability:capability};
}

function registerForkSession(projectCapability,{sessionId,parentSessionId,pid=process.pid,taskDescription='',
  workDir,currentPhase='plan',forkGeneration}={}) {
  requireSessionId(parentSessionId);
  const registry=readRegistry(projectCapability);const parent=validateForkTarget(registry,parentSessionId);
  const generation=forkGeneration===undefined?getForkGeneration(registry,parentSessionId)+1:forkGeneration;
  if (!Number.isSafeInteger(generation)||generation<1||generation>32) fail('fork-generation');
  return registerSession(projectCapability,{sessionId,pid,taskDescription,workDir,currentPhase,
    extra:{fork_parent:parentSessionId,fork_generation:generation,parent_branch:parent.branch||null}});
}

function removeSessionOwnership(projectCapability,{sessionId}={}) {
  requireSessionId(sessionId);
  return mutateRegistry(projectCapability,null,(registry)=>{
    const row=registry.sessions[sessionId];if(!row)fail('registry-session-missing');
    row.file_ownership=[];return registry;
  });
}

async function finalizeSession({sessionId,stateCapability,finishedAt=new Date().toISOString()}={}) {
  requireSessionId(sessionId);if(!Number.isFinite(Date.parse(finishedAt)))fail('session-finalize-time');
  if(!stateCapability||stateCapability.role!=='session-state'||!stateCapability.path.endsWith(`deep-work.${sessionId}.md`))
    fail('session-finalize-state');const projectCapability=transaction.projectCapabilityFor(stateCapability);const root=projectCapability.path;
  const caps=capabilities(projectCapability);const prefix=[{rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,
      path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})}];
  return transaction.withRankedLocks(prefix,()=>transaction.withRankedLocks([
    {rank:transaction.RANKS.pointer,capability:caps.pointerLock},{rank:transaction.RANKS.registry,capability:caps.registryLock},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}],async()=>{const operation=await beginOperation({
      projectCapability,sessionId,kind:'session-finalize',preconditions:{finishedAt,statePath:stateCapability.path}});let pending=
      await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'session-finalize'});let text=
      fs.readFileSync(stateCapability.path,'utf8');let fields=parseFrontmatter(text).fields;const stateStage=pending.stages?.find(
      (stage)=>stage.stage==='state-written');if(fields.current_phase==='idle'){
      if(fields.finished_at!==finishedAt&&!stateStage)fail('session-finalize-state-foreign');}
    else{atomicWriteFile(stateCapability,updateFrontmatterText(text,{current_phase:'idle',finished_at:finishedAt}));}
    await recordOperationStage(operation,'state-written',{owned:{statePath:stateCapability.path,finishedAt}});let registry=
      readRegistryUnlocked(caps.registry);const row=registry.sessions[sessionId];if(row){delete registry.sessions[sessionId];
      atomicWriteFile(caps.registry,`${JSON.stringify(registry)}\n`);}else if(!stateStage&&!pending.stages?.some((stage)=>stage.stage==='registry-written'))
      fail('registry-session-missing');await recordOperationStage(operation,'registry-written',{owned:{sessionId}});pending=
      await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'session-finalize'});
    if(!pending.stages?.some((stage)=>stage.stage==='pointer-cleared')){const pointer=readPointerUnlocked(caps.pointer);let cleared=false;
      if(pointer===sessionId){revalidatePathCapability(caps.pointer,'session-finalize-pointer');fs.unlinkSync(caps.pointer.path);cleared=true;}
      const refreshed=issueProjectStateCapability(root,caps.pointer.path,{allowMissingLeaf:true,role:'pointer'});
      await recordOperationStage(operation,'pointer-cleared',{owned:{sessionId,cleared,pointerAfter:readPointerUnlocked(refreshed)}});}
    return completeOperation(operation,{status:'finalized',sessionId,finishedAt});}));
}

async function withFinishTransaction({sessionId,stateCapability,outcome},callback){requireSessionId(sessionId);
  if(!['merge','publish-pr','keep','discard'].includes(outcome)||!stateCapability||stateCapability.role!=='session-state'||
      !stateCapability.path.endsWith(`deep-work.${sessionId}.md`)||typeof callback!=='function')fail('finish-operation');
  const projectCapability=transaction.projectCapabilityFor(stateCapability);const root=projectCapability.path;const caps=capabilities(projectCapability);
  const locks=[...(outcome==='keep'?[]:[{rank:transaction.RANKS.repository,capability:issueProjectStateCapability(root,
      path.join(root,'.claude','deep-work.git.lock'),{allowMissingLeaf:true,role:'lock'})}]),
    {rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.pointer,capability:caps.pointerLock},{rank:transaction.RANKS.registry,capability:caps.registryLock},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)},
    {rank:transaction.RANKS.target,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.finish-target.lock`),{allowMissingLeaf:true,role:'lock'})}];
  return transaction.withRankedLocks(locks,async()=>{const finishContext=Object.freeze({kind:'finish-context'});
    const binding={sessionId,statePath:stateCapability.path,outcome,projectCapability,caps,active:true};
    ACTIVE_FINISH_CONTEXTS.set(finishContext,binding);try{return await callback({projectCapability,caps,finishContext});}
    finally{binding.active=false;}});}

function validateActiveFinishContext(finishContext,{sessionId,stateCapability,outcome}={}){const binding=ACTIVE_FINISH_CONTEXTS.get(finishContext);
  if(!binding||!binding.active||binding.sessionId!==sessionId||binding.statePath!==stateCapability?.path||binding.outcome!==outcome)
    fail('finish-context-invalid');return Object.freeze({...binding});}

async function finalizeWithinFinishOperation({operation,sessionId,stateCapability,outcome,seam,locksHeld=false,caps}={}){
  requireSessionId(sessionId);if(!operation||operation.sessionId!==sessionId||
      operation.kind!==`finish-${outcome}`||!['merge','publish-pr','keep','discard'].includes(outcome))fail('finish-operation');
  if(!locksHeld)return withFinishTransaction({sessionId,stateCapability,outcome},({caps:held})=>finalizeWithinFinishOperation({operation,
    sessionId,stateCapability,outcome,seam,locksHeld:true,caps:held}));let fields=sessionFromState(stateCapability,sessionId);
  const projectCapability=transaction.projectCapabilityFor(stateCapability);const registry=readRegistryUnlocked(caps.registry);
  const owned=fields.finish_operation_id===operation.operationId&&
    fields.finish_outcome===outcome&&fields.current_phase==='idle'&&typeof fields.finished_at==='string';
  if(!registry.sessions[sessionId]&&!owned)fail('registry-session-missing');
  let finishedAt=owned?fields.finished_at:new Date().toISOString();
  if(!owned){if(fields.current_phase==='idle')fail('finish-state-foreign');if(seam)seam('before-state-write',
      {operationId:operation.operationId,outcome});const text=fs.readFileSync(stateCapability.path,'utf8');
    atomicWriteFile(stateCapability,updateFrontmatterText(text,{current_phase:'idle',finished_at:finishedAt,
      finish_operation_id:operation.operationId,finish_outcome:outcome}));
    if(seam)seam('after-state-write-before-stage',{operationId:operation.operationId,outcome});}
  await recordOperationStage(operation,'state-written',{owned:{statePath:stateCapability.path,sessionId,
    outcome,finishedAt,finishOperationId:operation.operationId}});
  const current=readRegistryUnlocked(caps.registry);if(current.sessions[sessionId]){delete current.sessions[sessionId];
    atomicWriteFile(caps.registry,`${JSON.stringify(current)}\n`);}
  else{fields=sessionFromState(issueProjectStateCapability(stateCapability.projectRoot,stateCapability.path,
      {role:'session-state'}),sessionId);if(fields.finish_operation_id!==operation.operationId)fail('finish-registry-adoption');}
  if(seam)seam('after-registry-write-before-stage',{operationId:operation.operationId,outcome});
  await recordOperationStage(operation,'registry-written',{owned:{sessionId,outcome,
    finishOperationId:operation.operationId}});let pending=await resumeOperation({projectCapability,operationId:operation.operationId,
      sessionId,kind:`finish-${outcome}`});if(!pending.stages?.some((stage)=>stage.stage==='pointer-cleared')){
    const pointer=readPointerUnlocked(caps.pointer);let cleared=false;if(pointer===sessionId){revalidatePathCapability(caps.pointer,
        'finish-pointer');fs.unlinkSync(caps.pointer.path);cleared=true;}const refreshed=issueProjectStateCapability(stateCapability.projectRoot,
      caps.pointer.path,{allowMissingLeaf:true,role:'pointer'});await recordOperationStage(operation,'pointer-cleared',{owned:{sessionId,
        cleared,pointerAfter:readPointerUnlocked(refreshed)}});}
  return{sessionId,outcome,finishedAt};
}

function parseStoredObject(value){if(value&&typeof value==='object'&&!Array.isArray(value))return structuredClone(value);
  if(typeof value==='string'){try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;}catch{}}
  return{};}
function forkArtifactPhase(name){if(name==='brainstorm.md')return'brainstorm';if(/^research(?:-[A-Za-z0-9-]+)?\.md$/.test(name))return'research';
  if(/^plan(?:-diff|-v\d+)?\.md$/.test(name))return'plan';if(['cross-slice-review.md','solid-review.md','insight-report.md',
    'drift-report.md','fidelity-score.json','debug-root-cause.md'].includes(name))return'implement';
  if(['test-results.md','quality-gates.md'].includes(name))return'test';return null;}
function publishForkArtifacts({parentFields,childStateCapability,fromPhase}){const order=['brainstorm','research','plan','implement','test'];
  const boundary=order.indexOf(fromPhase);const parentWork=typeof parentFields.work_dir==='string'?path.join(childStateCapability.projectRoot,
    ...parentFields.work_dir.split('/')):null;const childFields=parseFrontmatter(fs.readFileSync(childStateCapability.path,'utf8')).fields;
  const childWork=path.join(childStateCapability.projectRoot,...childFields.work_dir.split('/'));fs.mkdirSync(childWork,{recursive:true});
  const sessionCapability=issueProjectStateCapability(childStateCapability.projectRoot,childWork,{role:'session-work-dir',
    sessionStateCapability:childStateCapability});const manifest=[];if(parentWork&&fs.existsSync(parentWork))for(const name of fs.readdirSync(parentWork)
      .sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){const phase=forkArtifactPhase(name);if(!phase||order.indexOf(phase)>=boundary)continue;
    const source=path.join(parentWork,name);const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1_048_576)
      fail('fork-artifact-source');const bytes=fs.readFileSync(source);const target=transaction.issueSessionFileCapability({sessionCapability,
      candidate:path.join(childWork,name),allowedBasenames:[name],allowMissingLeaf:true,role:'fork-artifact'});
    if(fs.existsSync(target.path)){if(Buffer.compare(fs.readFileSync(target.path),bytes)!==0)fail('fork-artifact-foreign');}
    else transaction.atomicWriteSessionFile(target,bytes);manifest.push({name,sha256:sha256(bytes),phase});}
  return{sessionCapability,manifest,manifestSha256:sha256(canonicalJson(manifest))};}
async function forkSession({projectCapability,parentStateCapability,parentSessionId,childSessionId,
  fromPhase='plan',dirtyResolution='abort',seam}={}){
  requireSessionId(parentSessionId);requireSessionId(childSessionId);requireProject(projectCapability);
  if(!['brainstorm','research','plan','implement','test'].includes(fromPhase))fail('fork-phase');
  if(!['commit','stash-apply','abort'].includes(dirtyResolution||'abort'))fail('fork-dirty-resolution');
  if(!parentStateCapability||parentStateCapability.role!=='session-state'||parentStateCapability.projectRoot!==projectCapability.path||
      !parentStateCapability.path.endsWith(`deep-work.${parentSessionId}.md`))fail('fork-parent-capability');
  const root=projectCapability.path;const childPath=path.join(root,'.claude',`deep-work.${childSessionId}.md`);
  const childCap=issueProjectStateCapability(root,childPath,{allowMissingLeaf:true,role:'session-state'});const caps=capabilities(projectCapability);
  const stateLocks=[transaction.stateLock(parentStateCapability),transaction.stateLock(childCap)]
    .sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))).map((capability)=>({rank:transaction.RANKS.state,capability}));
  const locks=[{rank:transaction.RANKS.repository,capability:issueProjectStateCapability(root,path.join(root,'.claude','deep-work.git.lock'),
      {allowMissingLeaf:true,role:'lock'})},{rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,
      path.join(root,'.claude',`deep-work.${childSessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${childSessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.registry,capability:caps.registryLock},...stateLocks];
  return transaction.withRankedLocks(locks,async()=>{const registry=readRegistryUnlocked(caps.registry);const parentRow=registry.sessions[parentSessionId];
    if(!parentRow)fail('fork-parent-missing');const preExistingChild=registry.sessions[childSessionId];const parentText=fs.readFileSync(parentStateCapability.path,'utf8');const parentFields=
      parseFrontmatter(parentText).fields;if(parentFields.session_id!==undefined&&parentFields.session_id!==parentSessionId)
      fail('fork-parent-identity');if(parentFields.current_phase==='idle'||parentRow.current_phase==='idle')fail('fork-parent-idle');
    const preconditions={parentSessionId,fromPhase,dirtyResolution,
      parentStatePath:parentStateCapability.path};const operation=await beginOperation({projectCapability,sessionId:childSessionId,
      kind:'fork-create',preconditions});let pending=await resumeOperation({projectCapability,operationId:operation.operationId,
      sessionId:childSessionId,kind:'fork-create'});if(preExistingChild&&pending.stages?.length===1)fail('fork-child-exists');
    let inspection=pending.stages?.find((row)=>row.stage==='fork-inspected')?.details?.owned?.inspection;
    const gitRuntime=require('./git-runtime.js');if(!inspection){inspection=await gitRuntime.inspectForkRepository({projectCapability,
        parentSessionId,childSessionId,parentStateCapability});if(inspection.candidateExists||inspection.registered||inspection.branchOid!==null)
        fail('fork-collision');inspection.forkGeneration=(Number.isSafeInteger(parentRow.fork_generation)?parentRow.fork_generation:0)+1;
      if(inspection.forkGeneration>32)fail('fork-generation');await recordOperationStage(operation,'fork-inspected',{owned:{inspection,
        inspectionSha256:sha256(canonicalJson(inspection))}});}
    const call=(name,context={})=>{if(seam)seam(name,Object.freeze({operationId:operation.operationId,...context}));};
    const created=await gitRuntime.createFork({projectCapability,parentSessionId,childSessionId,parentStateCapability,operation,inspection,
      seam:(name,context)=>call(name,context)});const task=parentFields.task_description||parentRow.task_description||'Forked session';
    const childState=buildSessionState({sessionId:childSessionId,task,defaults:parseStoredObject(parentFields.defaults_json),
      profile:parseStoredObject(parentFields.profile_json),repositoryContext:{headOid:created.headOid,branch:created.branch,dirty:false,
        repositoryMode:'fork',worktreePurpose:'fork',worktreePath:created.path}});Object.assign(childState,{current_phase:fromPhase,fork_parent:parentSessionId,
      parent_branch:created.parentBranch,fork_generation:inspection.forkGeneration,worktree_enabled:true,worktree_path:created.path});
    const childText=updateFrontmatterText('',childState);let existing=null;try{existing=fs.readFileSync(childPath,'utf8');}
    catch(error){if(error.code!=='ENOENT')throw error;}if(existing!==null&&existing!==childText)fail('fork-child-state-foreign');
    if(existing===null){call('before-child-state-write');atomicWriteFile(childCap,childText);call('after-child-state-write-before-stage');}
    await recordOperationStage(operation,'child-state-written',{owned:{path:childPath,sha256:sha256(Buffer.from(childText))}});
    call('before-artifacts-copy');const artifacts=publishForkArtifacts({parentFields,childStateCapability:childCap,fromPhase});
    call('after-artifacts-copy-before-stage',{manifestSha256:artifacts.manifestSha256});await recordOperationStage(operation,
      'artifacts-copied',{owned:{manifest:artifacts.manifest,manifestSha256:artifacts.manifestSha256}});
    const snapshot={version:1,parent_session_id:parentSessionId,child_session_id:childSessionId,restart_phase:fromPhase,
      parent_branch:created.parentBranch,child_branch:created.branch,head_oid:created.headOid,parent_state_sha256:inspection.parentStateSha256,
      artifact_manifest_sha256:artifacts.manifestSha256};const snapshotBytes=Buffer.from(canonicalJson(snapshot));const snapshotCap=
      transaction.issueSessionFileCapability({sessionCapability:artifacts.sessionCapability,candidate:path.join(artifacts.sessionCapability.path,
        'fork-snapshot.json'),allowedBasenames:['fork-snapshot.json'],allowMissingLeaf:true,role:'fork-snapshot'});
    if(fs.existsSync(snapshotCap.path)){if(Buffer.compare(fs.readFileSync(snapshotCap.path),snapshotBytes)!==0)fail('fork-snapshot-foreign');}
    else{call('before-snapshot-write');transaction.atomicWriteSessionFile(snapshotCap,snapshotBytes);call('after-snapshot-write-before-stage');}
    await recordOperationStage(operation,'snapshot-written',{owned:{path:snapshotCap.path,sha256:sha256(snapshotBytes)}});
    let nextRegistry=readRegistryUnlocked(caps.registry);let childRow=nextRegistry.sessions[childSessionId];const expectedRow={task_description:task,
      work_dir:childState.work_dir,current_phase:fromPhase,file_ownership:[],fork_parent:parentSessionId,
      fork_generation:inspection.forkGeneration,parent_branch:created.parentBranch,branch:created.branch,head_oid:created.headOid};
    if(childRow){for(const [key,value] of Object.entries(expectedRow))if(canonicalJson(childRow[key])!==canonicalJson(value))
        fail('fork-registry-foreign');}else{pending=await resumeOperation({projectCapability,operationId:operation.operationId,
        sessionId:childSessionId,kind:'fork-create'});childRow={pid:process.pid,...expectedRow,last_activity:pending.createdAt};
      nextRegistry.sessions[childSessionId]=childRow;call('before-registry-write');atomicWriteFile(caps.registry,`${JSON.stringify(nextRegistry)}\n`);
      call('after-registry-write-before-stage');}
    await recordOperationStage(operation,'registry-written',{owned:{sessionId:childSessionId,parentSessionId,
      rowSha256:sha256(canonicalJson(childRow))}});const currentParentText=fs.readFileSync(parentStateCapability.path,'utf8');const currentParent=
      parseFrontmatter(currentParentText).fields;let children=currentParent.fork_children;if(typeof children==='string'){
      try{children=JSON.parse(children);}catch{fail('fork-children-invalid');}}if(children===undefined)children=[];if(!Array.isArray(children))
      fail('fork-children-invalid');const found=children.filter((row)=>row?.session_id===childSessionId);if(found.length>1||
        found.length===1&&found[0].restart_phase!==fromPhase)fail('fork-parent-link-foreign');if(!found.length){children=[...children,
        {session_id:childSessionId,restart_phase:fromPhase}];call('before-parent-link-write');atomicWriteFile(parentStateCapability,
        updateFrontmatterText(currentParentText,{fork_children:JSON.stringify(children)}));call('after-parent-link-write-before-stage');}
    await recordOperationStage(operation,'parent-linked',{owned:{parentSessionId,childSessionId,restartPhase:fromPhase}});
    const result={status:'created',parentSessionId,childSessionId,path:created.path,branch:created.branch,
      generation:inspection.forkGeneration,snapshotSha256:sha256(snapshotBytes),artifactManifestSha256:artifacts.manifestSha256};
    const receipt=await completeOperation(operation,result);return{...result,stateCapability:childCap,worktreeCapability:created.worktreeCapability,
      operationId:operation.operationId,receipt};});
}

async function prepareSessionRepository({projectCapability,sessionId,mode,task,defaults={},profile={},baseRef='HEAD',seam}={}){
  requireSessionId(sessionId);requireProject(projectCapability);
  if(typeof task!=='string'||!task.trim()||!['worktree','new-branch','current-branch'].includes(mode))fail('session-task');
  if(!defaults||typeof defaults!=='object'||Array.isArray(defaults)||!profile||typeof profile!=='object'||Array.isArray(profile))
    fail('session-input');const root=projectCapability.path;const statePath=path.join(root,'.claude',`deep-work.${sessionId}.md`);
  const stateCapability=issueProjectStateCapability(root,statePath,{allowMissingLeaf:true,role:'session-state'});const caps=capabilities(projectCapability);
  const locks=[{rank:transaction.RANKS.repository,capability:issueProjectStateCapability(root,
      path.join(root,'.claude','deep-work.git.lock'),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,
      path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,
      path.join(root,'.claude',`deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.pointer,capability:caps.pointerLock},{rank:transaction.RANKS.registry,capability:caps.registryLock},
    {rank:transaction.RANKS.state,capability:transaction.stateLock(stateCapability)}];
  return transaction.withRankedLocks(locks,async()=>{const gitRuntime=require('./git-runtime.js');const preconditions={mode,
      baseRef:mode==='current-branch'?null:baseRef,
      taskSha256:sha256(Buffer.from(task)),defaultsSha256:sha256(canonicalJson(defaults)),profileSha256:sha256(canonicalJson(profile)),
    };const operation=await beginOperation({projectCapability,sessionId,kind:'initial-repository-prepare',preconditions});
    let pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'initial-repository-prepare'});
    const inspected=pending.stages?.find((row)=>row.stage==='repository-inspected')?.details?.owned;let inspection=inspected?.inspection;
    let pointerBefore=inspected?.pointerBefore??null;if(!inspection){inspection=await gitRuntime.inspectInitialRepository({projectCapability,
        sessionId,mode,baseRef});pointerBefore=readPointerUnlocked(caps.pointer);await recordOperationStage(operation,'repository-inspected',
        {owned:{inspection,inspectionSha256:sha256(canonicalJson(inspection)),pointerBefore}});}
    const call=(name,context)=>{if(seam){if(typeof seam!=='function')fail('session-seam');seam(name,Object.freeze(context));}};
    call('before-repository-call',{operationId:operation.operationId,mode});
    const prepared=await gitRuntime.prepareInitialRepository({projectCapability,sessionId,mode,baseRef,operation,inspection,
      seam:(name,context)=>call(`repository-${name}`,context)});call('after-repository-call-before-stage',
      {operationId:operation.operationId,prepared});call('after-repository-stage',{operationId:operation.operationId,prepared});
    const state=buildSessionState({sessionId,task,defaults,profile,repositoryContext:prepared.repositoryContext});
    const stateText=updateFrontmatterText('',state);let currentState=null;try{currentState=fs.readFileSync(statePath,'utf8');}
    catch(error){if(error.code!=='ENOENT')throw error;}if(currentState!==null&&currentState!==stateText)fail('initial-state-foreign');
    if(currentState===null){call('before-state-write',{operationId:operation.operationId});atomicWriteFile(stateCapability,stateText);
      call('after-state-write-before-stage',{operationId:operation.operationId});}
    await recordOperationStage(operation,'state-written',{owned:{statePath,stateSha256:sha256(Buffer.from(stateText))}});
    const workDir=state.work_dir;const workPath=path.join(root,...workDir.split('/'));try{const stat=fs.lstatSync(workPath);
      if(!stat.isDirectory()||stat.isSymbolicLink())fail('initial-work-dir-foreign');}catch(error){if(error.code!=='ENOENT')throw error;
      fs.mkdirSync(workPath,{recursive:true});}
    let registry=readRegistryUnlocked(caps.registry);let row=registry.sessions[sessionId];pending=await resumeOperation({projectCapability,
      operationId:operation.operationId,sessionId,kind:'initial-repository-prepare'});const expectedRow={task_description:task,
      work_dir:workDir,current_phase:'brainstorm',file_ownership:[],branch:state.branch,head_oid:state.head_oid,repository_mode:mode,
      worktree_enabled:state.worktree_enabled,worktree_path:state.worktree_path};
    if(row){for(const [key,value] of Object.entries(expectedRow))if(canonicalJson(row[key])!==canonicalJson(value))
        fail('initial-registry-foreign');}
    else{row={pid:process.pid,...expectedRow,last_activity:pending.createdAt};registry.sessions[sessionId]=row;
      atomicWriteFile(caps.registry,`${JSON.stringify(registry)}\n`);call('after-registry-write-before-stage',{operationId:operation.operationId});}
    await recordOperationStage(operation,'registry-written',{owned:{sessionId,workDir,rowSha256:sha256(canonicalJson(row))}});
    const pointer=readPointerUnlocked(caps.pointer);if(pointer!==sessionId&&pointer!==pointerBefore)fail('initial-pointer-foreign');
    if(pointer!==sessionId){atomicWriteFile(caps.pointer,`${sessionId}\n`);call('after-pointer-write-before-stage',{operationId:operation.operationId});}
    await recordOperationStage(operation,'pointer-written',{owned:{sessionId}});const result={status:'prepared',sessionId,mode,statePath,
      repositoryContext:prepared.repositoryContext,preconditionSha256:sha256(canonicalJson(preconditions))};const receipt=await completeOperation(operation,result);
    return{sessionId,stateCapability,repositoryContext:prepared.repositoryContext,operationId:operation.operationId,receipt};});
}

function removeForkSession(projectCapability,{sessionId,parentSessionId}={}){
  requireSessionId(sessionId);if(parentSessionId)requireSessionId(parentSessionId);
  return mutateRegistry(projectCapability,null,(registry)=>{const row=registry.sessions[sessionId];
    if(!row)fail('registry-session-missing');if(parentSessionId&&row.fork_parent!==parentSessionId)fail('fork-parent-identity');
    delete registry.sessions[sessionId];return registry;});
}

async function cleanupSession({projectCapability,sessionId,stateCapability,worktreeCapability,force=false,seam}={}){
  requireSessionId(sessionId);requireProject(projectCapability);if(!stateCapability||stateCapability.role!=='session-state'||
      stateCapability.projectRoot!==projectCapability.path||!stateCapability.path.endsWith(`deep-work.${sessionId}.md`))fail('cleanup-state');
  if(worktreeCapability&&(worktreeCapability.kind!=='managed-worktree'||worktreeCapability.sessionId!==sessionId||
      worktreeCapability.purpose!=='fork-session'))fail('cleanup-worktree-capability');const root=projectCapability.path;const caps=capabilities(projectCapability);
  const prefix=[{rank:transaction.RANKS.repository,capability:issueProjectStateCapability(root,path.join(root,'.claude','deep-work.git.lock'),
      {allowMissingLeaf:true,role:'lock'})},{rank:transaction.RANKS.session,capability:issueProjectStateCapability(root,
      path.join(root,'.claude',`deep-work.${sessionId}.rank-operation.lock`),{allowMissingLeaf:true,role:'lock'})},
    {rank:transaction.RANKS.journal,capability:issueProjectStateCapability(root,path.join(root,'.claude',
      `deep-work.${sessionId}.rank-journal.lock`),{allowMissingLeaf:true,role:'lock'})}];
  return transaction.withRankedLocks(prefix,async()=>{const preconditions={statePath:stateCapability.path,
      worktreePath:worktreeCapability?.path||null,force};const operation=await beginOperation({projectCapability,sessionId,
      kind:'cleanup-remove',preconditions});let pending=await resumeOperation({projectCapability,operationId:operation.operationId,
      sessionId,kind:'cleanup-remove'});const preliminary=readRegistry(projectCapability).sessions[sessionId];const parentId=
      pending.stages?.find((stage)=>stage.stage==='cleanup-inspected')?.details?.owned?.forkParent||preliminary?.fork_parent;
    let parentCap=null;if(parentId){requireSessionId(parentId);const target=path.join(root,'.claude',
        `deep-work.${parentId}.md`);parentCap=issueProjectStateCapability(root,target,{role:'session-state'});}
    const stateCaps=[stateCapability,...(parentCap?[parentCap]:[])];const stateLocks=stateCaps.map(transaction.stateLock)
      .sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))).map((capability)=>({rank:transaction.RANKS.state,capability}));
    return transaction.withRankedLocks([{rank:transaction.RANKS.pointer,capability:caps.pointerLock},
      {rank:transaction.RANKS.registry,capability:caps.registryLock},...stateLocks],async()=>{let registry=readRegistryUnlocked(caps.registry);
      let row=registry.sessions[sessionId];pending=await resumeOperation({projectCapability,operationId:operation.operationId,
        sessionId,kind:'cleanup-remove'});let inspection=pending.stages?.find(
        (stage)=>stage.stage==='cleanup-inspected')?.details?.owned;if(!inspection){if(!row)fail('registry-session-missing');
        const fields=sessionFromState(stateCapability,sessionId);if(!force&&(fields.current_phase!=='idle'||row.current_phase!=='idle'))
          fail('cleanup-session-active');if(worktreeCapability&&(row.worktree_path&&path.resolve(row.worktree_path)!==path.resolve(worktreeCapability.path)||
            fields.worktree_path&&path.resolve(fields.worktree_path)!==path.resolve(worktreeCapability.path)))fail('cleanup-worktree-comparison');
        let head=null;if(worktreeCapability){const gitRuntime=require('./git-runtime.js');const git=gitRuntime.gitCapability(projectCapability);
          const rows=await gitRuntime.listWorktrees(git);const match=rows.filter(
            (item)=>{try{return fs.realpathSync(item.path)===fs.realpathSync(worktreeCapability.path);}catch{return false;}});
          if(match.length!==1||match[0].branch!==`refs/heads/${worktreeCapability.branch}`)fail('cleanup-worktree-identity');head=match[0].head;}
        inspection={sessionId,rowSha256:sha256(canonicalJson(row)),forkParent:row.fork_parent||null,pointerBefore:readPointerUnlocked(caps.pointer),
          worktreePath:worktreeCapability?.path||null,branch:worktreeCapability?.branch||null,head};await recordOperationStage(operation,
          'cleanup-inspected',{owned:inspection});}
      const gitRuntime=require('./git-runtime.js');if(worktreeCapability&&!pending.stages?.some((stage)=>stage.stage==='worktree-removed')){
        await gitRuntime.removeWorktree({projectCapability,worktreeCapability,force,operation,expectedHead:inspection.head,
          seam:(name,context)=>seam?.(`worktree-${name}`,context)});}
      pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'cleanup-remove'});
      if(inspection.branch&&!pending.stages?.some((stage)=>stage.stage==='branch-deleted')){const deleted=await gitRuntime.deleteBranchExact({
          projectCapability,sessionId,branch:inspection.branch,expectedOid:inspection.head,force,parentOperationId:operation.operationId,
          seam:(name,context)=>seam?.(`branch-${name}`,context)});seam?.('after-branch-delete-before-stage',{operationId:operation.operationId});
        await recordOperationStage(operation,'branch-deleted',{owned:{branch:inspection.branch,expectedOid:inspection.head,
          childOperationId:deleted.operationId}});}
      registry=readRegistryUnlocked(caps.registry);row=registry.sessions[sessionId];if(row){if(sha256(canonicalJson(row))!==inspection.rowSha256)
          fail('cleanup-registry-foreign');delete registry.sessions[sessionId];seam?.('before-registry-write',{operationId:operation.operationId});
        atomicWriteFile(caps.registry,`${JSON.stringify(registry)}\n`);seam?.('after-registry-write-before-stage',{operationId:operation.operationId});}
      else if(!pending.stages?.some((stage)=>stage.stage==='registry-unregistered')&&
          !pending.stages?.some((stage)=>stage.stage==='worktree-removed'))fail('cleanup-registry-foreign');
      await recordOperationStage(operation,'registry-unregistered',{owned:{sessionId,rowSha256:inspection.rowSha256}});
      if(inspection.forkParent){if(!parentCap)fail('cleanup-parent-state');const parentText=fs.readFileSync(parentCap.path,'utf8');const fields=
          parseFrontmatter(parentText).fields;let children=fields.fork_children;if(typeof children==='string'){try{children=JSON.parse(children);}
          catch{fail('fork-children-invalid');}}if(children===undefined)children=[];if(!Array.isArray(children))fail('fork-children-invalid');
        const matches=children.filter((child)=>child?.session_id===sessionId);if(matches.length>1)fail('cleanup-parent-link-foreign');
        if(matches.length){children=children.filter((child)=>child?.session_id!==sessionId);seam?.('before-parent-unlink-write',
            {operationId:operation.operationId});atomicWriteFile(parentCap,updateFrontmatterText(parentText,
            {fork_children:JSON.stringify(children)}));seam?.('after-parent-unlink-write-before-stage',{operationId:operation.operationId});}
        await recordOperationStage(operation,'parent-unlinked',{owned:{parentSessionId:inspection.forkParent,childSessionId:sessionId}});}
      pending=await resumeOperation({projectCapability,operationId:operation.operationId,sessionId,kind:'cleanup-remove'});
      const pointerStage=pending.stages?.find((stage)=>stage.stage==='pointer-cleared');if(!pointerStage){const pointer=readPointerUnlocked(caps.pointer);
        let cleared=pointer===null&&inspection.pointerBefore===sessionId;let adopted=cleared;if(pointer===sessionId){seam?.('before-pointer-clear',{operationId:operation.operationId});
          revalidatePathCapability(caps.pointer,'cleanup-pointer');fs.unlinkSync(caps.pointer.path);cleared=true;
          seam?.('after-pointer-clear-before-stage',{operationId:operation.operationId});}
        const refreshedPointer=issueProjectStateCapability(root,caps.pointer.path,{allowMissingLeaf:true,role:'pointer'});
        await recordOperationStage(operation,'pointer-cleared',{owned:{sessionId,cleared,adopted,
          pointerAfter:readPointerUnlocked(refreshedPointer)}});}
      const result={status:'removed',sessionId,worktreePath:inspection.worktreePath,branch:inspection.branch,head:inspection.head};
      return completeOperation(operation,result);});});
}

module.exports = {
  NODE_AUTHORITY,
  DEFAULT_SHARED_FILES,
  generateSessionId,
  initializeSession,
  buildSessionState,
  resolveSessionContext,
  readPointer,
  writePointer,
  selectSessionPointer,
  readRegistry,
  checkFileOwnership,
  registerFileOwnership,
  updateLastActivity,
  updateRegistryPhase,
  detectStaleSessions,
  migrateLegacyState,
  migrateKnownSessionSchema,
  recoverSessionWorktree,
  finalizeSession,
  withFinishTransaction,
  validateActiveFinishContext,
  finalizeWithinFinishOperation,
  prepareSessionRepository,
  forkSession,
  cleanupSession,
  validateForkTarget,
  getForkGeneration,
  parseStoredObject, // v6.11: §5.2 Node 리더 계약을 테스트가 실제 함수로 고정하기 위한 export
};
