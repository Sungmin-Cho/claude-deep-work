'use strict';
const fs = require('node:fs');
const o = require('./outcome-oracle-runtime.js');
const journal = require('./operation-journal.js');
const transaction = require('./transaction-runtime.js');
const KIND = 'outcome-check-run-v1';
const PRECONDITIONS = ['launch_id', 'plan_authority_sha256', 'prepared_sha256',
  'recovery_generation', 'session_id', 'slice_id', 'verification_plan_sha256'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function invalid() { o.fail('outcome-evidence-window-invalid'); }

// These are runtime journals, not verifier output. Read only regular files with
// a fixed allocation, including when a concurrently changed file grows.
function readJson(root, relative, limit) {
  const file = o.safePath(root, relative);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > limit) invalid();
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fs.fstatSync(fd);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) invalid();
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    invalid();
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function authenticateJournal(value, sessionId, operationId) {
  const pre = value?.preconditions;
  if (value?.version !== 1 || value.kind !== KIND || value.sessionId !== sessionId ||
      value.operationId !== operationId || !pre ||
      Object.keys(pre).sort().join(',') !== PRECONDITIONS.join(',') ||
      pre.session_id !== sessionId || !/^SLICE-\d{3}$/u.test(pre.slice_id || '') ||
      !UUID.test(pre.launch_id || '') || !Number.isSafeInteger(pre.recovery_generation) || pre.recovery_generation < 0 ||
      ['plan_authority_sha256', 'verification_plan_sha256', 'prepared_sha256'].some(key => !o.DIGEST.test(pre[key] || '')) ||
      operationId !== `op-${o.digest(`${KIND}-operation`, pre)}` ||
      (value.slice !== undefined && value.slice !== pre.slice_id)) invalid();
  const stages = journal.WORKFLOW_STAGE_RULES[KIND];
  if (!Array.isArray(value.stages) || !value.stages.length || value.stages.length > stages.length ||
      value.stages[0].stage !== 'prepared' || value.stage !== value.stages.at(-1).stage) invalid();
  let previous = -1;
  for (const row of value.stages) {
    const index = stages.indexOf(row?.stage);
    if (index !== previous + 1 || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))) invalid();
    previous = index;
  }
  return pre;
}

function completedIds(root, sessionId) {
  let ledger;
  try { ledger = readJson(root, `.claude/deep-work.${sessionId}.completed-operations.json`, 16 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return new Set(); throw error; }
  if (ledger?.version !== 1 || !Array.isArray(ledger.receipts) || ledger.receipts.length > journal.COMPLETED_LEDGER_LIMIT) invalid();
  const ids = new Set();
  for (const row of ledger.receipts) {
    if (row?.kind !== KIND) continue;
    if (row.version !== 1 || row.sessionId !== sessionId || row.stage !== 'completed-ledger' ||
        !/^op-[a-f0-9]{64}$/u.test(row.operationId || '') || ids.has(row.operationId) ||
        row.result === undefined || row.resultSha256 !== journal.sha256(journal.canonicalJson(row.result)) ||
        !Number.isFinite(Date.parse(row.completedAt))) invalid();
    ids.add(row.operationId);
  }
  return ids;
}

function assertOutcomeEvidenceWindow({stateCapability, binding}) {
  const root = transaction.projectCapabilityFor(stateCapability).path;
  const sessionId = transaction.sessionIdFromState(stateCapability);
  if (binding.session_id !== sessionId) invalid();
  const prefix = `deep-work.${sessionId}.op.${KIND}.`;
  const directory = fs.opendirSync(o.safePath(root, '.claude'));
  const relevant = [];
  try {
    let entry;
    while ((entry = directory.readSync())) {
      if (!entry.name.startsWith(prefix) || !entry.name.endsWith('.json')) continue;
      if (relevant.length >= 4096) invalid();
      const operationId = entry.name.slice(prefix.length, -5);
      if (!/^op-[a-f0-9]{64}$/u.test(operationId)) invalid();
      relevant.push({name:entry.name, operationId});
    }
  } finally { directory.closeSync(); }
  if (!relevant.length) return;
  let completed = completedIds(root, sessionId);
  for (const {name, operationId} of relevant) {
    let value;
    try { value = readJson(root, `.claude/${name}`, 1024 * 1024); }
    catch (error) {
      // A writer may publish the terminal ledger then remove the journal.
      if (error.code === 'ENOENT') {
        completed = completedIds(root, sessionId);
        if (completed.has(operationId)) continue;
      }
      invalid();
    }
    const pre = authenticateJournal(value, sessionId, operationId);
    if (Object.entries(binding).some(([key, expected]) => pre[key] !== expected)) continue;
    if (completed.has(operationId)) continue;
    // This stage authorizes the worker's start message. Preparation alone has
    // no verifier process and is not an evidence-window hazard.
    if (value.stages.some(row => row.stage === 'worker-authorized')) o.fail('outcome-check-pending');
  }
}
module.exports = {assertOutcomeEvidenceWindow};
