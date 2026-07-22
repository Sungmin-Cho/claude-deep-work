const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const evidenceRuntime = require('../../runtime/evidence-runtime.js');
const { canonicalJson } = require('../../runtime/operation-journal.js');
const { parseSpecMarkdown } = require('../../runtime/contract-runtime.js');
const { compilePlanProjectionV1 } = require('../../runtime/plan-runtime.js');
const { compileVerificationPlan } = require('../../runtime/verification-policy-runtime.js');
const { compileReviewPlan } = require('../../runtime/review-policy-runtime.js');
const { updateFrontmatterText } = require('../../runtime/frontmatter.js');

const {
  verifyReceipts,
  normalizeDiff,
  VERIFICATION_ITEMS,
} = require('./verify-receipt-core.js');

// ─── Fixture helpers (execFileSync, no shell) ────────────────
function makeTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function makeReceipt(overrides = {}) {
  return Object.assign({
    slice_id: 'SLICE-001',
    status: 'complete',
    tdd: {
      // Delegated-path compact path (valid via STRICT_TRANSITIONS superset)
      state_transitions: ['PENDING', 'RED_VERIFIED', 'GREEN', 'SENSOR_CLEAN'],
      red_verification_output: 'AssertionError: expected 2 to equal 3\n  at test.js:12',
    },
    git_before_slice: 'HEAD0',
    git_after_slice: 'HEAD1',
    changes: { git_diff: '' },
    sensor_results: { lint: 'pass', typecheck: 'pass', reviewCheck: 'pass' },
    spec_compliance: {},  // no verification_cmd → item 8 skipped per receipt
    slice_review: { stage1: 'pass', stage2: 'pass' },
    harness_metadata: { model_id: 'sonnet' },
  }, overrides);
}

const digest = (value) => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');

async function committedSliceEvidence(root = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-evidence-'))) {
  fs.mkdirSync(root, { recursive: true });
  const fixture = path.resolve(__dirname, '../../tests/fixtures/v6.13-spec/medium-valid');
  const specContract = parseSpecMarkdown(fs.readFileSync(path.join(fixture, 'spec.md'), 'utf8'));
  const planProjection = compilePlanProjectionV1({
    planMarkdown: fs.readFileSync(path.join(fixture, 'plan.md'), 'utf8'),
    specContract,
    sliceRiskState: { 'SLICE-001': { class: 'medium', score: 6, triggers: ['strict-admission'] } },
  });
  const verificationPlan = compileVerificationPlan({
    riskProfile: { class: 'medium', score: 6, triggers: ['strict-admission'] },
    riskProfileSha256: 'b'.repeat(64),
    policySnapshot: { risk_class: 'medium', profile: 'standard',
      verification_policy: { recommended: '표준 검증' } },
    specContract,
    specSha256: planProjection.contract_binding.spec_contract.spec_sha256,
    specApprovedHash: 'a'.repeat(64),
    planProjection,
    capabilities: {},
    compatibilityFacts: { created_by_version: '6.13.0', spec_policy_required: true },
  });
  const reviewPlan = compileReviewPlan({ artifactKind: 'session-final', phase: 'test',
    riskClass: 'medium', runtime: 'claude', availableChannels: { subagent: true,
      codex_cli: true, gemini_cli: true, deep_review: true }, tddMode: 'strict' });
  const reports = reviewPlan.reviewers.map((row, index) => ({ role: row.role, channel: row.channel,
    required: row.required, status: 'completed', report_ref: `reports/${row.role}.json`,
    sha256: String(index + 1).repeat(64).slice(0, 64) }));
  const commandSpec = { schema_version: 1, executable: { kind: 'node', value: 'node' }, args: ['verify.js'],
    cwd_role: 'active-worktree', timeout_ms: 5000, max_output_bytes: 4096, red_failure_literal: 'expected-red' };
  const records = [];
  for (const [index, gateId] of verificationPlan.evidence_required_gate_ids.entries()) {
    const gate = verificationPlan.gates.find((row) => row.id === gateId);
    const base = { evidence_id: `EVID-ITEM9-${String(index + 1).padStart(4, '0')}`, gate_id: gateId };
    let record;
    if (gate.adapter === 'command') record = await evidenceRuntime.captureCommandEvidence({ ...base,
      verification_spec: commandSpec, expected_outcome: 'must-pass', requirement_ids: gate.requirement_ids,
      invariant_ids: ['INV-001'], failure_mode_ids: gate.failure_mode_ids, negative_test_ids: ['NEG-001'],
      redaction_policy: { exact_secret_values: [] } }, { runner: async () => ({ exitCode: 0, stdout: 'ok',
      stderr: '', durationMs: 1 }) });
    else if (gate.adapter === 'contract') record = evidenceRuntime.captureContractEvidence({ ...base,
      verificationPlan, specContract });
    else if (gate.adapter === 'receipt') record = evidenceRuntime.captureReceiptEvidence({ ...base,
      verificationPlan, plan: planProjection, receipts: [{ slice_id: 'SLICE-001', status: 'complete' }],
      verificationResult: { pass: true, errors: [] } });
    else if (gate.adapter === 'review') record = evidenceRuntime.captureReviewEvidence({ ...base,
      verificationPlan, reviewPlan, reports });
    else if (['sensor', 'health'].includes(gate.adapter)) {
      const result = { status: 'pass', adapter: gate.adapter };
      record = evidenceRuntime.captureRuntimeProjectionEvidence({ ...base, verificationPlan, kind: gate.adapter,
        operation: { operationId: `op-${String(index + 1).repeat(32).slice(0, 32)}` }, result,
        result_sha256: digest(result) });
    } else throw new Error(`unhandled required adapter ${gate.adapter}`);
    records.push(evidenceRuntime.materializeRecordUnderLock({ artifactRoot: root, record }));
  }
  const packageValue = evidenceRuntime.buildEvidencePackage({ scope: { kind: 'slice', id: 'SLICE-001' },
    verificationPlan, records, artifactRoot: root });
  const pointer = evidenceRuntime.publishContentAddressedEvidencePackage({ projectRoot: root,
    package: packageValue, verificationPlan });
  return { root, verificationPlan, packageValue, pointer };
}

