'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { runSupervisedProcess } = require('./process-supervisor.js');

const WORKTREE_MANIFEST_MAX_ENTRIES = 100_000;
const WORKTREE_MANIFEST_MAX_RELATIVE_PATH_BYTES = 32_768;
const WORKTREE_MANIFEST_MAX_PATH_TOTAL_BYTES = 67_108_864;
const WORKTREE_MANIFEST_MAX_FILE_BYTES = 1_073_741_824;
const WORKTREE_MANIFEST_MAX_TOTAL_BYTES = 8_589_934_592;
const INSTALL_ROOT_MAX_ROOTS = 16;
const INSTALL_ROOT_MAX_DEPTH = 3;
const INSTALL_ROOT_MAX_ENTRIES_PER_ROOT = 4_096;
const INSTALL_ROOT_MAX_FILE_BYTES = 1_048_576;
const INSTALL_ROOT_MAX_TOTAL_BYTES_PER_ROOT = 16_777_216;
const CLAIM_TICKET_ONLY_TTL_MS = 30_000;
const CLAIM_TICKET_SCAN_MAX_ENTRIES = 1_024;
const CLAIM_TICKET_MAX_FILE_BYTES = 4_096;
const CLAIM_TICKET_SCAN_MAX_TOTAL_BYTES = 1_048_576;
const CLAIM_PRIVATE_SCAN_MAX_ENTRIES = 3;
const CLAIM_TICKET_REPORT_MAX_ENTRIES = 32;
const WINDOWS_STREAM_INVENTORY_TIMEOUT_MS = 20_000;
const WINDOWS_STREAM_INVENTORY_MAX_OUTPUT_BYTES = 67_108_864;
const WINDOWS_STREAM_INVENTORY_MAX_INPUT_BYTES = 67_108_864;
const WINDOWS_NPM_PREFIX_TIMEOUT_MS = 2_000;
const WINDOWS_NPM_PREFIX_MAX_OUTPUT_BYTES = 4_096;
const ATOMIC_RENAME_RETRY_MS = Object.freeze([5, 10, 20, 40, 80, 160]);

const CLOSED_CACHE_ROOTS = new Set([
  '.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache', '.next',
  '.svelte-kit', '.gradle', '.cargo', 'vendor', 'coverage', 'dist', 'build', 'target', 'out',
]);
const PROJECT_STATE_ROLES = new Set([
  'project-root', 'git-root', 'state', 'session-state', 'session-work-dir', 'work-dir',
  'lock', 'pending', 'receipt', 'history', 'registry', 'pointer', 'frontmatter',
  'phase-result', 'runtime-exclusion', 'operation-result', 'gate-results',
  'session-envelope-output', 'slice-envelope-output', 'project-handoff-output',
  'owned-temp', 'finalized-receipt-payload',
]);
const OWNED_TEMP_PURPOSES = new Set([
  'artifact-input', 'review-prompt', 'verification-spec', 'phase-result', 'gate-results',
  'receipt-payload', 'pr-title', 'pr-body', 'handoff-payload', 'reason', 'notes', 'selection',
]);
const FINALIZED_PRODUCER_KINDS = new Set([
  'finish-merge', 'finish-publish-pr', 'finish-keep', 'finish-discard',
  'implement-slice-complete',
]);
const PLATFORM_VALUES = new Set(['win32', 'darwin', 'linux']);
const LOCK_TEST_SEAMS = new Set([
  'after-ticket-open', 'after-ticket-fsync', 'after-private-mkdir',
  'after-owner-write', 'after-owner-fsync', 'after-heartbeat-write',
  'after-heartbeat-fsync', 'before-canonical-rename', 'after-canonical-rename',
  'before-first-heartbeat', 'before-heartbeat-replace', 'after-first-heartbeat',
  'after-release-lock-remove-before-ticket-unlink',
]);
const FORBIDDEN_SHELL_EXECUTABLES = new Set([
  'cmd.exe','command.com','powershell.exe','pwsh.exe','sh','bash','zsh','dash','fish',
]);
const WINDOWS_DEVICE_BASES = Object.freeze([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({length:9}, (_, i) => `COM${i + 1}`),
  ...Array.from({length:9}, (_, i) => `LPT${i + 1}`),
  'COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³', 'CONIN$', 'CONOUT$',
]);
const WINDOWS_DEVICE_SET = new Set(WINDOWS_DEVICE_BASES.map((value) => value.toLowerCase()));
const PATH_THREAT_MODEL = Object.freeze({
  version:1,
  protected:Object.freeze([
    'lexical-prefix-confusion',
    'pre-existing-link-or-reparse',
    'observed-component-identity-drift',
    'portable-windows-alias',
  ]),
  concurrentReplacementAfterFinalValidation:'unsupported',
  statement:'Path capabilities do not provide descriptor-relative or object-bound safety after the final validation seam.',
});

const CAPABILITY_META = new WeakMap();
const CAPABILITY_BRAND = new WeakSet();

function fail(code, message, details = {}) {
  const error = new Error(`[${code}] ${message || code}`);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  const seen = new WeakSet();
  function wellFormedString(item) {
    for (let index = 0; index < item.length; index++) {
      const code = item.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = item.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
  }
  function normalize(item) {
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') {
      if (!wellFormedString(item)) fail('canonical-json-invalid', 'canonical JSON string is malformed UTF-16');
      return item;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('canonical-json-invalid', 'canonical JSON number must be finite');
      return item;
    }
    if (typeof item !== 'object' || Buffer.isBuffer(item)) {
      fail('canonical-json-invalid', `unsupported canonical JSON value: ${typeof item}`);
    }
    if (seen.has(item)) fail('canonical-json-invalid', 'canonical JSON value is cyclic');
    seen.add(item);
    let result;
    if (Array.isArray(item)) result = item.map(normalize);
    else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        fail('canonical-json-invalid', 'canonical JSON objects must be plain');
      }
      result = {};
      for (const key of Object.keys(item).sort()) {
        if (!wellFormedString(key)) fail('canonical-json-invalid', 'canonical JSON key is malformed');
        result[key] = normalize(item[key]);
      }
    }
    seen.delete(item);
    return result;
  }
  return `${JSON.stringify(normalize(value))}\n`;
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function sanitizePathInput(value) {
  if (typeof value !== 'string') fail('path-input-type', 'path input must be a string');
  let output = value.trimEnd();
  if (/[\x00-\x1f\x7f]/u.test(output)) {
    fail('path-input-control', 'path input contains a forbidden control character');
  }
  if (!output) fail('path-input-empty', 'path input is empty');
  if (/^[A-Za-z]:[\\/]?$/.test(output)) return `${output[0]}:${output.includes('/') ? '/' : '\\'}`;
  if (output === '/' || /^\\\\[^\\]+\\[^\\]+\\?$/.test(output)) return output;
  return output;
}

function pathApiFor(value, platform) {
  if (platform === 'win32' || /^[A-Za-z]:[\\/]|^\\\\/.test(value)) return path.win32;
  return path;
}

function normalizeForCompare(value, platform = process.platform) {
  const clean = sanitizePathInput(value);
  const api = pathApiFor(clean, platform);
  let normalized = api.normalize(clean);
  const root = api.parse(normalized).root;
  while (normalized.length > root.length && /[\\/]$/.test(normalized)) normalized = normalized.slice(0, -1);
  return platform === 'win32' || api === path.win32 ? normalized.toLowerCase() : normalized;
}

function isPathInside(root, candidate, platform = process.platform) {
  const cleanRoot = sanitizePathInput(root);
  const cleanCandidate = sanitizePathInput(candidate);
  const api = pathApiFor(cleanRoot, platform);
  const normalizedRoot = api.resolve(cleanRoot);
  const normalizedCandidate = api.resolve(cleanCandidate);
  const relative = api.relative(normalizedRoot, normalizedCandidate);
  if (relative === '') return true;
  return !relative.startsWith(`..${api.sep}`) && relative !== '..' && !api.isAbsolute(relative);
}

function canonicalizePortableProjectPathV1(value) {
  if (typeof value !== 'string' || !value || value.normalize('NFC') !== value ||
      value.startsWith('/') || value.endsWith('/') || value.includes('\\')) {
    fail('portable-path-v1-invalid', 'path must be a nonempty NFC relative slash path');
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\x00-\x1f\x7f<>:"|?*]/u.test(segment) ||
        /[. ]$/u.test(segment)) {
      fail('portable-path-v1-invalid', `invalid portable path segment: ${JSON.stringify(segment)}`);
    }
    const base = segment.split('.')[0].replace(/[ .]+$/u, '').toLowerCase();
    if (WINDOWS_DEVICE_SET.has(base)) {
      fail('portable-path-v1-device', `reserved Windows device segment: ${segment}`);
    }
  }
  return {path:value, windowsKey:segments.map((segment) => segment.toLowerCase()).join('/')};
}

function resolveProjectRoot(startDir) {
  let current = fs.realpathSync(sanitizePathInput(startDir));
  for (;;) {
    const marker = path.join(current, '.git');
    try {
      const stat = fs.lstatSync(marker);
      if (stat.isDirectory() || stat.isFile()) return current;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) fail('project-root-not-found', `no .git marker above ${startDir}`);
    current = parent;
  }
}

function statIdentity(stat) {
  return Object.freeze({
    dev:String(stat.dev),
    ino:String(stat.ino),
    mode:stat.mode,
    type:stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'link' : 'other',
  });
}

function identitiesEqual(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.type === b.type;
}

function fsFor(overrides) {
  if (!overrides) return fs;
  return new Proxy(fs, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
      return target[property];
    },
  });
}

function inspectPhysical(rootInput, candidateInput, allowMissingLeaf, fsApi = fs) {
  const rootResolved = path.resolve(sanitizePathInput(rootInput));
  let rootStat;
  try { rootStat = fsApi.lstatSync(rootResolved); }
  catch (cause) { fail('path-capability-root-missing', cause.message, {cause}); }
  if (rootStat.isSymbolicLink()) fail('path-capability-link', 'capability root is a link/reparse point');
  const rootReal = fsApi.realpathSync(rootResolved);
  const candidateResolved = path.resolve(sanitizePathInput(candidateInput));
  if (!isPathInside(rootResolved, candidateResolved)) {
    fail('path-capability-outside', `${candidateResolved} is outside ${rootResolved}`);
  }
  const relative = path.relative(rootResolved, candidateResolved);
  const components = [{path:rootResolved, identity:statIdentity(rootStat)}];
  let cursor = rootResolved;
  let missing = false;
  for (const segment of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, segment);
    if (missing) continue;
    try {
      const stat = fsApi.lstatSync(cursor);
      if (stat.isSymbolicLink()) fail('path-capability-link', `link/reparse component: ${cursor}`);
      components.push({path:cursor, identity:statIdentity(stat)});
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing = true;
    }
  }
  if (missing && !allowMissingLeaf) fail('path-capability-missing', `path does not exist: ${candidateResolved}`);
  if (!missing) {
    const real = fsApi.realpathSync(candidateResolved);
    if (!isPathInside(rootReal, real)) fail('path-capability-outside', 'real path escapes capability root');
  }
  return {
    rootPath:rootResolved,
    rootRealPath:rootReal,
    rootIdentity:statIdentity(rootStat),
    path:candidateResolved,
    components:Object.freeze(components.map((entry) => Object.freeze(entry))),
    deepestExisting:components.at(-1).path,
    deepestIdentity:components.at(-1).identity,
    existed:!missing,
  };
}

function defineCapability(publicFields, meta, dynamic = {}) {
  const capability = {...publicFields};
  for (const [name, getter] of Object.entries(dynamic)) {
    Object.defineProperty(capability, name, {enumerable:true, configurable:false, get:getter});
  }
  CAPABILITY_META.set(capability, meta);
  CAPABILITY_BRAND.add(capability);
  return Object.freeze(capability);
}

function assertCapability(capability, kinds) {
  if (!capability || !CAPABILITY_BRAND.has(capability) || !CAPABILITY_META.has(capability)) {
    fail('path-capability-invalid', 'a branded path capability is required');
  }
  if (kinds && !kinds.includes(capability.kind)) {
    fail('path-capability-kind', `expected ${kinds.join('|')}, got ${capability.kind}`);
  }
  return CAPABILITY_META.get(capability);
}

function validateRecordedComponents(meta, fsApi = fs) {
  if (meta.sessionCapability) validateSessionCapability(meta.sessionCapability);
  for (const component of meta.physical.components) {
    let current;
    try { current = fsApi.lstatSync(component.path); }
    catch (cause) { fail('path-capability-identity', `component disappeared: ${component.path}`, {cause}); }
    if (current.isSymbolicLink()) fail('path-capability-link', `component became a link: ${component.path}`);
    if (!identitiesEqual(component.identity, statIdentity(current))) {
      fail('path-capability-identity', `component identity changed: ${component.path}`);
    }
  }
  const refreshed = inspectPhysical(meta.physical.rootPath, meta.physical.path, true, fsApi);
  if (!isPathInside(meta.physical.rootPath, refreshed.deepestExisting)) {
    fail('path-capability-outside', 'refreshed path escaped root');
  }
  if (meta.repositoryMarker) {
    let markerStat;
    try { markerStat = fsApi.lstatSync(meta.repositoryMarker.path); }
    catch (cause) {
      fail('path-capability-identity', 'authenticated Git repository marker disappeared', {cause});
    }
    if (markerStat.isSymbolicLink() ||
        !identitiesEqual(meta.repositoryMarker.identity, statIdentity(markerStat))) {
      fail('path-capability-identity', 'authenticated Git repository marker changed');
    }
    if (meta.repositoryMarker.contentDigest !== null &&
        sha256(fsApi.readFileSync(meta.repositoryMarker.path)) !== meta.repositoryMarker.contentDigest) {
      fail('path-capability-identity', 'authenticated Git worktree marker content changed');
    }
  }
  return refreshed;
}

function captureRepositoryMarker(root, fsApi) {
  const markerPath = path.join(root, '.git');
  let stat;
  try { stat = fsApi.lstatSync(markerPath); }
  catch (cause) { if (cause.code === 'ENOENT') return null;
    fail('path-capability-identity', 'cannot inspect project Git repository marker', {cause}); }
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    fail('path-capability-identity', 'Git repository marker has an unsupported type');
  }
  return Object.freeze({path:markerPath, identity:statIdentity(stat),
    contentDigest:stat.isFile() ? sha256(fsApi.readFileSync(markerPath)) : null});
}

function createProjectStateIssuer(fsApi) {
  return function issueProjectStateCapability(projectRoot, candidate, options = {}) {
    if (typeof candidate === 'string' && candidate.trimEnd() !== candidate) {
      fail('portable-path-v1-invalid', 'capability path must not be changed by trailing-input cleanup');
    }
    const rootPath = path.resolve(sanitizePathInput(projectRoot));
    const candidatePath = path.resolve(sanitizePathInput(candidate));
    const basename = path.basename(candidatePath);
    const role = options.role || (candidatePath === rootPath ? 'project-root'
      : candidatePath === path.join(rootPath, '.git') ? 'git-root'
        : basename.endsWith('.lock') ? 'lock'
          : ['.pending-changes.jsonl','.pending-append.jsonl'].includes(basename) ? 'pending'
            : 'state');
    if (!PROJECT_STATE_ROLES.has(role)) fail('project-state-role', `unknown project-state role: ${role}`);
    if (role === 'owned-temp') fail('owned-temp-derived-only', 'owned-temp is derived only');
    if (role === 'finalized-receipt-payload') {
      fail('finalized-receipt-derived-only', 'finalized result is producer-derived only');
    }
    if (['project-handoff-output','session-envelope-output','slice-envelope-output'].includes(role)) {
      fail('route-derived-only', `${role} is issued only by its route-specific constructor`);
    }
    if (isPathInside(rootPath, candidatePath)) {
      const portableRelative = path.relative(rootPath, candidatePath).split(path.sep).join('/');
      if (portableRelative) canonicalizePortableProjectPathV1(portableRelative);
    }
    let physical = inspectPhysical(projectRoot, candidate, Boolean(options.allowMissingLeaf), fsApi);
    const root = physical.rootPath;
    const expectedClaude = path.join(root, '.claude');
    const relative = path.relative(root, physical.path).split(path.sep).join('/');
    const stateMatch = relative.match(/^\.claude\/deep-work\.(s-[0-9a-f]{8})\.md$/);
    let sessionId = stateMatch ? stateMatch[1] : null;
    let sessionStateCapability = null;
    let sessionStateDigest = null;
    if (role === 'project-root' && physical.path !== root) fail('project-state-route', 'project root must be exact');
    if (role === 'git-root' && physical.path !== path.join(root, '.git')) fail('project-state-route', 'git root must be exact');
    if (role === 'session-state' && !stateMatch) {
      fail('project-state-route', 'session-state must be the exact authenticated session state path');
    }
    if (['session-work-dir','work-dir'].includes(role)) {
      sessionStateCapability = options.sessionStateCapability;
      const stateMeta = assertCapability(sessionStateCapability, ['project-state']);
      if (sessionStateCapability.role !== 'session-state' ||
          sessionStateCapability.projectRoot !== root || !stateMeta.sessionId) {
        fail('session-capability-identity', 'an authenticated matching session-state capability is required');
      }
      validateRecordedComponents(stateMeta, fsApi);
      const stateBytes = readBounded(sessionStateCapability.path, 1_048_576, fsApi,
        'session-capability-identity');
      const parsed = require('./frontmatter.js').parseFrontmatter(stateBytes.toString('utf8'));
      if (typeof parsed.fields.work_dir !== 'string') {
        fail('session-capability-identity', 'session state has no exact work_dir tuple');
      }
      const portableWorkDir = canonicalizePortableProjectPathV1(parsed.fields.work_dir);
      if (!portableWorkDir.path.startsWith('.deep-work/')) {
        fail('session-capability-identity', 'session work_dir must be beneath .deep-work');
      }
      const expected = path.join(root, ...portableWorkDir.path.split('/'));
      if (physical.path !== expected) {
        fail('project-state-route', `${role} does not match authenticated session state`);
      }
      sessionId = stateMeta.sessionId;
      sessionStateDigest = sha256(stateBytes);
    }
    if (!['project-root','git-root','project-handoff-output','session-work-dir','work-dir'].includes(role) &&
        !isPathInside(expectedClaude, physical.path)) {
      fail('project-state-route', `${role} must be beneath .claude`);
    }
    if (role === 'lock' && physical.existed && physical.path !== physical.rootPath) {
      const parentComponents = physical.components.slice(0, -1);
      physical = {...physical, components:Object.freeze(parentComponents),
        deepestExisting:parentComponents.at(-1).path,
        deepestIdentity:parentComponents.at(-1).identity,
        existed:false,
        observedLeafIdentity:physical.deepestIdentity};
    }
    const repositoryMarker = role === 'project-root' ? captureRepositoryMarker(root, fsApi) : null;
    const meta = {kind:'project-state', role, physical, fsApi, sessionId,
      repositoryMarker,
      sessionStateCapability, sessionStateDigest};
    return defineCapability({
      kind:'project-state', role, path:physical.path, projectRoot:root,
      root,
      canonicalProjectRoot:physical.rootRealPath,
      allowMissingLeaf:Boolean(options.allowMissingLeaf),
    }, meta, {
      deepestExistingParent:() => meta.physical.deepestExisting,
      identity:() => meta.physical.deepestIdentity,
    });
  };
}

const issueProjectStateCapability = createProjectStateIssuer(fs);

function issueExternalTargetLockCapability(target) {
  const targetPath=path.resolve(sanitizePathInput(target));const parent=path.dirname(targetPath);
  const parentStat=fs.lstatSync(parent);if(!parentStat.isDirectory()||parentStat.isSymbolicLink())
    fail('external-target-parent','external target parent must be an ordinary directory');
  const lockName=`.deep-work-target.${sha256(Buffer.from(targetPath))}.lock`;const physical=inspectPhysical(parent,
    path.join(parent,lockName),true,fs);const meta={kind:'project-state',role:'lock',physical,fsApi:fs,
      sessionStateCapability:null,sessionStateDigest:null,repositoryMarker:null};
  return defineCapability({kind:'project-state',role:'lock',path:physical.path,projectRoot:physical.rootPath,
    root:physical.rootPath,canonicalProjectRoot:physical.rootRealPath,allowMissingLeaf:true},meta,
  {deepestExistingParent:()=>meta.physical.deepestExisting,identity:()=>meta.physical.deepestIdentity});
}

function validateSessionCapability(sessionCapability) {
  const meta = assertCapability(sessionCapability, ['project-state']);
  if (!['session-work-dir','work-dir'].includes(sessionCapability.role)) {
    fail('session-capability-role', 'session work-directory capability is required');
  }
  if (!meta.sessionId || !meta.sessionStateCapability || !meta.sessionStateDigest) {
    fail('session-capability-identity', 'session work directory lacks authenticated state binding');
  }
  validateRecordedComponents(meta, meta.fsApi);
  const stateMeta = assertCapability(meta.sessionStateCapability, ['project-state']);
  validateRecordedComponents(stateMeta, meta.fsApi);
  const stateBytes = readBounded(meta.sessionStateCapability.path, 1_048_576, meta.fsApi,
    'session-capability-identity');
  if (sha256(stateBytes) !== meta.sessionStateDigest) {
    fail('session-capability-identity', 'authenticated session state changed after work-dir issuance');
  }
  return {meta, sessionId:meta.sessionId};
}

function validOperationId(value) {
  return typeof value === 'string' && /^op-[0-9a-f]{32,64}$/.test(value);
}

