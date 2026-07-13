'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fork } = require('node:child_process');

const platform = require('./platform.js');
const {
  PATH_THREAT_MODEL,
  PROJECT_STATE_ROLES,
  OWNED_TEMP_PURPOSES,
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
  sanitizePathInput,
  canonicalizePortableProjectPathV1,
  resolveProjectRoot,
  normalizeForCompare,
  isPathInside,
  issueProjectStateCapability,
  issueOwnedTempCapability,
  issueFinalizedReceiptPayloadCapability,
  issueSessionEnvelopeOutputCapability,
  issueSliceEnvelopeOutputCapability,
  issueProjectHandoffOutputCapability,
  issueInitialWorktreeCapability,
  issueForkWorktreeCapability,
  issueTrustedInstallRootCapability,
  issueNodeToolchainCapability,
  resolveNodePackageBin,
  captureWorktreeManifest,
  revalidatePathCapability,
  atomicWriteFile,
  compareRemoveOwnedTemp,
  consumeOwnedTemp,
  consumeFinalizedReceiptPayload,
  withDirectoryLock,
  mutateFileWithPendingOperations,
  appendJsonLineLocked,
  drainPendingOperations,
  scanTrustedInstallRoot,
  spawnPortable,
  createPlatformRuntimeForTest,
} = platform;

const fixtureRoot = path.join(__dirname, '..', 'tests', 'fixtures');

function makeRepo(prefix = 'dw-platform-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], {cwd:root});
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], {cwd:root});
  execFileSync('git', ['config', 'user.name', 'Deep Work Test'], {cwd:root});
  fs.mkdirSync(path.join(root, '.claude'), {recursive:true});
  fs.mkdirSync(path.join(root, '.deep-work', 's-a1b2c3d4'), {recursive:true});
  fs.writeFileSync(path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'),
    '---\nwork_dir: .deep-work/s-a1b2c3d4\n---\n');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'tracked\n');
  execFileSync('git', ['add', 'tracked.txt'], {cwd:root});
  execFileSync('git', ['commit', '-qm', 'fixture'], {cwd:root});
  return root;
}