describe('verify-receipt item 9: evidence completeness',()=>{
  it('cannot be skipped for spec-governed evidence',()=>{
    const slice={id:'SLICE-001',files:[],contract:{evidence_required:['GATE-spec-contract']}};
    const receipt=makeReceipt({evidence:{schema_version:2,package_sha256:'a'.repeat(64),
      verification_plan_sha256:'b'.repeat(64),risk_profile_sha256:'c'.repeat(64),
      completeness:{complete:true,satisfied_gate_ids:['GATE-spec-contract']}}});
    const result=verifyReceipts({receipts:[receipt],plan:{slices:[slice]},skip_items:[9],skip_git_checks:true});
    assert.equal(result.pass,false);assert.match(result.errors.join('\n'),/item 9.*cannot be skipped/);
  });

  it('rejects a forged embedded claim instead of accepting it as the committed slice package',async()=>{
    const authority=await committedSliceEvidence();const forged=structuredClone(authority.packageValue);
    forged.records[0].producer_proof.proof_sha256='f'.repeat(64);
    const slice={id:'SLICE-001',files:[],evidence_required:[...authority.verificationPlan.evidence_required_gate_ids]};
    const result=verifyReceipts({receipts:[makeReceipt({evidence:forged})],plan:{slices:[slice]},skip_git_checks:true,
      verification_plan:authority.verificationPlan,artifact_root:authority.root,
      committed_evidence:{slice_packages:{'SLICE-001':authority.pointer}}});
    assert.equal(result.pass,false);assert.match(result.errors.join('\n'),/item 9.*committed|item 9.*invalid/i);
  });

  it('rejects the producer receipt-plan-risk invalidation tuple for a validated committed package',async()=>{
    const authority=await committedSliceEvidence();const receiptRecord=authority.packageValue.records.find((row)=>row.kind==='receipt');
    const slice={id:'SLICE-001',files:[],evidence_required:[...authority.verificationPlan.evidence_required_gate_ids]};
    const result=verifyReceipts({receipts:[makeReceipt({evidence:authority.packageValue})],plan:{slices:[slice]},skip_git_checks:true,
      verification_plan:authority.verificationPlan,artifact_root:authority.root,
      committed_evidence:{slice_packages:{'SLICE-001':authority.pointer}},receipt_invalidations:[{slice_id:'SLICE-001',
        receipt_sha256:receiptRecord.result.receipt_set_sha256,
        prior_plan_sha256:authority.verificationPlan.plan_projection_sha256,
        prior_risk_profile_sha256:authority.verificationPlan.risk_profile_sha256}]});
    assert.equal(result.pass,false);assert.match(result.errors.join('\n'),/invalidated/);
  });

  it('production runner loads state authority and rejects forged or invalidated receipt evidence',async()=>{
    const projectRoot=fs.mkdtempSync(path.join(os.tmpdir(),'vr-runner-authority-')),session='s-aaaaaaaa';
    fs.mkdirSync(path.join(projectRoot,'.git'));fs.mkdirSync(path.join(projectRoot,'.claude'));const work=path.join(projectRoot,
      '.deep-work',session),receiptsDir=path.join(work,'receipts');fs.mkdirSync(receiptsDir,{recursive:true});
    const authority=await committedSliceEvidence(work),planPath=path.join(work,'plan.md');fs.copyFileSync(path.resolve(__dirname,
      '../../tests/fixtures/v6.13-spec/medium-valid/plan.md'),planPath);const statePath=path.join(projectRoot,'.claude',
      `deep-work.${session}.md`),review={evidence:{slice_packages:{'SLICE-001':authority.pointer}}};
    const writeState=(invalidations=[])=>fs.writeFileSync(statePath,updateFrontmatterText('',{session_id:session,
      work_dir:`.deep-work/${session}`,tdd_mode:'strict',verification_plan_json:canonicalJson(authority.verificationPlan),
      verification_plan_sha256:authority.verificationPlan.plan_sha256,review_execution_json:canonicalJson(review),
      receipt_invalidations_json:canonicalJson(invalidations)}));const run=()=>spawnSync(process.execPath,[path.join(__dirname,
      'verify-delegated-receipt-runner.js'),__dirname,statePath,receiptsDir,planPath,'','0'],{cwd:projectRoot,encoding:'utf8'});
    const forged=structuredClone(authority.packageValue);forged.records[0].producer_proof.proof_sha256='f'.repeat(64);
    fs.writeFileSync(path.join(receiptsDir,'SLICE-001.json'),canonicalJson(makeReceipt({evidence:forged})));writeState();
    let result=run();assert.notEqual(result.status,0);assert.match(result.stdout,/item 9.*committed/i);
    fs.writeFileSync(path.join(receiptsDir,'SLICE-001.json'),canonicalJson(makeReceipt({evidence:authority.packageValue})));
    const receiptRecord=authority.packageValue.records.find((row)=>row.kind==='receipt');writeState([{slice_id:'SLICE-001',
      receipt_sha256:receiptRecord.result.receipt_set_sha256,prior_plan_sha256:authority.verificationPlan.plan_projection_sha256,
      prior_risk_profile_sha256:authority.verificationPlan.risk_profile_sha256}]);result=run();assert.notEqual(result.status,0);
    assert.match(result.stdout,/item 9.*invalidated/i);
  });
});