function issueOwnedTempCapability({sessionCapability, operationId, purpose, allowMissingLeaf = true}) {
  const {meta:sessionMeta, sessionId} = validateSessionCapability(sessionCapability);
  if (!validOperationId(operationId)) fail('temp-operation-id', 'invalid operation ID');
  if (!OWNED_TEMP_PURPOSES.has(purpose)) fail('temp-purpose', `invalid temp purpose: ${purpose}`);
  const target = path.join(sessionCapability.path, '.tmp', operationId, `${purpose}.tmp`);
  const physical = inspectPhysical(sessionCapability.projectRoot, target, allowMissingLeaf, sessionMeta.fsApi);
  const terminalPath = `${target}.terminal.json`;
  const cleanupPath = `${target}.cleanup.json`;
  const state = {value:'reserved', digest:null, envelopeOperationId:null};
  const meta = {kind:'project-state', role:'owned-temp', physical, fsApi:sessionMeta.fsApi,
    sessionCapability, sessionId, operationId, purpose, state,
    ownerPath:`${target}.owner.json`, consumerPath:`${target}.consumer.json`,
    cleanupPath, terminalPath, preexistingTarget:physical.existed};
  const identity = {sessionId, operationId, purpose};
  let terminal = readOwnedTempTerminal(meta, identity, true);
  if (!terminal) {
    const cleanup = readOwnedTempCleanup(meta, identity, true);
    if (cleanup) {
      finishOwnedTempCleanup(meta, identity, cleanup);
      meta.physical = inspectPhysical(sessionCapability.projectRoot, target, true, sessionMeta.fsApi);
      terminal = readOwnedTempTerminal(meta, identity, false);
    }
  }
  if (terminal) {
    state.value = 'removed';
    state.digest = terminal.contentDigest;
  } else if (physical.existed) {
    const targetBytes = readBounded(target, WORKTREE_MANIFEST_MAX_FILE_BYTES, sessionMeta.fsApi,
      'owned-temp-foreign');
    const contentDigest = sha256(targetBytes);
    try {
      const owner = parseCanonicalJson(readBounded(meta.ownerPath, CLAIM_TICKET_MAX_FILE_BYTES,
        sessionMeta.fsApi, 'owned-temp-foreign'), 'owned-temp-foreign');
      if (exactKeys(owner, ['version','sessionId','operationId','purpose','contentDigest']) &&
          owner.version === 1 && owner.sessionId === sessionId && owner.operationId === operationId &&
          owner.purpose === purpose && owner.contentDigest === contentDigest) {
        state.value = 'written';
        state.digest = contentDigest;
      }
    } catch (error) {
      if (!['ENOENT','owned-temp-foreign'].includes(error.code)) throw error;
    }
  }
  return defineCapability({
    kind:'project-state', role:'owned-temp', path:target,
    projectRoot:sessionCapability.projectRoot, canonicalProjectRoot:sessionCapability.canonicalProjectRoot,
    allowMissingLeaf:true, sessionId, workDir:sessionCapability.path, operationId, purpose,
  }, meta, {
    state:() => state.value,
    contentDigest:() => state.digest,
  });
}

function issueFinalizedReceiptPayloadCapability({sessionCapability, producerOperationReceipt, slice}) {
  const {meta:sessionMeta, sessionId} = validateSessionCapability(sessionCapability);
  const receipt = producerOperationReceipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      !FINALIZED_PRODUCER_KINDS.has(receipt.kind)) {
    fail('finalized-receipt-producer-kind', 'invalid finalized receipt producer kind');
  }
  if (!validOperationId(receipt.operationId) || receipt.sessionId !== sessionId ||
      receipt.stage !== 'payload-published' || !/^[0-9a-f]{64}$/.test(receipt.sourceTempDigest || '') ||
      !/^[0-9a-f]{64}$/.test(receipt.finalizedBytesDigest || '')) {
    fail('finalized-receipt-producer', 'producer receipt is incomplete or foreign');
  }
  if (receipt.kind === 'implement-slice-complete') {
    if (!/^SLICE-\d{3}$/.test(slice || '') || receipt.slice !== slice) {
      fail('finalized-receipt-slice', 'slice producer requires its exact slice');
    }
  } else if (slice !== undefined || receipt.slice !== undefined) {
    fail('finalized-receipt-slice', 'finish producer cannot carry a slice');
  }
  if (Object.hasOwn(receipt, 'path')) fail('finalized-receipt-path-input', 'producer cannot supply a path');
  const target = path.join(sessionCapability.path, '.operation-results', receipt.operationId,
    'finalized-receipt-payload.json');
  const physical = inspectPhysical(sessionCapability.projectRoot, target, false, sessionMeta.fsApi);
  validateSessionCapability(sessionCapability);
  const payloadBytes = sessionMeta.fsApi.readFileSync(target);
  if (sha256(payloadBytes) !== receipt.finalizedBytesDigest) {
    fail('finalized-receipt-payload-digest', 'published finalized receipt bytes do not match producer');
  }
  const state = {value:'published', envelopeOperationId:null};
  const meta = {kind:'project-state', role:'finalized-receipt-payload', physical,
    fsApi:sessionMeta.fsApi, state, producer:{...receipt}, sessionCapability,
    consumerPath:`${target}.envelope-consumer.json`};
  validateSessionCapability(sessionCapability);
  const recordedConsumer = readFinalizedReceiptConsumer(meta, {
    sessionId, producerOperationId:receipt.operationId,
    payloadDigest:receipt.finalizedBytesDigest,
  }, true);
  if (recordedConsumer) {
    state.value = 'enveloped';
    state.envelopeOperationId = recordedConsumer.consumerOperationId;
  }
  return defineCapability({
    kind:'project-state', role:'finalized-receipt-payload', path:target,
    projectRoot:sessionCapability.projectRoot, canonicalProjectRoot:sessionCapability.canonicalProjectRoot,
    allowMissingLeaf:true, sessionId, slice, producerKind:receipt.kind,
    producerOperationId:receipt.operationId, sourceTempDigest:receipt.sourceTempDigest,
    payloadDigest:receipt.finalizedBytesDigest,
  }, meta, {state:() => state.value, envelopeOperationId:() => state.envelopeOperationId});
}

function readFinalizedReceiptConsumer(meta, capability, allowMissing) {
  validateSessionCapability(meta.sessionCapability);
  let bytes;
  try {
    bytes = readBounded(meta.consumerPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'finalized-receipt-consumer-invalid');
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw error;
  }
  const consumer = parseCanonicalJson(bytes, 'finalized-receipt-consumer-invalid');
  if (!exactKeys(consumer, ['version','kind','sessionId','producerOperationId',
    'consumerOperationId','payloadDigest']) || consumer.version !== 1 ||
      consumer.kind !== 'envelope-publish' || consumer.sessionId !== capability.sessionId ||
      consumer.producerOperationId !== capability.producerOperationId ||
      !validOperationId(consumer.consumerOperationId) ||
      consumer.consumerOperationId === capability.producerOperationId ||
      consumer.payloadDigest !== capability.payloadDigest) {
    fail('finalized-receipt-consumer-invalid', 'finalized receipt consumer is foreign or malformed');
  }
  cleanupPublishedSidecarStaging(meta.consumerPath, bytes, meta.fsApi);
  return consumer;
}

function consumeFinalizedReceiptPayload(capability, operationReceipt) {
  const meta = assertCapability(capability, ['project-state']);
  if (capability.role !== 'finalized-receipt-payload' || !operationReceipt ||
      operationReceipt.kind !== 'envelope-publish' || !validOperationId(operationReceipt.operationId)) {
    fail('finalized-receipt-consumer', 'only an envelope-publish operation may consume the result');
  }
  validateRecordedComponents(meta, meta.fsApi);
  if (sha256(meta.fsApi.readFileSync(capability.path)) !== capability.payloadDigest) {
    fail('finalized-receipt-payload-digest', 'finalized receipt payload changed before envelope');
  }
  if (operationReceipt.operationId === capability.producerOperationId) {
    fail('finalized-receipt-consumer', 'producer and envelope consumer operations must be distinct');
  }
  const consumerBytes = Buffer.from(canonicalJson({version:1, kind:'envelope-publish',
    sessionId:capability.sessionId, producerOperationId:capability.producerOperationId,
    consumerOperationId:operationReceipt.operationId, payloadDigest:capability.payloadDigest}));
  try {
    validateRecordedComponents(meta, meta.fsApi);
    writeExclusiveSidecar(meta.consumerPath, consumerBytes, meta.fsApi);
    fsyncDirectory(path.dirname(meta.consumerPath), meta.fsApi);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    validateRecordedComponents(meta, meta.fsApi);
    const current = readBounded(meta.consumerPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'finalized-receipt-already-consumed');
    if (!sameBytes(current, consumerBytes)) {
      fail('finalized-receipt-already-consumed', 'result was consumed by another envelope operation');
    }
  }
  meta.state.value = 'enveloped';
  meta.state.envelopeOperationId = operationReceipt.operationId;
  return capability;
}

function derivedProjectCap(sessionCapability, target, role) {
  const sessionMeta = assertCapability(sessionCapability, ['project-state']);
  const physical = inspectPhysical(sessionCapability.projectRoot, target, true, sessionMeta.fsApi);
  return defineCapability({kind:'project-state', role, path:target,
    projectRoot:sessionCapability.projectRoot, canonicalProjectRoot:sessionCapability.canonicalProjectRoot,
    allowMissingLeaf:true}, {kind:'project-state', role, physical, fsApi:sessionMeta.fsApi,
      sessionCapability});
}

function issueSessionEnvelopeOutputCapability({sessionCapability}) {
  validateSessionCapability(sessionCapability);
  return derivedProjectCap(sessionCapability, path.join(sessionCapability.path, 'session-receipt.json'),
    'session-envelope-output');
}

function issueSliceEnvelopeOutputCapability({sessionCapability, slice}) {
  validateSessionCapability(sessionCapability);
  if (!/^SLICE-\d{3}$/.test(slice || '')) fail('slice-identity', 'invalid slice identity');
  return derivedProjectCap(sessionCapability, path.join(sessionCapability.path, 'receipts', `${slice}.json`),
    'slice-envelope-output');
}

function issueProjectHandoffOutputCapability({projectCapability, sessionId, operationId}) {
  const projectMeta = assertCapability(projectCapability, ['project-state']);
  if (projectCapability.role !== 'project-root' || !/^s-[0-9a-f]{8}$/.test(sessionId || '') ||
      !validOperationId(operationId)) fail('handoff-route', 'invalid handoff route identity');
  validateRecordedComponents(projectMeta, projectMeta.fsApi);
  const target = path.join(projectCapability.path, '.deep-work', 'handoffs', `${sessionId}-${operationId}.json`);
  const physical = inspectPhysical(projectCapability.path, target, true, projectMeta.fsApi);
  if (!identitiesEqual(projectMeta.physical.rootIdentity, physical.rootIdentity)) {
    fail('path-capability-identity', 'handoff root differs from authenticated project root');
  }
  return defineCapability({kind:'project-state', role:'project-handoff-output', path:target,
    projectRoot:projectCapability.path, canonicalProjectRoot:projectCapability.canonicalProjectRoot,
    allowMissingLeaf:true, sessionId, operationId},
  {kind:'project-state', role:'project-handoff-output', physical, fsApi:projectMeta.fsApi,
    repositoryMarker:projectMeta.repositoryMarker});
}

function managedWorktreeCapability(input, purpose, fsApi = fs, platformValue = process.platform) {
  const lexicalProjectRoot = path.resolve(sanitizePathInput(input.projectRoot));
  const projectRoot = fsApi.realpathSync(lexicalProjectRoot);
  const projectStat = fsApi.lstatSync(projectRoot);
  if (projectStat.isSymbolicLink()) fail('managed-worktree-link', 'project root is a link');
  const parent = path.dirname(projectRoot);
  const session = input.sessionId;
  if (!/^s-[0-9a-f]{8}$/.test(session || '')) fail('managed-worktree-session', 'invalid session ID');
  const suffix = session.slice(2);
  const expectedBase = purpose === 'initial-session'
    ? `${path.basename(projectRoot)}-wt-${suffix}`
    : `${path.basename(projectRoot)}-wt-fork-${suffix}`;
  const lexicalCandidate = path.resolve(sanitizePathInput(input.candidate));
  const lexicalParent = path.dirname(lexicalProjectRoot);
  if (![parent, lexicalParent].includes(path.dirname(lexicalCandidate)) ||
      path.basename(lexicalCandidate) !== expectedBase) {
    fail('managed-worktree-shape', 'managed worktree must be the exact session sibling');
  }
  const candidate = path.join(parent, expectedBase);
  const expectedBranch = purpose === 'initial-session'
    ? `deep-work-${suffix}` : `${input.parentBranch}-fork-${suffix}`;
  if (input.branch !== expectedBranch || (purpose === 'fork-session' &&
      (typeof input.parentBranch !== 'string' || !input.parentBranch))) {
    fail('managed-worktree-branch', 'managed worktree branch does not match its purpose');
  }
  const parentPhysical = inspectPhysical(parent, parent, false, fsApi);
  const physical = inspectPhysical(parent, candidate, Boolean(input.allowMissingLeaf), fsApi);
  let baseOid;
  if (purpose === 'initial-session') {
    if (typeof input.baseRef !== 'string' || !input.baseRef || /[\0\r\n]/.test(input.baseRef)) {
      fail('managed-worktree-base', 'base ref is invalid');
    }
    try {
      const git = resolveGitExecutable(process.env, fsApi);
      baseOid = childProcess.execFileSync(git,
        ['rev-parse', '--verify', `${input.baseRef}^{commit}`],
        {cwd:projectRoot, encoding:'utf8', stdio:['ignore','pipe','pipe'],
          env:safeGitEnvironment(git), windowsHide:true}).trim();
    } catch (cause) { fail('managed-worktree-base', 'base ref did not resolve', {cause}); }
    if (!/^[0-9a-f]{40,64}$/.test(baseOid)) fail('managed-worktree-base', 'base OID is invalid');
  }
  const meta = {kind:'managed-worktree', purpose, physical, parentPhysical, fsApi,
    platform:platformValue,
    projectRoot, branch:input.branch, sessionId:session};
  return defineCapability({kind:'managed-worktree', purpose, path:candidate, projectRoot,
    siblingParent:parent, sessionId:session, sessionSuffix:suffix, branch:input.branch,
    baseOid, parentBranch:input.parentBranch, allowMissingLeaf:Boolean(input.allowMissingLeaf),
    identity:physical.deepestIdentity}, meta);
}

function issueInitialWorktreeCapability(input) {
  return managedWorktreeCapability(input, 'initial-session');
}

function issueForkWorktreeCapability(input) {
  return managedWorktreeCapability(input, 'fork-session');
}

function parseGitWorktreePorcelainZ(output) {
  const source = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  if (source === '') return [];
  if (!source.endsWith('\0\0')) {
    fail('git-worktree-porcelain-invalid', 'worktree porcelain -z output is not record terminated');
  }
  return source.slice(0, -2).split('\0\0').map((record) => {
    const fields = record.split('\0');
    if (!fields[0].startsWith('worktree ') || fields[0].length === 9) {
      fail('git-worktree-porcelain-invalid', 'worktree record has no path');
    }
    const parsed = {path:fields[0].slice(9)};
    const seen = new Set(['worktree']);
    for (const field of fields.slice(1)) {
      if (!field) fail('git-worktree-porcelain-invalid', 'worktree record has an empty field');
      const space = field.indexOf(' ');
      const key = space < 0 ? field : field.slice(0, space);
      const value = space < 0 ? true : field.slice(space + 1);
      if (!key || seen.has(key)) {
        fail('git-worktree-porcelain-invalid', 'worktree record has a duplicate or empty key');
      }
      seen.add(key);
      if (key === 'HEAD') parsed.head = value;
      else if (key === 'branch') parsed.branch = value;
      else parsed[key] = value;
    }
    return parsed;
  });
}

function verifyManagedWorktreeRegistration(capability, meta, refreshed) {
  const git = resolveGitExecutable(process.env, meta.fsApi);
  let output;
  try {
    output = childProcess.execFileSync(git, ['worktree','list','--porcelain','-z'], {
      cwd:capability.projectRoot, encoding:'utf8', stdio:['ignore','pipe','pipe'], windowsHide:true,
      env:safeGitEnvironment(git),
    });
  } catch (cause) { fail('managed-worktree-registration', 'git worktree list failed', {cause}); }
  const records = parseGitWorktreePorcelainZ(output);
  const expectedIdentity = refreshed && refreshed.existed ? refreshed.deepestIdentity : null;
  const matches = records.filter((record) => {
    if (typeof record.path !== 'string' || !expectedIdentity) return false;
    try {
      const before = meta.fsApi.lstatSync(record.path);
      if (before.isSymbolicLink() || !before.isDirectory()) return false;
      meta.fsApi.realpathSync(record.path);
      const after = meta.fsApi.lstatSync(record.path);
      return !after.isSymbolicLink() && after.isDirectory() &&
        identitiesEqual(statIdentity(before), statIdentity(after)) &&
        identitiesEqual(expectedIdentity, statIdentity(after));
    }
    catch { return false; }
  });
  if (matches.length !== 1 || matches[0].branch !== `refs/heads/${capability.branch}`) {
    fail('managed-worktree-registration', 'worktree path/branch is not registered to this capability');
  }
}

function defaultInstallRoots(home) {
  return [
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.claude', 'plugins', 'cache'),
    path.join(home, '.codex', 'plugins'),
    path.join(home, '.codex', 'plugins', 'cache'),
  ];
}

function issueTrustedInstallRootWithFs({home, candidate, explicitRoots}, fsApi = fs) {
  const homePhysical = inspectPhysical(home, home, false, fsApi);
  const roots = explicitRoots === undefined ? defaultInstallRoots(homePhysical.rootPath) : explicitRoots;
  if (!Array.isArray(roots) || roots.length > INSTALL_ROOT_MAX_ROOTS) {
    fail('install-root-count-limit', 'too many trusted install roots');
  }
  const normalized = roots.map((root) => path.resolve(sanitizePathInput(root)));
  const resolvedCandidate = path.resolve(sanitizePathInput(candidate));
  const allowed = explicitRoots !== undefined
    ? normalized.includes(resolvedCandidate)
    : normalized.some((root) => {
      if (!isPathInside(root, resolvedCandidate)) return false;
      const relative = path.relative(root, resolvedCandidate);
      return relative === '' || relative.split(path.sep).length <= INSTALL_ROOT_MAX_DEPTH;
    });
  if (!allowed) fail('install-root-not-allowed', 'install root is not allowed');
  const physical = inspectPhysical(homePhysical.rootPath, resolvedCandidate, false, fsApi);
  const meta = {kind:'trusted-install-root', physical, homePhysical, allowedRoots:normalized, fsApi};
  return defineCapability({kind:'trusted-install-root', path:physical.path,
    home:homePhysical.rootPath, canonicalHome:homePhysical.rootRealPath,
    limits:Object.freeze({maxRoots:INSTALL_ROOT_MAX_ROOTS, maxDepth:INSTALL_ROOT_MAX_DEPTH,
      maxEntries:INSTALL_ROOT_MAX_ENTRIES_PER_ROOT, maxFileBytes:INSTALL_ROOT_MAX_FILE_BYTES,
      maxTotalBytes:INSTALL_ROOT_MAX_TOTAL_BYTES_PER_ROOT})}, meta);
}

function issueTrustedInstallRootCapability(input) {
  return issueTrustedInstallRootWithFs(input, fs);
}

function scanTrustedInstallRoot(capability) {
  const meta = assertCapability(capability, ['trusted-install-root']);
  validateRecordedComponents(meta, meta.fsApi);
  const entries = [];
  let totalBytes = 0;
  function walk(directory, depth) {
    if (depth > INSTALL_ROOT_MAX_DEPTH) fail('install-root-depth-limit', 'install root depth exceeded');
    const names = meta.fsApi.readdirSync(directory).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of names) {
      if (++entries.count > INSTALL_ROOT_MAX_ENTRIES_PER_ROOT) {
        fail('install-root-entry-limit', 'install root entry count exceeded');
      }
      const target = path.join(directory, name);
      const stat = meta.fsApi.lstatSync(target);
      if (stat.isSymbolicLink()) fail('path-capability-link', `linked install entry: ${target}`);
      const relative = path.relative(capability.path, target).split(path.sep).join('/');
      if (stat.isDirectory()) {
        entries.push({path:relative, type:'directory', identity:statIdentity(stat)});
        walk(target, depth + 1);
      } else if (stat.isFile()) {
        if (stat.size > INSTALL_ROOT_MAX_FILE_BYTES) {
          fail('install-root-file-size-limit', `install file too large: ${relative}`);
        }
        totalBytes += stat.size;
        if (totalBytes > INSTALL_ROOT_MAX_TOTAL_BYTES_PER_ROOT) {
          fail('install-root-byte-limit', 'install root byte limit exceeded');
        }
        const bytes = meta.fsApi.readFileSync(target);
        entries.push({path:relative, type:'file', size:stat.size, sha256:sha256(bytes)});
      } else fail('install-root-entry-type', `unsupported install entry: ${relative}`);
    }
  }
  entries.count = 0;
  walk(capability.path, 1);
  delete entries.count;
  return Object.freeze({entries:Object.freeze(entries), totalBytes});
}

