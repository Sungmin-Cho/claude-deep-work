'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  issueProjectStateCapability,
  revalidatePathCapability,
  atomicWriteFile,
  withDirectoryLock,
} = require('./platform.js');

const OPERATION_KINDS = new Set([
  'initial-repository-prepare', 'fork-precommit', 'fork-dirty-snapshot', 'fork-create',
  'cleanup-remove', 'branch-create', 'branch-delete', 'delegated-rollback',
  'finish-merge', 'finish-publish-pr', 'finish-keep', 'finish-discard',
  'remote-push', 'pull-request-create', 'stash-publish', 'stash-apply', 'stash-drop',
  'slice-reset', 'session-finalize', 'registry-own', 'registry-touch', 'registry-phase',
  'phase-checkpoint', 'phase-approval', 'phase-rerun', 'delegation-scope-publish',
  'implement-slice-complete', 'owned-temp', 'envelope-publish',
  'verification-spec-migrate', 'verification-run', 'sensor-run', 'sensor-cycle-accept',
  'test-pass', 'test-retry', 'test-exhaust', 'mutation-round', 'debug-complete',
  'phase-review-record', 'receipt-export', 'report-generate', 'report-commit',
  'handoff-publish', 'integrate-loop-update',
]);

const COMPLETED_LEDGER_LIMIT = 512;
const WORKFLOW_STAGE_RULES = Object.freeze({
  'initial-repository-prepare':['repository-inspected','repository-prepared','state-written','registry-written','pointer-written',
    'before-call','after-call-before-stage','after-stage'],
  'fork-precommit':['before-call','after-call-before-stage','after-stage'],
  'fork-dirty-snapshot':['before-call','after-call-before-stage','after-stage'],
  'fork-create':['fork-inspected','before-call','after-call-before-stage','after-stage','worktree-created','child-state-written',
    'snapshot-written','artifacts-copied','registry-written','parent-linked'],
  'cleanup-remove':['cleanup-inspected','before-call','after-call-before-stage','after-stage','worktree-removed','branch-deleted',
    'registry-unregistered','parent-unlinked','pointer-cleared'],
  'branch-create':['before-call','after-call-before-stage','after-stage'],
  'branch-delete':['before-call','after-call-before-stage','after-stage'],
  'delegated-rollback':['before-call','after-call-before-stage','after-stage','receipt-removal-prepared','receipts-removed'],
  'finish-merge':['finish-inspected','before-call','after-call-before-stage','after-stage','merge-conflict','merge-aborted',
    'merge-completed','worktree-removed','branch-deleted','temp-prepared','temp-consumed','result-published','state-written','registry-written','pointer-cleared'],
  'finish-publish-pr':['before-call','after-call-before-stage','after-stage','temp-prepared','temp-consumed','remote-body-written','remote-pushed','pull-request-created','result-published','state-written','registry-written','pointer-cleared'],
  'finish-keep':['temp-prepared','temp-consumed','result-published','state-written','registry-written','pointer-cleared'],
  'finish-discard':['finish-inspected','before-call','after-call-before-stage','after-stage','worktree-removed','branch-deleted',
    'temp-prepared','temp-consumed','result-published','state-written','registry-written','pointer-cleared'],
  'remote-push':['before-call','after-call-before-stage','after-stage'],
  'pull-request-create':['before-call','after-call-before-stage','after-stage'],
  'stash-publish':['stash-prepared','nothing-to-stash','call-intent','call-result','stash-published',
    'before-call','after-call-before-stage','after-stage'],
  'stash-apply':['apply-prepared','apply-intent','apply-conflict','call-result','stash-applied',
    'before-call','after-call-before-stage','after-stage'],
  'stash-drop':['drop-prepared','drop-intent','call-result','stash-dropped',
    'before-call','after-call-before-stage','after-stage'],
  'slice-reset':['stores-prepared','stash-published','plan-written','receipt-written','state-written'],
  'session-finalize':['state-written','registry-written','pointer-cleared'],
  'registry-own':['registry-written'], 'registry-touch':['registry-written'], 'registry-phase':['registry-written'],
  'phase-checkpoint':['state-written'], 'phase-approval':['state-written'], 'phase-rerun':['state-written'],
  'delegation-scope-publish':['delegation-written','scoped-write-begun','scoped-write-accepted','state-written'],
  'implement-slice-complete':['temp-prepared','temp-consumed','result-published','receipt-written','plan-written','state-written'],
  'owned-temp':['reserved','written','consumed','removed'],
  'envelope-publish':['result-consumed','envelope-published'],
  'verification-spec-migrate':['plan-written'],
  'verification-run':['before-call','after-call-before-stage','after-stage','result-published'],
  'sensor-run':['before-call','after-call-before-stage','after-stage','result-published'],
  'sensor-cycle-accept':['state-written'],
  'test-pass':['report-written','state-written'],
  'test-retry':['stores-prepared','plan-written','receipt-written','state-written'],
  'test-exhaust':['stores-prepared','plan-written','receipt-written','state-written'],
  'mutation-round':['report-written','state-written'],
  'debug-complete':['stores-prepared','note-written','receipt-written','state-written'],
  'phase-review-record':['stores-prepared','json-written','markdown-written','adversarial-written','state-written'],
  'receipt-export':['output-written'], 'report-generate':['output-written'],
  'report-commit':['before-call','after-call-before-stage','after-stage','commit-recorded'],
  'handoff-publish':['result-consumed','output-written'],
  'integrate-loop-update':['state-written'],
});
const LOCK_OPTIONS = Object.freeze({timeoutMs:10_000, staleMs:30_000, heartbeatMs:1_000,
  processIdentity:crypto.createHash('sha256').update(`operation-journal:${process.pid}`).digest('hex').slice(0,32)});