describe('verify-receipt item 1: file existence', () => {
  it('FAIL when receipts count mismatches slice count', () => {
    const result = verifyReceipts({
      receipts: [],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /slice count mismatch/i);
  });
});

describe('verify-receipt item 2: status complete only (F10)', () => {
  it('FAIL on any blocked receipt', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({ status: 'blocked' })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /status.*blocked/i);
  });

  it('FAIL on blocked-upstream', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({ status: 'blocked-upstream' })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
  });
});

describe('verify-receipt item 3: tdd_state transitions', () => {
  it('FAIL on invalid transition PENDING → GREEN', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({
        tdd: {
          state_transitions: ['PENDING', 'GREEN'],
          red_verification_output: 'x',
        },
      })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      tdd_mode: 'strict',
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
  });

  it('PASS on delegated-path compact transition (PENDING→RED_VERIFIED→GREEN→SENSOR_CLEAN)', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt()],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      tdd_mode: 'strict',
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  it('PASS on phase-guard full FSM transitions (inline path) (W14)', () => {
    // Matches phase-guard-core.js VALID_TRANSITIONS full path
    const result = verifyReceipts({
      receipts: [makeReceipt({
        tdd: {
          state_transitions: [
            'PENDING', 'RED', 'RED_VERIFIED',
            'GREEN_ELIGIBLE', 'GREEN', 'SENSOR_RUN', 'SENSOR_CLEAN',
          ],
          red_verification_output: 'AssertionError: real\n  at x.js:1',
        },
      })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      tdd_mode: 'strict',
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt skip_items option (C7)', () => {
  it('skip_items: [1,2,3,4] — only item 5/6/7/8 evaluated (inline partial verify)', () => {
    // Intentionally break item 1-4 (count mismatch + bad status + bad transition)
    // but keep 5/6/7 valid. skip should silence all of 1-4.
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ status: 'blocked' }),  // item 2 would fail
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },  // item 1 count mismatch
        ],
      },
      tdd_mode: 'strict',
      skip_items: [1, 2, 3, 4],
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt item 4: sensor_results schema/status', () => {
  it('FAIL when sensor_results is empty', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({ sensor_results: {} })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /sensor_results.*empty/i);
  });

  it('FAIL when a required sensor reports fail or timeout', () => {
    for (const status of ['fail', 'timeout']) {
      const result = verifyReceipts({
        receipts: [makeReceipt({ sensor_results: { lint: status } })],
        plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
        skip_git_checks: true,
      });
      assert.equal(result.pass, false, `status=${status} should fail`);
      assert.match(result.errors.join('\n'), new RegExp(`lint.*${status}`, 'i'));
    }
  });

  it('FAIL when not_applicable has no tool-unavailable reason', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({ sensor_results: { typecheck: 'not_applicable' } })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /not_applicable.*reason/i);
  });

  it('PASS when not_applicable includes a tool-unavailable reason', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({
        sensor_results: {
          lint: 'pass',
          typecheck: { status: 'not_applicable', reason: 'tool not installed: tsc' },
        },
      })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  it('PASS with documented sensor metadata and object status fields', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({
        sensor_results: {
          ecosystem: 'typescript',
          lint: { tool: 'eslint', status: 'pass', errors: 0, warnings: 0 },
          typecheck: { tool: 'tsc', status: 'pass', errors: 0 },
          reviewCheck: { status: 'pass' },
        },
      })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  it('PASS with legacy delegated skipped sensor statuses', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({
        sensor_results: {
          lint: 'skipped',
          typecheck: 'skipped',
          reviewCheck: 'skipped',
        },
      })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt item 5: out-of-scope detection (F2, unfiltered)', () => {
  it('FAIL when touched_files ⊄ declared_files', () => {
    const dir = makeTmpRepo();
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    fs.writeFileSync(path.join(dir, 'a.js'), 'in\n');
    fs.writeFileSync(path.join(dir, 'b.js'), 'OUT\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'edit'], { cwd: dir });
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    const result = verifyReceipts({
      repo_root: dir,
      receipts: [makeReceipt({ git_before_slice: before, git_after_slice: after })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_diff_match: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /out.of.scope|b\.js/i);
  });

  it('PASS when touched_files ⊆ declared_files', () => {
    const dir = makeTmpRepo();
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    fs.writeFileSync(path.join(dir, 'a.js'), 'in\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'edit'], { cwd: dir });
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    const result = verifyReceipts({
      repo_root: dir,
      receipts: [makeReceipt({ git_before_slice: before, git_after_slice: after })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_diff_match: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  // NB (W1): This test validates multi-FILE scope within a SINGLE slice.
  // The true "multi-CLUSTER union scope" (N2) — where a solo worker receives
  // cluster_ids=[C1,C2] and edits files from both clusters — is enforced at
  // the AGENT PROMPT level (see implement-slice-worker.md Out-of-scope
  // guardrails), not at verify-receipt level. verify-receipt operates
  // slice-by-slice. Multi-cluster enforcement is covered by Task 16
  // Manual step 3 (observe agent behavior).
  it('PASS for multi-file slice scope', () => {
    const dir = makeTmpRepo();
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    fs.writeFileSync(path.join(dir, 'a.js'), 'f1\n');
    fs.writeFileSync(path.join(dir, 'b.js'), 'f2\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'edit'], { cwd: dir });
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    const result = verifyReceipts({
      repo_root: dir,
      receipts: [makeReceipt({ git_before_slice: before, git_after_slice: after })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js', 'b.js'] }] },
      skip_diff_match: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt item 6: baseline chain continuity (F1)', () => {
  it('FAIL on broken chain', () => {
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ slice_id: 'SLICE-001', git_before_slice: 'A', git_after_slice: 'B' }),
        makeReceipt({ slice_id: 'SLICE-002', git_before_slice: 'C', git_after_slice: 'D' }),
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },
        ],
      },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /chain|continuity/i);
  });

  it('PASS on continuous chain', () => {
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ slice_id: 'SLICE-001', git_before_slice: 'A', git_after_slice: 'B' }),
        makeReceipt({ slice_id: 'SLICE-002', git_before_slice: 'B', git_after_slice: 'C' }),
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },
        ],
      },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  it('PASS on team parallel: two clusters each with independent chain from same delegation_snapshot (CA4)', () => {
    // Cluster C1 chain: A -> B -> C
    // Cluster C2 chain: A -> D -> E  (started from same A = delegation_snapshot)
    // Global sort would flag C1.SLICE-001.after=B vs C2.SLICE-002.before=A as chain break.
    // Per-cluster chain check (CA4 fix) must treat these as independent chains.
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ slice_id: 'SLICE-001', cluster_id: 'C1', git_before_slice: 'A', git_after_slice: 'B' }),
        makeReceipt({ slice_id: 'SLICE-002', cluster_id: 'C2', git_before_slice: 'A', git_after_slice: 'D' }),
        makeReceipt({ slice_id: 'SLICE-003', cluster_id: 'C1', git_before_slice: 'B', git_after_slice: 'C' }),
        makeReceipt({ slice_id: 'SLICE-004', cluster_id: 'C2', git_before_slice: 'D', git_after_slice: 'E' }),
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },
          { id: 'SLICE-003', files: ['c.js'] },
          { id: 'SLICE-004', files: ['d.js'] },
        ],
      },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  it('FAIL on broken chain within a single cluster (per-cluster check)', () => {
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ slice_id: 'SLICE-001', cluster_id: 'C1', git_before_slice: 'A', git_after_slice: 'B' }),
        makeReceipt({ slice_id: 'SLICE-002', cluster_id: 'C1', git_before_slice: 'X', git_after_slice: 'Y' }),  // gap: B != X
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },
        ],
      },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /cluster "C1"/);
  });
});