function candidatePackageRoots(nodeExecutable, platformValue, fsApi) {
  const api = pathApiFor(nodeExecutable, platformValue);
  const nodeDir = api.dirname(nodeExecutable);
  const candidates = [
    {candidate:api.join(nodeDir, 'node_modules'), prefix:nodeDir},
    {candidate:api.resolve(nodeDir, '..', 'lib', 'node_modules'),
      prefix:api.resolve(nodeDir, '..')},
    {candidate:api.resolve(nodeDir, '..', 'node_modules'), prefix:api.resolve(nodeDir, '..')},
  ];
  const parts = nodeExecutable.split(/[\\/]/);
  const cellar = parts.lastIndexOf('Cellar');
  if (platformValue === 'darwin' && cellar >= 0 && parts[cellar + 1] === 'node' &&
      parts.at(-2) === 'bin' && parts.at(-1) === 'node') {
    const prefix = parts.slice(0, cellar).join(path.sep) || path.sep;
    candidates.push({candidate:path.join(prefix, 'lib', 'node_modules'), prefix});
  }
  return candidates;
}

function inspectExistingRoot(candidate, prefix, fsApi, platformValue, strict = false) {
  const api = pathApiFor(candidate, platformValue);
  const lexicalPrefix = api.resolve(prefix);
  const lexicalCandidate = api.resolve(candidate);
  if (!isPathInside(lexicalPrefix, lexicalCandidate, platformValue)) {
    if (strict) fail('path-capability-outside', 'toolchain root is outside its derived prefix');
    return null;
  }
  try {
    const components = [];
    let cursor = lexicalPrefix;
    for (const segment of ['', ...api.relative(lexicalPrefix, lexicalCandidate).split(api.sep)
      .filter(Boolean)]) {
      if (segment) cursor = api.join(cursor, segment);
      const stat = fsApi.lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        if (strict) fail('path-capability-link', `linked toolchain component: ${cursor}`);
        return null;
      }
      components.push(Object.freeze({path:cursor, identity:statIdentity(stat)}));
    }
    const stat = fsApi.lstatSync(lexicalCandidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const realPrefix = fsApi.realpathSync(lexicalPrefix);
    const real = fsApi.realpathSync(lexicalCandidate);
    if (!isPathInside(realPrefix, real, platformValue)) {
      if (strict) fail('path-capability-outside', 'toolchain root escaped its physical prefix');
      return null;
    }
    return {path:real, identity:statIdentity(stat), lexicalPath:lexicalCandidate,
      prefixPath:lexicalPrefix, prefixRealPath:realPrefix, components:Object.freeze(components)};
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function safePackageName(value) {
  return typeof value === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value) &&
    !value.includes('..');
}

function assertNoLinkComponents(root, target, fsApi, platformValue = process.platform) {
  const api = pathApiFor(root, platformValue);
  const rootResolved = api.resolve(root);
  const targetResolved = api.resolve(target);
  if (!isPathInside(rootResolved, targetResolved, platformValue)) {
    fail('path-capability-outside', 'package path escapes root');
  }
  const relative = api.relative(rootResolved, targetResolved);
  let cursor = rootResolved;
  for (const segment of relative ? relative.split(api.sep) : []) {
    cursor = api.join(cursor, segment);
    const stat = fsApi.lstatSync(cursor);
    if (stat.isSymbolicLink()) fail('path-capability-link', `linked package component: ${cursor}`);
  }
}

function isNativePackageBin(target, fsApi) {
  const fd = fsApi.openSync(target, 'r');
  const prefix = Buffer.alloc(4);
  let read;
  try { read = fsApi.readSync(fd, prefix, 0, 4, 0); } finally { fsApi.closeSync(fd); }
  if (read < 2) return false;
  const hex = prefix.subarray(0, read).toString('hex');
  return hex.startsWith('4d5a') || hex.startsWith('7f454c46') ||
    ['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe'].includes(hex);
}

function packageBinFromRoots(roots, request, fsApi, allowedPackages, platformValue = process.platform) {
  if (!request || !safePackageName(request.package) || typeof request.bin !== 'string' ||
      !/^[A-Za-z0-9._-]+$/.test(request.bin) || !Array.isArray(request.args) ||
      request.args.some((arg) => typeof arg !== 'string' || /[\0\r\n]/.test(arg))) {
    fail('node-toolchain-package-unavailable', 'package-bin request is invalid');
  }
  if (allowedPackages && !allowedPackages.has(request.package)) {
    fail('node-toolchain-package-unavailable', `package is not allowed: ${request.package}`);
  }
  const matches = [];
  for (const root of roots) {
    const rootPath = root.path || root;
    const api = pathApiFor(rootPath, platformValue);
    const packageDir = api.join(rootPath, ...request.package.split('/'));
    const manifestPath = api.join(packageDir, 'package.json');
    try {
      const manifestStat = fsApi.lstatSync(manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 1_048_576) continue;
      const packageReal = fsApi.realpathSync(packageDir);
      const rootReal = fsApi.realpathSync(root.path || root);
      if (!isPathInside(rootReal, packageReal, platformValue)) continue;
      assertNoLinkComponents(rootPath, packageDir, fsApi, platformValue);
      assertNoLinkComponents(rootPath, manifestPath, fsApi, platformValue);
      const manifest = JSON.parse(fsApi.readFileSync(manifestPath, 'utf8'));
      if (manifest.name !== request.package) continue;
      const declared = typeof manifest.bin === 'string'
        ? (request.bin === request.package.split('/').at(-1) ? manifest.bin : null)
        : manifest.bin && manifest.bin[request.bin];
      if (typeof declared !== 'string' || api.isAbsolute(declared) || /[\0\r\n]/.test(declared)) continue;
      const target = api.resolve(packageDir, declared);
      if (!isPathInside(packageDir, target, platformValue)) continue;
      const targetStat = fsApi.lstatSync(target);
      if (!targetStat.isFile() || targetStat.isSymbolicLink()) continue;
      const realTarget = fsApi.realpathSync(target);
      if (!isPathInside(packageReal, realTarget, platformValue)) continue;
      assertNoLinkComponents(rootPath, target, fsApi, platformValue);
      const native = isNativePackageBin(realTarget, fsApi);
      if (native) {
        if (platformValue === 'win32' && !/\.exe$/i.test(realTarget)) continue;
        if (platformValue !== 'win32') fsApi.accessSync(realTarget, fs.constants.X_OK);
      }
      matches.push({target:realTarget, native});
      break;
    } catch (error) {
      if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error;
    }
  }
  const unique = [...new Map(matches.map((match) => [match.target, match])).values()];
  if (unique.length !== 1) fail('node-toolchain-package-unavailable', 'package-bin is unavailable');
  return unique[0];
}

async function issueNodeToolchainWithRuntime(input, runtime) {
  const {fsApi, platform:platformValue, prefixProbeImpl} = runtime;
  if (!input || typeof input.nodeExecutable !== 'string' || typeof input.home !== 'string' ||
      !input.environment || typeof input.environment !== 'object') {
    fail('node-toolchain-input', 'node toolchain input is incomplete');
  }
  const api = platformValue === 'win32' ? path.win32 : path;
  const executable = fsApi.realpathSync(api.resolve(sanitizePathInput(input.nodeExecutable)));
  const executableStat = fsApi.lstatSync(executable);
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
    fail('path-capability-invalid', 'Node executable is not a physical file');
  }
  const home = fsApi.realpathSync(api.resolve(sanitizePathInput(input.home)));
  const roots = [];
  for (const {candidate, prefix} of candidatePackageRoots(executable, platformValue, fsApi)) {
    const existing = inspectExistingRoot(candidate, prefix, fsApi, platformValue);
    if (existing && !roots.some((root) => root.path === existing.path)) roots.push(existing);
  }
  if (platformValue === 'win32' && input.environment.APPDATA !== undefined) {
    const appDataRaw = input.environment.APPDATA;
    if (typeof appDataRaw !== 'string' || !appDataRaw || /[\0\r\n]/.test(appDataRaw) ||
        !pathApiFor(appDataRaw, 'win32').isAbsolute(appDataRaw)) {
      fail('path-capability-invalid', 'APPDATA must be one absolute Windows path');
    }
    const appDataRecord = inspectExistingRoot(appDataRaw, home, fsApi, platformValue, true);
    if (!appDataRecord) fail('path-capability-invalid', 'APPDATA is unavailable');
    const appData = appDataRecord.path;
    if (!isPathInside(home, appData, platformValue)) fail('path-capability-invalid', 'APPDATA is outside HOME');
    const expectedPrefix = pathApiFor(appData, 'win32').join(appData, 'npm');
    const npmCli = (() => {
      try { return packageBinFromRoots(roots, {package:'npm', bin:'npm', args:[]}, fsApi,
        new Set(['npm']), platformValue).target; } catch (error) {
        if (error.code === 'node-toolchain-package-unavailable') return null;
        throw error;
      }
    })();
    if (npmCli) {
      const probe = prefixProbeImpl
        ? await prefixProbeImpl({file:executable, args:[npmCli,'prefix','--global'], shell:false,
          timeoutMs:WINDOWS_NPM_PREFIX_TIMEOUT_MS, maxOutputBytes:WINDOWS_NPM_PREFIX_MAX_OUTPUT_BYTES,
          env:Object.freeze({...input.environment})})
        : await runSupervisedProcess({executable, args:[npmCli,'prefix','--global']}, {
          platform:platformValue, env:input.environment, timeoutMs:WINDOWS_NPM_PREFIX_TIMEOUT_MS,
          maxOutputBytes:WINDOWS_NPM_PREFIX_MAX_OUTPUT_BYTES,
        });
      if (!probe || probe.ok !== true || typeof probe.stdout !== 'string') {
        fail('node-toolchain-prefix-mismatch', 'npm global prefix probe failed');
      }
      const output = probe.stdout.endsWith('\r\n') ? probe.stdout.slice(0, -2)
        : probe.stdout.endsWith('\n') ? probe.stdout.slice(0, -1) : probe.stdout;
      if (!output || /[\r\n]/.test(output) || normalizeForCompare(output, 'win32') !==
          normalizeForCompare(expectedPrefix, 'win32')) {
        fail('node-toolchain-prefix-mismatch', 'npm global prefix does not match APPDATA npm');
      }
      const globalRoot = inspectExistingRoot(pathApiFor(appData, 'win32').join(expectedPrefix,
        'node_modules'), home, fsApi, platformValue, true);
      if (globalRoot && !roots.some((root) => root.path === globalRoot.path)) roots.push(globalRoot);
    }
  }
  const meta = {kind:'node-toolchain', fsApi, executable, executableIdentity:statIdentity(executableStat),
    roots:Object.freeze(roots.map((root) => Object.freeze(root))), platform:platformValue};
  return defineCapability({kind:'node-toolchain', nodeExecutable:executable,
    packageRoots:Object.freeze(roots.map((root) => root.path)), maxRoots:5}, meta);
}

async function issueNodeToolchainCapability(input) {
  try {
    if (!input || typeof input.nodeExecutable !== 'string' ||
        fs.realpathSync(input.nodeExecutable) !== fs.realpathSync(process.execPath)) throw new Error('foreign node');
  } catch (cause) { fail('node-toolchain-active-node', 'production toolchain must use process.execPath', {cause}); }
  try {
    if (typeof input.home !== 'string' || fs.realpathSync(input.home) !== fs.realpathSync(os.homedir())) {
      throw new Error('foreign home');
    }
  } catch (cause) { fail('node-toolchain-home', 'production toolchain must use os.homedir()', {cause}); }
  const environment = input.environment;
  const currentKeys = Object.keys(process.env).sort();
  if (!environment || typeof environment !== 'object' || Array.isArray(environment) ||
      Object.keys(environment).sort().join('\0') !== currentKeys.join('\0') ||
      currentKeys.some((key) => environment[key] !== process.env[key])) {
    fail('node-toolchain-environment', 'production toolchain requires the current environment snapshot');
  }
  return issueNodeToolchainWithRuntime(input, {fsApi:fs, platform:process.platform});
}

function resolveNodePackageBin(capability, request) {
  const meta = assertCapability(capability, ['node-toolchain']);
  const stat = meta.fsApi.lstatSync(meta.executable);
  if (!identitiesEqual(meta.executableIdentity, statIdentity(stat))) {
    fail('path-capability-identity', 'Node executable identity changed');
  }
  for (const root of meta.roots) {
    for (const component of root.components) {
      const current = meta.fsApi.lstatSync(component.path);
      if (current.isSymbolicLink()) {
        fail('path-capability-link', `toolchain component became linked: ${component.path}`);
      }
      if (!identitiesEqual(component.identity, statIdentity(current))) {
        fail('path-capability-identity', `toolchain component identity changed: ${component.path}`);
      }
    }
    if (!isPathInside(root.prefixRealPath, meta.fsApi.realpathSync(root.lexicalPath), meta.platform)) {
      fail('path-capability-outside', `package root escaped derived prefix: ${root.path}`);
    }
  }
  const resolved = packageBinFromRoots(meta.roots, request, meta.fsApi,
    new Set(['npm','@openai/codex','@google/gemini-cli']), meta.platform);
  return resolved.native
    ? {executable:resolved.target, argv:[...request.args]}
    : {executable:meta.executable, argv:[resolved.target, ...request.args]};
}

function revalidatePathCapability(capability, operation = 'access') {
  const meta = assertCapability(capability);
  if (!['project-state','managed-worktree','trusted-install-root'].includes(capability.kind)) {
    fail('path-capability-kind', `capability cannot be used for ${operation}`);
  }
  if (capability.kind === 'managed-worktree') {
    validateRecordedComponents({physical:meta.parentPhysical, fsApi:meta.fsApi}, meta.fsApi);
    const refreshed = validateRecordedComponents(meta, meta.fsApi);
    if (!refreshed.existed) {
      if (operation !== 'git-worktree-add') {
        fail('managed-worktree-missing', 'only git-worktree-add may use a missing managed worktree');
      }
      return capability;
    }
    verifyManagedWorktreeRegistration(capability, meta, refreshed);
    return capability;
  }
  validateRecordedComponents(meta, meta.fsApi);
  return capability;
}