function caps(root) {
  const workDir = path.join(root, '.deep-work', 's-a1b2c3d4');
  const sessionState = issueProjectStateCapability(root,
    path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
  return {
    project:issueProjectStateCapability(root, root, {role:'project-root'}),
    git:issueProjectStateCapability(root, path.join(root, '.git'), {role:'git-root'}),
    sessionState,
    work:issueProjectStateCapability(root, workDir,
      {role:'session-work-dir', sessionStateCapability:sessionState}),
    state:issueProjectStateCapability(root, path.join(root, '.claude', 'state.json'),
      {role:'state', allowMissingLeaf:true}),
  };
}

function remove(root) { fs.rmSync(root, {recursive:true, force:true}); }

function canonicalJsonForTest(value) {
  const normalize = (item) => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
      : item;
  return `${JSON.stringify(normalize(value))}\n`;
}

function hash(value) {
  return require('node:crypto').createHash('sha256').update(value).digest('hex');
}

async function waitForPath(file, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${file}`);
}

function windowsFixtureFs(base) {
  function map(value) {
    const normalized = path.win32.normalize(value);
    const parsed = path.win32.parse(normalized);
    if (parsed.root.toLowerCase() !== 'c:\\') throw Object.assign(new Error('foreign drive'), {code:'ENOENT'});
    const segments = normalized.slice(parsed.root.length).split('\\').filter(Boolean);
    return path.join(base, 'c-drive', ...segments);
  }
  function canonical(value) {
    fs.realpathSync(map(value));
    const normalized = path.win32.normalize(value);
    return `C:${normalized.slice(2)}`;
  }
  return {
    lstatSync:value => fs.lstatSync(map(value)),
    realpathSync:canonical,
    readFileSync:(value, options) => fs.readFileSync(map(value), options),
    openSync:(value, flags, mode) => fs.openSync(map(value), flags, mode),
    readSync:(...args) => fs.readSync(...args),
    closeSync:fd => fs.closeSync(fd),
    accessSync:(value, mode) => fs.accessSync(map(value), mode),
  };
}

test('public numeric limits and threat model exactly pin the approved contract', () => {
  assert.deepEqual([
    WORKTREE_MANIFEST_MAX_ENTRIES,
    WORKTREE_MANIFEST_MAX_RELATIVE_PATH_BYTES,
    WORKTREE_MANIFEST_MAX_PATH_TOTAL_BYTES,
    WORKTREE_MANIFEST_MAX_FILE_BYTES,
    WORKTREE_MANIFEST_MAX_TOTAL_BYTES,
  ], [100_000, 32_768, 67_108_864, 1_073_741_824, 8_589_934_592]);
  assert.deepEqual([
    INSTALL_ROOT_MAX_ROOTS, INSTALL_ROOT_MAX_DEPTH, INSTALL_ROOT_MAX_ENTRIES_PER_ROOT,
    INSTALL_ROOT_MAX_FILE_BYTES, INSTALL_ROOT_MAX_TOTAL_BYTES_PER_ROOT,
  ], [16, 3, 4096, 1_048_576, 16_777_216]);
  assert.deepEqual([
    CLAIM_TICKET_ONLY_TTL_MS, CLAIM_TICKET_SCAN_MAX_ENTRIES, CLAIM_TICKET_MAX_FILE_BYTES,
    CLAIM_TICKET_SCAN_MAX_TOTAL_BYTES, CLAIM_PRIVATE_SCAN_MAX_ENTRIES,
    CLAIM_TICKET_REPORT_MAX_ENTRIES,
  ], [30_000, 1024, 4096, 1_048_576, 3, 32]);
  assert.deepEqual([WINDOWS_STREAM_INVENTORY_TIMEOUT_MS,
    WINDOWS_STREAM_INVENTORY_MAX_OUTPUT_BYTES], [20_000, 67_108_864]);
  assert.equal(PATH_THREAT_MODEL.concurrentReplacementAfterFinalValidation, 'unsupported');
  assert.equal(PATH_THREAT_MODEL.protected.includes('pre-existing-link-or-reparse'), true);
  assert.equal(Object.isFrozen(PATH_THREAT_MODEL), true);
});

test('sanitize path handles contaminated input while preserving roots', () => {
  assert.equal(sanitizePathInput('/tmp/repo \r\n'), '/tmp/repo');
  assert.equal(sanitizePathInput('/'), '/');
  assert.equal(sanitizePathInput('C:\\'), 'C:\\');
  assert.throws(() => sanitizePathInput('a\0b'), /path-input-control/);
  assert.throws(() => sanitizePathInput(4), /path-input-type/);
});

test('Windows drive and UNC lexical containment reject prefix siblings', () => {
  assert.equal(isPathInside('C:\\repo', 'C:\\repo\\src\\한 글.js', 'win32'), true);
  assert.equal(isPathInside('C:\\repo', 'C:\\repo-evil\\x.js', 'win32'), false);
  assert.equal(isPathInside('\\\\server\\share\\repo', '\\\\server\\share\\repo\\a.js', 'win32'), true);
  assert.equal(normalizeForCompare('C:\\Repo\\', 'win32'), 'c:\\repo');
});

test('portable-path-v1 accepts NFC Unicode and rejects every forbidden segment family', () => {
  assert.deepEqual(canonicalizePortableProjectPathV1('src/한 글.js'), {
    path:'src/한 글.js', windowsKey:'src/한 글.js',
  });
  const invalid = [
    '', '/abs', 'a\\b', 'a//b', './a', 'a/../b', 'a.', 'a ', 'a:b', 'a<b',
    'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'CON', 'con.txt', 'PRN.log', 'AUX', 'NUL',
    'COM1.js', 'COM9', 'LPT1', 'LPT9.log', 'CONIN$', 'CONOUT$.txt',
    'COM¹', 'COM².txt', 'COM³', 'LPT¹', 'LPT².md', 'LPT³', 'e\u0301.txt',
  ];
  for (let code = 0; code <= 0x1f; code++) invalid.push(`a${String.fromCharCode(code)}b`);
  invalid.push(`a${String.fromCharCode(0x7f)}b`);
  for (const value of invalid) assert.throws(() => canonicalizePortableProjectPathV1(value),
    /portable-path-v1/, JSON.stringify(value));
  assert.equal(canonicalizePortableProjectPathV1('Src/A.js').windowsKey, 'src/a.js');
  assert.throws(() => canonicalizePortableProjectPathV1('CON .txt'), /portable-path-v1-device/);
});

test('resolveProjectRoot finds .git without prefix confusion', () => {
  const root = makeRepo();
  try {
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, {recursive:true});
    assert.equal(resolveProjectRoot(nested), fs.realpathSync(root));
    assert.throws(() => resolveProjectRoot(os.tmpdir()), /project-root-not-found/);
  } finally { remove(root); }
});

test('project-state capabilities are frozen branded physically-contained objects', () => {
  const root = makeRepo();
  try {
    const {state} = caps(root);
    assert.deepEqual([state.kind, state.role, state.allowMissingLeaf],
      ['project-state', 'state', true]);
    assert.equal(Object.isFrozen(state), true);
    assert.equal(revalidatePathCapability(state, 'write').path, state.path);
    assert.throws(() => revalidatePathCapability({...state}, 'write'), /path-capability/);
    assert.throws(() => issueProjectStateCapability(root, path.join(root, '..', 'evil'),
      {role:'state', allowMissingLeaf:true}), /path-capability-outside/);
    assert.throws(() => issueProjectStateCapability(root, path.join(root, '.claude', 'x'),
      {role:'owned-temp', allowMissingLeaf:true}), /owned-temp-derived-only/);
    assert.equal(PROJECT_STATE_ROLES.has('state'), true);
  } finally { remove(root); }
});

test('capability issuance and revalidation reject symlink component replacement', () => {
  const root = makeRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-outside-'));
  try {
    const dir = path.join(root, '.claude', 'safe');
    fs.mkdirSync(dir);
    const cap = issueProjectStateCapability(root, path.join(dir, 'state.json'),
      {role:'state', allowMissingLeaf:true});
    fs.rmSync(dir, {recursive:true});
    fs.symlinkSync(outside, dir, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => revalidatePathCapability(cap, 'write'), /path-capability-(link|identity)/);
  } finally { remove(root); remove(outside); }
});

test('owned temp is operation/purpose bound, write-once, adopt-exact, consume, and compare-remove', () => {
  const root = makeRepo();
  try {
    const {work} = caps(root);
    const operationId = `op-${'a'.repeat(32)}`;
    const cap = issueOwnedTempCapability({sessionCapability:work, operationId,
      purpose:'receipt-payload', allowMissingLeaf:true});
    assert.equal(cap.path, path.join(work.path, '.tmp', operationId, 'receipt-payload.tmp'));
    assert.equal(cap.state, 'reserved');
    atomicWriteFile(cap, Buffer.from('payload'));
    assert.equal(cap.state, 'written');
    assert.equal(atomicWriteFile(cap, Buffer.from('payload')).adopted, true);
    assert.throws(() => atomicWriteFile(cap, Buffer.from('other')), /owned-temp-content-conflict/);
    const digest = cap.contentDigest;
    consumeOwnedTemp(cap, {operationId:`op-${'c'.repeat(32)}`,
      purpose:'receipt-payload', expectedDigest:digest});
    assert.equal(cap.state, 'consumed');
    assert.equal(compareRemoveOwnedTemp(cap, digest), true);
    assert.equal(cap.state, 'removed');
    assert.equal(OWNED_TEMP_PURPOSES.has('receipt-payload'), true);
    assert.throws(() => issueOwnedTempCapability({sessionCapability:work, operationId,
      purpose:'foreign'}), /temp-purpose/);
  } finally { remove(root); }
});

test('owned temp rejects a pre-existing byte-identical target without same-operation owner proof', () => {
  const root = makeRepo();
  try {
    const {work} = caps(root);
    const operationId = `op-${'f'.repeat(32)}`;
    const target = path.join(work.path, '.tmp', operationId, 'notes.tmp');
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, 'same');
    const cap = issueOwnedTempCapability({sessionCapability:work, operationId, purpose:'notes'});
    assert.throws(() => atomicWriteFile(cap, 'same'), /owned-temp-foreign/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'same');
  } finally { remove(root); }
});

test('a newly issued same-operation owned temp adopts only its matching owner and digest', () => {
  const root = makeRepo();
  try {
    const {work} = caps(root);
    const input = {sessionCapability:work, operationId:`op-${'1'.repeat(32)}`, purpose:'notes'};
    const first = issueOwnedTempCapability(input);
    atomicWriteFile(first, 'same');
    const retry = issueOwnedTempCapability(input);
    assert.deepEqual(atomicWriteFile(retry, 'same'), {
      written:false, adopted:true, sha256:first.contentDigest,
    });
  } finally { remove(root); }
});

test('finalized receipt result is producer-derived and consumed once by envelope-publish', () => {
  const root = makeRepo();
  try {
    const {work} = caps(root);
    const operationId = `op-${'b'.repeat(32)}`;
    const payload = Buffer.from('{"ok":true}\n');
    const payloadPath = path.join(work.path, '.operation-results', operationId,
      'finalized-receipt-payload.json');
    fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
    fs.writeFileSync(payloadPath, payload);
    const producerOperationReceipt = {
      version:1, kind:'implement-slice-complete', operationId,
      sessionId:'s-a1b2c3d4', slice:'SLICE-001', stage:'payload-published',
      sourceTempDigest:'1'.repeat(64), finalizedBytesDigest:
        require('node:crypto').createHash('sha256').update(payload).digest('hex'),
    };
    const cap = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt, slice:'SLICE-001'});
    assert.equal(cap.role, 'finalized-receipt-payload');
    assert.equal(cap.state, 'published');
    assert.match(cap.path, /\.operation-results/);
    consumeFinalizedReceiptPayload(cap, {kind:'envelope-publish', operationId:`op-${'c'.repeat(32)}`});
    assert.equal(cap.state, 'enveloped');
    assert.doesNotThrow(() => consumeFinalizedReceiptPayload(cap,
      {kind:'envelope-publish', operationId:`op-${'c'.repeat(32)}`}));
    assert.throws(() => consumeFinalizedReceiptPayload(cap,
      {kind:'envelope-publish', operationId:`op-${'d'.repeat(32)}`}), /already-consumed/);
    assert.throws(() => issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:{...producerOperationReceipt, kind:'slice-complete'}, slice:'SLICE-001'}),
    /producer-kind/);
    const foreignOperation = `op-${'9'.repeat(32)}`;
    assert.throws(() => issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:{...producerOperationReceipt, operationId:foreignOperation},
      slice:'SLICE-001'}), /finalized-receipt-payload/);
  } finally { remove(root); }
});

test('envelope and handoff outputs have exact route-derived paths', () => {
  const root = makeRepo();
  try {
    const {project, work} = caps(root);
    assert.equal(issueSessionEnvelopeOutputCapability({sessionCapability:work}).path,
      path.join(work.path, 'session-receipt.json'));
    assert.equal(issueSliceEnvelopeOutputCapability({sessionCapability:work, slice:'SLICE-007'}).path,
      path.join(work.path, 'receipts', 'SLICE-007.json'));
    const handoff = issueProjectHandoffOutputCapability({projectCapability:project,
      sessionId:'s-a1b2c3d4', operationId:`op-${'e'.repeat(32)}`});
    assert.equal(handoff.path, path.join(root, '.deep-work', 'handoffs',
      `s-a1b2c3d4-op-${'e'.repeat(32)}.json`));
    assert.throws(() => issueProjectStateCapability(root,
      path.join(root, '.deep-work', 'handoffs', 'caller.json'),
      {role:'project-handoff-output', allowMissingLeaf:true}), /route-derived-only/);
    assert.throws(() => issueProjectStateCapability(root,
      path.join(root, '.claude', 'caller-receipt.json'),
      {role:'session-envelope-output', allowMissingLeaf:true}), /route-derived-only/);
  } finally { remove(root); }
});

test('managed initial and fork worktree capabilities enforce disjoint sibling shapes', () => {
  const root = makeRepo();
  try {
    const parent = path.dirname(root);
    const base = path.basename(root);
    const initial = issueInitialWorktreeCapability({projectRoot:root,
      candidate:path.join(parent, `${base}-wt-a1b2c3d4`), sessionId:'s-a1b2c3d4',
      baseRef:'HEAD', branch:'deep-work-a1b2c3d4', allowMissingLeaf:true});
    assert.equal(initial.purpose, 'initial-session');
    assert.match(initial.baseOid, /^[0-9a-f]{40,64}$/);
    const fork = issueForkWorktreeCapability({projectRoot:root,
      candidate:path.join(parent, `${base}-wt-fork-a1b2c3d4`), sessionId:'s-a1b2c3d4',
      parentBranch:'main', branch:'main-fork-a1b2c3d4', allowMissingLeaf:true});
    assert.equal(fork.purpose, 'fork-session');
    for (const candidate of [path.join(parent, `${base}-evil`),
      path.join(path.dirname(parent), `${base}-wt-fork-a1b2c3d4`)]) {
      assert.throws(() => issueForkWorktreeCapability({projectRoot:root, candidate,
        sessionId:'s-a1b2c3d4', parentBranch:'main', branch:'main-fork-a1b2c3d4',
        allowMissingLeaf:true}), /managed-worktree/);
    }
  } finally { remove(root); }
});

test('existing managed worktree revalidation binds the registered path and exact branch', () => {
  const root = makeRepo();
  const canonicalRoot = fs.realpathSync(root);
  const candidate = path.join(path.dirname(canonicalRoot), `${path.basename(canonicalRoot)}-wt-a1b2c3d4`);
  try {
    execFileSync('git', ['worktree','add','-q','-b','deep-work-a1b2c3d4',candidate,'HEAD'], {cwd:root});
    const cap = issueInitialWorktreeCapability({projectRoot:root, candidate,
      sessionId:'s-a1b2c3d4', baseRef:'HEAD', branch:'deep-work-a1b2c3d4'});
    assert.doesNotThrow(() => revalidatePathCapability(cap, 'git-worktree-remove'));
    execFileSync('git', ['switch','-q','-c','foreign-branch'], {cwd:candidate});
    assert.throws(() => revalidatePathCapability(cap, 'git-worktree-remove'),
      /managed-worktree-registration/);
  } finally {
    try { execFileSync('git', ['worktree','remove','--force',candidate], {cwd:root}); } catch {}
    remove(root);
  }
});

test('worktree manifest includes ignored files and records only exclusion roots', () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '.env.local\ndocs/ignored.md\n');
    fs.writeFileSync(path.join(root, '.env.local'), 'secret');
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'docs', 'ignored.md'), 'plan');
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), {recursive:true});
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'cache.bin'), 'cache');
    const {project, git, state} = caps(root);
    const manifest = captureWorktreeManifest({projectCapability:project, gitCapability:git,
      runtimeExclusions:[state]});
    assert.equal(manifest.entries.some((e) => e.path === '.env.local'), true);
    assert.equal(manifest.entries.some((e) => e.path === 'docs/ignored.md'), true);
    assert.equal(manifest.entries.some((e) => e.path === 'node_modules' && e.excluded), true);
    assert.equal(manifest.entries.some((e) => e.path === 'node_modules/pkg/cache.bin'), false);
    assert.equal(manifest.entries.some((e) => e.path === '.claude/state.json' && e.excluded), true);
    assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.head, /^[0-9a-f]{40,64}$/);
    assert.match(manifest.index, /^[0-9a-f]{64}$/);
  } finally { remove(root); }
});

test('manifest rejects Windows-key collision and invalid physical path rather than omitting it', () => {
  if (process.platform === 'win32' || process.platform === 'darwin') return test.skip('case-only paths cannot coexist');
  const root = makeRepo();
  try {
    fs.mkdirSync(path.join(root, 'Src'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'Src', 'A.js'), 'A');
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'a');
    const {project, git} = caps(root);
    assert.throws(() => captureWorktreeManifest({projectCapability:project, gitCapability:git,
      runtimeExclusions:[]}), /worktree-manifest-case-collision/);
  } finally { remove(root); }
});

test('manifest test seam fails closed on limits and unstable traversal', () => {
  const root = makeRepo();
  try {
    const {project, git} = caps(root);
    const runtime = createPlatformRuntimeForTest({manifestWalkerImpl:() => ({
      entries:Array.from({length:WORKTREE_MANIFEST_MAX_ENTRIES + 1}, (_, i) => ({path:`f${i}`})),
    })});
    assert.throws(() => runtime.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /worktree-manifest-entry-limit/);
  } finally { remove(root); }
});

test('manifest test walker cannot bypass path and file budgets', () => {
  const root = makeRepo();
  try {
    const {project, git} = caps(root);
    const longPath = createPlatformRuntimeForTest({manifestWalkerImpl:() => ({
      entries:[{path:'a'.repeat(WORKTREE_MANIFEST_MAX_RELATIVE_PATH_BYTES + 1), type:'file',
        size:0, sha256:'0'.repeat(64)}],
    })});
    assert.throws(() => longPath.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /worktree-manifest-path-limit/);
    const tooLarge = createPlatformRuntimeForTest({manifestWalkerImpl:() => ({
      entries:[{path:'large.bin', type:'file', size:WORKTREE_MANIFEST_MAX_FILE_BYTES + 1,
        sha256:'0'.repeat(64)}],
    })});
    assert.throws(() => tooLarge.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /worktree-manifest-file-size-limit/);
  } finally { remove(root); }
});

test('physical manifest rejects a reserved Windows device name even on POSIX', () => {
  if (process.platform === 'win32') return test.skip('Windows cannot create reserved device names');
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, 'CON.txt'), 'forbidden');
    const {project, git} = caps(root);
    assert.throws(() => captureWorktreeManifest({projectCapability:project, gitCapability:git,
      runtimeExclusions:[]}), /portable-path-v1-device/);
  } finally { remove(root); }
});

test('trusted install root is read-only, bounded, explicit, and rejects links', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-home-'));
  try {
    const install = path.join(home, '.codex', 'plugins', 'cache', 'deep-work');
    fs.mkdirSync(install, {recursive:true});
    fs.writeFileSync(path.join(install, 'package.json'), '{}');
    const cap = issueTrustedInstallRootCapability({home, candidate:install,
      explicitRoots:[install]});
    const scan = scanTrustedInstallRoot(cap);
    assert.equal(scan.entries.length, 1);
    assert.throws(() => issueTrustedInstallRootCapability({home,
      candidate:path.join(home, 'other'), explicitRoots:[install]}), /install-root-not-allowed/);
  } finally { remove(home); }
});

test('trusted install limits accept exact file/total edges and reject one byte or depth over', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-install-budget-'));
  try {
    const install = path.join(home, '.codex', 'plugins', 'cache', 'deep-work');
    fs.mkdirSync(install, {recursive:true});
    const cap = issueTrustedInstallRootCapability({home, candidate:install, explicitRoots:[install]});
    const oneMiB = Buffer.alloc(INSTALL_ROOT_MAX_FILE_BYTES, 0x61);
    for (let index = 0; index < 16; index++) {
      fs.writeFileSync(path.join(install, `f-${String(index).padStart(2, '0')}.bin`), oneMiB);
    }
    assert.equal(scanTrustedInstallRoot(cap).totalBytes, INSTALL_ROOT_MAX_TOTAL_BYTES_PER_ROOT);
    fs.writeFileSync(path.join(install, 'one-over-total.bin'), 'x');
    assert.throws(() => scanTrustedInstallRoot(cap), /install-root-byte-limit/);
    fs.rmSync(path.join(install, 'one-over-total.bin'));
    fs.rmSync(path.join(install, 'f-00.bin'));
    fs.writeFileSync(path.join(install, 'one-over-file.bin'),
      Buffer.alloc(INSTALL_ROOT_MAX_FILE_BYTES + 1));
    assert.throws(() => scanTrustedInstallRoot(cap), /install-root-file-size-limit/);
    fs.rmSync(path.join(install, 'one-over-file.bin'));
    fs.mkdirSync(path.join(install, 'a', 'b', 'c', 'd'), {recursive:true});
    assert.throws(() => scanTrustedInstallRoot(cap), /install-root-depth-limit/);
    assert.throws(() => issueTrustedInstallRootCapability({home, candidate:install,
      explicitRoots:Array.from({length:INSTALL_ROOT_MAX_ROOTS + 1}, (_, i) =>
        path.join(home, `root-${i}`))}), /install-root-count-limit/);
  } finally { remove(home); }
});

test('node toolchain resolves only authenticated declared JavaScript bins', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-toolchain-'));
  try {
    const bin = path.join(root, 'bin');
    const nodeExecutable = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
    fs.mkdirSync(path.join(bin, 'node_modules', 'npm', 'bin'), {recursive:true});
    fs.mkdirSync(path.join(bin, 'node_modules', '@openai', 'codex', 'bin'), {recursive:true});
    fs.writeFileSync(nodeExecutable, 'fixture');
    fs.chmodSync(nodeExecutable, 0o755);
    fs.writeFileSync(path.join(bin, 'node_modules', 'npm', 'package.json'), JSON.stringify({
      name:'npm', bin:{npm:'bin/npm-cli.js'},
    }));
    fs.writeFileSync(path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), '');
    fs.writeFileSync(path.join(bin, 'node_modules', '@openai', 'codex', 'package.json'),
      JSON.stringify({name:'@openai/codex', bin:{codex:'bin/codex.js'}}));
    fs.writeFileSync(path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), '');
    const cap = await createPlatformRuntimeForTest()
      .issueNodeToolchainCapability({nodeExecutable, home:root, environment:{}});
    const npm = resolveNodePackageBin(cap, {package:'npm', bin:'npm', args:['audit','--json']});
    assert.deepEqual(npm, {executable:fs.realpathSync(nodeExecutable),
      argv:[fs.realpathSync(path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js')),
        'audit','--json']});
    assert.throws(() => resolveNodePackageBin(cap,
      {package:'@google/gemini-cli', bin:'gemini', args:[]}), /node-toolchain-package-unavailable/);
    assert.throws(() => resolveNodePackageBin(cap,
      {package:'../../foreign', bin:'x', args:[]}), /node-toolchain-package-unavailable/);
  } finally { remove(root); }
});

test('static nvm, Homebrew, setup-node, and Windows MSI fixtures resolve declared bins', async () => {
  const base = path.join(fixtureRoot, 'node-toolchain');
  const nvmNode = path.join(base, 'unix-nvm', 'home', 'test', '.nvm', 'versions', 'node',
    'v22.14.0', 'bin', 'node');
  const nvm = await createPlatformRuntimeForTest({platform:'linux'})
    .issueNodeToolchainCapability({nodeExecutable:nvmNode,
      home:path.join(base, 'unix-nvm', 'home', 'test'), environment:{}});
  assert.match(resolveNodePackageBin(nvm,
    {package:'@openai/codex', bin:'codex', args:[]}).argv[0], /unix-nvm/);

  const brewNode = path.join(base, 'macos-homebrew', 'opt', 'homebrew', 'Cellar', 'node',
    '22.14.0', 'bin', 'node');
  const brew = await createPlatformRuntimeForTest({platform:'darwin'})
    .issueNodeToolchainCapability({nodeExecutable:brewNode,
      home:path.join(base, 'macos-homebrew'), environment:{}});
  assert.match(resolveNodePackageBin(brew,
    {package:'@openai/codex', bin:'codex', args:[]}).argv[0], /macos-homebrew/);

  for (const [fixture, nodeExecutable, home, environment, expected] of [
    ['windows-node-msi', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\test',
      {APPDATA:'C:\\Users\\test\\AppData\\Roaming'}, /AppData\\Roaming\\npm\\node_modules/],
    ['windows-setup-node', 'C:\\hostedtoolcache\\windows\\node\\22.14.0\\x64\\node.exe',
      'C:\\Users\\test', {}, /hostedtoolcache/],
  ]) {
    const calls = [];
    const runtime = createPlatformRuntimeForTest({platform:'win32',
      fsImpl:windowsFixtureFs(path.join(base, fixture)),
      prefixProbeImpl:async (request) => {
        calls.push(request);
        return {ok:true, stdout:'C:\\Users\\test\\AppData\\Roaming\\npm\r\n', stderr:''};
      }});
    const capability = await runtime.issueNodeToolchainCapability({nodeExecutable, home, environment});
    const resolved = resolveNodePackageBin(capability,
      {package:'@openai/codex', bin:'codex', args:['--version']});
    assert.match(resolved.argv[0], expected, fixture);
    if (environment.APPDATA) {
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args.slice(1), ['prefix','--global']);
      assert.equal(calls[0].shell, false);
    }
  }
});

test('node toolchain rejects a linked package scope even when it resolves inside the root', async () => {
  if (process.platform === 'win32') return test.skip('symlink setup requires elevated mode on Windows');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-toolchain-link-'));
  try {
    const bin = path.join(root, 'bin');
    const nodeExecutable = path.join(bin, 'node');
    const packages = path.join(bin, 'node_modules');
    const realScope = path.join(packages, 'real-scope');
    fs.mkdirSync(path.join(realScope, 'codex', 'bin'), {recursive:true});
    fs.writeFileSync(nodeExecutable, 'fixture');
    fs.writeFileSync(path.join(realScope, 'codex', 'package.json'),
      JSON.stringify({name:'@openai/codex', bin:{codex:'bin/codex.js'}}));
    fs.writeFileSync(path.join(realScope, 'codex', 'bin', 'codex.js'), '');
    fs.symlinkSync(realScope, path.join(packages, '@openai'));
    const cap = await createPlatformRuntimeForTest()
      .issueNodeToolchainCapability({nodeExecutable, home:root, environment:{}});
    assert.throws(() => resolveNodePackageBin(cap,
      {package:'@openai/codex', bin:'codex', args:[]}), /path-capability-link/);
  } finally { remove(root); }
});

test('production node-toolchain issuer is bound to active Node and real home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-toolchain-foreign-'));
  try {
    const foreign = path.join(root, 'node');
    fs.writeFileSync(foreign, 'fixture');
    await assert.rejects(() => issueNodeToolchainCapability({nodeExecutable:foreign,
      home:os.homedir(), environment:process.env}), /node-toolchain-active-node/);
    await assert.rejects(() => issueNodeToolchainCapability({nodeExecutable:process.execPath,
      home:root, environment:process.env}), /node-toolchain-home/);
  } finally { remove(root); }
});

test('portable launcher uses process.execPath for project package JS bins and rejects shims', async () => {
  const root = makeRepo();
  try {
    const packageRoot = path.join(root, 'node_modules', 'fixture-tool');
    fs.mkdirSync(path.join(packageRoot, 'bin'), {recursive:true});
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
      name:'fixture-tool', bin:{fixture:'bin/fixture.js'},
    }));
    fs.writeFileSync(path.join(packageRoot, 'bin', 'fixture.js'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const {project} = caps(root);
    const result = await spawnPortable({kind:'node-package-bin', package:'fixture-tool',
      bin:'fixture', args:['--format','json','한 글.js']}, {projectCapability:project});
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(result.stdout), ['--format','json','한 글.js']);
    for (const processSpec of [
      {kind:'native-executable', executable:'npm.cmd', args:['test']},
      {kind:'native-executable', executable:'C:\\Tools\\npm.cmd', args:['test']},
      {kind:'native-executable', executable:'tool.exe', args:['a\nb']},
      {kind:'node-package-bin', package:'../../foreign', bin:'x', args:[]},
      {kind:'native-executable', executable:process.execPath, args:[], command:'echo unsafe'},
      {kind:'node-package-bin', package:'fixture-tool', bin:'fixture', args:[],
        callerPackageRoot:path.join(root, 'node_modules')},
    ]) await assert.rejects(() => spawnPortable(processSpec, {projectCapability:project}));
  } finally { remove(root); }
});

test('atomic write preserves old target when rename never succeeds', () => {
  const root = makeRepo();
  try {
    const {state} = caps(root);
    fs.writeFileSync(state.path, 'old');
    const runtime = createPlatformRuntimeForTest({fsImpl:{...fs,
      renameSync(){ const error = new Error('busy'); error.code = 'EPERM'; throw error; },
    }});
    assert.throws(() => runtime.atomicWriteFile(state, 'new'), /EPERM|busy/);
    assert.equal(fs.readFileSync(state.path, 'utf8'), 'old');
  } finally { remove(root); }
});

test('directory lock publishes and releases an authenticated claim without owned residue', () => {
  const root = makeRepo();
  try {
    const lockPath = path.join(root, '.claude', 'state.lock');
    const lock = issueProjectStateCapability(root, lockPath, {role:'lock', allowMissingLeaf:true});
    const result = withDirectoryLock(lock, {timeoutMs:1_000, staleMs:200, heartbeatMs:25,
      processIdentity:'a'.repeat(32)}, () => 'released');
    assert.equal(result, 'released');
    assert.equal(fs.existsSync(lock.path), false);
    const claims = `${lock.path}.claims`;
    assert.deepEqual(fs.existsSync(claims) ? fs.readdirSync(claims) : [], []);
  } finally { remove(root); }
});

test('claim core, ticket, owner, and heartbeat form an acyclic stable chain', async () => {
  const root = makeRepo();
  try {
    const lock = issueProjectStateCapability(root, path.join(root, '.claude', 'chain.lock'),
      {role:'lock', allowMissingLeaf:true});
    await withDirectoryLock(lock, {timeoutMs:1_000, staleMs:300, heartbeatMs:20,
      processIdentity:'6'.repeat(32)}, async () => {
      const ticketPath = path.join(`${lock.path}.claims`, fs.readdirSync(`${lock.path}.claims`)
        .find((name) => name.endsWith('.ticket')));
      const ownerPath = path.join(lock.path, 'owner.json');
      const heartbeatPath = path.join(lock.path, 'heartbeat.json');
      const ticketBefore = fs.readFileSync(ticketPath);
      const ownerBefore = fs.readFileSync(ownerPath);
      const owner = JSON.parse(ownerBefore);
      assert.deepEqual(Object.keys(owner).sort(), ['claimCoreDigest','createdAt','nonce','pid',
        'processIdentity','ticketDigest','ticketExpiresAt','version']);
      assert.equal(owner.ticketDigest, hash(ticketBefore));
      await new Promise((resolve) => setTimeout(resolve, 75));
      assert.deepEqual(fs.readFileSync(ticketPath), ticketBefore);
      assert.deepEqual(fs.readFileSync(ownerPath), ownerBefore);
      const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath));
      assert.equal(heartbeat.ownerCoreDigest, hash(ownerBefore));
      assert.equal(heartbeat.sequence > 0, true);
    });
    assert.deepEqual(fs.readdirSync(`${lock.path}.claims`), []);
  } finally { remove(root); }
});

test('heartbeat replacement never exposes a staging entry inside the canonical claim', () => {
  const root = makeRepo('dw-lock-heartbeat-staging-');
  try {
    const lockPath = path.join(root, '.claude', 'heartbeat-staging.lock');
    const heartbeatPath = path.join(lockPath, 'heartbeat.json');
    let observedReplacement = false;
    const runtime = createPlatformRuntimeForTest({
      nonceFactory: () => 'a'.repeat(32),
      fsImpl: {
        renameSync(source, destination) {
          if (!observedReplacement && destination === heartbeatPath) {
            observedReplacement = true;
            assert.deepEqual(fs.readdirSync(lockPath).sort(), ['heartbeat.json', 'owner.json']);
          }
          return fs.renameSync(source, destination);
        },
      },
    });
    const lock = runtime.issueProjectStateCapability(root, lockPath,
      {role:'lock', allowMissingLeaf:true});
    assert.equal(runtime.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:200, heartbeatMs:25, processIdentity:'b'.repeat(32)},
      () => 'done'), 'done');
    assert.equal(observedReplacement, true);
  } finally { remove(root); }
});

test('production lock clock survives a wall-clock step before the initial heartbeat', () => {
  const root = makeRepo('dw-lock-initial-clock-step-');
  try {
    const lockPath = path.join(root, '.claude', 'initial-clock-step.lock');
    const source = `
      const path = require('node:path');
      const values = [10_000, 10_000, 10_000, 10_000, 10_000, 9_999];
      Date.now = () => values.shift() ?? 9_999;
      const platform = require(${JSON.stringify(path.resolve(__dirname, 'platform.js'))});
      const root = process.argv[1];
      const lock = platform.issueProjectStateCapability(root,
        path.join(root, '.claude', 'initial-clock-step.lock'),
        {role:'lock', allowMissingLeaf:true});
      const result = platform.withDirectoryLock(lock,
        {timeoutMs:1_000, staleMs:200, heartbeatMs:25,
          processIdentity:'a'.repeat(32)}, () => 'done');
      process.stdout.write(JSON.stringify({result}));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', source, root],
      {encoding:'utf8'}));
    assert.deepEqual(result, {result:'done'});
    assert.equal(fs.existsSync(lockPath), false);
  } finally { remove(root); }
});