describe('verify-receipt item 7: TDD hard-fail (W8)', () => {
  it('FAIL when red_verification_output is missing', () => {
    const r = makeReceipt();
    delete r.tdd.red_verification_output;
    const result = verifyReceipts({
      receipts: [r],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /red_verification_output/);
  });

  it('FAIL on trivial output (ok, pass, PASS)', () => {
    for (const trivial of ['ok', 'pass', 'PASS', 'passed', '  ok  ']) {
      const result = verifyReceipts({
        receipts: [makeReceipt({
          tdd: {
            state_transitions: ['PENDING', 'RED_VERIFIED', 'GREEN', 'SENSOR_CLEAN'],
            red_verification_output: trivial,
          },
        })],
        plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
        skip_git_checks: true,
      });
      assert.equal(result.pass, false, `should fail for trivial output: "${trivial}"`);
    }
  });

  it('PASS on real FAIL message', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt()],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('parseStateFile (N-R2 — YAML frontmatter)', () => {
  const { parseStateFile } = require('./verify-receipt-core.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  function writeState(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
    const file = path.join(dir, 'deep-work.S1.md');
    fs.writeFileSync(file, content);
    return file;
  }

  it('reads tdd_mode from YAML frontmatter', () => {
    const f = writeState([
      '---',
      'work_dir: "/tmp/x"',
      'tdd_mode: "strict"',
      'team_mode: "team"',
      '---',
      '',
      '# body',
    ].join('\n'));
    const s = parseStateFile(f);
    assert.equal(s.tdd_mode, 'strict');
    assert.equal(s.team_mode, 'team');
  });

  it('handles unquoted YAML values', () => {
    const f = writeState([
      '---',
      'tdd_mode: strict',
      '---',
    ].join('\n'));
    assert.equal(parseStateFile(f).tdd_mode, 'strict');
  });

  it('ignores inline YAML comments', () => {
    const f = writeState([
      '---',
      'tdd_mode: "strict"  # fixed at session start',
      '---',
    ].join('\n'));
    assert.equal(parseStateFile(f).tdd_mode, 'strict');
  });

  it('returns empty object when no frontmatter', () => {
    const f = writeState('# No frontmatter here\n');
    assert.deepEqual(parseStateFile(f), {});
  });

  it('does NOT throw on Markdown content (was C9/N-R2 bug)', () => {
    const f = writeState([
      '---',
      'tdd_mode: "strict"',
      '---',
      '',
      '# deep-work session log',
      '',
      'This is Markdown, not JSON. Previous JSON.parse would throw.',
    ].join('\n'));
    // Must not throw
    const s = parseStateFile(f);
    assert.equal(s.tdd_mode, 'strict');
  });
});

describe('parsePlanMd (N-R1 — deep-plan template compat)', () => {
  const { parsePlanMd } = require('./verify-receipt-core.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  function writePlan(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-md-test-'));
    const file = path.join(dir, 'plan.md');
    fs.writeFileSync(file, content);
    return file;
  }

  it('existing parsePlanMd rejects duplicate and dangling contract IDs', () => {
    const f = writePlan([
      '## Spec Contract Binding',
      '',
      '```json',
      JSON.stringify({
        schema_version: 1,
        mode: 'strict-spec',
        created_by_version: '6.13.0',
        spec_contract: {
          schema_version: 1,
          spec_id: 'SPEC-PARSER',
          spec_sha256: 'a'.repeat(64),
          spec_approved_hash: 'b'.repeat(64),
        },
        risk_profile_sha256: 'c'.repeat(64),
      }),
      '```',
      '',
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: Reject invalid trace links',
      '  - outcome: invalid trace links are rejected',
      '  - files: [runtime/a.js, runtime/a.test.js]',
      '  - depends_on: []',
      '  - integration_touchpoints: [contract parser]',
      '  - requirements: [REQ-001, REQ-001]',
      '  - invariants: [INV-999]',
      '  - failure_modes: []',
      '  - risk: { class: medium, score: 6, triggers: [contract-parser] }',
      '  - negative_tests: [NEG-001]',
      '  - evidence_required: [GATE-negative-tests]',
      '  - rollback: { method: revert, verification: [GATE-recovery] }',
      '  - review_policy: single',
      '  - scope_expansion_trigger: [public API change]',
      '  - size: M',
    ].join('\n'));

    assert.throws(
      () => parsePlanMd(f),
      (error) => error && /duplicate|dangling/.test(error.code || error.message)
    );
  });

  it('Markdown parser returns the full normalized SliceContractV1', () => {
    const f = writePlan([
      '## Spec Contract Binding', '', '```json', JSON.stringify({
        schema_version: 1, mode: 'strict-spec', created_by_version: '6.13.0',
        spec_contract: { schema_version: 1, spec_id: 'SPEC-PARSER',
          spec_sha256: 'a'.repeat(64), spec_approved_hash: 'b'.repeat(64) },
        risk_profile_sha256: 'c'.repeat(64),
      }), '```', '', '## Slice Checklist', '',
      '- [ ] SLICE-001: Preserve the full contract',
      '  - outcome: every normative field is preserved',
      '  - files: [runtime/a.js, runtime/a.test.js]',
      '  - depends_on: []',
      '  - integration_touchpoints: [plan parser, delegated worker]',
      '  - requirements: [REQ-001]',
      '  - invariants: [INV-001]',
      '  - failure_modes: [FM-001]',
      '  - risk: { class: high, score: 9, triggers: [contract-parser] }',
      '  - negative_tests: [NEG-001]',
      '  - evidence_required: [GATE-negative-tests]',
      '  - rollback: { method: revert-slice, verification: [GATE-recovery] }',
      '  - review_policy: dual',
      '  - scope_expansion_trigger: [public API change]',
      '  - failing_test: parser omits a normative field',
      '  - verification_cmd: node --test runtime/a.test.js',
      '  - expected_output: fail 0',
      '  - code_sketch: parsePlanContractMarkdown(source)',
      '  - spec_checklist: [REQ-001 acceptance, FM-001 recovery]',
      '  - contract: [all fields normalize, duplicates fail]',
      '  - acceptance_threshold: all',
      '  - size: L',
      '  - steps:',
      '    1. runtime/a.test.js adds the RED assertion',
      '    2. runtime/a.js implements the parser',
    ].join('\n'));

    const slice = parsePlanMd(f).slices[0];
    assert.equal(slice.failing_test, 'parser omits a normative field');
    assert.equal(slice.verification_cmd, 'node --test runtime/a.test.js');
    assert.equal(slice.expected_output, 'fail 0');
    assert.deepEqual(slice.spec_checklist, ['REQ-001 acceptance', 'FM-001 recovery']);
    assert.deepEqual(slice.contract, ['all fields normalize', 'duplicates fail']);
    assert.equal(slice.acceptance_threshold, 'all');
    assert.deepEqual(slice.steps, [
      'runtime/a.test.js adds the RED assertion',
      'runtime/a.js implements the parser',
    ]);
  });

  it('parses unquoted bracket files list (deep-plan canonical format)', () => {
    const f = writePlan([
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: Parse config',
      '  - files: [src/config.js, src/parser.js]',
      '  - size: S',
      '',
      '- [x] SLICE-002: Add validation',
      '  - files: [src/validate.js]',
      '  - size: M',
      '',
      '## Open Questions',
      '- [ ] none',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.equal(plan.slices.length, 2);
    assert.deepEqual(plan.slices[0].files, ['src/config.js', 'src/parser.js']);
    assert.equal(plan.slices[0].size, 'S');
    assert.deepEqual(plan.slices[1].files, ['src/validate.js']);
  });

  it('parses quoted bracket files (JSON-style) too', () => {
    const f = writePlan([
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: X',
      '  - files: ["src/a.js", "src/b.js"]',
      '  - size: S',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.deepEqual(plan.slices[0].files, ['src/a.js', 'src/b.js']);
  });

  it('IGNORES SLICE-NNN mentions outside Slice Checklist section', () => {
    // Prose mention of SLICE-001 in Overview + duplicate mention in Review
    // should not create phantom slices.
    const f = writePlan([
      '# Plan',
      '',
      '## Overview',
      'SLICE-001 is the entry point. Subsequent work depends on SLICE-002.',
      '',
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: Real entry',
      '  - files: [a.js]',
      '  - size: S',
      '',
      '## Review Notes',
      'See SLICE-001 and SLICE-999 for details.',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.equal(plan.slices.length, 1);
    assert.equal(plan.slices[0].id, 'SLICE-001');
    assert.deepEqual(plan.slices[0].files, ['a.js']);
  });

  it('returns empty when Slice Checklist section is missing', () => {
    const f = writePlan('# Plan\n\nNo checklist here.');
    assert.deepEqual(parsePlanMd(f), { slices: [] });
  });

  it('strips inline YAML comments on files line', () => {
    const f = writePlan([
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: X',
      '  - files: [a.js, b.js]  # two files',
      '  - size: S',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.deepEqual(plan.slices[0].files, ['a.js', 'b.js']);
  });
});

describe('normalizeDiff (N3)', () => {
  it('strips trailing newlines', () => {
    assert.equal(normalizeDiff('line1\nline2\n\n\n'), 'line1\nline2');
  });
  it('strips diff index hash lines', () => {
    const input = 'diff --git a/x b/x\nindex abc123..def456 100644\n--- a/x\n+++ b/x';
    assert.ok(!normalizeDiff(input).includes('index abc123'));
  });
  it('preserves internal whitespace', () => {
    assert.equal(normalizeDiff('a  b\n'), 'a  b');
  });
});