function mkdirParentsSafe(capability, fsApi) {
  const meta = assertCapability(capability, ['project-state']);
  validateRecordedComponents(meta, fsApi);
  const root = meta.physical.rootPath;
  const parent = path.dirname(capability.path);
  const relative = path.relative(root, parent);
  let cursor = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fsApi.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('path-capability-link', `unsafe parent: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      validateRecordedComponents(meta, fsApi);
      fsApi.mkdirSync(cursor);
      const created = fsApi.lstatSync(cursor);
      if (!created.isDirectory() || created.isSymbolicLink()) fail('path-capability-link', `unsafe new parent: ${cursor}`);
    }
  }
}

function atomicWriteWithFs(targetCapability, data, options = {}, fsApi = fs) {
  const meta = assertCapability(targetCapability, ['project-state']);
  if (typeof data !== 'string' && !Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
    fail('atomic-write-data', 'atomic write data must be bytes or string');
  }
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  validateRecordedComponents(meta, fsApi);
  mkdirParentsSafe(targetCapability, fsApi);
  if (targetCapability.role === 'owned-temp') {
    const digest = sha256(bytes);
    const terminal = readOwnedTempTerminal(meta, targetCapability, true);
    if (terminal) {
      meta.state.value = 'removed';
      meta.state.digest = terminal.contentDigest;
      if (terminal.contentDigest !== digest) {
        fail('owned-temp-terminal-conflict', 'terminal producer operation cannot be rewritten');
      }
      return {written:false, adopted:true, terminal:true, sha256:digest};
    }
    if (meta.state.value === 'removed' || meta.state.value === 'consumed') {
      fail('owned-temp-state', `cannot write owned temp in state ${meta.state.value}`);
    }
    if (meta.state.digest && meta.state.digest !== digest) {
      fail('owned-temp-content-conflict', 'owned temp cannot be rewritten with different bytes');
    }
    const ownerBytes = Buffer.from(canonicalJson({version:1, sessionId:targetCapability.sessionId,
      operationId:targetCapability.operationId, purpose:targetCapability.purpose, contentDigest:digest}));
    let targetExists = false;
    try { targetExists = fsApi.lstatSync(targetCapability.path).isFile(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (targetExists || meta.preexistingTarget) {
      let currentOwner;
      try {
        validateRecordedComponents(meta, fsApi);
        currentOwner = readBounded(meta.ownerPath, CLAIM_TICKET_MAX_FILE_BYTES, fsApi,
          'owned-temp-foreign');
      }
      catch (cause) { fail('owned-temp-foreign', 'pre-existing temp has no same-operation owner', {cause}); }
      if (!sameBytes(currentOwner, ownerBytes)) {
        fail('owned-temp-foreign', 'pre-existing temp owner does not match this operation');
      }
    } else {
      try {
        validateRecordedComponents(meta, fsApi);
        writeExclusiveSidecar(meta.ownerPath, ownerBytes, fsApi);
      }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        validateRecordedComponents(meta, fsApi);
        const currentOwner = readBounded(meta.ownerPath, CLAIM_TICKET_MAX_FILE_BYTES, fsApi,
          'owned-temp-foreign');
        if (!sameBytes(currentOwner, ownerBytes)) {
          fail('owned-temp-foreign', 'temp owner belongs to another operation');
        }
      }
    }
    try {
      validateRecordedComponents(meta, fsApi);
      const fd = fsApi.openSync(targetCapability.path, 'wx', options.mode || 0o600);
      try {
        fsApi.writeFileSync(fd, bytes);
        fsApi.fsyncSync(fd);
      } finally { fsApi.closeSync(fd); }
      meta.state.value = 'written';
      meta.state.digest = digest;
      meta.physical = inspectPhysical(meta.physical.rootPath, targetCapability.path, false, fsApi);
      return {written:true, adopted:false, sha256:meta.state.digest};
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      validateRecordedComponents(meta, fsApi);
      const current = fsApi.readFileSync(targetCapability.path);
      const digest = sha256(current);
      if (!current.equals(bytes) || (meta.state.digest && meta.state.digest !== digest)) {
        fail('owned-temp-content-conflict', 'pre-existing owned temp is not byte-identical');
      }
      meta.state.value = 'written';
      meta.state.digest = digest;
      meta.physical = inspectPhysical(meta.physical.rootPath, targetCapability.path, false, fsApi);
      return {written:false, adopted:true, sha256:digest};
    }
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  const temporary = path.join(path.dirname(targetCapability.path),
    `.${path.basename(targetCapability.path)}.tmp.${process.pid}.${nonce}`);
  validateRecordedComponents(meta, fsApi);
  let fd;
  try {
    fd = fsApi.openSync(temporary, 'wx', options.mode || 0o600);
    fsApi.writeFileSync(fd, bytes);
    fsApi.fsyncSync(fd);
  } finally { if (fd !== undefined) fsApi.closeSync(fd); }
  let renamed = false;
  try {
    for (let attempt = 0; attempt <= ATOMIC_RENAME_RETRY_MS.length; attempt++) {
      try {
        validateRecordedComponents(meta, fsApi);
        fsApi.renameSync(temporary, targetCapability.path);
        renamed = true;
        break;
      } catch (error) {
        if (!['EPERM','EACCES'].includes(error.code) || attempt === ATOMIC_RENAME_RETRY_MS.length) throw error;
        sleepSync(ATOMIC_RENAME_RETRY_MS[attempt]);
      }
    }
    try {
      const directoryFd = fsApi.openSync(path.dirname(targetCapability.path), 'r');
      try { fsApi.fsyncSync(directoryFd); } finally { fsApi.closeSync(directoryFd); }
    } catch (error) {
      if (!['EINVAL','ENOTSUP','EISDIR','EPERM','EACCES'].includes(error.code)) throw error;
    }
    meta.physical = inspectPhysical(meta.physical.rootPath, targetCapability.path, false, fsApi);
    return {written:true, adopted:false, sha256:sha256(bytes)};
  } finally {
    if (!renamed) {
      try { fsApi.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function atomicWriteFile(targetCapability, data, options) {
  return atomicWriteWithFs(targetCapability, data, options, fs);
}

function consumeOwnedTemp(capability, {operationId, purpose, expectedDigest}) {
  const meta = assertCapability(capability, ['project-state']);
  if (capability.role !== 'owned-temp' || !validOperationId(operationId) ||
      operationId === capability.operationId || purpose !== capability.purpose ||
      expectedDigest !== meta.state.digest || !['written','consumed','removed'].includes(meta.state.value)) {
    fail('owned-temp-consume', 'owned temp identity/digest/state mismatch');
  }
  validateRecordedComponents(meta, meta.fsApi);
  if (meta.state.value !== 'removed') {
    const current = meta.fsApi.readFileSync(capability.path);
    if (sha256(current) !== expectedDigest) fail('owned-temp-consume', 'owned temp bytes changed');
  } else {
    const terminal = readOwnedTempTerminal(meta, capability, false);
    if (terminal.contentDigest !== expectedDigest) {
      fail('owned-temp-consume', 'terminal owned temp digest changed');
    }
  }
  const consumerBytes = Buffer.from(canonicalJson({version:1, sessionId:capability.sessionId,
    producerOperationId:capability.operationId, consumerOperationId:operationId,
    purpose:capability.purpose, contentDigest:expectedDigest}));
  try {
    validateRecordedComponents(meta, meta.fsApi);
    writeExclusiveSidecar(meta.consumerPath, consumerBytes, meta.fsApi);
    fsyncDirectory(path.dirname(meta.consumerPath), meta.fsApi);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    validateRecordedComponents(meta, meta.fsApi);
    const recorded = readBounded(meta.consumerPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-already-consumed');
    if (!sameBytes(recorded, consumerBytes)) {
      fail('owned-temp-already-consumed', 'owned temp was consumed by another operation');
    }
  }
  if (meta.state.value !== 'removed') meta.state.value = 'consumed';
  return capability;
}

function authenticateOwnedTempConsumer(capability,{operationId,purpose,expectedDigest,allowMissing=false}={}){
  const meta=assertCapability(capability,['project-state']);if(capability.role!=='owned-temp'||!validOperationId(operationId)||
      operationId===capability.operationId||purpose!==capability.purpose||expectedDigest!==meta.state.digest)
    fail('owned-temp-consume','owned temp consumer identity mismatch');validateRecordedComponents(meta,meta.fsApi);let bytes;
  try{bytes=readBounded(meta.consumerPath,CLAIM_TICKET_MAX_FILE_BYTES,meta.fsApi,'owned-temp-consumer-invalid');}
  catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}const consumer=parseCanonicalJson(bytes,
    'owned-temp-consumer-invalid');if(!exactKeys(consumer,['version','sessionId','producerOperationId','consumerOperationId',
      'purpose','contentDigest'])||consumer.version!==1||consumer.sessionId!==capability.sessionId||
      consumer.producerOperationId!==capability.operationId||consumer.consumerOperationId!==operationId||
      consumer.purpose!==purpose||consumer.contentDigest!==expectedDigest)fail('owned-temp-consumer-invalid',
    'owned-temp consumer record is foreign or malformed');return Object.freeze({...consumer});
}

function ownedTempCleanupId(capability, contentDigest, consumerOperationId) {
  return sha256(Buffer.from(canonicalJson({version:1, sessionId:capability.sessionId,
    producerOperationId:capability.operationId, consumerOperationId,
    purpose:capability.purpose, contentDigest}))).slice(0, 32);
}

function requireOwnedTempTerminalPublicationAvailable(meta, cleanupId) {
  validateSessionCapability(meta.sessionCapability);
  for (const candidate of [meta.terminalPath, `${meta.terminalPath}.publish.${cleanupId}`]) {
    try {
      meta.fsApi.lstatSync(candidate);
      fail('owned-temp-terminal-staging-invalid',
        `owned-temp terminal publication path is already occupied: ${candidate}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function readOwnedTempCleanup(meta, capability, allowMissing) {
  validateSessionCapability(meta.sessionCapability);
  let bytes;
  try {
    bytes = readBounded(meta.cleanupPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-cleanup-invalid');
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw error;
  }
  const cleanup = parseCanonicalJson(bytes, 'owned-temp-cleanup-invalid');
  if (!exactKeys(cleanup, ['version','sessionId','producerOperationId','consumerOperationId',
    'purpose','contentDigest','cleanupId','state']) || cleanup.version !== 1 ||
      cleanup.state !== 'cleanup-pending' || cleanup.sessionId !== capability.sessionId ||
      cleanup.producerOperationId !== capability.operationId ||
      cleanup.purpose !== capability.purpose || !/^[0-9a-f]{64}$/.test(cleanup.contentDigest) ||
      !(cleanup.consumerOperationId === null || validOperationId(cleanup.consumerOperationId)) ||
      cleanup.cleanupId !== ownedTempCleanupId(capability, cleanup.contentDigest,
        cleanup.consumerOperationId)) {
    fail('owned-temp-cleanup-invalid', 'owned-temp cleanup record is foreign or malformed');
  }
  cleanupPublishedSidecarStaging(meta.cleanupPath, bytes, meta.fsApi);
  return Object.freeze({record:cleanup, bytes});
}

function readOptionalOwnedBytes(file, maxBytes, fsApi, code) {
  try { return readBounded(file, maxBytes, fsApi, code); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function validateOwnedTempCleanupAuthority(meta) {
  validateSessionCapability(meta.sessionCapability);
  inspectPhysical(meta.sessionCapability.projectRoot, path.dirname(meta.physical.path), false, meta.fsApi);
}

function authenticateOwnedTempCleanupState(meta, capability, cleanup) {
  const ownerBytes = Buffer.from(canonicalJson({version:1, sessionId:capability.sessionId,
    operationId:capability.operationId, purpose:capability.purpose,
    contentDigest:cleanup.record.contentDigest}));
  const ownerQuarantine = `${meta.ownerPath}.remove.${cleanup.record.cleanupId}`;
  const targetQuarantine = `${meta.physical.path}.remove.${cleanup.record.cleanupId}`;
  const ownerCanonical = readOptionalOwnedBytes(meta.ownerPath, CLAIM_TICKET_MAX_FILE_BYTES,
    meta.fsApi, 'owned-temp-cleanup-foreign');
  const ownerQuarantined = readOptionalOwnedBytes(ownerQuarantine, CLAIM_TICKET_MAX_FILE_BYTES,
    meta.fsApi, 'owned-temp-cleanup-foreign');
  const targetCanonical = readOptionalOwnedBytes(meta.physical.path, WORKTREE_MANIFEST_MAX_FILE_BYTES,
    meta.fsApi, 'owned-temp-cleanup-foreign');
  const targetQuarantined = readOptionalOwnedBytes(targetQuarantine,
    WORKTREE_MANIFEST_MAX_FILE_BYTES, meta.fsApi, 'owned-temp-cleanup-foreign');
  if ((ownerCanonical && !sameBytes(ownerCanonical, ownerBytes)) ||
      (ownerQuarantined && !sameBytes(ownerQuarantined, ownerBytes)) ||
      (targetCanonical && sha256(targetCanonical) !== cleanup.record.contentDigest) ||
      (targetQuarantined && sha256(targetQuarantined) !== cleanup.record.contentDigest)) {
    fail('owned-temp-cleanup-foreign', 'owned-temp cleanup residue changed identity or bytes');
  }
  const shape = [Boolean(ownerCanonical), Boolean(ownerQuarantined),
    Boolean(targetCanonical), Boolean(targetQuarantined)].map(Number).join('');
  if (!new Set(['1010','0110','0101','0100','0000']).has(shape)) {
    fail('owned-temp-cleanup-ambiguous', `owned-temp cleanup residue shape is ambiguous: ${shape}`);
  }
  return {ownerQuarantine, targetQuarantine, ownerCanonical:Boolean(ownerCanonical),
    ownerQuarantined:Boolean(ownerQuarantined), targetCanonical:Boolean(targetCanonical),
    targetQuarantined:Boolean(targetQuarantined)};
}

function publishOwnedTempTerminal(meta, capability, cleanup) {
  const terminalBytes = Buffer.from(canonicalJson({version:1, sessionId:capability.sessionId,
    producerOperationId:capability.operationId,
    consumerOperationId:cleanup.record.consumerOperationId, purpose:capability.purpose,
    contentDigest:cleanup.record.contentDigest, cleanupDigest:sha256(cleanup.bytes), state:'removed'}));
  const stagingPath = `${meta.terminalPath}.publish.${cleanup.record.cleanupId}`;
  let staged = false;
  try {
    writeExclusive(stagingPath, terminalBytes, meta.fsApi);
    staged = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = readBounded(stagingPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-terminal-staging-invalid');
    if (existing.length > terminalBytes.length ||
        !sameBytes(existing, terminalBytes.subarray(0, existing.length))) {
      fail('owned-temp-terminal-staging-invalid', 'terminal staging record is foreign');
    }
    if (existing.length === terminalBytes.length) staged = true;
    else {
      meta.fsApi.unlinkSync(stagingPath);
      fsyncDirectory(path.dirname(stagingPath), meta.fsApi);
      writeExclusive(stagingPath, terminalBytes, meta.fsApi);
      staged = true;
    }
  }
  if (!staged) fail('owned-temp-terminal-staging-invalid', 'terminal staging was not published');
  fsyncDirectory(path.dirname(stagingPath), meta.fsApi);
  try {
    meta.fsApi.renameSync(stagingPath, meta.terminalPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const terminal = readBounded(meta.terminalPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-terminal-invalid');
    if (!sameBytes(terminal, terminalBytes)) {
      fail('owned-temp-terminal-conflict', 'another terminal record owns this producer operation');
    }
    const stagedBytes = readBounded(stagingPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-terminal-staging-invalid');
    if (!sameBytes(stagedBytes, terminalBytes)) {
      fail('owned-temp-terminal-staging-invalid', 'terminal staging changed after publication race');
    }
    meta.fsApi.unlinkSync(stagingPath);
  }
  fsyncDirectory(path.dirname(meta.terminalPath), meta.fsApi);
}

function finishOwnedTempCleanup(meta, capability, cleanup) {
  validateOwnedTempCleanupAuthority(meta);
  let stage = authenticateOwnedTempCleanupState(meta, capability, cleanup);
  if (stage.ownerCanonical) {
    validateOwnedTempCleanupAuthority(meta);
    meta.fsApi.renameSync(meta.ownerPath, stage.ownerQuarantine);
    stage = authenticateOwnedTempCleanupState(meta, capability, cleanup);
  }
  if (stage.targetCanonical) {
    validateOwnedTempCleanupAuthority(meta);
    meta.fsApi.renameSync(meta.physical.path, stage.targetQuarantine);
    stage = authenticateOwnedTempCleanupState(meta, capability, cleanup);
  }
  if (stage.targetQuarantined) {
    validateOwnedTempCleanupAuthority(meta);
    meta.fsApi.unlinkSync(stage.targetQuarantine);
    stage = authenticateOwnedTempCleanupState(meta, capability, cleanup);
  }
  if (stage.ownerQuarantined) {
    validateOwnedTempCleanupAuthority(meta);
    meta.fsApi.unlinkSync(stage.ownerQuarantine);
    stage = authenticateOwnedTempCleanupState(meta, capability, cleanup);
  }
  if (stage.ownerCanonical || stage.ownerQuarantined ||
      stage.targetCanonical || stage.targetQuarantined) {
    fail('owned-temp-cleanup-ambiguous', 'owned-temp cleanup did not reach an empty residue state');
  }
  fsyncDirectory(path.dirname(meta.physical.path), meta.fsApi);
  publishOwnedTempTerminal(meta, capability, cleanup);
}

function readOwnedTempTerminal(meta, capability, allowMissing) {
  validateSessionCapability(meta.sessionCapability);
  let bytes;
  try {
    bytes = readBounded(meta.terminalPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-terminal-invalid');
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw error;
  }
  const terminal = parseCanonicalJson(bytes, 'owned-temp-terminal-invalid');
  const cleanup = readOwnedTempCleanup(meta, capability, false);
  if (!exactKeys(terminal, ['version','sessionId','producerOperationId','consumerOperationId',
    'purpose','contentDigest','cleanupDigest','state']) || terminal.version !== 1 ||
      terminal.state !== 'removed' || terminal.sessionId !== capability.sessionId ||
      terminal.producerOperationId !== capability.operationId ||
      terminal.purpose !== capability.purpose || !/^[0-9a-f]{64}$/.test(terminal.contentDigest) ||
      !(terminal.consumerOperationId === null || validOperationId(terminal.consumerOperationId)) ||
      terminal.contentDigest !== cleanup.record.contentDigest ||
      terminal.consumerOperationId !== cleanup.record.consumerOperationId ||
      terminal.cleanupDigest !== sha256(cleanup.bytes)) {
    fail('owned-temp-terminal-invalid', 'terminal owned-temp record is foreign or malformed');
  }
  authenticateOwnedTempCleanupState(meta, capability, cleanup);
  return terminal;
}

function compareRemoveOwnedTemp(capability, expectedDigest) {
  const meta = assertCapability(capability, ['project-state']);
  if (capability.role !== 'owned-temp' || !['written','consumed','removed'].includes(meta.state.value) ||
      expectedDigest !== meta.state.digest) fail('owned-temp-remove', 'owned temp digest/state mismatch');
  validateRecordedComponents(meta, meta.fsApi);
  if (meta.state.value === 'removed') {
    const terminal = readOwnedTempTerminal(meta, capability, false);
    if (terminal.contentDigest !== expectedDigest) {
      fail('owned-temp-remove', 'terminal owned temp digest changed');
    }
    return true;
  }
  const ownerBytes = Buffer.from(canonicalJson({version:1, sessionId:capability.sessionId,
    operationId:capability.operationId, purpose:capability.purpose, contentDigest:expectedDigest}));
  let current;
  try { current = readBounded(capability.path, WORKTREE_MANIFEST_MAX_FILE_BYTES, meta.fsApi,
    'owned-temp-remove'); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (sha256(current) !== expectedDigest) fail('owned-temp-remove', 'owned temp bytes changed');
  const currentOwner = readBounded(meta.ownerPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
    'owned-temp-foreign');
  if (!sameBytes(currentOwner, ownerBytes)) {
    fail('owned-temp-foreign', 'temp owner changed before removal');
  }
  let consumerOperationId = null;
  try {
    const consumerBytes = readBounded(meta.consumerPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-consumer-invalid');
    const consumer = parseCanonicalJson(consumerBytes, 'owned-temp-consumer-invalid');
    if (!exactKeys(consumer, ['version','sessionId','producerOperationId','consumerOperationId',
      'purpose','contentDigest']) || consumer.version !== 1 ||
        consumer.sessionId !== capability.sessionId ||
        consumer.producerOperationId !== capability.operationId ||
        consumer.purpose !== capability.purpose || consumer.contentDigest !== expectedDigest ||
        !validOperationId(consumer.consumerOperationId)) {
      fail('owned-temp-consumer-invalid', 'owned-temp consumer record is foreign or malformed');
    }
    consumerOperationId = consumer.consumerOperationId;
  } catch (error) {
    if (error.code !== 'ENOENT' || meta.state.value === 'consumed') throw error;
  }
  const cleanupId = ownedTempCleanupId(capability, expectedDigest, consumerOperationId);
  const cleanupBytes = Buffer.from(canonicalJson({version:1, sessionId:capability.sessionId,
    producerOperationId:capability.operationId, consumerOperationId, purpose:capability.purpose,
    contentDigest:expectedDigest, cleanupId, state:'cleanup-pending'}));
  try {
    requireOwnedTempTerminalPublicationAvailable(meta, cleanupId);
    validateRecordedComponents(meta, meta.fsApi);
    writeExclusiveSidecar(meta.cleanupPath, cleanupBytes, meta.fsApi);
    fsyncDirectory(path.dirname(meta.cleanupPath), meta.fsApi);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    validateRecordedComponents(meta, meta.fsApi);
    const existing = readBounded(meta.cleanupPath, CLAIM_TICKET_MAX_FILE_BYTES, meta.fsApi,
      'owned-temp-cleanup-invalid');
    if (!sameBytes(existing, cleanupBytes)) {
      fail('owned-temp-cleanup-conflict', 'another cleanup record owns this producer operation');
    }
  }
  const cleanup = readOwnedTempCleanup(meta, capability, false);
  finishOwnedTempCleanup(meta, capability, cleanup);
  meta.physical = inspectPhysical(capability.projectRoot, capability.path, true, meta.fsApi);
  meta.state.value = 'removed';
  return true;
}

const WINDOWS_STREAM_INVENTORY_HELPER_SHA256 = '0b84a5a6710ef5c97f83026606a13f87311b9f2816328abf96c0ccb45d1c292c';
const WINDOWS_STREAM_INVENTORY_PINVOKE_SHA256 = 'feab51e7d72e75438490593f2dc09d860a745f9b6b1a499663c20cdd9c5d372a';

function resolveGitExecutable(environment = process.env, fsApi = fs) {
  const pathValue = typeof environment.PATH === 'string' ? environment.PATH : '';
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory || /[\0\r\n]/.test(directory)) continue;
    const candidate = path.join(directory, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      fsApi.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      const stat = fsApi.lstatSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return fsApi.realpathSync(candidate);
    } catch {}
  }
  fail('worktree-manifest-git-unavailable', 'a physical Git executable was not found on PATH');
}

function safeGitEnvironment(executable) {
  const environment = {};
  for (const key of ['HOME','USERPROFILE','SystemRoot','SYSTEMROOT','TEMP','TMP']) {
    if (typeof process.env[key] === 'string' && !/[\0\r\n]/.test(process.env[key])) {
      environment[key] = process.env[key];
    }
  }
  Object.assign(environment, {
    PATH:path.dirname(executable),
    LC_ALL:'C',
    LANG:'C',
    GIT_OPTIONAL_LOCKS:'0',
    GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:process.platform === 'win32' ? 'NUL' : '/dev/null',
  });
  return environment;
}

function gitOutput(projectCapability, gitCapability, args, fsApi = fs) {
  revalidatePathCapability(projectCapability, 'git-cwd');
  revalidatePathCapability(gitCapability, 'git-metadata');
  const executable = resolveGitExecutable(process.env, fsApi);
  const environment = safeGitEnvironment(executable);
  try {
    return childProcess.execFileSync(executable, args, {
      cwd:projectCapability.path,
      encoding:'utf8',
      stdio:['ignore','pipe','pipe'],
      env:environment,
      windowsHide:true,
    });
  } catch (cause) {
    fail('worktree-manifest-git-failed', `Git failed: ${args.join(' ')}`, {cause});
  }
}

function classifyIgnoredPaths(projectCapability, gitCapability, relativePaths, fsApi) {
  if (relativePaths.length === 0) return new Set();
  revalidatePathCapability(projectCapability, 'git-check-ignore-cwd');
  revalidatePathCapability(gitCapability, 'git-check-ignore-metadata');
  const executable = resolveGitExecutable(process.env, fsApi);
  const environment = safeGitEnvironment(executable);
  try {
    const output = childProcess.execFileSync(executable,
      ['check-ignore', '--stdin', '-z', '--no-index'], {
        cwd:projectCapability.path,
        input:`${relativePaths.join('\0')}\0`,
        encoding:'utf8',
        stdio:['pipe','pipe','pipe'],
        windowsHide:true,
        env:environment,
        maxBuffer:WORKTREE_MANIFEST_MAX_PATH_TOTAL_BYTES + WORKTREE_MANIFEST_MAX_ENTRIES + 1,
      });
    return new Set(output.split('\0').filter(Boolean));
  } catch (error) {
    if (error.status === 1) return new Set();
    fail('worktree-manifest-git-failed', 'git check-ignore failed', {cause:error});
  }
}

function directorySnapshot(directory, fsApi) {
  const stat = fsApi.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('worktree-manifest-entry-type', `directory changed type: ${directory}`);
  }
  const names = fsApi.readdirSync(directory)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return {identity:statIdentity(stat), names};
}

function entrySort(a, b) {
  return Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));
}

function checkManifestBudgets(state, relative, stat) {
  state.entries += 1;
  if (state.entries > WORKTREE_MANIFEST_MAX_ENTRIES) {
    fail('worktree-manifest-entry-limit', 'manifest entry limit exceeded');
  }
  const pathBytes = Buffer.byteLength(relative);
  if (pathBytes > WORKTREE_MANIFEST_MAX_RELATIVE_PATH_BYTES) {
    fail('worktree-manifest-path-limit', `manifest path is too long: ${relative}`);
  }
  state.pathBytes += pathBytes;
  if (state.pathBytes > WORKTREE_MANIFEST_MAX_PATH_TOTAL_BYTES) {
    fail('worktree-manifest-path-byte-limit', 'manifest aggregate path bytes exceeded');
  }
  if (stat && stat.isFile()) {
    if (stat.size > WORKTREE_MANIFEST_MAX_FILE_BYTES) {
      fail('worktree-manifest-file-size-limit', `manifest file is too large: ${relative}`);
    }
    state.fileBytes += stat.size;
    if (state.fileBytes > WORKTREE_MANIFEST_MAX_TOTAL_BYTES) {
      fail('worktree-manifest-byte-limit', 'manifest aggregate file bytes exceeded');
    }
  }
}

function physicalManifestWalk(projectCapability, runtimeExclusions, fsApi) {
  const projectMeta = assertCapability(projectCapability, ['project-state']);
  if (projectCapability.role !== 'project-root') fail('worktree-manifest-project', 'project-root capability required');
  validateRecordedComponents(projectMeta, fsApi);
  const exactExclusions = new Map();
  for (const capability of runtimeExclusions || []) {
    const meta = assertCapability(capability, ['project-state']);
    if (capability.projectRoot !== projectCapability.path ||
        ['project-root','git-root'].includes(capability.role)) {
      fail('worktree-manifest-exclusion', 'runtime exclusion is foreign or has an invalid role');
    }
    validateRecordedComponents(meta, fsApi);
    exactExclusions.set(capability.path, capability);
  }
  const entries = [];
  const directories = [];
  const typedRows = [{version:1, id:0, kind:'root', relative_path:null,
    absolutePath:projectCapability.path,
    identity:statIdentity(fsApi.lstatSync(projectCapability.path))}];
  const windowsKeys = new Map();
  const exactPaths = new Set();
  const budgets = {entries:0, pathBytes:0, fileBytes:0};

  function addEntry(relative, absolute, stat, extra = {}) {
    const portable = canonicalizePortableProjectPathV1(relative);
    if (exactPaths.has(portable.path)) fail('worktree-manifest-path-collision', `duplicate path: ${relative}`);
    const collision = windowsKeys.get(portable.windowsKey);
    if (collision && collision !== portable.path) {
      fail('worktree-manifest-case-collision', `${collision} collides with ${portable.path}`);
    }
    exactPaths.add(portable.path);
    windowsKeys.set(portable.windowsKey, portable.path);
    checkManifestBudgets(budgets, portable.path, extra.excluded ? null : stat);
    let entry;
    if (extra.missing) {
      entry = {path:portable.path, windowsKey:portable.windowsKey, type:'missing', excluded:true,
        exclusionRole:extra.exclusionRole};
    } else if (extra.excluded) {
      entry = {path:portable.path, windowsKey:portable.windowsKey,
        type:stat.isDirectory() ? 'directory' : stat.isFile() ? 'file'
          : stat.isSymbolicLink() ? 'link' : 'other',
        identity:statIdentity(stat), excluded:true, exclusionRole:extra.exclusionRole};
    } else if (stat.isDirectory()) {
      entry = {path:portable.path, windowsKey:portable.windowsKey, type:'directory', mode:stat.mode,
        identity:statIdentity(stat), ...extra};
      typedRows.push({version:1, id:typedRows.length, kind:'directory', relative_path:portable.path,
        absolutePath:absolute, identity:statIdentity(stat)});
    } else if (stat.isFile()) {
      const bytes = fsApi.readFileSync(absolute);
      if (bytes.length !== stat.size) fail('worktree-manifest-unstable', `file size changed: ${relative}`);
      const after = fsApi.lstatSync(absolute);
      if (!identitiesEqual(statIdentity(stat), statIdentity(after)) || after.size !== stat.size) {
        fail('worktree-manifest-unstable', `file changed during read: ${relative}`);
      }
      entry = {path:portable.path, windowsKey:portable.windowsKey, type:'file', mode:stat.mode,
        size:stat.size, sha256:sha256(bytes), identity:statIdentity(stat), ...extra};
      typedRows.push({version:1, id:typedRows.length, kind:'file', relative_path:portable.path,
        absolutePath:absolute, identity:statIdentity(stat)});
    } else if (stat.isSymbolicLink()) {
      const target = fsApi.readlinkSync(absolute);
      entry = {path:portable.path, windowsKey:portable.windowsKey, type:'link', mode:stat.mode,
        targetSha256:sha256(Buffer.from(target)), target, ...extra};
    } else {
      fail('worktree-manifest-entry-type', `unsupported entry type: ${relative}`);
    }
    entries.push(entry);
  }

  function walk(directory, relativeDirectory) {
    const before = directorySnapshot(directory, fsApi);
    directories.push({path:directory, before});
    for (const name of before.names) {
      const absolute = path.join(directory, name);
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = fsApi.lstatSync(absolute);
      const exactExcluded = exactExclusions.get(absolute);
      const closedExcluded = stat.isDirectory() && CLOSED_CACHE_ROOTS.has(name);
      if (exactExcluded || closedExcluded) {
        addEntry(relative, absolute, stat, {excluded:true,
          exclusionRole:exactExcluded ? exactExcluded.role : 'closed-cache-root'});
        continue;
      }
      addEntry(relative, absolute, stat);
      if (stat.isDirectory()) walk(absolute, relative);
    }
  }
  walk(projectCapability.path, '');
  for (const [absolute, capability] of exactExclusions) {
    if (entries.some((entry) => entry.path === path.relative(projectCapability.path, absolute)
      .split(path.sep).join('/'))) continue;
    const relative = path.relative(projectCapability.path, absolute).split(path.sep).join('/');
    addEntry(relative, absolute, null, {missing:true, exclusionRole:capability.role});
  }
  return {entries, directories, typedRows, budgets};
}

function powershellPath(environment, fsApi) {
  const systemRoot = environment.SystemRoot || environment.SYSTEMROOT;
  if (typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot) || /[\0\r\n]/.test(systemRoot)) {
    fail('worktree-manifest-stream-helper-unavailable', 'SystemRoot is unavailable');
  }
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const stat = fsApi.lstatSync(executable);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a physical file');
    return fsApi.realpathSync(executable);
  } catch (cause) {
    fail('worktree-manifest-stream-helper-unavailable', 'canonical Windows PowerShell is unavailable', {cause});
  }
}

function extractPinnedPInvokeSource(helperBytes) {
  const source = helperBytes.toString('utf8');
  const begin = source.indexOf('# DEEP_WORK_PINVOKE_SOURCE_BEGIN');
  const end = source.indexOf('# DEEP_WORK_PINVOKE_SOURCE_END');
  if (begin < 0 || end <= begin) fail('worktree-manifest-stream-helper-changed', 'P/Invoke markers are missing');
  const lineStart = source.indexOf('\n', begin) + 1;
  return source.slice(lineStart, end);
}

function parseStreamInventoryOutput(output, typedRows) {
  const lines = output === '' ? [] : output.replace(/\r\n/g, '\n').split('\n').filter((line) => line !== '');
  if (lines.length !== typedRows.length) {
    fail('worktree-manifest-stream-result-set', 'stream inventory row count differs');
  }
  const results = [];
  const seen = new Set();
  for (const line of lines) {
    if (Buffer.byteLength(line) > 1_048_576) fail('worktree-manifest-stream-output', 'stream output row too large');
    let row;
    try { row = JSON.parse(line); }
    catch (cause) { fail('worktree-manifest-stream-output', 'malformed stream output', {cause}); }
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        Object.keys(row).sort().join(',') !== 'id,kind,streams,version' || row.version !== 1 ||
        !Number.isInteger(row.id) || seen.has(row.id) || !Array.isArray(row.streams)) {
      fail('worktree-manifest-stream-output', 'invalid stream result schema');
    }
    seen.add(row.id);
    const expected = typedRows[row.id];
    if (!expected || row.kind !== expected.kind) fail('worktree-manifest-stream-result-set', 'foreign stream result');
    const streamSeen = new Set();
    const streams = row.streams.map((stream) => {
      if (!stream || typeof stream !== 'object' || Array.isArray(stream) ||
          Object.keys(stream).sort().join(',') !== 'name,size' || typeof stream.name !== 'string' ||
          /[\uD800-\uDFFF]/u.test(stream.name) || !Number.isSafeInteger(stream.size) || stream.size < 0 ||
          streamSeen.has(stream.name)) {
        fail('worktree-manifest-stream-output', 'invalid or duplicate stream');
      }
      streamSeen.add(stream.name);
      return {name:stream.name, size:stream.size};
    }).sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
    results[row.id] = {version:1, id:row.id, kind:row.kind, streams};
  }
  for (let id = 0; id < typedRows.length; id++) {
    if (!results[id]) fail('worktree-manifest-stream-result-set', `missing stream result ${id}`);
  }
  return results;
}

function enforceNoNamedWindowsStreams(results, typedRows) {
  for (let id = 0; id < typedRows.length; id++) {
    const expected = typedRows[id];
    const streams = results[id].streams;
    const named = streams.filter((stream) => stream.name !== '::$DATA');
    if (named.length > 0 || (expected.kind === 'file' &&
        (streams.length !== 1 || streams[0].name !== '::$DATA'))) {
      fail('worktree-manifest-alternate-stream',
        `alternate stream on ${expected.relative_path || '<root>'}`);
    }
  }
}

function validateWindowsStreamInventoryExecution(execution, typedRows) {
  const result = execution && execution.result;
  const innerError = result && result.error;
  const envelopeError = execution && execution.envelopeError;
  const stages = result && result.stages || envelopeError && envelopeError.stages || null;
  if (!execution || execution.error || execution.status !== 0 || execution.signal ||
      execution.stderr !== '' || !result || result.ok !== true || result.stderr !== '' ||
      typeof result.stdout !== 'string' ||
      Buffer.byteLength(result.stdout) > WINDOWS_STREAM_INVENTORY_MAX_OUTPUT_BYTES) {
    const timedOut = execution && execution.error && execution.error.code === 'ETIMEDOUT' ||
      result && result.timedOut === true || innerError && innerError.code === 'process-timeout' ||
      envelopeError && envelopeError.code === 'process-timeout';
    fail(timedOut
      ? 'worktree-manifest-stream-timeout' : 'worktree-manifest-stream-helper-failed',
    'Windows stream helper did not complete cleanly',
    {cause:execution && execution.error, status:execution && execution.status,
      signal:execution && execution.signal, envelopeError, innerError, stages});
  }
  return parseStreamInventoryOutput(result.stdout, typedRows);
}

function runWindowsStreamInventory(projectCapability, typedRows, fsApi, environment) {
  const helper = path.join(__dirname, 'windows-stream-inventory.ps1');
  const helperBytes = fsApi.readFileSync(helper);
  if (sha256(helperBytes) !== WINDOWS_STREAM_INVENTORY_HELPER_SHA256 ||
      sha256(Buffer.from(extractPinnedPInvokeSource(helperBytes))) !== WINDOWS_STREAM_INVENTORY_PINVOKE_SHA256) {
    fail('worktree-manifest-stream-helper-changed', 'Windows stream helper digest changed');
  }
  const executable = powershellPath(environment, fsApi);
  const projected = typedRows.map(({version, id, kind, relative_path}) =>
    JSON.stringify({version, id, kind, relative_path})).join('\n') + '\n';
  const projectedBytes = Buffer.from(projected);
  if (projectedBytes.length > WINDOWS_STREAM_INVENTORY_MAX_INPUT_BYTES) {
    fail('worktree-manifest-stream-input', 'Windows stream inventory input is too large');
  }
  const tempCandidate = environment.TEMP || environment.TMP || os.tmpdir();
  if (typeof tempCandidate !== 'string' || !path.win32.isAbsolute(tempCandidate) ||
      /[\x00-\x1f\x7f]/u.test(tempCandidate)) {
    fail('worktree-manifest-stream-helper-unavailable', 'Windows temporary directory is invalid');
  }
  const fixedEnv = {
    SystemRoot:environment.SystemRoot || environment.SYSTEMROOT,
    WINDIR:environment.SystemRoot || environment.SYSTEMROOT,
    TEMP:tempCandidate,
    TMP:tempCandidate,
    PATH:'',
    PSModulePath:'',
  };
  const request = JSON.stringify({
    spec:{executable, args:['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-File',helper,'-RootPath',projectCapability.path,'-ExpectedRows',String(typedRows.length),
      '-ExpectedInputBytes',String(projectedBytes.length)]},
    options:{platform:'win32', env:fixedEnv, timeoutMs:WINDOWS_STREAM_INVENTORY_TIMEOUT_MS,
      maxOutputBytes:WINDOWS_STREAM_INVENTORY_MAX_OUTPUT_BYTES,
      cwd:projectCapability.path},
    input:projectedBytes.toString('base64'),
  });
  const supervised = childProcess.spawnSync(process.execPath,
    [path.join(__dirname, 'process-supervisor.js'), '--windows-stream-inventory-supervisor'], {
      input:request,
      encoding:'utf8',
      shell:false,
      windowsHide:true,
      timeout:WINDOWS_STREAM_INVENTORY_TIMEOUT_MS + 5_000,
      maxBuffer:(WINDOWS_STREAM_INVENTORY_MAX_OUTPUT_BYTES * 2) + 1_048_576,
      env:fixedEnv,
    });
  let envelope;
  try { envelope = JSON.parse(supervised.stdout || ''); } catch {}
  const result = envelope && envelope.ok ? envelope.result : null;
  return validateWindowsStreamInventoryExecution({error:supervised.error, status:supervised.status,
    signal:supervised.signal, stderr:supervised.stderr, result,
    envelopeError:envelope && envelope.error}, typedRows);
}

function revalidateManifestRows(rows, fsApi) {
  for (const row of rows) {
    const stat = fsApi.lstatSync(row.absolutePath);
    if (stat.isSymbolicLink() || !identitiesEqual(row.identity, statIdentity(stat)) ||
        (row.kind === 'root' && !stat.isDirectory()) ||
        (row.kind === 'directory' && !stat.isDirectory()) ||
        (row.kind === 'file' && !stat.isFile())) {
      fail('worktree-manifest-unstable', `typed inventory row changed: ${row.relative_path || '<root>'}`);
    }
    if (fsApi.realpathSync(row.absolutePath) !== row.absolutePath) {
      fail('worktree-manifest-unstable', `typed inventory row changed realpath: ${row.relative_path || '<root>'}`);
    }
  }
}

function readGitManifestIdentity(projectCapability, gitCapability, fsApi) {
  const head = gitOutput(projectCapability, gitCapability, ['rev-parse','--verify','HEAD'], fsApi).trim();
  if (!/^[0-9a-f]{40,64}$/.test(head)) fail('worktree-manifest-git', 'HEAD is invalid');
  const indexPath = gitOutput(projectCapability, gitCapability, ['rev-parse','--git-path','index'], fsApi).trim();
  const absoluteIndex = path.isAbsolute(indexPath) ? indexPath : path.join(projectCapability.path, indexPath);
  let indexBytes = Buffer.alloc(0);
  try { indexBytes = fsApi.readFileSync(absoluteIndex); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {head, index:sha256(indexBytes)};
}

function revalidateManifestEntries(projectCapability, entries, fsApi) {
  for (const entry of entries) {
    const absolute = path.join(projectCapability.path, ...entry.path.split('/'));
    if (entry.type === 'missing') {
      try {
        fsApi.lstatSync(absolute);
        fail('worktree-manifest-unstable', `excluded missing path appeared: ${entry.path}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      continue;
    }
    const stat = fsApi.lstatSync(absolute);
    if (stat.isSymbolicLink() && process.platform === 'win32') {
      fail('worktree-manifest-reparse', `Windows reparse entry is ambiguous: ${entry.path}`);
    }
    if (entry.identity && !identitiesEqual(entry.identity, statIdentity(stat))) {
      fail('worktree-manifest-unstable', `entry identity changed: ${entry.path}`);
    }
    if (entry.excluded) {
      continue;
    }
    if (entry.type === 'file') {
      const bytes = fsApi.readFileSync(absolute);
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
        fail('worktree-manifest-unstable', `file changed after capture: ${entry.path}`);
      }
    } else if (entry.type === 'link') {
      if (!stat.isSymbolicLink() || fsApi.readlinkSync(absolute) !== entry.target) {
        fail('worktree-manifest-unstable', `link changed after capture: ${entry.path}`);
      }
    } else if (entry.type === 'directory' && !stat.isDirectory()) {
      fail('worktree-manifest-unstable', `directory changed type: ${entry.path}`);
    }
  }
}

function captureManifestWithRuntime(input, runtime) {
  const {fsApi, platform:platformValue, manifestWalkerImpl, windowsStreamInventoryImpl} = runtime;
  const {projectCapability, gitCapability, runtimeExclusions = []} = input || {};
  assertCapability(projectCapability, ['project-state']);
  assertCapability(gitCapability, ['project-state']);
  if (gitCapability.role !== 'git-root' || gitCapability.projectRoot !== projectCapability.path) {
    fail('worktree-manifest-git', 'matching git-root capability required');
  }
  const gitBefore = readGitManifestIdentity(projectCapability, gitCapability, fsApi);
  let walk;
  if (manifestWalkerImpl) {
    walk = manifestWalkerImpl({projectCapability, gitCapability, runtimeExclusions});
    if (!walk || !Array.isArray(walk.entries)) fail('worktree-manifest-walker', 'test walker result invalid');
    if (walk.entries.length > WORKTREE_MANIFEST_MAX_ENTRIES) {
      fail('worktree-manifest-entry-limit', 'manifest entry limit exceeded');
    }
    const budgets = {entries:0, pathBytes:0, fileBytes:0};
    const exact = new Set();
    const windows = new Map();
    for (const entry of walk.entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          !['file','directory','link','missing'].includes(entry.type)) {
        fail('worktree-manifest-walker', 'test walker entry is invalid');
      }
      const portable = canonicalizePortableProjectPathV1(entry.path);
      if (exact.has(portable.path)) fail('worktree-manifest-path-collision', 'duplicate walker path');
      if (windows.has(portable.windowsKey) && windows.get(portable.windowsKey) !== portable.path) {
        fail('worktree-manifest-case-collision', 'walker Windows-key collision');
      }
      exact.add(portable.path);
      windows.set(portable.windowsKey, portable.path);
      const size = entry.type === 'file' ? entry.size : 0;
      if (!Number.isSafeInteger(size) || size < 0) fail('worktree-manifest-file-size-limit', 'invalid walker file size');
      checkManifestBudgets(budgets, portable.path, {
        isFile:() => entry.type === 'file',
        size,
      });
    }
    walk.directories ||= [];
    walk.typedRows ||= [];
    walk.budgets = budgets;
  } else walk = physicalManifestWalk(projectCapability, runtimeExclusions, fsApi);

  const streamPolicy = Object.freeze({version:1, namedStreams:Object.freeze([])});
  if (platformValue === 'win32') {
    if (walk.typedRows.length === 0) fail('worktree-manifest-stream-result-set', 'typed inventory is empty');
    revalidateManifestRows(walk.typedRows, fsApi);
    const invokeInventory = (pass) => windowsStreamInventoryImpl
      ? validateWindowsStreamInventoryExecution(windowsStreamInventoryImpl(Object.freeze({
        pass, projectCapability, typedRows:Object.freeze([...walk.typedRows]),
      })), walk.typedRows)
      : runWindowsStreamInventory(projectCapability, walk.typedRows, fsApi, process.env);
    const first = invokeInventory(1);
    revalidateManifestRows(walk.typedRows, fsApi);
    const second = invokeInventory(2);
    if (canonicalJson(first) !== canonicalJson(second)) {
      fail('worktree-manifest-alternate-stream', 'Windows stream inventory changed between passes');
    }
    enforceNoNamedWindowsStreams(second, walk.typedRows);
  }

  const ignored = classifyIgnoredPaths(projectCapability, gitCapability,
    walk.entries.filter((entry) => entry.type !== 'missing').map((entry) => entry.path), fsApi);
  for (const directory of walk.directories) {
    const after = directorySnapshot(directory.path, fsApi);
    if (!identitiesEqual(directory.before.identity, after.identity) ||
        canonicalJson(directory.before.names) !== canonicalJson(after.names)) {
      fail('worktree-manifest-unstable', `directory changed during traversal: ${directory.path}`);
    }
  }
  if (!manifestWalkerImpl) revalidateManifestEntries(projectCapability, walk.entries, fsApi);
  const entries = walk.entries.map((entry) => Object.freeze({...entry,
    ignored:entry.type === 'missing' ? false : ignored.has(entry.path)})).sort(entrySort);
  const gitAfter = readGitManifestIdentity(projectCapability, gitCapability, fsApi);
  if (gitBefore.head !== gitAfter.head || gitBefore.index !== gitAfter.index) {
    fail('worktree-manifest-unstable', 'Git HEAD or index changed during manifest capture');
  }
  const body = {version:1, head:gitAfter.head, index:gitAfter.index, entries,
    exclusions:runtimeExclusions.map((capability) => ({path:path.relative(projectCapability.path,
      capability.path).split(path.sep).join('/'), role:capability.role})).sort(entrySort),
    budgets:walk.budgets,
    streamPolicy};
  return Object.freeze({...body, entries:Object.freeze(entries), sha256:sha256(Buffer.from(canonicalJson(body)))});
}

function captureWorktreeManifest(input) {
  return captureManifestWithRuntime(input, {fsApi:fs, platform:process.platform});
}

function validateProcessArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || /[\0\r\n]/.test(arg))) {
    fail('process-spec-invalid', 'process args must be control-free strings');
  }
}

function resolveProjectOrInstallBin(capability, request, fsApi, platformValue) {
  const meta = assertCapability(capability);
  let roots;
  const api = pathApiFor(capability.path, platformValue);
  if (capability.kind === 'project-state' && capability.role === 'project-root') {
    validateRecordedComponents(meta, fsApi);
    roots = [{path:api.join(capability.path, 'node_modules')}];
  } else if (capability.kind === 'trusted-install-root') {
    validateRecordedComponents(meta, fsApi);
    roots = [{path:api.join(capability.path, 'node_modules')}];
  } else fail('process-package-owner', 'package owner capability is invalid');
  return packageBinFromRoots(roots, request, fsApi, undefined, platformValue);
}

function sanitizeEnvironment(environment, platformValue = process.platform) {
  const source = environment === undefined ? process.env : environment;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('process-env-invalid', 'environment must be an object');
  }
  const output = {};
  const windowsKeys = new Set();
  for (const [key, value] of Object.entries(source)) {
    const validKey = platformValue === 'win32'
      ? Boolean(key) && !/[\0\r\n=]/.test(key)
      : /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
    if (!validKey || typeof value !== 'string' || /[\0\r\n]/.test(value)) {
      fail('process-env-invalid', `invalid environment entry: ${key}`);
    }
    if (platformValue === 'win32') {
      const folded = key.toLowerCase();
      if (windowsKeys.has(folded)) {
        fail('process-env-invalid', `case-insensitive duplicate environment entry: ${key}`);
      }
      windowsKeys.add(folded);
    }
    output[key] = value;
  }
  return Object.freeze(output);
}

function environmentValue(environment, key, platformValue) {
  if (platformValue !== 'win32') return environment[key];
  const folded = key.toLowerCase();
  const match = Object.keys(environment).find((candidate) => candidate.toLowerCase() === folded);
  return match === undefined ? undefined : environment[match];
}

function nativeExecutable(executable, platformValue, environment, fsApi) {
  const api = pathApiFor(executable || '', platformValue);
  const basename = api.basename(executable || '').toLowerCase();
  if (typeof executable !== 'string' || /[\0\r\n;&|`$]/.test(executable) || !api.isAbsolute(executable) ||
      /\.(?:cmd|bat)$/i.test(executable) || (platformValue === 'win32' && !/\.exe$/i.test(executable))) {
    fail('process-native-executable', 'native executable must be an absolute physical executable');
  }
  if (FORBIDDEN_SHELL_EXECUTABLES.has(basename)) {
    fail('process-native-executable', 'shell interpreters are not portable process targets');
  }
  let real;
  try {
    const stat = fsApi.lstatSync(executable);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a physical file');
    if (platformValue !== 'win32') fsApi.accessSync(executable, fs.constants.X_OK);
    real = fsApi.realpathSync(executable);
  } catch (cause) { fail('process-native-executable', 'native executable is unavailable', {cause}); }
  if (real !== fsApi.realpathSync(process.execPath)) {
    const delimiter = platformValue === 'win32' ? ';' : path.delimiter;
    const pathValue = environmentValue(environment, 'PATH', platformValue) || '';
    const allowed = pathValue.split(delimiter).filter(Boolean).some((directory) => {
      try { return isPathInside(fsApi.realpathSync(directory), real, platformValue); } catch { return false; }
    });
    if (!allowed) fail('process-native-executable', 'native executable is outside sanitized PATH');
  }
  return real;
}

async function spawnWithRuntime(processSpec, options, runtime) {
  if (!processSpec || typeof processSpec !== 'object' || Array.isArray(processSpec) ||
      !['native-executable','node-package-bin'].includes(processSpec.kind)) {
    fail('process-spec-invalid', 'closed process spec kind is required');
  }
  const expectedSpecKeys = processSpec.kind === 'native-executable'
    ? ['args','executable','kind'] : ['args','bin','kind','package'];
  if (Object.keys(processSpec).sort().join(',') !== expectedSpecKeys.join(',')) {
    fail('process-spec-invalid', 'process spec has unknown or missing fields');
  }
  const allowedOptions = new Set(['cwdCapability','projectCapability','installCapability',
    'nodeToolchainCapability','env','timeoutMs','maxOutputBytes']);
  for (const key of Object.keys(options || {})) {
    if (!allowedOptions.has(key)) fail('process-option-invalid', `unsupported production option: ${key}`);
  }
  const env = sanitizeEnvironment(options && options.env, runtime.platform);
  validateProcessArgs(processSpec.args);
  let executable;
  let argv;
  if (processSpec.kind === 'native-executable') {
    executable = nativeExecutable(processSpec.executable, runtime.platform, env, runtime.fsApi);
    argv = [...processSpec.args];
  } else {
    const owners = [options && options.projectCapability, options && options.installCapability,
      options && options.nodeToolchainCapability].filter(Boolean);
    if (owners.length !== 1) fail('process-package-owner', 'exactly one package owner is required');
    if (owners[0].kind === 'node-toolchain') {
      const resolved = resolveNodePackageBin(owners[0], processSpec);
      executable = resolved.executable;
      argv = resolved.argv;
    } else {
      const bin = resolveProjectOrInstallBin(owners[0], processSpec, runtime.fsApi, runtime.platform);
      executable = bin.native ? bin.target : fs.realpathSync(process.execPath);
      argv = bin.native ? [...processSpec.args] : [bin.target, ...processSpec.args];
    }
  }
  let cwd = process.cwd();
  if (options && options.cwdCapability) {
    if (options.cwdCapability.kind !== 'project-state' && options.cwdCapability.kind !== 'managed-worktree') {
      fail('process-cwd-invalid', 'cwd requires a project-state or managed-worktree capability');
    }
    cwd = revalidatePathCapability(options.cwdCapability, 'process-cwd').path;
    const stat = runtime.fsApi.lstatSync(cwd);
    if (!stat.isDirectory()) fail('process-cwd-invalid', 'process cwd must be a directory');
  } else if (options && options.projectCapability) {
    if (options.projectCapability.kind !== 'project-state' ||
        options.projectCapability.role !== 'project-root') {
      fail('process-cwd-invalid', 'project cwd requires project-root capability');
    }
    cwd = revalidatePathCapability(options.projectCapability, 'process-cwd').path;
  }
  const result = await runSupervisedProcess({executable, args:argv}, {
    cwd,
    env,
    timeoutMs:options && options.timeoutMs,
    maxOutputBytes:options && options.maxOutputBytes,
    platform:runtime.platform,
    spawnImpl:runtime.spawnImpl,
    terminationImpl:runtime.terminationImpl,
  });
  return Object.freeze({...result, executable, argv:Object.freeze(argv),
    spawnOptions:Object.freeze({shell:false})});
}

function spawnPortable(processSpec, options = {}) {
  return spawnWithRuntime(processSpec, options, {fsApi:fs, platform:process.platform});
}

const DEFAULT_PROCESS_IDENTITY = sha256(Buffer.from(
  `${process.pid}:${process.ppid}:${process.execPath}:${process.uptime()}`)).slice(0, 32);
const PENDING_OPERATION_KINDS = new Set([
  'append-json-line', 'receipt-file-change', 'history-provisional', 'history-finalized',
]);

function defaultLiveness(pid) {
  try {
    process.kill(pid, 0);
    return {status:'alive', reason:'success'};
  } catch (error) {
    if (error.code === 'ESRCH') return {status:'dead', reason:'ESRCH'};
    if (error.code === 'EPERM') return {status:'alive', reason:'EPERM'};
    return {status:'unknown', reason:error.code || 'unknown'};
  }
}

function directoryFsyncOutcome(directory, fsApi) {
  try {
    const fd = fsApi.openSync(directory, 'r');
    try { fsApi.fsyncSync(fd); } finally { fsApi.closeSync(fd); }
    return {supported:true, outcome:'durable', code:null};
  } catch (error) {
    if (['EINVAL','ENOTSUP','EISDIR','EPERM','EACCES'].includes(error.code)) {
      return {supported:false, outcome:'unsupported', code:error.code};
    }
    throw error;
  }
}

function fsyncDirectory(directory, fsApi) {
  return directoryFsyncOutcome(directory, fsApi).supported;
}

function recordLockDirectoryDurability(runtime, stage, directory) {
  let result;
  try { result = directoryFsyncOutcome(directory, runtime.fsApi); }
  catch (error) {
    runtime.lockDurabilityRecords.push(Object.freeze({stage, path:directory,
      supported:true, outcome:'error', code:error.code || 'unknown'}));
    throw error;
  }
  runtime.lockDurabilityRecords.push(Object.freeze({stage, path:directory, ...result}));
  return result.supported;
}

function reachLockTestSeam(runtime, seam, details = {}) {
  if (!LOCK_TEST_SEAMS.has(seam)) fail('lock-test-seam-invalid', `unknown lock test seam: ${seam}`);
  runtime.lockSeamImpl?.(Object.freeze({seam, ...details}));
}

function writeExclusive(file, bytes, fsApi, mode = 0o600) {
  const fd = fsApi.openSync(file, 'wx', mode);
  try {
    fsApi.writeFileSync(fd, bytes);
    fsApi.fsyncSync(fd);
  } finally { fsApi.closeSync(fd); }
}

function writeExclusiveSidecar(file, bytes, fsApi, mode = 0o600) {
  const stagingPath = `${file}.publish.${sha256(bytes)}`;
  for (;;) {
    try {
      writeExclusive(stagingPath, bytes, fsApi, mode);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = readBounded(stagingPath, Math.max(bytes.length, CLAIM_TICKET_MAX_FILE_BYTES),
        fsApi, 'exclusive-sidecar-staging-invalid');
      if (existing.length > bytes.length ||
          !sameBytes(existing, bytes.subarray(0, existing.length))) {
        fail('exclusive-sidecar-staging-invalid',
          'exclusive sidecar staging bytes are foreign or mismatched');
      }
      if (existing.length === bytes.length) break;
      fsApi.unlinkSync(stagingPath);
      fsyncDirectory(path.dirname(stagingPath), fsApi);
    }
  }
  fsyncDirectory(path.dirname(stagingPath), fsApi);
  try {
    fsApi.linkSync(stagingPath, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const staged = readBounded(stagingPath, Math.max(bytes.length, CLAIM_TICKET_MAX_FILE_BYTES),
      fsApi, 'exclusive-sidecar-staging-invalid');
    if (!sameBytes(staged, bytes)) {
      fail('exclusive-sidecar-staging-invalid',
        'exclusive sidecar staging bytes changed before publication');
    }
    fsApi.unlinkSync(stagingPath);
    fsyncDirectory(path.dirname(stagingPath), fsApi);
    throw error;
  }
  fsyncDirectory(path.dirname(file), fsApi);
  fsApi.unlinkSync(stagingPath);
  fsyncDirectory(path.dirname(stagingPath), fsApi);
}

function cleanupPublishedSidecarStaging(file, bytes, fsApi) {
  const stagingPath = `${file}.publish.${sha256(bytes)}`;
  let staged;
  try {
    staged = readBounded(stagingPath, Math.max(bytes.length, CLAIM_TICKET_MAX_FILE_BYTES),
      fsApi, 'exclusive-sidecar-staging-invalid');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!sameBytes(staged, bytes)) {
    fail('exclusive-sidecar-staging-invalid',
      'published exclusive sidecar staging bytes are foreign or mismatched');
  }
  fsApi.unlinkSync(stagingPath);
  fsyncDirectory(path.dirname(stagingPath), fsApi);
}

function writeAtomicRaw(file, bytes, runtime, nonce, durabilityStage) {
  const targetDirectory = path.dirname(file);
  const stagingDirectory = path.dirname(targetDirectory);
  const temporary = path.join(stagingDirectory,
    `.${path.basename(targetDirectory)}.${path.basename(file)}.tmp.${process.pid}.${nonce}`);
  writeExclusive(temporary, bytes, runtime.fsApi);
  try {
    reachLockTestSeam(runtime, 'before-heartbeat-replace', {file, temporary});
    runtime.fsApi.renameSync(temporary, file);
  }
  catch (error) {
    try { runtime.fsApi.unlinkSync(temporary); } catch {}
    throw error;
  }
  recordLockDirectoryDurability(runtime, durabilityStage, targetDirectory);
}

function readBounded(file, maxBytes, fsApi, code) {
  const stat = fsApi.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    fail(code, `invalid or oversized file: ${file}`);
  }
  const bytes = fsApi.readFileSync(file);
  if (bytes.length !== stat.size) fail(code, `file changed during read: ${file}`);
  return bytes;
}

function parseCanonicalJson(bytes, code) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch (cause) { fail(code, 'record is not JSON', {cause}); }
  if (canonicalJson(value) !== bytes.toString('utf8')) fail(code, 'record is not canonical JSON');
  return value;
}

function lockTargetIdentity(capability) {
  const meta = assertCapability(capability, ['project-state']);
  return sha256(Buffer.from(canonicalJson({
    version:1,
    projectRoot:capability.canonicalProjectRoot,
    path:capability.path,
    rootIdentity:meta.physical.rootIdentity,
  })));
}

function claimTicketName(core) {
  return [
    'v2', sha256(Buffer.from(core.targetIdentity)), core.pid, core.processIdentity, core.nonce,
    core.createdAt, core.ticketExpiresAt, 'ticket',
  ].join('.');
}

function parseClaimTicketName(name, targetIdentity) {
  const match = name.match(/^v2\.([0-9a-f]{64})\.(\d+)\.([0-9a-f]{32})\.([0-9a-f]{32})\.(\d+)\.(\d+)\.ticket$/);
  if (!match) return null;
  const pid = Number(match[2]);
  const createdAt = Number(match[5]);
  const ticketExpiresAt = Number(match[6]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(createdAt) ||
      !Number.isSafeInteger(ticketExpiresAt) || ticketExpiresAt !== createdAt + CLAIM_TICKET_ONLY_TTL_MS ||
      match[1] !== sha256(Buffer.from(targetIdentity))) return null;
  return {version:2, targetIdentity, pid, processIdentity:match[3], nonce:match[4],
    createdAt, ticketExpiresAt};
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function validClaimChain({core, ticketBytes, ownerBytes, heartbeatBytes}) {
  const claimCoreBytes = Buffer.from(canonicalJson(core));
  const claimCoreDigest = sha256(claimCoreBytes);
  const ticket = parseCanonicalJson(ticketBytes, 'lock-ticket-invalid');
  const owner = parseCanonicalJson(ownerBytes, 'lock-owner-invalid');
  const heartbeat = parseCanonicalJson(heartbeatBytes, 'lock-heartbeat-invalid');
  const ticketExpected = ['version','claimCoreDigest','targetIdentity','pid','processIdentity','nonce',
    'createdAt','ticketExpiresAt'];
  const ownerExpected = ['version','claimCoreDigest','ticketDigest','pid','processIdentity','nonce',
    'createdAt','ticketExpiresAt'];
  const heartbeatExpected = ['version','ownerCoreDigest','sequence','heartbeatAt'];
  if (!exactKeys(ticket, ticketExpected) || !exactKeys(owner, ownerExpected) ||
      !exactKeys(heartbeat, heartbeatExpected) || ticket.version !== 2 || owner.version !== 2 ||
      heartbeat.version !== 1 || ticket.claimCoreDigest !== claimCoreDigest ||
      ticket.targetIdentity !== core.targetIdentity || ticket.pid !== core.pid ||
      ticket.processIdentity !== core.processIdentity || ticket.nonce !== core.nonce ||
      ticket.createdAt !== core.createdAt || ticket.ticketExpiresAt !== core.ticketExpiresAt ||
      owner.claimCoreDigest !== claimCoreDigest || owner.ticketDigest !== sha256(ticketBytes) ||
      owner.pid !== core.pid || owner.processIdentity !== core.processIdentity ||
      owner.nonce !== core.nonce || owner.createdAt !== core.createdAt ||
      owner.ticketExpiresAt !== core.ticketExpiresAt ||
      heartbeat.ownerCoreDigest !== sha256(ownerBytes) || !Number.isSafeInteger(heartbeat.sequence) ||
      heartbeat.sequence < 0 || !Number.isSafeInteger(heartbeat.heartbeatAt)) {
    fail('lock-chain-invalid', 'claim core/ticket/owner/heartbeat chain is invalid');
  }
  return {ticket, owner, heartbeat, claimCoreDigest, ownerCoreDigest:sha256(ownerBytes)};
}

function readCanonicalClaim(lockPath, claimsDir, targetIdentity, fsApi) {
  const directoryInfo = privateClaimEntries(lockPath, fsApi);
  if (!directoryInfo || !directoryInfo.valid || directoryInfo.names.join(',') !== 'heartbeat.json,owner.json') {
    fail('lock-chain-invalid', 'canonical claim directory has missing or foreign entries');
  }
  const ownerPath = path.join(lockPath, 'owner.json');
  const heartbeatPath = path.join(lockPath, 'heartbeat.json');
  const ownerBytes = readBounded(ownerPath, CLAIM_TICKET_MAX_FILE_BYTES, fsApi, 'lock-owner-invalid');
  const owner = parseCanonicalJson(ownerBytes, 'lock-owner-invalid');
  if (!owner || typeof owner.nonce !== 'string' || typeof owner.processIdentity !== 'string' ||
      !Number.isSafeInteger(owner.pid) || !Number.isSafeInteger(owner.createdAt) ||
      !Number.isSafeInteger(owner.ticketExpiresAt)) fail('lock-owner-invalid', 'owner identity is invalid');
  const core = {version:2, targetIdentity, pid:owner.pid, processIdentity:owner.processIdentity,
    nonce:owner.nonce, createdAt:owner.createdAt, ticketExpiresAt:owner.ticketExpiresAt};
  const ticketPath = path.join(claimsDir, claimTicketName(core));
  const ticketBytes = readBounded(ticketPath, CLAIM_TICKET_MAX_FILE_BYTES, fsApi, 'lock-ticket-invalid');
  const heartbeatBytes = readBounded(heartbeatPath, CLAIM_TICKET_MAX_FILE_BYTES, fsApi,
    'lock-heartbeat-invalid');
  const chain = validClaimChain({core, ticketBytes, ownerBytes, heartbeatBytes});
  return {core, ticketPath, ticketBytes, ownerPath, ownerBytes, heartbeatPath, heartbeatBytes, ...chain};
}

function cleanupOwnedHeartbeatStaging(lockPath, chain, runtime) {
  const directory = path.dirname(lockPath);
  const prefix = `.${path.basename(lockPath)}.heartbeat.json.tmp.${chain.core.pid}.`;
  const names = runtime.fsApi.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && /^[0-9a-f]{32}$/.test(name.slice(prefix.length)))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (names.length === 0) return;
  if (names.length !== 1 || !livenessDead(runtime, chain.core)) {
    for (const name of names) recordDiagnostic(runtime,
      {path:path.join(directory, name), reason:'ambiguous-heartbeat-staging'});
    return;
  }
  const stagingPath = path.join(directory, names[0]);
  let bytes;
  try {
    bytes = readBounded(stagingPath, CLAIM_TICKET_MAX_FILE_BYTES, runtime.fsApi,
      'lock-heartbeat-staging-invalid');
    const heartbeat = parseCanonicalJson(bytes, 'lock-heartbeat-staging-invalid');
    if (!exactKeys(heartbeat, ['version','ownerCoreDigest','sequence','heartbeatAt']) ||
        heartbeat.version !== 1 || heartbeat.ownerCoreDigest !== chain.ownerCoreDigest ||
        heartbeat.sequence !== chain.heartbeat.sequence + 1 ||
        !Number.isSafeInteger(heartbeat.heartbeatAt) ||
        heartbeat.heartbeatAt < chain.heartbeat.heartbeatAt) {
      fail('lock-heartbeat-staging-invalid', 'heartbeat staging is not the exact next owned record');
    }
  } catch (error) {
    if (error.code === 'ENOENT') return;
    recordDiagnostic(runtime, {path:stagingPath, reason:'invalid-heartbeat-staging',
      digest:bytes ? sha256(bytes) : ''});
    return;
  }
  runtime.fsApi.unlinkSync(stagingPath);
  recordLockDirectoryDurability(runtime, 'heartbeat-staging-recovery', directory);
}

function sameBytes(a, b) { return Buffer.compare(a, b) === 0; }

function livenessDead(runtime, core) {
  const result = runtime.livenessImpl(core.pid, core.processIdentity);
  return result && result.status === 'dead' && result.reason === 'ESRCH';
}

function recordDiagnostic(runtime, entry) {
  const key = `${entry.path}:${entry.digest || ''}`;
  if (runtime.diagnosticKeys.has(key)) return;
  runtime.diagnosticKeys.add(key);
  runtime.diagnostics.push(Object.freeze(entry));
  runtime.diagnostics.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (runtime.diagnostics.length > CLAIM_TICKET_REPORT_MAX_ENTRIES) {
    runtime.diagnostics.length = CLAIM_TICKET_REPORT_MAX_ENTRIES;
    runtime.diagnosticOverflow += 1;
  }
}

function ensureClaimsDirectory(lockCapability, runtime) {
  const meta = assertCapability(lockCapability, ['project-state']);
  validateRecordedComponents(meta, runtime.fsApi);
  const claimsDir = `${lockCapability.path}.claims`;
  try {
    runtime.fsApi.mkdirSync(claimsDir);
    recordLockDirectoryDurability(runtime, 'claims-parent', path.dirname(claimsDir));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = runtime.fsApi.lstatSync(claimsDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('lock-claims-invalid', 'claims path is not a directory');
  }
  return claimsDir;
}

function validateClaimsDirectory(claimsDir, expectedIdentity, fsApi) {
  const stat = fsApi.lstatSync(claimsDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      !identitiesEqual(expectedIdentity, statIdentity(stat))) {
    fail('lock-claims-invalid', 'claims directory identity changed');
  }
}

function privateClaimEntries(privatePath, fsApi) {
  let iterator;
  try { iterator = fsApi.opendirSync(privatePath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const names = [];
  try {
    for (;;) {
      const entry = iterator.readSync();
      if (!entry) break;
      names.push(entry.name);
      if (names.length >= CLAIM_PRIVATE_SCAN_MAX_ENTRIES) {
        return {valid:false, names, totalBytes:0};
      }
    }
  } finally { iterator.closeSync(); }
  if (names.some((name) => !['owner.json','heartbeat.json'].includes(name))) {
    return {valid:false, names, totalBytes:0};
  }
  let totalBytes = 0;
  for (const name of names) {
    const target = path.join(privatePath, name);
    const stat = fsApi.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CLAIM_TICKET_MAX_FILE_BYTES) {
      return {valid:false, names, totalBytes};
    }
    totalBytes += stat.size;
    if (totalBytes > CLAIM_TICKET_MAX_FILE_BYTES * CLAIM_PRIVATE_SCAN_MAX_ENTRIES) {
      return {valid:false, names, totalBytes};
    }
  }
  return {valid:true, names:names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    totalBytes};
}

function expectedTicketBytes(core) {
  const claimCoreDigest = sha256(Buffer.from(canonicalJson(core)));
  return Buffer.from(canonicalJson({version:2, claimCoreDigest, targetIdentity:core.targetIdentity,
    pid:core.pid, processIdentity:core.processIdentity, nonce:core.nonce,
    createdAt:core.createdAt, ticketExpiresAt:core.ticketExpiresAt}));
}

function ticketBytesAreOwnedPrefix(core, bytes) {
  const expected = expectedTicketBytes(core);
  return bytes.length <= expected.length && expected.subarray(0, bytes.length).equals(bytes);
}

function privateClaimMatchesOwnedPrefix(core, ticketBytes, privatePath, privateInfo, fsApi) {
  if (!privateInfo) return true;
  if (!privateInfo.valid || !ticketBytes.equals(expectedTicketBytes(core))) return false;
  const ownerPath = path.join(privatePath, 'owner.json');
  const heartbeatPath = path.join(privatePath, 'heartbeat.json');
  const hasOwner = privateInfo.names.includes('owner.json');
  const hasHeartbeat = privateInfo.names.includes('heartbeat.json');
  if (hasHeartbeat && !hasOwner) return false;
  let ownerBytes = null;
  if (hasOwner) {
    ownerBytes = fsApi.readFileSync(ownerPath);
    const expectedOwner = Buffer.from(canonicalJson({version:2,
      claimCoreDigest:sha256(Buffer.from(canonicalJson(core))), ticketDigest:sha256(ticketBytes),
      pid:core.pid, processIdentity:core.processIdentity, nonce:core.nonce,
      createdAt:core.createdAt, ticketExpiresAt:core.ticketExpiresAt}));
    if (!expectedOwner.subarray(0, ownerBytes.length).equals(ownerBytes)) return false;
    if (ownerBytes.length < expectedOwner.length) return !hasHeartbeat;
  }
  if (hasHeartbeat) {
    const heartbeatBytes = fsApi.readFileSync(heartbeatPath);
    if (heartbeatBytes.length === 0) return true;
    if (!heartbeatBytes.toString('utf8').endsWith('\n')) return true;
    try {
      const heartbeat = parseCanonicalJson(heartbeatBytes, 'lock-heartbeat-invalid');
      return exactKeys(heartbeat, ['version','ownerCoreDigest','sequence','heartbeatAt']) &&
        heartbeat.version === 1 && heartbeat.ownerCoreDigest === sha256(ownerBytes) &&
        Number.isSafeInteger(heartbeat.sequence) && heartbeat.sequence >= 0 &&
        Number.isSafeInteger(heartbeat.heartbeatAt);
    } catch { return false; }
  }
  return true;
}

function claimQuarantinePaths(lockPath, nonce, fsApi) {
  const directory = path.dirname(lockPath);
  const prefix = `${path.basename(lockPath)}.claim-quarantine.${nonce}.`;
  const names = fsApi.readdirSync(directory).filter((name) => name.startsWith(prefix))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return names.map((name) => path.join(directory, name));
}

function scanTicketOnlyClaims(lockCapability, claimsDir, claimsIdentity, runtime) {
  validateClaimsDirectory(claimsDir, claimsIdentity, runtime.fsApi);
  const targetIdentity = lockTargetIdentity(lockCapability);
  const iterator = runtime.fsApi.opendirSync(claimsDir);
  const names = [];
  try {
    for (;;) {
      const entry = iterator.readSync();
      if (!entry) break;
      names.push(entry.name);
      if (names.length === CLAIM_TICKET_SCAN_MAX_ENTRIES + 1) {
        fail('claim-ticket-scan-limit', 'claim ticket entry count exceeded');
      }
    }
  } finally { iterator.closeSync(); }
  names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  let totalBytes = 0;
  for (const name of names) {
    const ticketPath = path.join(claimsDir, name);
    const quarantinedTicketMatch = name.match(/^(.*\.ticket)\.quarantine\.([0-9a-f]{32})$/);
    const core = parseClaimTicketName(quarantinedTicketMatch ? quarantinedTicketMatch[1] : name,
      targetIdentity);
    const ticketAlreadyQuarantined = Boolean(quarantinedTicketMatch);
    let stat;
    try { stat = runtime.fsApi.lstatSync(ticketPath); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CLAIM_TICKET_MAX_FILE_BYTES) {
      fail('claim-ticket-scan-limit', 'claim ticket file bound exceeded');
    }
    totalBytes += stat.size;
    if (totalBytes > CLAIM_TICKET_SCAN_MAX_TOTAL_BYTES) {
      fail('claim-ticket-scan-limit', 'claim ticket byte bound exceeded');
    }
    if (!core) {
      recordDiagnostic(runtime, {path:ticketPath, reason:'noncanonical-ticket',
        digest:stat.size ? sha256(runtime.fsApi.readFileSync(ticketPath)) : sha256(Buffer.alloc(0))});
      continue;
    }
    const bytes = runtime.fsApi.readFileSync(ticketPath);
    if (bytes.length !== stat.size) continue;
    if (!ticketBytesAreOwnedPrefix(core, bytes)) {
      recordDiagnostic(runtime, {path:ticketPath, reason:'corrupt-ticket', digest:sha256(bytes)});
      continue;
    }
    if (runtime.clock() <= core.ticketExpiresAt || !livenessDead(runtime, core)) continue;
    const canonicalExistsFirst = runtime.fsApi.existsSync(lockCapability.path);
    const ordinaryPrivatePath = `${lockCapability.path}.claim.${core.nonce}`;
    const releaseResiduePath = `${lockCapability.path}.release.${core.nonce}`;
    const quarantinePaths = claimQuarantinePaths(lockCapability.path, core.nonce, runtime.fsApi);
    const hasOrdinaryPrivate = runtime.fsApi.existsSync(ordinaryPrivatePath);
    const hasReleaseResidue = runtime.fsApi.existsSync(releaseResiduePath);
    const candidates = [hasOrdinaryPrivate ? ordinaryPrivatePath : null,
      hasReleaseResidue ? releaseResiduePath : null, ...quarantinePaths].filter(Boolean);
    if (candidates.length > 1) {
      recordDiagnostic(runtime, {path:ticketPath, reason:'multiple-private-claims', digest:sha256(bytes)});
      continue;
    }
    const privatePath = candidates[0] || ordinaryPrivatePath;
    const privateInfo = privateClaimEntries(privatePath, runtime.fsApi);
    if (privateInfo) {
      totalBytes += privateInfo.totalBytes;
      if (totalBytes > CLAIM_TICKET_SCAN_MAX_TOTAL_BYTES) {
        fail('claim-ticket-scan-limit', 'claim ticket/private byte bound exceeded');
      }
    }
    if (canonicalExistsFirst || !privateClaimMatchesOwnedPrefix(core, bytes, privatePath, privateInfo,
      runtime.fsApi)) {
      recordDiagnostic(runtime, {path:ticketPath, reason:'ambiguous-ticket', digest:sha256(bytes)});
      continue;
    }
    const ticketBytesAgain = runtime.fsApi.readFileSync(ticketPath);
    const privateInfoAgain = privateClaimEntries(privatePath, runtime.fsApi);
    if (!sameBytes(bytes, ticketBytesAgain) || runtime.fsApi.existsSync(lockCapability.path) ||
        JSON.stringify(privateInfo) !== JSON.stringify(privateInfoAgain) ||
        !privateClaimMatchesOwnedPrefix(core, bytes, privatePath, privateInfoAgain, runtime.fsApi) ||
        !livenessDead(runtime, core)) continue;

    const suffix = runtime.nonceFactory();
    const privateAlreadyQuarantined = quarantinePaths.includes(privatePath);
    const privateQuarantine = privateAlreadyQuarantined ? privatePath
      : `${lockCapability.path}.claim-quarantine.${core.nonce}.${suffix}`;
    const ticketQuarantine = ticketAlreadyQuarantined ? ticketPath
      : `${ticketPath}.quarantine.${suffix}`;
    let privateRenamed = privateAlreadyQuarantined;
    try {
      revalidatePathCapability(lockCapability, 'ticket-only-quarantine');
      validateClaimsDirectory(claimsDir, claimsIdentity, runtime.fsApi);
      if (privateInfo && !privateAlreadyQuarantined) {
        runtime.fsApi.renameSync(privatePath, privateQuarantine);
        privateRenamed = true;
      }
      if (!ticketAlreadyQuarantined) runtime.fsApi.renameSync(ticketPath, ticketQuarantine);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EEXIST') continue;
      throw error;
    }
    const quarantinedTicketBytes = readBounded(ticketQuarantine, CLAIM_TICKET_MAX_FILE_BYTES,
      runtime.fsApi, 'lock-ticket-invalid');
    const quarantinedPrivateInfo = privateRenamed
      ? privateClaimEntries(privateQuarantine, runtime.fsApi) : null;
    if (!sameBytes(bytes, quarantinedTicketBytes) ||
        (privateRenamed && (!quarantinedPrivateInfo ||
          !privateClaimMatchesOwnedPrefix(core, quarantinedTicketBytes, privateQuarantine,
            quarantinedPrivateInfo, runtime.fsApi)))) {
      fail('lock-ambiguous', 'quarantined ticket/private ownership changed');
    }
    if (!livenessDead(runtime, core) || runtime.clock() <= core.ticketExpiresAt) {
      fail('lock-ambiguous', 'quarantined ticket owner is no longer provably dead');
    }
    if (privateRenamed) runtime.fsApi.rmSync(privateQuarantine, {recursive:true, force:false});
    runtime.fsApi.unlinkSync(ticketQuarantine);
    recordLockDirectoryDurability(runtime, 'ticket-recovery-cleanup', claimsDir);
  }
}

function tryRecoverCanonicalLock(lockCapability, claimsDir, claimsIdentity, options, runtime) {
  validateClaimsDirectory(claimsDir, claimsIdentity, runtime.fsApi);
  const targetIdentity = lockTargetIdentity(lockCapability);
  const canonicalMissing = () => {
    try { runtime.fsApi.lstatSync(lockCapability.path); return false; }
    catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
  };
  let first;
  try { first = readCanonicalClaim(lockCapability.path, claimsDir, targetIdentity, runtime.fsApi); }
  catch (error) {
    if (error.code === 'ENOENT' || canonicalMissing()) return false;
    try {
      readCanonicalClaim(lockCapability.path, claimsDir, targetIdentity, runtime.fsApi);
    } catch (retryError) {
      if (retryError.code === 'ENOENT' || canonicalMissing()) return false;
      fail('lock-ambiguous', 'canonical lock metadata is missing or invalid', {cause:retryError});
    }
    return false;
  }
  if (runtime.clock() - first.heartbeat.heartbeatAt <= options.staleMs ||
      !livenessDead(runtime, first.core)) return false;
  const second = readCanonicalClaim(lockCapability.path, claimsDir, targetIdentity, runtime.fsApi);
  if (!sameBytes(first.ownerBytes, second.ownerBytes) || !sameBytes(first.ticketBytes, second.ticketBytes) ||
      !sameBytes(first.heartbeatBytes, second.heartbeatBytes) || !livenessDead(runtime, second.core)) return false;
  const suffix = runtime.nonceFactory();
  const quarantine = `${lockCapability.path}.claim-quarantine.${second.core.nonce}.${suffix}`;
  const ticketQuarantine = `${second.ticketPath}.quarantine.${suffix}`;
  revalidatePathCapability(lockCapability, 'stale-lock-quarantine');
  validateClaimsDirectory(claimsDir, claimsIdentity, runtime.fsApi);
  try { runtime.fsApi.renameSync(lockCapability.path, quarantine); }
  catch (error) { if (['ENOENT','EEXIST'].includes(error.code)) return false; throw error; }
  const quarantined = readCanonicalClaim(quarantine, claimsDir, targetIdentity, runtime.fsApi);
  if (!sameBytes(second.ownerBytes, quarantined.ownerBytes) ||
      !sameBytes(second.heartbeatBytes, quarantined.heartbeatBytes) ||
      runtime.clock() - quarantined.heartbeat.heartbeatAt <= options.staleMs ||
      !livenessDead(runtime, quarantined.core)) {
    fail('lock-ambiguous', 'quarantined lock ownership changed');
  }
  validateClaimsDirectory(claimsDir, claimsIdentity, runtime.fsApi);
  runtime.fsApi.renameSync(second.ticketPath, ticketQuarantine);
  const quarantinedTicket = readBounded(ticketQuarantine, CLAIM_TICKET_MAX_FILE_BYTES,
    runtime.fsApi, 'lock-ticket-invalid');
  const quarantinedOwner = readBounded(path.join(quarantine, 'owner.json'),
    CLAIM_TICKET_MAX_FILE_BYTES, runtime.fsApi, 'lock-owner-invalid');
  const quarantinedHeartbeat = readBounded(path.join(quarantine, 'heartbeat.json'),
    CLAIM_TICKET_MAX_FILE_BYTES, runtime.fsApi, 'lock-heartbeat-invalid');
  const quarantinedChain = validClaimChain({core:second.core, ticketBytes:quarantinedTicket,
    ownerBytes:quarantinedOwner, heartbeatBytes:quarantinedHeartbeat});
  if (!sameBytes(second.ownerBytes, quarantinedOwner) ||
      !sameBytes(second.heartbeatBytes, quarantinedHeartbeat) ||
      !sameBytes(second.ticketBytes, quarantinedTicket) ||
      runtime.clock() - quarantinedChain.heartbeat.heartbeatAt <= options.staleMs ||
      !livenessDead(runtime, second.core)) {
    fail('lock-ambiguous', 'two-stage quarantined ownership changed');
  }
  runtime.fsApi.rmSync(quarantine, {recursive:true, force:false});
  runtime.fsApi.unlinkSync(ticketQuarantine);
  cleanupOwnedHeartbeatStaging(lockCapability.path, second, runtime);
  recordLockDirectoryDurability(runtime, 'canonical-recovery-ticket-directory', claimsDir);
  recordLockDirectoryDurability(runtime, 'canonical-recovery-parent',
    path.dirname(lockCapability.path));
  return true;
}

function authenticatePrivateDirectoryClaim(privatePath, claim, runtime) {
  validateClaimsDirectory(claim.claimsDir, claim.claimsIdentity, runtime.fsApi);
  const entries = privateClaimEntries(privatePath, runtime.fsApi);
  if (!entries || !entries.valid || entries.names.join(',') !== 'heartbeat.json,owner.json') {
    fail('lock-chain-invalid', 'private claim directory has missing or foreign entries');
  }
  const ticketBytes = readBounded(claim.ticketPath, CLAIM_TICKET_MAX_FILE_BYTES,
    runtime.fsApi, 'lock-ticket-invalid');
  const ownerBytes = readBounded(path.join(privatePath, 'owner.json'), CLAIM_TICKET_MAX_FILE_BYTES,
    runtime.fsApi, 'lock-owner-invalid');
  const heartbeatBytes = readBounded(path.join(privatePath, 'heartbeat.json'),
    CLAIM_TICKET_MAX_FILE_BYTES, runtime.fsApi, 'lock-heartbeat-invalid');
  if (!sameBytes(ticketBytes, claim.ticketBytes)) {
    fail('lock-ticket-invalid', 'private claim ticket changed before publication');
  }
  if (!sameBytes(ownerBytes, claim.ownerBytes)) {
    fail('lock-owner-invalid', 'private claim owner changed before publication');
  }
  if (!sameBytes(heartbeatBytes, claim.heartbeatBytes)) {
    fail('lock-heartbeat-invalid', 'private claim heartbeat changed before publication');
  }
  validClaimChain({core:claim.core, ticketBytes, ownerBytes, heartbeatBytes});
}

function publishCanonicalDirectoryClaim(privatePath, lockCapability, meta, claim, runtime) {
  for (let attempt = 0; attempt <= ATOMIC_RENAME_RETRY_MS.length; attempt++) {
    validateRecordedComponents(meta, runtime.fsApi);
    authenticatePrivateDirectoryClaim(privatePath, claim, runtime);
    try {
      runtime.fsApi.renameSync(privatePath, lockCapability.path);
      return;
    } catch (error) {
      if (runtime.platform !== 'win32' || !['EPERM','EACCES'].includes(error.code) ||
          attempt === ATOMIC_RENAME_RETRY_MS.length) throw error;
      if (runtime.fsApi.existsSync(lockCapability.path)) {
        const occupied = new Error(`canonical lock already exists: ${lockCapability.path}`);
        occupied.code = 'EEXIST';
        throw occupied;
      }
      sleepSync(ATOMIC_RENAME_RETRY_MS[attempt]);
    }
  }
}

function acquireDirectoryClaim(lockCapability, options, runtime) {
  const meta = assertCapability(lockCapability, ['project-state']);
  if (lockCapability.role !== 'lock') fail('lock-capability-role', 'lock role capability required');
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0 ||
      !Number.isSafeInteger(options.staleMs) || options.staleMs <= 0 ||
      !Number.isSafeInteger(options.heartbeatMs) || options.heartbeatMs <= 0 ||
      options.heartbeatMs >= options.staleMs || !/^[0-9a-f]{32}$/.test(options.processIdentity || '')) {
    fail('lock-options-invalid', 'lock timing or process identity is invalid');
  }
  validateRecordedComponents(meta, runtime.fsApi);
  mkdirParentsSafe(lockCapability, runtime.fsApi);
  const claimsDir = ensureClaimsDirectory(lockCapability, runtime);
  const claimsIdentity = statIdentity(runtime.fsApi.lstatSync(claimsDir));
  const startedAt = runtime.clock();
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    fail('lock-clock-invalid', 'lock clock must be epoch milliseconds');
  }
  const deadline = startedAt + options.timeoutMs;
  const monotonicDeadline = performance.now() + options.timeoutMs;
  for (;;) {
    if (runtime.clock() > deadline || performance.now() > monotonicDeadline) {
      fail('lock-timeout', `timed out acquiring ${lockCapability.path}`);
    }
    scanTicketOnlyClaims(lockCapability, claimsDir, claimsIdentity, runtime);
    if (runtime.fsApi.existsSync(lockCapability.path)) {
      tryRecoverCanonicalLock(lockCapability, claimsDir, claimsIdentity, options, runtime);
      if (runtime.fsApi.existsSync(lockCapability.path)) {
        if (runtime.clock() >= deadline || performance.now() >= monotonicDeadline) {
          fail('lock-timeout', `timed out acquiring ${lockCapability.path}`);
        }
        sleepSync(Math.min(10, Math.max(1, deadline - runtime.clock())));
        continue;
      }
    }
    validateRecordedComponents(meta, runtime.fsApi);
    const now = runtime.clock();
    if (!Number.isSafeInteger(now) || now < 0) fail('lock-clock-invalid', 'lock clock must be epoch milliseconds');
    const core = {version:2, targetIdentity:lockTargetIdentity(lockCapability), pid:process.pid,
      processIdentity:options.processIdentity, nonce:runtime.nonceFactory(), createdAt:now,
      ticketExpiresAt:now + CLAIM_TICKET_ONLY_TTL_MS};
    if (!/^[0-9a-f]{32}$/.test(core.nonce)) fail('lock-nonce-invalid', 'nonce must be 32 lowercase hex');
    const claimCoreBytes = Buffer.from(canonicalJson(core));
    const claimCoreDigest = sha256(claimCoreBytes);
    const ticket = {version:2, claimCoreDigest, targetIdentity:core.targetIdentity, pid:core.pid,
      processIdentity:core.processIdentity, nonce:core.nonce, createdAt:core.createdAt,
      ticketExpiresAt:core.ticketExpiresAt};
    const ticketBytes = Buffer.from(canonicalJson(ticket));
    const ticketPath = path.join(claimsDir, claimTicketName(core));
    const privatePath = `${lockCapability.path}.claim.${core.nonce}`;
    validateClaimsDirectory(claimsDir, claimsIdentity, runtime.fsApi);
    let ticketFd;
    try {
      ticketFd = runtime.fsApi.openSync(ticketPath, 'wx', 0o600);
      reachLockTestSeam(runtime, 'after-ticket-open', {ticketPath, privatePath, core});
      runtime.fsApi.writeFileSync(ticketFd, ticketBytes);
      runtime.fsApi.fsyncSync(ticketFd);
      reachLockTestSeam(runtime, 'after-ticket-fsync', {ticketPath, privatePath, core});
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    } finally {
      if (ticketFd !== undefined) runtime.fsApi.closeSync(ticketFd);
    }
    recordLockDirectoryDurability(runtime, 'ticket-directory', claimsDir);
    let canonicalPublished = false;
    try {
      validateRecordedComponents(meta, runtime.fsApi);
      runtime.fsApi.mkdirSync(privatePath);
      reachLockTestSeam(runtime, 'after-private-mkdir', {ticketPath, privatePath, core});
      const owner = {version:2, claimCoreDigest, ticketDigest:sha256(ticketBytes), pid:core.pid,
        processIdentity:core.processIdentity, nonce:core.nonce, createdAt:core.createdAt,
        ticketExpiresAt:core.ticketExpiresAt};
      const ownerBytes = Buffer.from(canonicalJson(owner));
      const ownerPath = path.join(privatePath, 'owner.json');
      const ownerFd = runtime.fsApi.openSync(ownerPath, 'wx', 0o600);
      try {
        runtime.fsApi.writeFileSync(ownerFd, ownerBytes);
        reachLockTestSeam(runtime, 'after-owner-write', {ticketPath, privatePath, core});
        runtime.fsApi.fsyncSync(ownerFd);
        reachLockTestSeam(runtime, 'after-owner-fsync', {ticketPath, privatePath, core});
      } finally { runtime.fsApi.closeSync(ownerFd); }
      const heartbeatAt = runtime.clock();
      if (!Number.isSafeInteger(heartbeatAt) || heartbeatAt < now) {
        fail('lock-clock-invalid', 'initial heartbeat clock must be monotonic epoch milliseconds');
      }
      const heartbeat = {version:1, ownerCoreDigest:sha256(ownerBytes), sequence:0, heartbeatAt};
      const heartbeatBytes = Buffer.from(canonicalJson(heartbeat));
      const heartbeatPath = path.join(privatePath, 'heartbeat.json');
      const heartbeatFd = runtime.fsApi.openSync(heartbeatPath, 'wx', 0o600);
      try {
        runtime.fsApi.writeFileSync(heartbeatFd, heartbeatBytes);
        reachLockTestSeam(runtime, 'after-heartbeat-write', {ticketPath, privatePath, core});
        runtime.fsApi.fsyncSync(heartbeatFd);
        reachLockTestSeam(runtime, 'after-heartbeat-fsync', {ticketPath, privatePath, core});
      } finally { runtime.fsApi.closeSync(heartbeatFd); }
      recordLockDirectoryDurability(runtime, 'private-claim', privatePath);
      reachLockTestSeam(runtime, 'before-canonical-rename', {ticketPath, privatePath, core});
      publishCanonicalDirectoryClaim(privatePath, lockCapability, meta, {core, ticketPath,
        ticketBytes, ownerBytes, heartbeatBytes, claimsDir, claimsIdentity}, runtime);
      canonicalPublished = true;
      reachLockTestSeam(runtime, 'after-canonical-rename',
        {ticketPath, privatePath, lockPath:lockCapability.path, core});
      recordLockDirectoryDurability(runtime, 'canonical-parent',
        path.dirname(lockCapability.path));
      return {core, claimCoreBytes, ticketPath, ticketBytes, ownerBytes, heartbeat, claimsDir,
        claimsIdentity};
    } catch (error) {
      if (canonicalPublished) {
        fail('lock-publication-durability-failed',
          'canonical lock was published but its parent durability step failed',
          {cause:error, ticketPath, lockPath:lockCapability.path});
      }
      try { runtime.fsApi.rmSync(privatePath, {recursive:true, force:true}); } catch {}
      try {
        const current = runtime.fsApi.readFileSync(ticketPath);
        if (sameBytes(current, ticketBytes)) runtime.fsApi.unlinkSync(ticketPath);
      } catch {}
      if (['EEXIST','ENOTEMPTY'].includes(error.code)) continue;
      throw error;
    }
  }
}

function updateOwnedHeartbeat(lockCapability, claim, runtime) {
  validateClaimsDirectory(claim.claimsDir, claim.claimsIdentity, runtime.fsApi);
  const chain = readCanonicalClaim(lockCapability.path, claim.claimsDir, claim.core.targetIdentity,
    runtime.fsApi);
  if (chain.core.nonce !== claim.core.nonce || !sameBytes(chain.ticketBytes, claim.ticketBytes) ||
      !sameBytes(chain.ownerBytes, claim.ownerBytes)) fail('lock-ownership-lost', 'lock ownership changed');
  const heartbeatAt = runtime.clock();
  if (!Number.isSafeInteger(heartbeatAt) || heartbeatAt < chain.heartbeat.heartbeatAt) {
    fail('lock-clock-invalid', 'heartbeat clock must be monotonic epoch milliseconds');
  }
  const heartbeat = {version:1, ownerCoreDigest:chain.ownerCoreDigest,
    sequence:chain.heartbeat.sequence + 1, heartbeatAt};
  revalidatePathCapability(lockCapability, 'lock-heartbeat-replace');
  writeAtomicRaw(chain.heartbeatPath, Buffer.from(canonicalJson(heartbeat)), runtime,
    runtime.nonceFactory(), 'first-heartbeat');
  claim.heartbeat = heartbeat;
}

function releaseDirectoryClaim(lockCapability, claim, runtime) {
  validateClaimsDirectory(claim.claimsDir, claim.claimsIdentity, runtime.fsApi);
  const chain = readCanonicalClaim(lockCapability.path, claim.claimsDir, claim.core.targetIdentity,
    runtime.fsApi);
  if (chain.core.nonce !== claim.core.nonce || chain.core.pid !== process.pid ||
      chain.core.processIdentity !== claim.core.processIdentity ||
      !sameBytes(chain.ticketBytes, claim.ticketBytes) || !sameBytes(chain.ownerBytes, claim.ownerBytes)) {
    fail('lock-ownership-lost', 'cannot release a foreign lock');
  }
  const quarantine = `${lockCapability.path}.release.${claim.core.nonce}`;
  revalidatePathCapability(lockCapability, 'lock-release-remove');
  runtime.fsApi.renameSync(lockCapability.path, quarantine);
  runtime.fsApi.rmSync(quarantine, {recursive:true, force:false});
  recordLockDirectoryDurability(runtime, 'release-parent', path.dirname(lockCapability.path));
  reachLockTestSeam(runtime, 'after-release-lock-remove-before-ticket-unlink',
    {ticketPath:claim.ticketPath, lockPath:lockCapability.path, core:claim.core});
  try {
    validateClaimsDirectory(claim.claimsDir, claim.claimsIdentity, runtime.fsApi);
    const current = runtime.fsApi.readFileSync(claim.ticketPath);
    if (!sameBytes(current, claim.ticketBytes)) fail('lock-ownership-lost', 'ticket changed before release');
    runtime.fsApi.unlinkSync(claim.ticketPath);
    recordLockDirectoryDurability(runtime, 'release-ticket-directory', claim.claimsDir);
  } catch (cause) {
    fail('lock-release-ticket-cleanup-failed', 'released lock but could not remove owned ticket',
      {cause, ticketPath:claim.ticketPath});
  }
}

function withDirectoryLockRuntime(lockCapability, options, callback, runtime) {
  if (typeof callback !== 'function') fail('lock-callback-invalid', 'lock callback must be a function');
  const claim = acquireDirectoryClaim(lockCapability, options, runtime);
  reachLockTestSeam(runtime, 'before-first-heartbeat',
    {ticketPath:claim.ticketPath, lockPath:lockCapability.path, core:claim.core});
  updateOwnedHeartbeat(lockCapability, claim, runtime);
  reachLockTestSeam(runtime, 'after-first-heartbeat',
    {ticketPath:claim.ticketPath, lockPath:lockCapability.path, core:claim.core});
  let heartbeatFailure = null;
  const timer = setInterval(() => {
    try { updateOwnedHeartbeat(lockCapability, claim, runtime); }
    catch (error) { heartbeatFailure = error; clearInterval(timer); }
  }, options.heartbeatMs);
  timer.unref?.();
  const finish = (kind, value) => {
    clearInterval(timer);
    let releaseError;
    try { releaseDirectoryClaim(lockCapability, claim, runtime); }
    catch (error) { releaseError = error; }
    if (heartbeatFailure) throw heartbeatFailure;
    if (releaseError) throw releaseError;
    if (kind === 'throw') throw value;
    return value;
  };
  let result;
  try { result = callback(); }
  catch (error) { return finish('throw', error); }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).then((value) => finish('return', value),
      (error) => finish('throw', error));
  }
  return finish('return', result);
}

function withDirectoryLock(lockCapability, options, callback) {
  return withDirectoryLockRuntime(lockCapability, options, callback, defaultRuntime());
}

function validatePendingPair(targetCapability, pendingCapability) {
  const targetMeta = assertCapability(targetCapability, ['project-state']);
  const pendingMeta = assertCapability(pendingCapability, ['project-state']);
  if (pendingCapability.role !== 'pending' || targetCapability.projectRoot !== pendingCapability.projectRoot ||
      path.dirname(targetCapability.path) !== path.dirname(pendingCapability.path) ||
      !['.pending-changes.jsonl','.pending-append.jsonl'].includes(path.basename(pendingCapability.path))) {
    fail('pending-capability-invalid', 'pending sidecar must be a mandatory exact sibling');
  }
  return {targetMeta, pendingMeta};
}

function validatePendingOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) || operation.version !== 1 ||
      !PENDING_OPERATION_KINDS.has(operation.kind) || !Object.hasOwn(operation, 'payload') ||
      Object.keys(operation).sort().join(',') !== 'kind,payload,version') {
    fail('pending-operation-invalid', 'pending operation is not a closed version-1 record');
  }
  function freeze(value) {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  return freeze(JSON.parse(canonicalJson({version:1, kind:operation.kind, payload:operation.payload})));
}

function pendingLockCapability(capability, suffix, runtime) {
  const issuer = createProjectStateIssuer(runtime.fsApi);
  return issuer(capability.projectRoot, `${capability.path}${suffix}`,
    {role:'lock', allowMissingLeaf:true});
}

function pendingLockOptions(timeoutMs = 1_000) {
  return {timeoutMs, staleMs:5_000, heartbeatMs:500, processIdentity:DEFAULT_PROCESS_IDENTITY};
}

function listDrainingFiles(pendingCapability, runtime) {
  const directory = path.dirname(pendingCapability.path);
  const prefix = `${path.basename(pendingCapability.path)}.draining.`;
  return runtime.fsApi.readdirSync(directory).filter((name) => name.startsWith(prefix))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((name) => path.join(directory, name));
}

function parsePendingFile(file, runtime) {
  const bytes = readBounded(file, CLAIM_TICKET_SCAN_MAX_TOTAL_BYTES, runtime.fsApi,
    'pending-operation-invalid');
  const operations = [];
  for (const line of bytes.toString('utf8').split('\n')) {
    if (!line) continue;
    let operation;
    try { operation = JSON.parse(line); }
    catch (cause) { fail('pending-operation-invalid', 'pending JSONL is malformed', {cause}); }
    if (canonicalJson(operation) !== `${line}\n`) {
      fail('pending-operation-invalid', 'pending JSONL is not canonical');
    }
    operations.push(validatePendingOperation(operation));
  }
  return operations;
}

function drainUnderTargetLock(targetCapability, pendingCapability, applyOperations, runtime) {
  if (typeof applyOperations !== 'function') fail('pending-reducer-invalid', 'trusted reducer is required');
  const pendingLock = pendingLockCapability(pendingCapability, '.lock', runtime);
  let renamed = null;
  withDirectoryLockRuntime(pendingLock, pendingLockOptions(), () => {
    try {
      runtime.fsApi.lstatSync(pendingCapability.path);
      renamed = `${pendingCapability.path}.draining.${process.pid}.${runtime.nonceFactory()}`;
      revalidatePathCapability(pendingCapability, 'pending-drain-rename');
      runtime.fsApi.renameSync(pendingCapability.path, renamed);
      fsyncDirectory(path.dirname(pendingCapability.path), runtime.fsApi);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }, runtime);
  const draining = listDrainingFiles(pendingCapability, runtime);
  if (renamed && !draining.includes(renamed)) draining.push(renamed);
  draining.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const operationGroups = draining.map((file) => ({file, operations:parsePendingFile(file, runtime)}));
  const operations = operationGroups.flatMap((group) => group.operations);
  if (operations.length === 0) return {recovered:0, draining:[]};
  let current;
  try { current = runtime.fsApi.readFileSync(targetCapability.path); }
  catch (error) { if (error.code === 'ENOENT') current = Buffer.alloc(0); else throw error; }
  const seenLines = new Set(Buffer.from(current).toString('utf8').split('\n').filter(Boolean));
  const operationsToApply = [];
  for (const operation of operations) {
    if (operation.kind === 'append-json-line') {
      const line = canonicalJson(operation.payload).slice(0, -1);
      if (seenLines.has(line)) continue;
      seenLines.add(line);
    }
    operationsToApply.push(operation);
  }
  const next = applyOperations(Buffer.from(current), operationsToApply);
  if (next && typeof next.then === 'function') fail('pending-reducer-invalid', 'pending reducer must be synchronous');
  if (typeof next !== 'string' && !Buffer.isBuffer(next) && !(next instanceof Uint8Array)) {
    fail('pending-reducer-invalid', 'pending reducer must return bytes');
  }
  runtime.pendingIoImpl?.beforeCanonicalWrite?.({targetCapability, pendingCapability,
    operations:Object.freeze(operationsToApply)});
  atomicWriteWithFs(targetCapability, next, {}, runtime.fsApi);
  for (const group of operationGroups) runtime.fsApi.unlinkSync(group.file);
  fsyncDirectory(path.dirname(pendingCapability.path), runtime.fsApi);
  return {recovered:operations.length, draining:operationGroups.map((group) => group.file)};
}

function queuePendingOperation(pendingCapability, operation, runtime) {
  const pendingLock = pendingLockCapability(pendingCapability, '.lock', runtime);
  return withDirectoryLockRuntime(pendingLock, pendingLockOptions(), () => {
    let current;
    try { current = runtime.fsApi.readFileSync(pendingCapability.path); }
    catch (error) { if (error.code === 'ENOENT') current = Buffer.alloc(0); else throw error; }
    const next = Buffer.concat([current, Buffer.from(canonicalJson(operation))]);
    atomicWriteWithFs(pendingCapability, next, {}, runtime.fsApi);
  }, runtime);
}

function mutateWithRuntime(targetCapability, options, runtime) {
  const {pendingCapability, applyOperations} = options || {};
  validatePendingPair(targetCapability, pendingCapability);
  const operation = validatePendingOperation(options.operation);
  if (typeof applyOperations !== 'function') fail('pending-reducer-invalid', 'trusted reducer is required');
  const targetLock = pendingLockCapability(targetCapability, '.lock', runtime);
  try {
    return withDirectoryLockRuntime(targetLock, pendingLockOptions(250), () => {
      const drained = drainUnderTargetLock(targetCapability, pendingCapability, applyOperations, runtime);
      let current;
      try { current = runtime.fsApi.readFileSync(targetCapability.path); }
      catch (error) { if (error.code === 'ENOENT') current = Buffer.alloc(0); else throw error; }
      const alreadyApplied = operation.kind === 'append-json-line' &&
        Buffer.from(current).toString('utf8').split('\n')
          .includes(canonicalJson(operation.payload).slice(0, -1));
      const next = applyOperations(Buffer.from(current), alreadyApplied ? [] : [operation]);
      if (next && typeof next.then === 'function') fail('pending-reducer-invalid', 'reducer must be synchronous');
      runtime.pendingIoImpl?.beforeCanonicalWrite?.({targetCapability, pendingCapability,
        operations:Object.freeze([operation])});
      atomicWriteWithFs(targetCapability, next, {}, runtime.fsApi);
      return {written:true, queued:false, recovered:drained.recovered};
    }, runtime);
  } catch (error) {
    if (error.code !== 'lock-timeout') throw error;
    queuePendingOperation(pendingCapability, operation, runtime);
    return {written:false, queued:true, recovered:0};
  }
}

function mutateFileWithPendingOperations(targetCapability, options) {
  return mutateWithRuntime(targetCapability, options, defaultRuntime());
}

function appendJsonLineReducer(currentBytes, operations) {
  const chunks = [Buffer.from(currentBytes)];
  for (const operation of operations) {
    if (operation.kind !== 'append-json-line') fail('pending-operation-invalid', 'JSONL reducer got wrong kind');
    chunks.push(Buffer.from(canonicalJson(operation.payload)));
  }
  return Buffer.concat(chunks);
}

function appendJsonLineLocked(targetCapability, payload, options = {}) {
  return mutateFileWithPendingOperations(targetCapability, {
    pendingCapability:options.pendingCapability,
    operation:{version:1, kind:'append-json-line', payload},
    applyOperations:appendJsonLineReducer,
  });
}

function drainWithRuntime(targetCapability, options, runtime) {
  const {pendingCapability, applyOperations} = options || {};
  validatePendingPair(targetCapability, pendingCapability);
  const targetLock = pendingLockCapability(targetCapability, '.lock', runtime);
  return withDirectoryLockRuntime(targetLock, pendingLockOptions(), () => {
    const result = drainUnderTargetLock(targetCapability, pendingCapability, applyOperations, runtime);
    return {written:result.recovered > 0, queued:false, recovered:result.recovered};
  }, runtime);
}

function drainPendingOperations(targetCapability, options) {
  return drainWithRuntime(targetCapability, options, defaultRuntime());
}

let defaultRuntimeValue;
function monotonicEpochNow() {
  return Math.floor(performance.timeOrigin + performance.now());
}

function defaultRuntime() {
  if (!defaultRuntimeValue) defaultRuntimeValue = {
    fsApi:fs,
    platform:process.platform,
    prefixProbeImpl:null,
    spawnImpl:null,
    terminationImpl:null,
    clock:monotonicEpochNow,
    livenessImpl:defaultLiveness,
    nonceFactory:() => crypto.randomBytes(16).toString('hex'),
    manifestWalkerImpl:null,
    windowsStreamInventoryImpl:null,
    pendingIoImpl:null,
    lockSeamImpl:null,
    lockDurabilityRecords:[],
    diagnostics:[],
    diagnosticKeys:new Set(),
    diagnosticOverflow:0,
  };
  return defaultRuntimeValue;
}

function createPlatformRuntimeForTest(options = {}) {
  const allowed = new Set(['fsImpl','prefixProbeImpl','spawnImpl','terminationImpl','platform','clock',
    'livenessImpl','nonceFactory','manifestWalkerImpl','pendingIoImpl','windowsStreamInventoryImpl',
    'lockSeamImpl']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail('test-runtime-option-invalid', `unsupported test runtime option: ${key}`);
  }
  const platformValue = options.platform || process.platform;
  if (!PLATFORM_VALUES.has(platformValue)) fail('test-runtime-platform-invalid', 'invalid test platform');
  if (options.windowsStreamInventoryImpl !== undefined &&
      typeof options.windowsStreamInventoryImpl !== 'function') {
    fail('test-runtime-option-invalid', 'windowsStreamInventoryImpl must be a function');
  }
  if (options.lockSeamImpl !== undefined && typeof options.lockSeamImpl !== 'function') {
    fail('test-runtime-option-invalid', 'lockSeamImpl must be a function');
  }
  const runtime = {
    fsApi:fsFor(options.fsImpl),
    platform:platformValue,
    prefixProbeImpl:options.prefixProbeImpl || null,
    spawnImpl:options.spawnImpl || null,
    terminationImpl:options.terminationImpl || null,
    clock:options.clock || monotonicEpochNow,
    livenessImpl:options.livenessImpl || defaultLiveness,
    nonceFactory:options.nonceFactory || (() => crypto.randomBytes(16).toString('hex')),
    manifestWalkerImpl:options.manifestWalkerImpl || null,
    windowsStreamInventoryImpl:options.windowsStreamInventoryImpl || null,
    pendingIoImpl:options.pendingIoImpl || null,
    lockSeamImpl:options.lockSeamImpl || null,
    lockDurabilityRecords:[],
    diagnostics:[],
    diagnosticKeys:new Set(),
    diagnosticOverflow:0,
  };
  const issuer = createProjectStateIssuer(runtime.fsApi);
  return Object.freeze({
    issueProjectStateCapability:issuer,
    issueOwnedTempCapability,
    issueFinalizedReceiptPayloadCapability,
    consumeOwnedTemp,
    authenticateOwnedTempConsumer,
    compareRemoveOwnedTemp,
    consumeFinalizedReceiptPayload,
    issueInitialWorktreeCapability:(input) => managedWorktreeCapability(input, 'initial-session',
      runtime.fsApi, runtime.platform),
    issueForkWorktreeCapability:(input) => managedWorktreeCapability(input, 'fork-session',
      runtime.fsApi, runtime.platform),
    issueTrustedInstallRootCapability:(input) => issueTrustedInstallRootWithFs(input, runtime.fsApi),
    issueNodeToolchainCapability:(input) => issueNodeToolchainWithRuntime(input, runtime),
    captureWorktreeManifest:(input) => captureManifestWithRuntime(input, runtime),
    atomicWriteFile:(capability, data, writeOptions) =>
      atomicWriteWithFs(capability, data, writeOptions, runtime.fsApi),
    withDirectoryLock:(capability, lockOptions, callback) =>
      withDirectoryLockRuntime(capability, lockOptions, callback, runtime),
    mutateFileWithPendingOperations:(capability, mutationOptions) =>
      mutateWithRuntime(capability, mutationOptions, runtime),
    drainPendingOperations:(capability, drainOptions) =>
      drainWithRuntime(capability, drainOptions, runtime),
    sanitizeEnvironment:(environment) => sanitizeEnvironment(environment, runtime.platform),
    environmentValue:(environment, key) => environmentValue(environment, key, runtime.platform),
    spawnPortable:(spec, spawnOptions = {}) => spawnWithRuntime(spec, spawnOptions, runtime),
    lockDurability:() => Object.freeze(runtime.lockDurabilityRecords.map((record) =>
      Object.freeze({...record}))),
    diagnostics:() => Object.freeze({entries:Object.freeze([...runtime.diagnostics]),
      overflow:runtime.diagnosticOverflow}),
  });
}

module.exports = {
  PATH_THREAT_MODEL,
  PROJECT_STATE_ROLES,
  OWNED_TEMP_PURPOSES,
  WINDOWS_DEVICE_BASES,
  WORKTREE_MANIFEST_MAX_ENTRIES,
  WORKTREE_MANIFEST_MAX_RELATIVE_PATH_BYTES,
  WORKTREE_MANIFEST_MAX_PATH_TOTAL_BYTES,
  WORKTREE_MANIFEST_MAX_FILE_BYTES,
  WORKTREE_MANIFEST_MAX_TOTAL_BYTES,
  INSTALL_ROOT_MAX_ROOTS,
  INSTALL_ROOT_MAX_DEPTH,
  INSTALL_ROOT_MAX_ENTRIES_PER_ROOT,
  INSTALL_ROOT_MAX_FILE_BYTES,
  INSTALL_ROOT_MAX_TOTAL_BYTES_PER_ROOT,
  CLAIM_TICKET_ONLY_TTL_MS,
  CLAIM_TICKET_SCAN_MAX_ENTRIES,
  CLAIM_TICKET_MAX_FILE_BYTES,
  CLAIM_TICKET_SCAN_MAX_TOTAL_BYTES,
  CLAIM_PRIVATE_SCAN_MAX_ENTRIES,
  CLAIM_TICKET_REPORT_MAX_ENTRIES,
  WINDOWS_STREAM_INVENTORY_TIMEOUT_MS,
  WINDOWS_STREAM_INVENTORY_MAX_OUTPUT_BYTES,
  WINDOWS_STREAM_INVENTORY_HELPER_SHA256,
  WINDOWS_STREAM_INVENTORY_PINVOKE_SHA256,
  sanitizePathInput,
  canonicalizePortableProjectPathV1,
  parseGitWorktreePorcelainZ,
  resolveProjectRoot,
  normalizeForCompare,
  isPathInside,
  issueProjectStateCapability,
  issueExternalTargetLockCapability,
  issueOwnedTempCapability,
  issueFinalizedReceiptPayloadCapability,
  issueSessionEnvelopeOutputCapability,
  issueSliceEnvelopeOutputCapability,
  issueProjectHandoffOutputCapability,
  issueInitialWorktreeCapability,
  issueForkWorktreeCapability,
  issueTrustedInstallRootCapability,
  issueNodeToolchainCapability,
  captureWorktreeManifest,
  revalidatePathCapability,
  scanTrustedInstallRoot,
  resolveNodePackageBin,
  atomicWriteFile,
  consumeOwnedTemp,
  authenticateOwnedTempConsumer,
  compareRemoveOwnedTemp,
  consumeFinalizedReceiptPayload,
  withDirectoryLock,
  mutateFileWithPendingOperations,
  appendJsonLineLocked,
  drainPendingOperations,
  spawnPortable,
  createPlatformRuntimeForTest,
};