function fail(code, message) {
  const error = new Error(`[${code}] ${message || code}`);
  error.code = code;
  throw error;
}

function validSessionId(value) { return /^s-[0-9a-f]{8}$/.test(value || ''); }
function validOperationId(value) { return /^op-[0-9a-f]{32,64}$/.test(value || ''); }

function canonicalJson(value) {
  function sort(item) {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort()
      .map((key) => [key, sort(item[key])]));
    return item;
  }
  return `${JSON.stringify(sort(value))}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function projectRootOf(projectCapability) {
  if (!projectCapability || projectCapability.kind !== 'project-state' ||
      projectCapability.role !== 'project-root') fail('operation-project-capability', 'project root capability required');
  revalidatePathCapability(projectCapability, 'operation-project');
  return projectCapability.path;
}

function paths(projectCapability, sessionId, kind, operationId) {
  const root = projectRootOf(projectCapability);
  const base = path.join(root, '.claude');
  return {
    journal:path.join(base, `deep-work.${sessionId}.op.${kind}.${operationId}.json`),
    ledger:path.join(base, `deep-work.${sessionId}.completed-operations.json`),
    lock:path.join(base, `deep-work.${sessionId}.operations.lock`),
  };
}

function cap(projectCapability, target, role = 'state') {
  return issueProjectStateCapability(projectRootOf(projectCapability), target,
    {allowMissingLeaf:true, role});
}

function readJson(target, missing) {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) { if (missing && error.code === 'ENOENT') return missing(); throw error; }
}

function readLedger(file) {
  const ledger = readJson(file, () => ({version:1, receipts:[]}));
  if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.receipts) ||
      ledger.receipts.length > COMPLETED_LEDGER_LIMIT) {
    fail('operation-ledger-invalid', 'completed operation ledger is invalid');
  }
  return ledger;
}

function operationHandle(projectCapability, receipt) {
  return Object.freeze({projectCapability, operationId:receipt.operationId,
    sessionId:receipt.sessionId, kind:receipt.kind});
}

function stageAllowed(kind,stage){const exact=WORKFLOW_STAGE_RULES[kind]||[];
  if(exact.includes(stage)||stage==='state-prepared'&&exact.includes('state-written'))return true;
  const match=stage.match(/^(before-call|after-call-before-stage|after-stage|call-result)-(\d+)$/);
  return Boolean(match&&exact.includes(match[1]));}
function validateJournal(value){if(!value||value.version!==1||!validOperationId(value.operationId)||
    !validSessionId(value.sessionId)||!OPERATION_KINDS.has(value.kind)||!Array.isArray(value.stages)||
    value.stages.length<1||value.stages[0].stage!=='prepared')fail('operation-journal-invalid');
  for(const row of value.stages.slice(1))if(!row||!stageAllowed(value.kind,row.stage)||typeof row.at!=='string')
    fail('operation-journal-stage');return value;}

async function underLock(projectCapability, filePaths, callback) {
  fs.mkdirSync(path.dirname(filePaths.lock), {recursive:true});
  const deadline=Date.now()+LOCK_OPTIONS.timeoutMs;for(;;){let entered=false;
    try{return await withDirectoryLock(cap(projectCapability,filePaths.lock,'lock'),LOCK_OPTIONS,()=>{entered=true;return callback();});}
    catch(error){if(entered||!['lock-ambiguous','lock-chain-invalid','ENOENT'].includes(error.code)||Date.now()>=deadline)throw error;
      await new Promise((resolve)=>setTimeout(resolve,2));}}
}

async function beginOperation({projectCapability, sessionId, kind, operationId, preconditions = {},
  slice} = {}) {
  if (!validSessionId(sessionId)) fail('operation-session', 'invalid operation session');
  if (!OPERATION_KINDS.has(kind)) fail('operation-kind', `unsupported operation kind: ${kind}`);
  const callerSelectedId=operationId!==undefined;const id=operationId||`op-${crypto.randomBytes(32).toString('hex')}`;
  if (!validOperationId(id)) fail('operation-id', 'invalid operation ID');
  const filePaths = paths(projectCapability, sessionId, kind, id);
  return underLock(projectCapability, filePaths, () => {
    if(!callerSelectedId){const claude=path.join(projectRootOf(projectCapability),'.claude');const prefix=`deep-work.${sessionId}.op.${kind}.`;
      const pending=fs.readdirSync(claude).filter((name)=>name.startsWith(prefix)&&name.endsWith('.json'));
      const matches=[];for(const name of pending){const value=validateJournal(readJson(path.join(claude,name)));
        if(canonicalJson(value.preconditions)===canonicalJson(preconditions)&&(value.slice||null)===(slice||null))matches.push(value);}
      if(matches.length>1)fail('operation-resume-ambiguous');if(matches.length===1)return operationHandle(projectCapability,matches[0]);}
    const completed = readLedger(filePaths.ledger).receipts.find((row) => row.operationId === id);
    if (completed) fail('operation-id-complete', `operation ID is already complete: ${id}`);
    const existing = readJson(filePaths.journal, () => null);
    const base = {version:1, operationId:id, sessionId, kind,
      ...(slice === undefined ? {} : {slice}), preconditions, stage:'prepared', owned:null,
      createdAt:new Date().toISOString()};
    if (existing) {
      validateJournal(existing);
      if (existing.operationId !== id || existing.sessionId !== sessionId || existing.kind !== kind ||
          canonicalJson(existing.preconditions) !== canonicalJson(preconditions) ||
          (existing.slice || null) !== (slice || null)) {
        fail('operation-precondition-mismatch', 'operation journal identity differs');
      }
      return operationHandle(projectCapability, existing);
    }
    const journal = {...base, stages:[{stage:'prepared',at:base.createdAt}]};
    atomicWriteFile(cap(projectCapability, filePaths.journal), canonicalJson(journal));
    return operationHandle(projectCapability, journal);
  });
}

function assertHandle(handle) {
  if (!handle || !validOperationId(handle.operationId) || !validSessionId(handle.sessionId) ||
      !OPERATION_KINDS.has(handle.kind)) fail('operation-handle', 'invalid operation handle');
  return paths(handle.projectCapability, handle.sessionId, handle.kind, handle.operationId);
}

async function recordOperationStage(handle, stage, details = {}) {
  if (typeof stage !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(stage)) {
    fail('operation-stage', 'invalid operation stage');
  }
  if(!stageAllowed(handle?.kind,stage))fail('operation-stage-kind',`${handle?.kind}:${stage}`);
  const filePaths = assertHandle(handle);
  return underLock(handle.projectCapability, filePaths, () => {
    const journal = validateJournal(readJson(filePaths.journal, () => fail('operation-journal-missing')));
    if (journal.operationId !== handle.operationId || journal.kind !== handle.kind ||
        journal.sessionId !== handle.sessionId) fail('operation-journal-identity');
    const existing = journal.stages.find((row) => row.stage === stage);
    if (existing) {
      if (canonicalJson(existing.details || {}) !== canonicalJson(details)) {
        fail('operation-stage-mismatch', 'operation stage replay differs');
      }
      return journal;
    }
    journal.stage = stage;
    journal.owned = details.owned === undefined ? journal.owned : details.owned;
    journal.stages.push({stage, at:new Date().toISOString(), details});
    atomicWriteFile(cap(handle.projectCapability, filePaths.journal), canonicalJson(journal));
    return journal;
  });
}

async function completeOperation(handle, result) {
  const filePaths = assertHandle(handle);
  return underLock(handle.projectCapability, filePaths, () => {
    const ledger = readLedger(filePaths.ledger);
    const existing = ledger.receipts.find((row) => row.operationId === handle.operationId);
    const resultCanonical = canonicalJson(result);
    if (existing) {
      if (existing.resultSha256 !== sha256(resultCanonical)) {
        fail('operation-result-mismatch', 'completed result differs');
      }
      return existing;
    }
    if (ledger.receipts.length >= COMPLETED_LEDGER_LIMIT) {
      fail('operation-ledger-full', 'completed operation ledger is at its fail-closed retention limit');
    }
    const journal = validateJournal(readJson(filePaths.journal, () => fail('operation-journal-missing')));
    const receipt = {version:1, operationId:handle.operationId, sessionId:handle.sessionId,
      kind:handle.kind, stage:'completed-ledger', result, resultSha256:sha256(resultCanonical),
      completedAt:new Date().toISOString()};
    ledger.receipts.push(receipt);
    ledger.receipts.sort((a, b) => Buffer.compare(Buffer.from(a.operationId), Buffer.from(b.operationId)));
    atomicWriteFile(cap(handle.projectCapability, filePaths.ledger), canonicalJson(ledger));
    const journalCap = cap(handle.projectCapability, filePaths.journal);
    revalidatePathCapability(journalCap, 'operation-journal-cleanup');
    if (journal.operationId !== handle.operationId) fail('operation-journal-identity');
    fs.unlinkSync(filePaths.journal);
    return receipt;
  });
}

async function resumeOperation({projectCapability, operationId, sessionId, kind} = {}) {
  if (!validOperationId(operationId)) fail('operation-id', 'invalid operation ID');
  const root = projectRootOf(projectCapability);
  const claude = path.join(root, '.claude');
  const names = fs.existsSync(claude) ? fs.readdirSync(claude) : [];
  const ledgerNames = names.filter((name) => /^deep-work\.s-[0-9a-f]{8}\.completed-operations\.json$/.test(name));
  for (const name of ledgerNames.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const receipt = readLedger(path.join(claude, name)).receipts.find((row) => row.operationId === operationId);
    if (!receipt) continue;
    if (sessionId && receipt.sessionId !== sessionId || kind && receipt.kind !== kind) {
      fail('operation-identity-mismatch', 'completed operation has different identity');
    }
    return receipt;
  }
  const suffix = `.${operationId}.json`;
  const journalName = names.find((name) => name.endsWith(suffix) && name.includes('.op.'));
  if (!journalName) fail('operation-not-found', `operation not found: ${operationId}`);
  const journal = readJson(path.join(claude, journalName));
  return {status:'pending', ...journal};
}

module.exports = {
  OPERATION_KINDS,
  COMPLETED_LEDGER_LIMIT,
  beginOperation,
  recordOperationStage,
  completeOperation,
  resumeOperation,
  canonicalJson,
  sha256,
  WORKFLOW_STAGE_RULES,
};