test('production lock clock survives a wall-clock step during periodic heartbeat', () => {
  const root = makeRepo('dw-lock-periodic-clock-step-');
  try {
    const lockPath = path.join(root, '.claude', 'periodic-clock-step.lock');
    const source = `
      const path = require('node:path');
      const platform = require(${JSON.stringify(path.resolve(__dirname, 'platform.js'))});
      let now = 10_000;
      Date.now = () => now;
      const root = process.argv[1];
      const lock = platform.issueProjectStateCapability(root,
        path.join(root, '.claude', 'periodic-clock-step.lock'),
        {role:'lock', allowMissingLeaf:true});
      (async () => {
        const result = await platform.withDirectoryLock(lock,
          {timeoutMs:1_000, staleMs:200, heartbeatMs:10,
            processIdentity:'b'.repeat(32)}, async () => {
              now = 9_999;
              await new Promise((resolve) => setTimeout(resolve, 35));
              return 'done';
            });
        process.stdout.write(JSON.stringify({result}));
      })().catch((error) => {
        process.stderr.write(error.stack || String(error));
        process.exitCode = 1;
      });
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', source, root],
      {encoding:'utf8'}));
    assert.deepEqual(result, {result:'done'});
    assert.equal(fs.existsSync(lockPath), false);
  } finally { remove(root); }
});

test('routine heartbeat durability does not fsync the sibling staging parent', () => {
  const root = makeRepo('dw-lock-heartbeat-fsync-');
  try {
    const runtime = createPlatformRuntimeForTest();
    const lock = runtime.issueProjectStateCapability(root,
      path.join(root, '.claude', 'heartbeat-fsync.lock'),
      {role:'lock', allowMissingLeaf:true});
    assert.equal(runtime.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:200, heartbeatMs:25,
        processIdentity:'c'.repeat(32)}, () => 'done'), 'done');
    assert.deepEqual(runtime.lockDurability()
      .filter((record) => record.stage.startsWith('first-heartbeat'))
      .map((record) => record.stage), ['first-heartbeat']);
  } finally { remove(root); }
});

test('expired partial ticket is recovered only from its canonical filename and three ESRCH probes', () => {
  const root = makeRepo();
  try {
    const lock = issueProjectStateCapability(root, path.join(root, '.claude', 'partial.lock'),
      {role:'lock', allowMissingLeaf:true});
    const rootStat = fs.lstatSync(root);
    const rootIdentity = {dev:String(rootStat.dev), ino:String(rootStat.ino), mode:rootStat.mode,
      type:'directory'};
    const targetIdentity = hash(Buffer.from(canonicalJsonForTest({version:1,
      projectRoot:lock.canonicalProjectRoot, path:lock.path, rootIdentity})));
    const core = {version:2, targetIdentity, pid:999_999, processIdentity:'7'.repeat(32),
      nonce:'8'.repeat(32), createdAt:1_000, ticketExpiresAt:31_000};
    const ticket = {version:2, claimCoreDigest:hash(Buffer.from(canonicalJsonForTest(core))),
      targetIdentity, pid:core.pid, processIdentity:core.processIdentity, nonce:core.nonce,
      createdAt:core.createdAt, ticketExpiresAt:core.ticketExpiresAt};
    const name = ['v2', hash(Buffer.from(targetIdentity)), core.pid, core.processIdentity, core.nonce,
      core.createdAt, core.ticketExpiresAt, 'ticket'].join('.');
    const claims = `${lock.path}.claims`;
    fs.mkdirSync(claims);
    fs.writeFileSync(path.join(claims, name), Buffer.from(canonicalJsonForTest(ticket)).subarray(0, 23));
    let probes = 0;
    const nonces = ['9'.repeat(32), 'a'.repeat(32)];
    const runtime = createPlatformRuntimeForTest({clock:() => 31_001,
      livenessImpl:() => { probes += 1; return {status:'dead', reason:'ESRCH'}; },
      nonceFactory:() => nonces.shift() || 'b'.repeat(32)});
    assert.equal(runtime.withDirectoryLock(lock, {timeoutMs:1_000, staleMs:200, heartbeatMs:25,
      processIdentity:'c'.repeat(32)}, () => 'recovered'), 'recovered');
    assert.equal(probes, 3);
    assert.deepEqual(fs.readdirSync(claims), []);
  } finally { remove(root); }
});

test('SIGKILL owner is reclaimed only after stale heartbeat and ESRCH', async () => {
  if (process.platform === 'win32') return test.skip('SIGKILL integration is POSIX-only');
  const root = makeRepo();
  try {
    const lockPath = path.join(root, '.claude', 'worker.lock');
    const worker = fork(path.join(fixtureRoot, 'lock-worker.js'),
      [root, lockPath, 'b'.repeat(32)], {stdio:['ignore','ignore','inherit','ipc']});
    await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    worker.kill('SIGKILL');
    await new Promise((resolve) => worker.once('exit', resolve));
    await new Promise((resolve) => setTimeout(resolve, 220));
    const lock = issueProjectStateCapability(root, lockPath, {role:'lock', allowMissingLeaf:true});
    assert.equal(withDirectoryLock(lock, {timeoutMs:1_000, staleMs:150, heartbeatMs:25,
      processIdentity:'c'.repeat(32)}, () => 'recovered'), 'recovered');
    const claims = `${lockPath}.claims`;
    assert.deepEqual(fs.existsSync(claims) ? fs.readdirSync(claims) : [], []);
  } finally { remove(root); }
});

test('release ticket unlink failure is typed and retains only its exact ticket', () => {
  const root = makeRepo();
  try {
    const issuer = createPlatformRuntimeForTest({fsImpl:{
      unlinkSync(value) {
        if (String(value).endsWith('.ticket')) throw Object.assign(new Error('busy'), {code:'EPERM'});
        return fs.unlinkSync(value);
      },
    }});
    const lock = issuer.issueProjectStateCapability(root, path.join(root, '.claude', 'release.lock'),
      {role:'lock', allowMissingLeaf:true});
    assert.throws(() => issuer.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:200, heartbeatMs:25, processIdentity:'d'.repeat(32)}, () => 'done'),
    (error) => error.code === 'lock-release-ticket-cleanup-failed' &&
      error.ticketPath.endsWith('.ticket'));
    assert.equal(fs.existsSync(lock.path), false);
    assert.equal(fs.readdirSync(`${lock.path}.claims`).filter((name) => name.endsWith('.ticket')).length, 1);
  } finally { remove(root); }
});

test('pending operations replay in order and failed replay retains draining bytes', () => {
  const root = makeRepo();
  try {
    const target = issueProjectStateCapability(root, path.join(root, '.claude', 'history.jsonl'),
      {role:'history', allowMissingLeaf:true});
    const pending = issueProjectStateCapability(root,
      path.join(root, '.claude', '.pending-append.jsonl'), {role:'pending', allowMissingLeaf:true});
    appendJsonLineLocked(target, {id:'a'}, {pendingCapability:pending});
    appendJsonLineLocked(target, {id:'b'}, {pendingCapability:pending});
    assert.deepEqual(fs.readFileSync(target.path, 'utf8').trim().split('\n').map(JSON.parse),
      [{id:'a'}, {id:'b'}]);
    fs.writeFileSync(pending.path,
      canonicalJsonForTest({version:1,kind:'append-json-line',payload:{id:'c'}}));
    const reducer = (bytes, operations) => Buffer.concat([bytes,
      Buffer.from(operations.map((op) => `${JSON.stringify(op.payload)}\n`).join(''))]);
    const failing = createPlatformRuntimeForTest({pendingIoImpl:{
      beforeCanonicalWrite(){ throw new Error('replay-failure'); },
    }});
    assert.throws(() => failing.drainPendingOperations(target,
      {pendingCapability:pending, applyOperations:reducer}), /replay-failure/);
    assert.equal(fs.readdirSync(path.dirname(pending.path)).some((name) =>
      name.startsWith(`${path.basename(pending.path)}.draining.`)), true);
    assert.equal(drainPendingOperations(target,
      {pendingCapability:pending, applyOperations:reducer}).recovered, 1);
    assert.match(fs.readFileSync(target.path, 'utf8'), /"id":"c"/);
  } finally { remove(root); }
});

test('append-json-line replay is idempotent for an already-applied exact operation', () => {
  const root = makeRepo();
  try {
    const target = issueProjectStateCapability(root, path.join(root, '.claude', 'events.jsonl'),
      {role:'history', allowMissingLeaf:true});
    const pending = issueProjectStateCapability(root,
      path.join(root, '.claude', '.pending-append.jsonl'), {role:'pending', allowMissingLeaf:true});
    appendJsonLineLocked(target, {id:'same'}, {pendingCapability:pending});
    fs.writeFileSync(pending.path,
      canonicalJsonForTest({version:1,kind:'append-json-line',payload:{id:'same'}}));
    drainPendingOperations(target, {pendingCapability:pending,
      applyOperations:(bytes, operations) => Buffer.concat([bytes,
        Buffer.from(operations.map((operation) => `${JSON.stringify(operation.payload)}\n`).join(''))])});
    assert.equal(fs.readFileSync(target.path, 'utf8').trim().split('\n').length, 1);
  } finally { remove(root); }
});

test('noncanonical pending JSONL is retained and never mutates the canonical target', () => {
  const root = makeRepo();
  try {
    const target = issueProjectStateCapability(root, path.join(root, '.claude', 'canonical.jsonl'),
      {role:'history', allowMissingLeaf:true});
    const pending = issueProjectStateCapability(root,
      path.join(root, '.claude', '.pending-append.jsonl'), {role:'pending', allowMissingLeaf:true});
    fs.writeFileSync(pending.path,
      '{"version":1,"kind":"append-json-line","payload":{"id":"wrong-order"}}\n');
    assert.throws(() => drainPendingOperations(target, {pendingCapability:pending,
      applyOperations:(bytes) => bytes}), /pending-operation-invalid/);
    assert.equal(fs.existsSync(target.path), false);
    assert.equal(fs.readdirSync(path.dirname(pending.path)).some((name) =>
      name.startsWith(`${path.basename(pending.path)}.draining.`)), true);
  } finally { remove(root); }
});

test('process supervision removes a grandchild after normal completion and timeout', async () => {
  const root = makeRepo();
  try {
    const {project} = caps(root);
    for (const [mode, timeoutMs] of [['normal', 2_000], ['timeout', 150]]) {
      const marker = path.join(root, `.claude/${mode}.pid`);
      const result = await spawnPortable({kind:'native-executable', executable:process.execPath,
        args:[path.join(fixtureRoot, 'process-tree-parent.js'), mode, marker]},
      {cwdCapability:project, timeoutMs, maxOutputBytes:128_000});
      assert.equal(fs.existsSync(marker), true, mode);
      const pid = Number(fs.readFileSync(marker, 'utf8'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.throws(() => process.kill(pid, 0), {code:'ESRCH'});
      assert.equal(mode === 'normal' ? result.ok : result.timedOut, true, mode);
    }
  } finally { remove(root); }
});

test('output overflow removes the process tree and termination failure is fail-closed', async () => {
  const root = makeRepo();
  try {
    const {project} = caps(root);
    const marker = path.join(root, '.claude', 'overflow.pid');
    const result = await spawnPortable({kind:'native-executable', executable:process.execPath,
      args:[path.join(fixtureRoot, 'process-tree-parent.js'), 'overflow', marker]},
    {cwdCapability:project, timeoutMs:2_000, maxOutputBytes:1_024});
    assert.equal(result.outputOverflow, true);
    const pid = Number(fs.readFileSync(marker, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(() => process.kill(pid, 0), {code:'ESRCH'});

    let failedPid;
    const failing = createPlatformRuntimeForTest({terminationImpl:async ({pid}) => {
      failedPid = pid;
      const error = new Error('cannot terminate');
      error.code = 'process-tree-termination-failed';
      throw error;
    }});
    await assert.rejects(() => failing.spawnPortable({kind:'native-executable',
      executable:process.execPath,
      args:[path.join(fixtureRoot, 'process-tree-parent.js'), 'timeout',
        path.join(root, '.claude', 'failure.pid')]},
    {cwdCapability:project, timeoutMs:100, maxOutputBytes:1_024}),
    /cannot terminate/);
    if (failedPid && process.platform !== 'win32') {
      try { process.kill(-failedPid, 'SIGKILL'); } catch {}
    }
  } finally { remove(root); }
});

test('test runtime rejects every injection key outside the closed test-only seam', () => {
  for (const key of ['resolver','io','prefixAnswer','callerPackageRoot','streamInventoryImpl']) {
    assert.throws(() => createPlatformRuntimeForTest({[key]:{}}), /test-runtime-option-invalid/, key);
  }
});

test('fixed Windows stream helper is closed P/Invoke source without Get-Item or caller code', () => {
  const source = fs.readFileSync(path.join(__dirname, 'windows-stream-inventory.ps1'), 'utf8');
  for (const name of ['FindFirstStreamW', 'FindNextStreamW', 'FindClose', 'GetLastWin32Error']) {
    assert.match(source, new RegExp(name));
  }
  assert.doesNotMatch(source, /Get-Item\s+-Stream/i);
  assert.doesNotMatch(source, /Invoke-Expression|\biex\b/i);
  assert.match(source, /relative_path/);
});

test('Windows stream execution validator rejects the complete helper output/failure mutant matrix', () => {
  const root = makeRepo('dw-stream-mutants-');
  try {
    const directory = path.join(root, 'typed');
    const file = path.join(directory, 'file.txt');
    fs.mkdirSync(directory);
    fs.writeFileSync(file, 'main');
    const {project, git} = caps(root);
    const typedRows = [
      {version:1, id:0, kind:'root', relative_path:null, absolutePath:fs.realpathSync(root)},
      {version:1, id:1, kind:'directory', relative_path:'typed', absolutePath:fs.realpathSync(directory)},
      {version:1, id:2, kind:'file', relative_path:'typed/file.txt', absolutePath:fs.realpathSync(file)},
    ].map((row) => {
      const stat = fs.lstatSync(row.absolutePath);
      return {...row, identity:{dev:String(stat.dev), ino:String(stat.ino), mode:stat.mode,
        type:stat.isDirectory() ? 'directory' : 'file'}};
    });
    const cleanRows = () => typedRows.map((row) => ({version:1, id:row.id, kind:row.kind,
      streams:row.kind === 'file' ? [{name:'::$DATA', size:4}] : []}));
    const output = (rows) => `${rows.map(JSON.stringify).join('\n')}\n`;
    const okExecution = (rows = cleanRows()) => ({error:null, status:0, signal:null, stderr:'',
      result:{ok:true, stdout:output(rows), stderr:''}});
    const scenarios = [
      ['omitted-root', () => okExecution(cleanRows().slice(1)), /stream-result-set/],
      ['omitted-directory', () => okExecution(cleanRows().filter((row) => row.id !== 1)), /stream-result-set/],
      ['omitted-file', () => okExecution(cleanRows().filter((row) => row.id !== 2)), /stream-result-set/],
      ['malformed-json', () => ({...okExecution(), result:{ok:true,
        stdout:`{bad\n${cleanRows().slice(1).map(JSON.stringify).join('\n')}\n`, stderr:''}}),
        /stream-output/],
      ['foreign-id', () => okExecution(cleanRows().map((row) => row.id === 2 ? {...row, id:99} : row)),
        /stream-result-set/],
      ['wrong-kind', () => okExecution(cleanRows().map((row) => row.id === 1 ? {...row, kind:'file'} : row)),
        /stream-result-set/],
      ['duplicate-row', () => okExecution([...cleanRows().slice(0, 2), cleanRows()[1]]), /stream-output/],
      ['duplicate-stream', () => okExecution(cleanRows().map((row) => row.id === 2
        ? {...row, streams:[{name:'::$DATA',size:4},{name:'::$DATA',size:4}]} : row)), /stream-output/],
      ['negative-size', () => okExecution(cleanRows().map((row) => row.id === 2
        ? {...row, streams:[{name:'::$DATA',size:-1}]} : row)), /stream-output/],
      ['malformed-utf16', () => okExecution(cleanRows().map((row) => row.id === 2
        ? {...row, streams:[{name:'bad\ud800',size:1}]} : row)), /stream-output/],
      ['named-stream', () => okExecution(cleanRows().map((row) => row.id === 0
        ? {...row, streams:[{name:':hidden:$DATA',size:1}]} : row)), /alternate-stream/],
      ['missing-unnamed-file-stream', () => okExecution(cleanRows().map((row) => row.id === 2
        ? {...row, streams:[]} : row)), /alternate-stream/],
      ['timeout', () => ({...okExecution(), error:Object.assign(new Error('timeout'), {code:'ETIMEDOUT'})}),
        /stream-timeout/],
      ['nonzero', () => ({...okExecution(), status:7}), /stream-helper-failed/],
      ['signal', () => ({...okExecution(), signal:'SIGTERM'}), /stream-helper-failed/],
      ['outer-stderr', () => ({...okExecution(), stderr:'noise'}), /stream-helper-failed/],
      ['result-nonzero', () => ({...okExecution(), result:{ok:false, stdout:'', stderr:''}}),
        /stream-helper-failed/],
      ['missing-result', () => ({error:null, status:0, signal:null, stderr:'', result:null}),
        /stream-helper-failed/],
      ['result-stderr', () => ({...okExecution(), result:{ok:true, stdout:output(cleanRows()), stderr:'noise'}}),
        /stream-helper-failed/],
      ['overflow', () => ({...okExecution(), result:{ok:true,
        stdout:'x'.repeat(WINDOWS_STREAM_INVENTORY_MAX_OUTPUT_BYTES + 1), stderr:''}}),
        /stream-helper-failed/],
    ];
    for (const [name, execution, pattern] of scenarios) {
      const runtime = createPlatformRuntimeForTest({platform:'win32',
        manifestWalkerImpl:() => ({entries:[], directories:[], typedRows}),
        windowsStreamInventoryImpl:() => execution()});
      assert.throws(() => runtime.captureWorktreeManifest({projectCapability:project,
        gitCapability:git, runtimeExclusions:[]}), pattern, name);
    }

    let pass = 0;
    const changing = createPlatformRuntimeForTest({platform:'win32',
      manifestWalkerImpl:() => ({entries:[], directories:[], typedRows}),
      windowsStreamInventoryImpl:() => {
        pass += 1;
        return okExecution(cleanRows().map((row) => row.id === 2
          ? {...row, streams:[{name:'::$DATA',size:pass === 1 ? 4 : 5}]} : row));
      }});
    assert.throws(() => changing.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /alternate-stream/);

    let removalPasses = 0;
    const removal = createPlatformRuntimeForTest({platform:'win32',
      manifestWalkerImpl:() => ({entries:[], directories:[], typedRows}),
      windowsStreamInventoryImpl:({pass:inventoryPass}) => {
        removalPasses += 1;
        return okExecution(cleanRows().map((row) => row.id === 2 && inventoryPass === 1
          ? {...row, streams:[{name:'::$DATA',size:4},{name:':removed:$DATA',size:1}]} : row));
      }});
    assert.throws(() => removal.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /alternate-stream/);
    assert.equal(removalPasses, 2, 'removal between complete passes must be observed');

    let identityPass = 0;
    const identityChanging = createPlatformRuntimeForTest({platform:'win32',
      manifestWalkerImpl:() => ({entries:[], directories:[], typedRows}),
      windowsStreamInventoryImpl:() => {
        identityPass += 1;
        if (identityPass === 1) {
          const replacement = `${file}.replacement`;
          fs.writeFileSync(replacement, 'main');
          fs.renameSync(replacement, file);
        }
        return okExecution();
      }});
    assert.throws(() => identityChanging.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /worktree-manifest-unstable/);
  } finally { remove(root); }
});

test('project-state issuance applies portable-path-v1 before granting authority', () => {
  const root = makeRepo();
  try {
    const accepted = issueProjectStateCapability(root, path.join(root, '.claude', '한 글.json'),
      {role:'state', allowMissingLeaf:true});
    assert.equal(accepted.path, path.join(root, '.claude', '한 글.json'));
    for (const relative of [
      '.claude/CON.txt', '.claude/a:b', '.claude/trailing.', '.claude/trailing ',
      '.claude/e\u0301.json', '.claude/COM¹.log',
    ]) {
      const candidate = path.join(root, ...relative.split('/'));
      assert.throws(() => issueProjectStateCapability(root, candidate,
        {role:'state', allowMissingLeaf:true}), /portable-path-v1/, relative);
    }
  } finally { remove(root); }
});

test('session work-dir capability binds the exact real .deep-work session tuple', () => {
  const root = makeRepo();
  try {
    const exact = path.join(root, '.deep-work', 's-a1b2c3d4');
    fs.mkdirSync(exact, {recursive:true});
    const sessionState = issueProjectStateCapability(root,
      path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
    const cap = issueProjectStateCapability(root, exact,
      {role:'session-work-dir', sessionStateCapability:sessionState});
    assert.deepEqual([cap.role, cap.path], ['session-work-dir', exact]);
    for (const candidate of [
      path.join(root, '.claude', 'sessions', 's-a1b2c3d4'),
      path.join(root, '.deep-work', 'invented', 's-a1b2c3d4'),
      path.join(root, '.deep-work', 's-a1b2c3d4', 'nested'),
      path.join(root, '.deep-work', 's-deadbeef'),
    ]) {
      if (!fs.existsSync(candidate)) fs.mkdirSync(candidate, {recursive:true});
      assert.throws(() => issueProjectStateCapability(root, candidate,
        {role:'session-work-dir', sessionStateCapability:sessionState}),
      /project-state-route|session-capability-identity/);
    }
  } finally { remove(root); }
});

test('owned-temp durable consumer journal survives reissue and rejects a second consumer', () => {
  const root = makeRepo();
  try {
    const workDir = path.join(root, '.deep-work', 's-a1b2c3d4');
    fs.mkdirSync(workDir, {recursive:true});
    const sessionState = issueProjectStateCapability(root,
      path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
    const work = issueProjectStateCapability(root, workDir,
      {role:'session-work-dir', sessionStateCapability:sessionState});
    const producerOperationId = `op-${'1'.repeat(32)}`;
    const consumerOperationId = `op-${'2'.repeat(32)}`;
    const input = {sessionCapability:work, operationId:producerOperationId, purpose:'notes'};
    const first = issueOwnedTempCapability(input);
    atomicWriteFile(first, 'durable');
    consumeOwnedTemp(first, {operationId:consumerOperationId, purpose:'notes',
      expectedDigest:first.contentDigest});
    const retry = issueOwnedTempCapability(input);
    atomicWriteFile(retry, 'durable');
    assert.doesNotThrow(() => consumeOwnedTemp(retry, {operationId:consumerOperationId,
      purpose:'notes', expectedDigest:first.contentDigest}));
    const rival = issueOwnedTempCapability(input);
    atomicWriteFile(rival, 'durable');
    assert.throws(() => consumeOwnedTemp(rival, {operationId:`op-${'3'.repeat(32)}`,
      purpose:'notes', expectedDigest:first.contentDigest}), /owned-temp-already-consumed/);
    assert.notEqual(consumerOperationId, producerOperationId);
  } finally { remove(root); }
});

test('owned-temp terminal tombstone prevents same-producer rewrite after consume/remove/reissue', () => {
  const root = makeRepo();
  try {
    const {work} = caps(root);
    const producerId = `op-${'b'.repeat(32)}`;
    const consumerId = `op-${'c'.repeat(32)}`;
    const input = {sessionCapability:work, operationId:producerId, purpose:'notes'};
    const first = issueOwnedTempCapability(input);
    atomicWriteFile(first, 'terminal-old');
    const digest = first.contentDigest;
    consumeOwnedTemp(first, {operationId:consumerId, purpose:'notes', expectedDigest:digest});
    assert.equal(compareRemoveOwnedTemp(first, digest), true);
    assert.equal(fs.existsSync(first.path), false);
    assert.equal(fs.existsSync(`${first.path}.owner.json`), false);

    const exactRetry = issueOwnedTempCapability(input);
    assert.deepEqual(atomicWriteFile(exactRetry, 'terminal-old'), {
      written:false, adopted:true, terminal:true, sha256:digest,
    });
    assert.equal(exactRetry.state, 'removed');
    assert.equal(fs.existsSync(exactRetry.path), false);
    assert.doesNotThrow(() => consumeOwnedTemp(exactRetry,
      {operationId:consumerId, purpose:'notes', expectedDigest:digest}));
    assert.throws(() => consumeOwnedTemp(exactRetry,
      {operationId:`op-${'d'.repeat(32)}`, purpose:'notes', expectedDigest:digest}),
    /owned-temp-already-consumed/);

    const differentRetry = issueOwnedTempCapability(input);
    assert.throws(() => atomicWriteFile(differentRetry, 'terminal-different'),
      /owned-temp-terminal-conflict/);
    assert.equal(fs.existsSync(differentRetry.path), false);

    const fresh = issueOwnedTempCapability({sessionCapability:work,
      operationId:`op-${'e'.repeat(32)}`, purpose:'notes'});
    assert.equal(atomicWriteFile(fresh, 'terminal-different').written, true);
  } finally { remove(root); }
});

test('owned-temp terminal tombstone is enforced in a fresh Node process', () => {
  const root = makeRepo();
  try {
    const {work} = caps(root);
    const producerId = `op-${'f'.repeat(32)}`;
    const consumerId = `op-${'1'.repeat(32)}`;
    const cap = issueOwnedTempCapability({sessionCapability:work,
      operationId:producerId, purpose:'notes'});
    atomicWriteFile(cap, 'cross-process');
    const digest = cap.contentDigest;
    consumeOwnedTemp(cap, {operationId:consumerId, purpose:'notes', expectedDigest:digest});
    compareRemoveOwnedTemp(cap, digest);
    const worker = path.join(fixtureRoot, 'owned-temp-reissue-worker.js');
    const exact = JSON.parse(execFileSync(process.execPath,
      [worker, root, producerId, 'notes', 'cross-process'], {encoding:'utf8'}));
    assert.deepEqual(exact, {ok:true, result:{written:false, adopted:true, terminal:true,
      sha256:digest}, state:'removed', targetExists:false});
    assert.throws(() => execFileSync(process.execPath,
      [worker, root, producerId, 'notes', 'different'], {encoding:'utf8', stdio:['ignore','pipe','pipe']}),
    /Command failed/);
    assert.equal(fs.existsSync(cap.path), false);
  } finally { remove(root); }
});

test('owned-temp cleanup resumes every process-death boundary before exposing removed', () => {
  const boundaries = [
    'after-cleanup-intent-fsync',
    'after-owner-rename',
    'after-target-rename',
    'after-target-unlink',
    'after-owner-unlink',
    'after-cleanup-directory-fsync',
    'after-terminal-stage-write',
    'after-terminal-stage-fsync',
    'after-terminal-rename',
  ];
  for (const boundary of boundaries) {
    const root = makeRepo(`dw-owned-cleanup-${boundary}-`);
    try {
      let armed = false;
      let fired = false;
      let targetPath;
      let ownerPath;
      const directoryFds = new Set();
      const terminalStageFds = new Set();
      const runtime = createPlatformRuntimeForTest({fsImpl:{
        openSync(value, flags, mode) {
          if (armed && boundary === 'after-cleanup-directory-fsync' &&
              String(value).startsWith(`${targetPath}.terminal.json.publish.`) && flags === 'wx') {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          const fd = fs.openSync(value, flags, mode);
          if (flags === 'r' && value === path.dirname(targetPath || '')) directoryFds.add(fd);
          if (String(value).startsWith(`${targetPath}.terminal.json.publish.`)) {
            terminalStageFds.add(fd);
          }
          return fd;
        },
        closeSync(fd) {
          directoryFds.delete(fd);
          terminalStageFds.delete(fd);
          return fs.closeSync(fd);
        },
        writeFileSync(fd, bytes) {
          const result = fs.writeFileSync(fd, bytes);
          if (armed && !fired && boundary === 'after-terminal-stage-write' &&
              terminalStageFds.has(fd)) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          return result;
        },
        fsyncSync(fd) {
          const result = fs.fsyncSync(fd);
          if (armed && !fired && boundary === 'after-terminal-stage-fsync' &&
              terminalStageFds.has(fd)) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          if (armed && !fired && boundary === 'after-owner-unlink' && directoryFds.has(fd) &&
              !fs.existsSync(ownerPath) && !fs.existsSync(targetPath)) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          return result;
        },
        renameSync(source, destination) {
          if (armed && !fired && boundary === 'after-cleanup-intent-fsync' && source === ownerPath) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          const result = fs.renameSync(source, destination);
          if (armed && !fired && boundary === 'after-owner-rename' && source === ownerPath) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          if (armed && !fired && boundary === 'after-target-rename' && source === targetPath) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          if (armed && !fired && boundary === 'after-terminal-rename' &&
              String(source).startsWith(`${targetPath}.terminal.json.publish.`) &&
              destination === `${targetPath}.terminal.json`) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          return result;
        },
        unlinkSync(value) {
          const result = fs.unlinkSync(value);
          if (armed && !fired && boundary === 'after-target-unlink' &&
              String(value).startsWith(`${targetPath}.remove.`)) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          if (armed && !fired && boundary === 'after-owner-unlink' &&
              String(value).startsWith(`${ownerPath}.remove.`)) {
            fired = true;
            throw Object.assign(new Error(boundary), {code:'EIO'});
          }
          return result;
        },
      }});
      const state = runtime.issueProjectStateCapability(root,
        path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
      const work = runtime.issueProjectStateCapability(root,
        path.join(root, '.deep-work', 's-a1b2c3d4'),
        {role:'session-work-dir', sessionStateCapability:state});
      const producerId = `op-${hash(boundary).slice(0, 32)}`;
      const consumerId = `op-${hash(`consumer-${boundary}`).slice(0, 32)}`;
      const first = runtime.issueOwnedTempCapability({sessionCapability:work,
        operationId:producerId, purpose:'notes'});
      targetPath = first.path;
      ownerPath = `${targetPath}.owner.json`;
      runtime.atomicWriteFile(first, `payload-${boundary}`);
      const digest = first.contentDigest;
      consumeOwnedTemp(first, {operationId:consumerId, purpose:'notes', expectedDigest:digest});
      armed = true;
      assert.throws(() => compareRemoveOwnedTemp(first, digest), new RegExp(boundary));
      assert.equal(fired, true, boundary);
      armed = false;

      const retryState = issueProjectStateCapability(root,
        path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
      const retryWork = issueProjectStateCapability(root,
        path.join(root, '.deep-work', 's-a1b2c3d4'),
        {role:'session-work-dir', sessionStateCapability:retryState});
      const retry = issueOwnedTempCapability({sessionCapability:retryWork,
        operationId:producerId, purpose:'notes'});
      assert.equal(retry.state, 'removed', boundary);
      assert.deepEqual(atomicWriteFile(retry, `payload-${boundary}`),
        {written:false, adopted:true, terminal:true, sha256:digest}, boundary);
      assert.equal(fs.existsSync(targetPath), false, boundary);
      assert.equal(fs.existsSync(ownerPath), false, boundary);
      assert.equal(fs.readdirSync(path.dirname(targetPath)).some((name) => name.includes('.remove.')),
        false, boundary);
      const repeated = issueOwnedTempCapability({sessionCapability:retryWork,
        operationId:producerId, purpose:'notes'});
      assert.equal(repeated.state, 'removed', boundary);
    } finally { remove(root); }
  }
});

test('owned-temp cleanup converges from fresh-process death at every durable stage', async () => {
  if (process.platform === 'win32') return test.skip('SIGKILL cleanup matrix is POSIX-only');
  const boundaries = [
    'after-cleanup-intent-fsync',
    'after-owner-rename',
    'after-target-rename',
    'after-target-unlink',
    'after-owner-unlink',
    'after-cleanup-directory-fsync',
    'after-terminal-stage-write',
    'after-terminal-stage-fsync',
    'after-terminal-rename',
    'after-terminal-directory-fsync',
  ];
  for (const boundary of boundaries) {
    const root = makeRepo(`dw-owned-cleanup-process-${boundary}-`);
    const control = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-owned-cleanup-control-'));
    try {
      const producerId = `op-${hash(`producer-${boundary}`).slice(0, 32)}`;
      const consumerId = `op-${hash(`consumer-${boundary}`).slice(0, 32)}`;
      const worker = fork(path.join(fixtureRoot, 'owned-temp-cleanup-worker.js'),
        [root, boundary, producerId, consumerId, control],
        {stdio:['ignore','ignore','inherit','ipc']});
      const markerPath = path.join(control, `${boundary}.json`);
      await waitForPath(markerPath);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      assert.deepEqual({boundary:marker.boundary, pid:marker.pid, producerId:marker.producerId,
        consumerId:marker.consumerId}, {boundary, pid:worker.pid, producerId, consumerId});
      worker.kill('SIGKILL');
      const exit = await new Promise((resolve) => worker.once('exit', (code, signal) =>
        resolve({code, signal})));
      assert.equal(exit.signal, 'SIGKILL', boundary);

      const reissue = JSON.parse(execFileSync(process.execPath,
        [path.join(fixtureRoot, 'owned-temp-reissue-worker.js'), root, producerId, 'notes',
          `payload-${boundary}`], {encoding:'utf8'}));
      assert.deepEqual(reissue, {ok:true, result:{written:false, adopted:true, terminal:true,
        sha256:marker.digest}, state:'removed', targetExists:false}, boundary);
      assert.equal(fs.existsSync(`${marker.targetPath}.owner.json`), false, boundary);
      assert.equal(fs.existsSync(`${marker.targetPath}.terminal.json`), true, boundary);
      assert.equal(fs.readdirSync(path.dirname(marker.targetPath)).some((name) =>
        name.includes('.remove.') || name.includes('.terminal.json.publish.')), false, boundary);
    } finally { remove(root); remove(control); }
  }
});

test('all crash-resumable sidecars recover fresh-process open and torn-write death', async (t) => {
  if (process.platform === 'win32') return test.skip('SIGKILL sidecar matrix is POSIX-only');
  for (const sidecarKind of ['cleanup-intent','finalized-consumer','owner','owned-consumer']) {
    for (const boundary of ['after-open','during-write','after-publish']) {
      await t.test(`${sidecarKind}:${boundary}`, async () => {
      const root = makeRepo(`dw-sidecar-${sidecarKind}-${boundary}-`);
      const control = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sidecar-control-'));
      try {
        const producerId = `op-${hash(`producer-${sidecarKind}-${boundary}`).slice(0, 32)}`;
        const consumerId = `op-${hash(`consumer-${sidecarKind}-${boundary}`).slice(0, 32)}`;
        const worker = fork(path.join(fixtureRoot, 'sidecar-crash-worker.js'),
          [root, sidecarKind, boundary, producerId, consumerId, control],
          {stdio:['ignore','ignore','inherit','ipc']});
        const markerPath = path.join(control, `${sidecarKind}-${boundary}.json`);
        await waitForPath(markerPath);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        assert.deepEqual({sidecarKind:marker.sidecarKind, boundary:marker.boundary,
          pid:marker.pid, producerId:marker.producerId, consumerId:marker.consumerId},
        {sidecarKind, boundary, pid:worker.pid, producerId, consumerId});
        worker.kill('SIGKILL');
        const exit = await new Promise((resolve) => worker.once('exit', (code, signal) =>
          resolve({code, signal})));
        assert.equal(exit.signal, 'SIGKILL', `${sidecarKind}:${boundary}`);
        const interrupted = fs.readFileSync(marker.actualPath);
        assert.equal(interrupted.length === 0 || interrupted.length < 512, true,
          `${sidecarKind}:${boundary}`);

        const retry = JSON.parse(execFileSync(process.execPath,
          [path.join(fixtureRoot, 'sidecar-retry-worker.js'), root, sidecarKind, boundary,
            producerId, consumerId], {encoding:'utf8', stdio:['ignore','pipe','pipe']}));
        if (sidecarKind === 'finalized-consumer') {
          assert.deepEqual({state:retry.state, envelopeOperationId:retry.envelopeOperationId},
            {state:'enveloped', envelopeOperationId:consumerId}, `${sidecarKind}:${boundary}`);
        } else {
          assert.equal(retry.state, 'removed', `${sidecarKind}:${boundary}`);
          assert.equal(retry.targetExists, false, `${sidecarKind}:${boundary}`);
          assert.equal(retry.ownerExists, false, `${sidecarKind}:${boundary}`);
          assert.deepEqual(retry.removeResidue, [], `${sidecarKind}:${boundary}`);
        }
        assert.equal(fs.readdirSync(path.dirname(marker.sidecarPath))
          .some((name) => name.includes('.publish.')), false, `${sidecarKind}:${boundary}`);
      } finally { remove(root); remove(control); }
      });
    }
  }
});

test('exclusive sidecar staging rejects and preserves foreign mismatched bytes', () => {
  const root = makeRepo('dw-sidecar-foreign-stage-');
  try {
    let armed = false;
    let sidecarPath;
    let foreignPath;
    const foreignBytes = Buffer.from('foreign-sidecar-staging\n');
    const runtime = createPlatformRuntimeForTest({fsImpl:{
      openSync(value, flags, mode) {
        if (armed && flags === 'wx' &&
            (value === sidecarPath || String(value).startsWith(`${sidecarPath}.publish.`))) {
          armed = false;
          foreignPath = value;
          fs.writeFileSync(value, foreignBytes, {flag:'wx'});
        }
        return fs.openSync(value, flags, mode);
      },
    }});
    const state = runtime.issueProjectStateCapability(root,
      path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
    const work = runtime.issueProjectStateCapability(root,
      path.join(root, '.deep-work', 's-a1b2c3d4'),
      {role:'session-work-dir', sessionStateCapability:state});
    const temp = runtime.issueOwnedTempCapability({sessionCapability:work,
      operationId:`op-${'0'.repeat(32)}`, purpose:'notes'});
    sidecarPath = `${temp.path}.owner.json`;
    armed = true;
    assert.throws(() => runtime.atomicWriteFile(temp, 'foreign-stage-safe'),
      /exclusive-sidecar-staging-invalid|owned-temp-foreign/);
    assert.deepEqual(fs.readFileSync(foreignPath), foreignBytes);
    assert.equal(fs.existsSync(sidecarPath), false);
    assert.equal(fs.existsSync(temp.path), false);
  } finally { remove(root); }
});

test('owned-temp cleanup recovery retains drifted authenticated artifacts', () => {
  const root = makeRepo('dw-owned-cleanup-foreign-');
  try {
    let armed = false;
    let ownerPath;
    const runtime = createPlatformRuntimeForTest({fsImpl:{
      renameSync(source, destination) {
        if (armed && source === ownerPath) {
          throw Object.assign(new Error('cleanup-crash'), {code:'EIO'});
        }
        return fs.renameSync(source, destination);
      },
    }});
    const state = runtime.issueProjectStateCapability(root,
      path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
    const work = runtime.issueProjectStateCapability(root,
      path.join(root, '.deep-work', 's-a1b2c3d4'),
      {role:'session-work-dir', sessionStateCapability:state});
    const producerId = `op-${'9'.repeat(32)}`;
    const first = runtime.issueOwnedTempCapability({sessionCapability:work,
      operationId:producerId, purpose:'notes'});
    ownerPath = `${first.path}.owner.json`;
    runtime.atomicWriteFile(first, 'foreign-safe');
    const digest = first.contentDigest;
    consumeOwnedTemp(first, {operationId:`op-${'8'.repeat(32)}`, purpose:'notes',
      expectedDigest:digest});
    armed = true;
    assert.throws(() => compareRemoveOwnedTemp(first, digest), /cleanup-crash/);
    armed = false;
    fs.writeFileSync(ownerPath, 'foreign-owner\n');

    const retryState = issueProjectStateCapability(root,
      path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
    const retryWork = issueProjectStateCapability(root,
      path.join(root, '.deep-work', 's-a1b2c3d4'),
      {role:'session-work-dir', sessionStateCapability:retryState});
    assert.throws(() => issueOwnedTempCapability({sessionCapability:retryWork,
      operationId:producerId, purpose:'notes'}), /owned-temp-(foreign|cleanup)/);
    assert.equal(fs.readFileSync(ownerPath, 'utf8'), 'foreign-owner\n');
    assert.equal(fs.readFileSync(first.path, 'utf8'), 'foreign-safe');
  } finally { remove(root); }
});

test('owned-temp cleanup preserves a foreign terminal staging artifact observed before intent', () => {
  const root = makeRepo('dw-owned-cleanup-foreign-stage-');
  try {
    const {work} = caps(root);
    const producerOperationId = `op-${'a'.repeat(32)}`;
    const consumerOperationId = `op-${'b'.repeat(32)}`;
    const temp = issueOwnedTempCapability({sessionCapability:work,
      operationId:producerOperationId, purpose:'notes'});
    atomicWriteFile(temp, 'foreign-terminal-stage');
    consumeOwnedTemp(temp, {operationId:consumerOperationId, purpose:'notes',
      expectedDigest:temp.contentDigest});
    const cleanupId = hash(Buffer.from(canonicalJsonForTest({version:1,
      sessionId:'s-a1b2c3d4', producerOperationId, consumerOperationId,
      purpose:'notes', contentDigest:temp.contentDigest}))).slice(0, 32);
    const stagingPath = `${temp.path}.terminal.json.publish.${cleanupId}`;
    const foreignBytes = Buffer.from('{"cleanupDigest"');
    fs.writeFileSync(stagingPath, foreignBytes);

    assert.throws(() => compareRemoveOwnedTemp(temp, temp.contentDigest),
      /owned-temp-terminal-staging/);
    assert.deepEqual(fs.readFileSync(stagingPath), foreignBytes);
    assert.equal(fs.readFileSync(temp.path, 'utf8'), 'foreign-terminal-stage');
    assert.equal(fs.existsSync(`${temp.path}.owner.json`), true);
    assert.equal(fs.existsSync(`${temp.path}.cleanup.json`), false);
  } finally { remove(root); }
});

test('project handoff rejects stale root authority before issuance and immediate publication', () => {
  const root = makeRepo();
  const old = `${root}.old`;
  try {
    const project = issueProjectStateCapability(root, root, {role:'project-root'});
    fs.renameSync(root, old);
    fs.mkdirSync(root);
    execFileSync('git', ['init', '-q'], {cwd:root});
    assert.throws(() => issueProjectHandoffOutputCapability({projectCapability:project,
      sessionId:'s-a1b2c3d4', operationId:`op-${'2'.repeat(32)}`}),
    /path-capability-identity/);
  } finally { remove(root); remove(old); }

  const second = makeRepo();
  const secondOld = `${second}.old`;
  try {
    const project = issueProjectStateCapability(second, second, {role:'project-root'});
    const handoff = issueProjectHandoffOutputCapability({projectCapability:project,
      sessionId:'s-a1b2c3d4', operationId:`op-${'3'.repeat(32)}`});
    fs.renameSync(second, secondOld);
    fs.mkdirSync(second);
    execFileSync('git', ['init', '-q'], {cwd:second});
    assert.throws(() => atomicWriteFile(handoff, '{}\n'), /path-capability-identity/);
    assert.equal(fs.existsSync(handoff.path), false);
  } finally { remove(second); remove(secondOld); }
});

test('project handoff binds the authenticated Git repository marker across issuance/publication', () => {
  const root = makeRepo();
  const oldGit = path.join(root, '.git.old');
  try {
    const project = issueProjectStateCapability(root, root, {role:'project-root'});
    fs.renameSync(path.join(root, '.git'), oldGit);
    execFileSync('git', ['init', '-q'], {cwd:root});
    assert.throws(() => issueProjectHandoffOutputCapability({projectCapability:project,
      sessionId:'s-a1b2c3d4', operationId:`op-${'4'.repeat(32)}`}),
    /path-capability-identity/);
  } finally { remove(root); }

  const second = makeRepo();
  try {
    const project = issueProjectStateCapability(second, second, {role:'project-root'});
    const handoff = issueProjectHandoffOutputCapability({projectCapability:project,
      sessionId:'s-a1b2c3d4', operationId:`op-${'5'.repeat(32)}`});
    fs.renameSync(path.join(second, '.git'), path.join(second, '.git.old'));
    execFileSync('git', ['init', '-q'], {cwd:second});
    assert.throws(() => atomicWriteFile(handoff, '{}\n'), /path-capability-identity/);
  } finally { remove(second); }
});

test('every session-derived mutation revalidates source state and work-directory authority', () => {
  const root = makeRepo('dw-session-child-drift-');
  try {
    const {sessionState, work} = caps(root);
    const beforeWrite = issueOwnedTempCapability({sessionCapability:work,
      operationId:`op-${'1'.repeat(32)}`, purpose:'notes'});
    const beforeConsume = issueOwnedTempCapability({sessionCapability:work,
      operationId:`op-${'2'.repeat(32)}`, purpose:'notes'});
    atomicWriteFile(beforeConsume, 'consume-after-drift');
    const beforeRemove = issueOwnedTempCapability({sessionCapability:work,
      operationId:`op-${'3'.repeat(32)}`, purpose:'notes'});
    atomicWriteFile(beforeRemove, 'remove-after-drift');
    consumeOwnedTemp(beforeRemove, {operationId:`op-${'4'.repeat(32)}`, purpose:'notes',
      expectedDigest:beforeRemove.contentDigest});
    const sessionOutput = issueSessionEnvelopeOutputCapability({sessionCapability:work});
    const sliceOutput = issueSliceEnvelopeOutputCapability({sessionCapability:work, slice:'SLICE-001'});
    const producerId = `op-${'5'.repeat(32)}`;
    const payload = Buffer.from('{"done":true}\n');
    const payloadPath = path.join(work.path, '.operation-results', producerId,
      'finalized-receipt-payload.json');
    fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
    fs.writeFileSync(payloadPath, payload);
    const finalized = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:{version:1, kind:'finish-merge', operationId:producerId,
        sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'a'.repeat(64),
        finalizedBytesDigest:hash(payload)}});

    fs.writeFileSync(sessionState.path,
      '---\nwork_dir: .deep-work/s-a1b2c3d4\ncurrent_phase: finish\n---\n');
    assert.throws(() => atomicWriteFile(beforeWrite, 'write-after-drift'),
      /session-capability-identity/);
    assert.throws(() => consumeOwnedTemp(beforeConsume,
      {operationId:`op-${'6'.repeat(32)}`, purpose:'notes',
        expectedDigest:beforeConsume.contentDigest}), /session-capability-identity/);
    assert.throws(() => compareRemoveOwnedTemp(beforeRemove, beforeRemove.contentDigest),
      /session-capability-identity/);
    assert.throws(() => atomicWriteFile(sessionOutput, '{}\n'), /session-capability-identity/);
    assert.throws(() => atomicWriteFile(sliceOutput, '{}\n'), /session-capability-identity/);
    assert.throws(() => consumeFinalizedReceiptPayload(finalized,
      {kind:'envelope-publish', operationId:`op-${'7'.repeat(32)}`}),
    /session-capability-identity/);
  } finally { remove(root); }

  for (const drift of ['state-file-replacement','work-directory-replacement']) {
    const replacementRoot = makeRepo(`dw-session-child-${drift}-`);
    try {
      const {sessionState, work} = caps(replacementRoot);
      const suffix = drift === 'state-file-replacement' ? 'a' : 'b';
      const beforeWrite = issueOwnedTempCapability({sessionCapability:work,
        operationId:`op-${suffix.repeat(32)}`, purpose:'notes'});
      const beforeConsume = issueOwnedTempCapability({sessionCapability:work,
        operationId:`op-${(suffix === 'a' ? 'c' : 'd').repeat(32)}`, purpose:'notes'});
      atomicWriteFile(beforeConsume, `consume-${drift}`);
      const beforeRemove = issueOwnedTempCapability({sessionCapability:work,
        operationId:`op-${(suffix === 'a' ? 'e' : 'f').repeat(32)}`, purpose:'notes'});
      atomicWriteFile(beforeRemove, `remove-${drift}`);
      consumeOwnedTemp(beforeRemove,
        {operationId:`op-${(suffix === 'a' ? '1' : '2').repeat(32)}`, purpose:'notes',
          expectedDigest:beforeRemove.contentDigest});
      const sessionOutput = issueSessionEnvelopeOutputCapability({sessionCapability:work});
      const sliceOutput = issueSliceEnvelopeOutputCapability({sessionCapability:work,
        slice:'SLICE-003'});
      const producerId = `op-${(suffix === 'a' ? '3' : '4').repeat(32)}`;
      const payload = Buffer.from(`{"drift":"${drift}"}\n`);
      const payloadPath = path.join(work.path, '.operation-results', producerId,
        'finalized-receipt-payload.json');
      fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
      fs.writeFileSync(payloadPath, payload);
      const finalized = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
        producerOperationReceipt:{version:1, kind:'finish-merge', operationId:producerId,
          sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'5'.repeat(64),
          finalizedBytesDigest:hash(payload)}});
      if (drift === 'state-file-replacement') {
        const old = `${sessionState.path}.old`;
        fs.renameSync(sessionState.path, old);
        fs.writeFileSync(sessionState.path, fs.readFileSync(old));
      } else {
        const old = `${work.path}.old`;
        fs.renameSync(work.path, old);
        fs.mkdirSync(work.path, {recursive:true});
      }
      const expected = /(?:session-capability|path-capability)-identity/;
      assert.throws(() => atomicWriteFile(beforeWrite, `write-${drift}`), expected, drift);
      assert.throws(() => consumeOwnedTemp(beforeConsume,
        {operationId:`op-${'6'.repeat(32)}`, purpose:'notes',
          expectedDigest:beforeConsume.contentDigest}), expected, drift);
      assert.throws(() => compareRemoveOwnedTemp(beforeRemove, beforeRemove.contentDigest),
        expected, drift);
      assert.throws(() => atomicWriteFile(sessionOutput, '{}\n'), expected, drift);
      assert.throws(() => atomicWriteFile(sliceOutput, '{}\n'), expected, drift);
      assert.throws(() => consumeFinalizedReceiptPayload(finalized,
        {kind:'envelope-publish', operationId:`op-${'7'.repeat(32)}`}), expected, drift);
    } finally { remove(replacementRoot); }
  }
});

test('session-derived sidecar creation and adoption revalidate at the point of use', () => {
  {
    const root = makeRepo('dw-session-owner-sidecar-');
    try {
      const sessionStatePath = path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md');
      let armed = false;
      let terminalPath;
      const runtime = createPlatformRuntimeForTest({fsImpl:{
        lstatSync(value) {
          if (armed && value === terminalPath) {
            armed = false;
            fs.writeFileSync(sessionStatePath,
              '---\nwork_dir: .deep-work/s-a1b2c3d4\ncurrent_phase: finish\n---\n');
          }
          return fs.lstatSync(value);
        },
      }});
      const state = runtime.issueProjectStateCapability(root, sessionStatePath,
        {role:'session-state'});
      const work = runtime.issueProjectStateCapability(root,
        path.join(root, '.deep-work', 's-a1b2c3d4'),
        {role:'session-work-dir', sessionStateCapability:state});
      const temp = runtime.issueOwnedTempCapability({sessionCapability:work,
        operationId:`op-${'1'.repeat(32)}`, purpose:'notes'});
      terminalPath = `${temp.path}.terminal.json`;
      armed = true;
      assert.throws(() => runtime.atomicWriteFile(temp, 'stale-owner'),
        /session-capability-identity/);
      assert.equal(fs.existsSync(`${temp.path}.owner.json`), false);
      assert.equal(fs.existsSync(temp.path), false);
    } finally { remove(root); }
  }

  {
    const root = makeRepo('dw-session-cleanup-sidecar-');
    try {
      const sessionStatePath = path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md');
      let armed = false;
      let consumerPath;
      const runtime = createPlatformRuntimeForTest({fsImpl:{
        readFileSync(value, options) {
          const bytes = fs.readFileSync(value, options);
          if (armed && value === consumerPath) {
            armed = false;
            fs.writeFileSync(sessionStatePath,
              '---\nwork_dir: .deep-work/s-a1b2c3d4\ncurrent_phase: finish\n---\n');
          }
          return bytes;
        },
      }});
      const state = runtime.issueProjectStateCapability(root, sessionStatePath,
        {role:'session-state'});
      const work = runtime.issueProjectStateCapability(root,
        path.join(root, '.deep-work', 's-a1b2c3d4'),
        {role:'session-work-dir', sessionStateCapability:state});
      const temp = runtime.issueOwnedTempCapability({sessionCapability:work,
        operationId:`op-${'2'.repeat(32)}`, purpose:'notes'});
      runtime.atomicWriteFile(temp, 'stale-cleanup');
      consumeOwnedTemp(temp, {operationId:`op-${'3'.repeat(32)}`, purpose:'notes',
        expectedDigest:temp.contentDigest});
      consumerPath = `${temp.path}.consumer.json`;
      armed = true;
      assert.throws(() => compareRemoveOwnedTemp(temp, temp.contentDigest),
        /session-capability-identity/);
      assert.equal(fs.existsSync(`${temp.path}.cleanup.json`), false);
      assert.equal(fs.readFileSync(temp.path, 'utf8'), 'stale-cleanup');
    } finally { remove(root); }
  }

  {
    const root = makeRepo('dw-session-owned-adoption-');
    try {
      const sessionStatePath = path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md');
      let armed = false;
      let targetPath;
      const runtime = createPlatformRuntimeForTest({fsImpl:{
        openSync(value, flags, mode) {
          if (armed && value === targetPath && flags === 'wx') {
            armed = false;
            fs.writeFileSync(sessionStatePath,
              '---\nwork_dir: .deep-work/s-a1b2c3d4\ncurrent_phase: finish\n---\n');
          }
          return fs.openSync(value, flags, mode);
        },
      }});
      const state = runtime.issueProjectStateCapability(root, sessionStatePath,
        {role:'session-state'});
      const work = runtime.issueProjectStateCapability(root,
        path.join(root, '.deep-work', 's-a1b2c3d4'),
        {role:'session-work-dir', sessionStateCapability:state});
      const input = {sessionCapability:work, operationId:`op-${'4'.repeat(32)}`, purpose:'notes'};
      const first = runtime.issueOwnedTempCapability(input);
      runtime.atomicWriteFile(first, 'adopt-me');
      const retry = runtime.issueOwnedTempCapability(input);
      targetPath = retry.path;
      armed = true;
      assert.throws(() => runtime.atomicWriteFile(retry, 'adopt-me'),
        /session-capability-identity/);
    } finally { remove(root); }
  }

  for (const kind of ['owned-consumer','finalized-consumer']) {
    const root = makeRepo(`dw-session-${kind}-adoption-`);
    try {
      const sessionStatePath = path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md');
      let armed = false;
      let consumerPath;
      const runtime = createPlatformRuntimeForTest({fsImpl:{
        openSync(value, flags, mode) {
          if (armed && flags === 'wx' &&
              (value === consumerPath || String(value).startsWith(`${consumerPath}.publish.`))) {
            armed = false;
            fs.writeFileSync(sessionStatePath,
              '---\nwork_dir: .deep-work/s-a1b2c3d4\ncurrent_phase: finish\n---\n');
          }
          return fs.openSync(value, flags, mode);
        },
      }});
      const state = runtime.issueProjectStateCapability(root, sessionStatePath,
        {role:'session-state'});
      const work = runtime.issueProjectStateCapability(root,
        path.join(root, '.deep-work', 's-a1b2c3d4'),
        {role:'session-work-dir', sessionStateCapability:state});
      if (kind === 'owned-consumer') {
        const temp = runtime.issueOwnedTempCapability({sessionCapability:work,
          operationId:`op-${'5'.repeat(32)}`, purpose:'notes'});
        runtime.atomicWriteFile(temp, 'consumer-adoption');
        const operationId = `op-${'6'.repeat(32)}`;
        consumeOwnedTemp(temp, {operationId, purpose:'notes', expectedDigest:temp.contentDigest});
        consumerPath = `${temp.path}.consumer.json`;
        armed = true;
        assert.throws(() => consumeOwnedTemp(temp,
          {operationId, purpose:'notes', expectedDigest:temp.contentDigest}),
        /session-capability-identity/);
      } else {
        const producerId = `op-${'7'.repeat(32)}`;
        const payload = Buffer.from('{"terminal":true}\n');
        const payloadPath = path.join(work.path, '.operation-results', producerId,
          'finalized-receipt-payload.json');
        fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
        fs.writeFileSync(payloadPath, payload);
        const finalized = runtime.issueFinalizedReceiptPayloadCapability({sessionCapability:work,
          producerOperationReceipt:{version:1, kind:'finish-merge', operationId:producerId,
            sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'d'.repeat(64),
            finalizedBytesDigest:hash(payload)}});
        const operationId = `op-${'8'.repeat(32)}`;
        consumeFinalizedReceiptPayload(finalized, {kind:'envelope-publish', operationId});
        consumerPath = `${finalized.path}.envelope-consumer.json`;
        armed = true;
        assert.throws(() => consumeFinalizedReceiptPayload(finalized,
          {kind:'envelope-publish', operationId}), /session-capability-identity/);
      }
    } finally { remove(root); }
  }
});

test('unchanged session authority permits every derived child transition', () => {
  const root = makeRepo('dw-session-child-unchanged-');
  try {
    const {work} = caps(root);
    const temp = issueOwnedTempCapability({sessionCapability:work,
      operationId:`op-${'8'.repeat(32)}`, purpose:'notes'});
    atomicWriteFile(temp, 'unchanged');
    consumeOwnedTemp(temp, {operationId:`op-${'9'.repeat(32)}`, purpose:'notes',
      expectedDigest:temp.contentDigest});
    assert.equal(compareRemoveOwnedTemp(temp, temp.contentDigest), true);
    assert.equal(atomicWriteFile(issueSessionEnvelopeOutputCapability({sessionCapability:work}),
      '{}\n').written, true);
    assert.equal(atomicWriteFile(issueSliceEnvelopeOutputCapability({sessionCapability:work,
      slice:'SLICE-002'}), '{}\n').written, true);
    const producerId = `op-${'a'.repeat(32)}`;
    const payload = Buffer.from('{"ok":true}\n');
    const payloadPath = path.join(work.path, '.operation-results', producerId,
      'finalized-receipt-payload.json');
    fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
    fs.writeFileSync(payloadPath, payload);
    const finalized = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:{version:1, kind:'finish-merge', operationId:producerId,
        sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'b'.repeat(64),
        finalizedBytesDigest:hash(payload)}});
    assert.equal(consumeFinalizedReceiptPayload(finalized,
      {kind:'envelope-publish', operationId:`op-${'b'.repeat(32)}`}).state, 'enveloped');
  } finally { remove(root); }
});

test('finalized-result durable envelope journal survives reissue and rejects a rival envelope', () => {
  const root = makeRepo();
  try {
    const workDir = path.join(root, '.deep-work', 's-a1b2c3d4');
    fs.mkdirSync(workDir, {recursive:true});
    const sessionState = issueProjectStateCapability(root,
      path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
    const work = issueProjectStateCapability(root, workDir,
      {role:'session-work-dir', sessionStateCapability:sessionState});
    const producerId = `op-${'4'.repeat(32)}`;
    const payload = Buffer.from('{"done":true}\n');
    const payloadPath = path.join(work.path, '.operation-results', producerId,
      'finalized-receipt-payload.json');
    fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
    fs.writeFileSync(payloadPath, payload);
    const receipt = {version:1, kind:'finish-merge', operationId:producerId,
      sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'a'.repeat(64),
      finalizedBytesDigest:hash(payload)};
    const consumerId = `op-${'5'.repeat(32)}`;
    const first = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:receipt});
    consumeFinalizedReceiptPayload(first, {kind:'envelope-publish', operationId:consumerId});
    const retry = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:receipt});
    assert.equal(retry.state, 'enveloped');
    assert.equal(retry.envelopeOperationId, consumerId);
    assert.doesNotThrow(() => consumeFinalizedReceiptPayload(retry,
      {kind:'envelope-publish', operationId:consumerId}));
    const rival = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:receipt});
    assert.throws(() => consumeFinalizedReceiptPayload(rival,
      {kind:'envelope-publish', operationId:`op-${'6'.repeat(32)}`}), /already-consumed/);
  } finally { remove(root); }
});

test('finalized-result terminal state survives a fresh process and rejects corrupt durable consumers', () => {
  const root = makeRepo('dw-finalized-reissue-');
  try {
    const {work} = caps(root);
    const producerId = `op-${'c'.repeat(32)}`;
    const consumerId = `op-${'d'.repeat(32)}`;
    const payload = Buffer.from('{"done":"fresh"}\n');
    const payloadPath = path.join(work.path, '.operation-results', producerId,
      'finalized-receipt-payload.json');
    fs.mkdirSync(path.dirname(payloadPath), {recursive:true});
    fs.writeFileSync(payloadPath, payload);
    const receipt = {version:1, kind:'finish-merge', operationId:producerId,
      sessionId:'s-a1b2c3d4', stage:'payload-published', sourceTempDigest:'c'.repeat(64),
      finalizedBytesDigest:hash(payload)};
    const first = issueFinalizedReceiptPayloadCapability({sessionCapability:work,
      producerOperationReceipt:receipt});
    consumeFinalizedReceiptPayload(first, {kind:'envelope-publish', operationId:consumerId});
    const worker = path.join(fixtureRoot, 'finalized-reissue-worker.js');
    const fresh = JSON.parse(execFileSync(process.execPath,
      [worker, root, producerId, receipt.sourceTempDigest, receipt.finalizedBytesDigest],
      {encoding:'utf8'}));
    assert.deepEqual(fresh, {state:'enveloped', envelopeOperationId:consumerId});

    const consumerPath = `${payloadPath}.envelope-consumer.json`;
    const validConsumer = fs.readFileSync(consumerPath);
    for (const corrupt of [Buffer.from('{}\n'), Buffer.from(validConsumer.toString('utf8')
      .replace(producerId, `op-${'e'.repeat(32)}`)),
    Buffer.from(validConsumer.toString('utf8').replace(consumerId, producerId)),
    Buffer.from(validConsumer.toString('utf8').replace('s-a1b2c3d4', 's-deadbeef')),
    Buffer.from(validConsumer.toString('utf8').replace(receipt.finalizedBytesDigest,
      'f'.repeat(64)))]) {
      fs.writeFileSync(consumerPath, corrupt);
      assert.throws(() => issueFinalizedReceiptPayloadCapability({sessionCapability:work,
        producerOperationReceipt:receipt}), /finalized-receipt-(consumer|already-consumed)/);
    }
  } finally { remove(root); }
});

test('owned-temp compare-remove authenticates owner before preserving foreign artifacts', () => {
  const root = makeRepo();
  try {
    const workDir = path.join(root, '.deep-work', 's-a1b2c3d4');
    fs.mkdirSync(workDir, {recursive:true});
    const sessionState = issueProjectStateCapability(root,
      path.join(root, '.claude', 'deep-work.s-a1b2c3d4.md'), {role:'session-state'});
    const work = issueProjectStateCapability(root, workDir,
      {role:'session-work-dir', sessionStateCapability:sessionState});
    const cap = issueOwnedTempCapability({sessionCapability:work,
      operationId:`op-${'7'.repeat(32)}`, purpose:'notes'});
    atomicWriteFile(cap, 'foreign-safe');
    fs.writeFileSync(`${cap.path}.owner.json`, 'foreign\n');
    assert.throws(() => compareRemoveOwnedTemp(cap, cap.contentDigest), /owned-temp-foreign/);
    assert.equal(fs.readFileSync(cap.path, 'utf8'), 'foreign-safe');
    assert.equal(fs.readFileSync(`${cap.path}.owner.json`, 'utf8'), 'foreign\n');
  } finally { remove(root); }
});

test('node-toolchain rejects every linked component in a derived root', async () => {
  if (process.platform === 'win32') return test.skip('POSIX symlink row');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-toolchain-prefix-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-toolchain-prefix-outside-'));
  try {
    fs.mkdirSync(path.join(root, 'bin'), {recursive:true});
    fs.writeFileSync(path.join(root, 'bin', 'node'), 'fixture');
    fs.mkdirSync(path.join(outside, 'node_modules'), {recursive:true});
    fs.symlinkSync(outside, path.join(root, 'lib'), 'dir');
    const cap = await createPlatformRuntimeForTest({platform:'linux'})
      .issueNodeToolchainCapability({nodeExecutable:path.join(root, 'bin', 'node'),
        home:root, environment:{}});
    assert.equal(cap.packageRoots.includes(fs.realpathSync(path.join(outside, 'node_modules'))), false);
  } finally { remove(root); remove(outside); }
});

test('runtime-excluded file records identity only and is stable under content churn', () => {
  const root = makeRepo();
  try {
    const {project, git, state} = caps(root);
    fs.writeFileSync(state.path, 'one');
    const before = captureWorktreeManifest({projectCapability:project, gitCapability:git,
      runtimeExclusions:[state]});
    fs.writeFileSync(state.path, 'two');
    const after = captureWorktreeManifest({projectCapability:project, gitCapability:git,
      runtimeExclusions:[state]});
    const row = after.entries.find((entry) => entry.path === '.claude/state.json');
    assert.deepEqual(Object.hasOwn(row, 'sha256'), false);
    assert.deepEqual(Object.hasOwn(row, 'size'), false);
    assert.equal(after.sha256, before.sha256);
  } finally { remove(root); }
});

test('stale canonical recovery durably adopts a first quarantine after ticket-rename crash', () => {
  const root = makeRepo();
  try {
    const lockPath = path.join(root, '.claude', 'two-stage.lock');
    const lock = issueProjectStateCapability(root, lockPath, {role:'lock', allowMissingLeaf:true});
    const releaseCrash = createPlatformRuntimeForTest({fsImpl:{
      rmSync(value, options) {
        if (String(value).includes('.release.')) {
          throw Object.assign(new Error('leave stale claim'), {code:'EIO'});
        }
        return fs.rmSync(value, options);
      },
    }, nonceFactory:() => '1'.repeat(32)});
    assert.throws(() => releaseCrash.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'2'.repeat(32)}, () => 'x'),
    /leave stale claim/);
    const releaseName = fs.readdirSync(path.dirname(lockPath))
      .find((name) => name.startsWith(`${path.basename(lockPath)}.release.`));
    assert.ok(releaseName);
    fs.renameSync(path.join(path.dirname(lockPath), releaseName), lockPath);

    let ticketRenameAttempted = false;
    const crash = createPlatformRuntimeForTest({clock:() => Date.now() + 60_000,
      livenessImpl:() => ({status:'dead', reason:'ESRCH'}), nonceFactory:() => '3'.repeat(32),
      fsImpl:{
        renameSync(source, destination) {
          if (String(source).endsWith('.ticket') && String(destination).includes('.quarantine.')) {
            ticketRenameAttempted = true;
            throw Object.assign(new Error('ticket rename crash'), {code:'EIO'});
          }
          return fs.renameSync(source, destination);
        },
      }});
    assert.throws(() => crash.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'4'.repeat(32)}, () => 'x'),
    /ticket rename crash/);
    assert.equal(ticketRenameAttempted, true);
    assert.equal(fs.readdirSync(path.dirname(lockPath)).some((name) =>
      name.startsWith(`${path.basename(lockPath)}.claim-quarantine.`)), true);

    const nonces = ['5'.repeat(32), '6'.repeat(32), '7'.repeat(32), '8'.repeat(32)];
    const recovery = createPlatformRuntimeForTest({clock:() => Date.now() + 120_000,
      livenessImpl:() => ({status:'dead', reason:'ESRCH'}),
      nonceFactory:() => nonces.shift() || '9'.repeat(32)});
    assert.equal(recovery.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'a'.repeat(32)},
      () => 'recovered'), 'recovered');
    assert.deepEqual(fs.readdirSync(`${lock.path}.claims`), []);
    assert.equal(fs.readdirSync(path.dirname(lockPath)).some((name) =>
      name.startsWith(`${path.basename(lockPath)}.claim-quarantine.`)), false);
  } finally { remove(root); }
});

test('post-publication directory fsync failure preserves the complete claim for stale recovery', () => {
  const root = makeRepo();
  try {
    const lockPath = path.join(root, '.claude', 'publish-fsync.lock');
    const lock = issueProjectStateCapability(root, lockPath, {role:'lock', allowMissingLeaf:true});
    const parent = path.dirname(lockPath);
    const parentFds = new Set();
    const failing = createPlatformRuntimeForTest({nonceFactory:() => '4'.repeat(32), fsImpl:{
      openSync(value, flags, mode) {
        const fd = fs.openSync(value, flags, mode);
        if (value === parent && flags === 'r') parentFds.add(fd);
        return fd;
      },
      fsyncSync(fd) {
        if (parentFds.has(fd) && fs.existsSync(lockPath)) {
          throw Object.assign(new Error('post-publish-dir-fsync'), {code:'EIO'});
        }
        return fs.fsyncSync(fd);
      },
      closeSync(fd) { parentFds.delete(fd); return fs.closeSync(fd); },
    }});
    assert.throws(() => failing.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'5'.repeat(32)}, () => 'x'),
    (error) => error.code === 'lock-publication-durability-failed' &&
      error.cause && error.cause.code === 'EIO');
    assert.deepEqual(fs.readdirSync(lockPath).sort(), ['heartbeat.json','owner.json']);
    assert.equal(fs.readdirSync(`${lockPath}.claims`).filter((name) => name.endsWith('.ticket')).length, 1);

    const nonces = ['6'.repeat(32), '7'.repeat(32), '8'.repeat(32)];
    const recovery = createPlatformRuntimeForTest({clock:() => Date.now() + 60_000,
      livenessImpl:() => ({status:'dead', reason:'ESRCH'}),
      nonceFactory:() => nonces.shift() || '9'.repeat(32)});
    assert.equal(recovery.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'a'.repeat(32)},
      () => 'recovered'), 'recovered');
    assert.equal(fs.existsSync(lockPath), false);
    assert.deepEqual(fs.readdirSync(`${lockPath}.claims`), []);
  } finally { remove(root); }
});

test('pre-publication canonical rename failure leaves no unauthenticated residue', () => {
  const root = makeRepo();
  try {
    const lockPath = path.join(root, '.claude', 'publish-rename.lock');
    const runtime = createPlatformRuntimeForTest({nonceFactory:() => 'b'.repeat(32), fsImpl:{
      renameSync(source, destination) {
        if (destination === lockPath && String(source).includes('.claim.')) {
          throw Object.assign(new Error('publish-rename-failed'), {code:'EIO'});
        }
        return fs.renameSync(source, destination);
      },
    }});
    const lock = runtime.issueProjectStateCapability(root, lockPath,
      {role:'lock', allowMissingLeaf:true});
    assert.throws(() => runtime.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'c'.repeat(32)}, () => 'x'),
    /publish-rename-failed/);
    assert.equal(fs.existsSync(lockPath), false);
    assert.deepEqual(fs.readdirSync(`${lockPath}.claims`), []);
  } finally { remove(root); }
});

test('lock process-death seams recover exact owned claim stages without residue', async () => {
  if (process.platform === 'win32') return test.skip('SIGKILL seam matrix is POSIX-only');
  const preCanonical = ['after-ticket-open','after-ticket-fsync','after-private-mkdir',
    'after-owner-write','after-owner-fsync','after-heartbeat-write','after-heartbeat-fsync',
    'before-canonical-rename'];
  const canonical = ['after-canonical-rename','before-first-heartbeat','before-heartbeat-replace',
    'after-first-heartbeat'];
  const release = ['after-release-lock-remove-before-ticket-unlink'];
  for (const seam of [...preCanonical, ...canonical, ...release]) {
    const root = makeRepo(`dw-lock-seam-${seam}-`);
    const control = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-lock-seam-control-'));
    try {
      const lockPath = path.join(root, '.claude', `${seam}.lock`);
      const processIdentity = hash(`identity-${seam}`).slice(0, 32);
      const worker = fork(path.join(fixtureRoot, 'lock-worker.js'),
        [root, lockPath, processIdentity, seam, control],
        {stdio:['ignore','ignore','inherit','ipc']});
      const marker = path.join(control, `${seam}.json`);
      await waitForPath(marker);
      const reached = JSON.parse(fs.readFileSync(marker, 'utf8'));
      assert.deepEqual({seam:reached.seam, pid:reached.pid, processIdentity:reached.processIdentity},
        {seam, pid:worker.pid, processIdentity});
      worker.kill('SIGKILL');
      const exit = await new Promise((resolve) => worker.once('exit', (code, signal) =>
        resolve({code, signal})));
      assert.equal(exit.signal, 'SIGKILL', seam);

      let probes = 0;
      const nonces = Array.from({length:16}, (_, index) =>
        hash(`recovery-${seam}-${index}`).slice(0, 32));
      const recovery = createPlatformRuntimeForTest({clock:() => Date.now() + 120_000,
        livenessImpl:(pid, identity) => {
          assert.equal(pid, worker.pid, seam);
          assert.equal(identity, processIdentity, seam);
          probes += 1;
          return {status:'dead', reason:'ESRCH'};
        }, nonceFactory:() => nonces.shift() || 'f'.repeat(32)});
      const lock = recovery.issueProjectStateCapability(root, lockPath,
        {role:'lock', allowMissingLeaf:true});
      assert.equal(recovery.withDirectoryLock(lock,
        {timeoutMs:1_000, staleMs:100, heartbeatMs:25,
          processIdentity:hash(`contender-${seam}`).slice(0, 32)}, () => 'recovered'),
      'recovered', seam);
      assert.equal(probes, seam === 'before-heartbeat-replace' ? 6 :
        (canonical.includes(seam) ? 5 : 3), seam);
      assert.equal(fs.existsSync(lockPath), false, seam);
      assert.deepEqual(fs.readdirSync(`${lockPath}.claims`), [], seam);
      const residuePrefix = path.basename(lockPath);
      assert.deepEqual(fs.readdirSync(path.dirname(lockPath))
        .filter((name) => name.startsWith(`${residuePrefix}.claim.`) ||
          name.startsWith(`${residuePrefix}.claim-quarantine.`) ||
          name.startsWith(`${residuePrefix}.release.`) ||
          name.startsWith(`.${residuePrefix}.heartbeat.json.tmp.`)), [], seam);
    } finally { remove(root); remove(control); }
  }
});

test('lock recovery preserves foreign live EPERM and corrupt artifacts byte-identically', async () => {
  if (process.platform === 'win32') return test.skip('SIGKILL lock fixture is POSIX-only');
  const root = makeRepo('dw-lock-retained-artifacts-');
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-lock-retained-control-'));
  let worker;
  try {
    const seam = 'after-first-heartbeat';
    const lockPath = path.join(root, '.claude', 'retained.lock');
    const processIdentity = '5'.repeat(32);
    worker = fork(path.join(fixtureRoot, 'lock-worker.js'),
      [root, lockPath, processIdentity, seam, control],
      {stdio:['ignore','ignore','inherit','ipc']});
    await waitForPath(path.join(control, `${seam}.json`));
    const claims = `${lockPath}.claims`;
    const ticketPath = path.join(claims, fs.readdirSync(claims)
      .find((name) => name.endsWith('.ticket')));
    const ownerPath = path.join(lockPath, 'owner.json');
    const heartbeatPath = path.join(lockPath, 'heartbeat.json');
    const foreignPath = path.join(claims, 'foreign.ticket');
    fs.writeFileSync(foreignPath, 'foreign-bytes\n');
    const snapshot = () => ({ticket:fs.readFileSync(ticketPath), owner:fs.readFileSync(ownerPath),
      heartbeat:fs.readFileSync(heartbeatPath), foreign:fs.readFileSync(foreignPath)});
    const original = snapshot();
    for (const result of [{status:'alive', reason:'success'}, {status:'alive', reason:'EPERM'}]) {
      const contender = createPlatformRuntimeForTest({clock:() => Date.now() + 120_000,
        livenessImpl:() => result, nonceFactory:() => '6'.repeat(32)});
      const lock = contender.issueProjectStateCapability(root, lockPath,
        {role:'lock', allowMissingLeaf:true});
      assert.throws(() => contender.withDirectoryLock(lock,
        {timeoutMs:25, staleMs:100, heartbeatMs:25, processIdentity:'7'.repeat(32)},
        () => 'no'), /lock-timeout/);
      assert.deepEqual(snapshot(), original, result.reason);
    }

    worker.kill('SIGKILL');
    await new Promise((resolve) => worker.once('exit', resolve));
    worker = null;
    fs.writeFileSync(heartbeatPath, 'corrupt-heartbeat\n');
    const corrupt = snapshot();
    const dead = createPlatformRuntimeForTest({clock:() => Date.now() + 120_000,
      livenessImpl:() => ({status:'dead', reason:'ESRCH'}), nonceFactory:() => '8'.repeat(32)});
    const lock = dead.issueProjectStateCapability(root, lockPath,
      {role:'lock', allowMissingLeaf:true});
    assert.throws(() => dead.withDirectoryLock(lock,
      {timeoutMs:100, staleMs:50, heartbeatMs:25, processIdentity:'9'.repeat(32)},
      () => 'no'), /lock-ambiguous/);
    assert.deepEqual(snapshot(), corrupt);
  } finally {
    if (worker) {
      worker.kill('SIGKILL');
      await new Promise((resolve) => worker.once('exit', resolve));
    }
    remove(root);
    remove(control);
  }
});

test('lock records every supported and native-unsupported directory durability attempt', () => {
  const supportedRoot = makeRepo('dw-lock-durability-supported-');
  try {
    const runtime = createPlatformRuntimeForTest({nonceFactory:() => '1'.repeat(32)});
    const lock = runtime.issueProjectStateCapability(supportedRoot,
      path.join(supportedRoot, '.claude', 'durability.lock'),
      {role:'lock', allowMissingLeaf:true});
    assert.equal(runtime.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'2'.repeat(32)},
      () => 'done'), 'done');
    const records = runtime.lockDurability();
    for (const stage of ['claims-parent','ticket-directory','private-claim',
      'canonical-parent','first-heartbeat','release-parent','release-ticket-directory']) {
      assert.equal(records.some((record) => record.stage === stage &&
        record.outcome === 'durable' && record.supported === true), true, stage);
    }
  } finally { remove(supportedRoot); }

  const unsupportedRoot = makeRepo('dw-lock-durability-unsupported-');
  try {
    const runtime = createPlatformRuntimeForTest({platform:'win32', nonceFactory:() => '3'.repeat(32),
      fsImpl:{
        openSync(value, flags, mode) {
          if (flags === 'r') {
            try {
              if (fs.lstatSync(value).isDirectory()) {
                throw Object.assign(new Error('directory fsync unsupported'), {code:'EINVAL'});
              }
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          return fs.openSync(value, flags, mode);
        },
      }});
    const lock = runtime.issueProjectStateCapability(unsupportedRoot,
      path.join(unsupportedRoot, '.claude', 'durability.lock'),
      {role:'lock', allowMissingLeaf:true});
    assert.equal(runtime.withDirectoryLock(lock,
      {timeoutMs:1_000, staleMs:100, heartbeatMs:25, processIdentity:'4'.repeat(32)},
      () => 'done'), 'done');
    const records = runtime.lockDurability();
    assert.equal(records.length >= 7, true);
    assert.equal(records.every((record) => record.outcome === 'unsupported' &&
      record.supported === false && record.code === 'EINVAL'), true);
  } finally { remove(unsupportedRoot); }
});

test('native Windows filename matrix declares accepted and rejected distinct operation rows', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  const nativeMatrix = source.slice(source.lastIndexOf("test('native Windows device aliases"),
    source.lastIndexOf("test('native Windows node-toolchain"));
  for (const token of ['acceptedNameSpellings', 'rejectedNameSpellings',
    'create-new', 'open-existing', 'parent-enumeration']) {
    assert.equal(nativeMatrix.includes(token), true, token);
  }
});

test('native Windows device aliases and ADS inventory are executable contract rows', {
  skip:process.platform !== 'win32' ? 'native Windows only' : false,
}, () => {
  const root = makeRepo('dw-native-win-stream-');
  try {
    const {project, git} = caps(root);
    const rejectedNameSpellings = [...new Set(platform.WINDOWS_DEVICE_BASES.flatMap((base) => {
      const stems = [base, base.toLowerCase(), `${base[0].toLowerCase()}${base.slice(1)}`];
      return stems.flatMap((stem) => [stem, `${stem}.txt`, `${stem}.tar.gz`]);
    }))];
    const acceptedNameSpellings = rejectedNameSpellings.map((name, index) =>
      `safe ${String(index).padStart(3, '0')}-${name}`)
      .concat(['ordinary', 'Ordinary.TXT', '한 글.txt', 'Résumé Data.tar.gz']);
    const operationRows = [];
    for (let index = 0; index < acceptedNameSpellings.length; index++) {
      const name = acceptedNameSpellings[index];
      const candidate = path.join(root, name);
      assert.equal(canonicalizePortableProjectPathV1(name).path, name);
      const createFd = fs.openSync(candidate, 'wx');
      operationRows.push({group:'accepted', operation:'create-new', name});
      try { fs.writeFileSync(createFd, Buffer.from(`accepted-${index}`)); }
      finally { fs.closeSync(createFd); }
      const openFd = fs.openSync(candidate, 'r');
      operationRows.push({group:'accepted', operation:'open-existing', name});
      try { assert.equal(fs.readFileSync(openFd, 'utf8'), `accepted-${index}`); }
      finally { fs.closeSync(openFd); }
      operationRows.push({group:'accepted', operation:'parent-enumeration', name});
      assert.equal(fs.readdirSync(root).includes(name), true, name);
      fs.unlinkSync(candidate);
    }
    for (const name of rejectedNameSpellings) {
      const candidate = path.join(root, name);
      let createFd;
      let created = false;
      try { createFd = fs.openSync(candidate, 'wx'); created = true; }
      catch (error) { assert.equal(typeof error.code, 'string', `create-new:${name}`); }
      finally { if (createFd !== undefined) fs.closeSync(createFd); }
      operationRows.push({group:'rejected', operation:'create-new', name});
      let openFd;
      try { openFd = fs.openSync(candidate, 'r'); }
      catch (error) { assert.equal(typeof error.code, 'string', `open-existing:${name}`); }
      finally { if (openFd !== undefined) fs.closeSync(openFd); }
      operationRows.push({group:'rejected', operation:'open-existing', name});
      const enumerated = fs.readdirSync(root)
        .some((entry) => entry.toLowerCase() === name.toLowerCase());
      operationRows.push({group:'rejected', operation:'parent-enumeration', name, enumerated});
      assert.throws(() => canonicalizePortableProjectPathV1(name), /portable-path-v1-device/, name);
      if (created) fs.unlinkSync(candidate);
      assert.equal(fs.readdirSync(root).some((entry) => entry.toLowerCase() === name.toLowerCase()),
        false, name);
    }
    for (const group of ['accepted','rejected']) {
      const expected = group === 'accepted' ? acceptedNameSpellings.length : rejectedNameSpellings.length;
      for (const operation of ['create-new','open-existing','parent-enumeration']) {
        assert.equal(operationRows.filter((row) => row.group === group &&
          row.operation === operation).length, expected, `${group}:${operation}`);
      }
    }

    const fakeBin = path.join(root, 'fake-path-bin');
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin, 'powershell.exe'), 'fake');
    const oldPath = process.env.PATH;
    const oldComSpec = process.env.ComSpec;
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath || ''}`;
    process.env.ComSpec = path.join(fakeBin, 'cmd.exe');
    let clean;
    try {
      clean = captureWorktreeManifest({projectCapability:project, gitCapability:git,
        runtimeExclusions:[]});
    } finally {
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      if (oldComSpec === undefined) delete process.env.ComSpec; else process.env.ComSpec = oldComSpec;
    }
    assert.match(clean.sha256, /^[0-9a-f]{64}$/);
    const directory = path.join(root, 'ads-dir');
    const file = path.join(directory, 'file.txt');
    fs.mkdirSync(directory);
    fs.writeFileSync(file, 'main');
    for (const target of [root, directory, file]) {
      fs.writeFileSync(`${target}:deep-work-test`, 'hidden');
      assert.throws(() => captureWorktreeManifest({projectCapability:project,
        gitCapability:git, runtimeExclusions:[]}), /alternate-stream/);
      fs.unlinkSync(`${target}:deep-work-test`);
    }

    let walkerActive = false;
    let rootRevalidations = 0;
    const rootStat = fs.lstatSync(root);
    const rootIdentity = {dev:String(rootStat.dev), ino:String(rootStat.ino), mode:rootStat.mode,
      type:'directory'};
    const mutating = createPlatformRuntimeForTest({platform:'win32',
      manifestWalkerImpl:() => {
        walkerActive = true;
        return {entries:[], directories:[], typedRows:[{version:1, id:0, kind:'root',
          relative_path:null, absolutePath:root, identity:rootIdentity}]};
      },
      fsImpl:{
        lstatSync(value) {
          if (walkerActive && value === root && ++rootRevalidations === 2) {
            fs.writeFileSync(`${root}:between-pass`, 'hidden');
          }
          return fs.lstatSync(value);
        },
      }});
    assert.throws(() => mutating.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /alternate-stream/);
    fs.unlinkSync(`${root}:between-pass`);

    const helperPath = path.join(__dirname, 'windows-stream-inventory.ps1');
    const helperMutant = createPlatformRuntimeForTest({platform:'win32',
      manifestWalkerImpl:() => ({entries:[], directories:[], typedRows:[{version:1, id:0,
        kind:'root', relative_path:null, absolutePath:root, identity:rootIdentity}]}),
      fsImpl:{
        readFileSync(value, options) {
          const bytes = fs.readFileSync(value, options);
          return value === helperPath ? Buffer.concat([Buffer.from(bytes), Buffer.from('# mutant\n')]) : bytes;
        },
      }});
    assert.throws(() => helperMutant.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /stream-helper-changed/);

    const pinvokeMutant = createPlatformRuntimeForTest({platform:'win32',
      manifestWalkerImpl:() => ({entries:[], directories:[], typedRows:[{version:1, id:0,
        kind:'root', relative_path:null, absolutePath:root, identity:rootIdentity}]}),
      fsImpl:{
        readFileSync(value, options) {
          const bytes = fs.readFileSync(value, options);
          return value === helperPath
            ? Buffer.from(Buffer.from(bytes).toString('utf8').replace('FindFirstStreamW', 'Get-Item -Stream'))
            : bytes;
        },
      }});
    assert.throws(() => pinvokeMutant.captureWorktreeManifest({projectCapability:project,
      gitCapability:git, runtimeExclusions:[]}), /stream-helper-changed/);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-native-win-reparse-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, 'reparse-entry'), 'junction');
      assert.throws(() => captureWorktreeManifest({projectCapability:project,
        gitCapability:git, runtimeExclusions:[]}), /worktree-manifest-reparse/);
      fs.rmSync(path.join(root, 'reparse-entry'), {recursive:true, force:true});
    } finally { remove(outside); }
  } finally { remove(root); }
});

test('native Windows node-toolchain rejects an intermediate junction root', {
  skip:process.platform !== 'win32' ? 'native Windows only' : false,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-native-win-junction-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-native-win-junction-outside-'));
  try {
    fs.mkdirSync(path.join(root, 'bin'), {recursive:true});
    fs.writeFileSync(path.join(root, 'bin', 'node.exe'), 'MZfixture');
    fs.mkdirSync(path.join(outside, 'node_modules'), {recursive:true});
    fs.symlinkSync(outside, path.join(root, 'lib'), 'junction');
    const cap = await createPlatformRuntimeForTest({platform:'win32'})
      .issueNodeToolchainCapability({nodeExecutable:path.join(root, 'bin', 'node.exe'),
        home:root, environment:{}});
    assert.equal(cap.packageRoots.includes(fs.realpathSync(path.join(outside, 'node_modules'))), false);
  } finally { remove(root); remove(outside); }
});

test('CI executes the runtime contract on native Windows Node 22', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'tests.yml'),
    'utf8');
  assert.match(workflow, /runtime-windows:/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /node-version:\s*['"]22['"]/);
  assert.match(workflow, /run:\s*npm run test:runtime/);
});
