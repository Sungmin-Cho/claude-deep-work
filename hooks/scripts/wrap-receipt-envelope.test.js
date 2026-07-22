const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('node:crypto');
const { spawnSync } = require('child_process');
const { canonicalJson } = require('../../runtime/operation-journal.js');
const { parseSpecMarkdown } = require('../../runtime/contract-runtime.js');
const { compilePlanProjectionV1 } = require('../../runtime/plan-runtime.js');
const { compileVerificationPlan } = require('../../runtime/verification-policy-runtime.js');
const { updateFrontmatterText } = require('../../runtime/frontmatter.js');

const WRAP = path.resolve(__dirname, 'wrap-receipt-envelope.js');

// Deterministic test-verification signal: for session-receipt kind, the wrapper
// reads the session state's `test_passed` marker via --session-state-file and
// stamps x-test-verified:true|false on the payload. It does NOT rewrite outcome
// — merge/pr are already physically complete by §7-Z, so the receipt records
// the fact (outcome) and the verification signal (x-test-verified) separately.

let dir;
function setup() { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-gate-')); }
function cleanup() { if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = null; } }

function writePayload(outcome) {
  const p = path.join(dir, 'payload.json');
  fs.writeFileSync(p, JSON.stringify({
    schema_version: '1.0',
    session_id: 'dw-test',
    started_at: '2026-07-06T00:00:00Z',
    outcome,
    slices: { total: 1 },
  }));
  return p;
}

function writeState(testPassedLine) {
  const p = path.join(dir, 'state.md');
  fs.writeFileSync(p, `---\ncurrent_phase: test\n${testPassedLine}\n---\n`);
  return p;
}

function runWrap(extraArgs, cwd) {
  const out = path.join(dir, 'receipt.json');
  const r = spawnSync('node', [
    WRAP,
    '--artifact-kind', 'session-receipt',
    '--payload-file', path.join(dir, 'payload.json'),
    '--output', out,
    ...extraArgs,
  ], { encoding: 'utf8', timeout: 10000, cwd });
  const payload = r.status === 0 ? JSON.parse(fs.readFileSync(out, 'utf8')).payload : null;
  return { r, payload };
}

function verificationAuthority() {
  const fixture=path.resolve(__dirname,'../../tests/fixtures/v6.13-spec/medium-valid');
  const specContract=parseSpecMarkdown(fs.readFileSync(path.join(fixture,'spec.md'),'utf8'));
  const planProjection=compilePlanProjectionV1({planMarkdown:fs.readFileSync(path.join(fixture,'plan.md'),'utf8'),specContract,
    sliceRiskState:{'SLICE-001':{class:'medium',score:6,triggers:['strict-admission']}}});
  const verificationPlan=compileVerificationPlan({riskProfile:{class:'medium',score:6,triggers:['strict-admission']},
    riskProfileSha256:'b'.repeat(64),policySnapshot:{risk_class:'medium',profile:'standard',verification_policy:{recommended:'표준 검증'}},
    specContract,specSha256:planProjection.contract_binding.spec_contract.spec_sha256,specApprovedHash:'a'.repeat(64),
    planProjection,capabilities:{},compatibilityFacts:{created_by_version:'6.13.0',spec_policy_required:true}});
  return verificationPlan;
}

function forgedEvidenceState({legacySessionPointer}) {
  const session='s-aaaaaaaa',work=path.join(dir,'.deep-work',session);fs.mkdirSync(path.join(dir,'.claude'),{recursive:true});
  fs.mkdirSync(path.join(work,'evidence','packages'),{recursive:true});const verificationPlan=verificationAuthority();
  const pkg={schema_version:2,scope:{kind:'session',id:session},verification_plan_sha256:'f'.repeat(64),
    spec_id:verificationPlan.spec_id,spec_sha256:verificationPlan.spec_sha256,spec_approved_hash:verificationPlan.spec_approved_hash,
    risk_profile_sha256:verificationPlan.risk_profile_sha256,risk_snapshot:{class:'medium'},policy_snapshot:{profile:'standard'},
    contract_trace:{requirements:[],invariants:[],failure_cases:[]},records:[],coverage:{requirements:{total:0,covered:0,ratio:null},
      failure_matrix:{total:0,covered:0,ratio:null}},completeness:{evidence_required_gate_ids:[],satisfied_gate_ids:[],
      missing_gate_ids:[],complete:true},reviews:{findings:[],dispositions:[]},unverified_areas:[],
    residual_risk:{class:'low',accepted_by:null,reason:null}};
  const preimage=structuredClone(pkg);pkg.package_sha256=crypto.createHash('sha256').update(canonicalJson(preimage)).digest('hex');
  const packageRef=`evidence/packages/${pkg.package_sha256}.json`;fs.writeFileSync(path.join(work,packageRef),canonicalJson(pkg));
  const pointer={package_ref:packageRef,package_sha256:pkg.package_sha256,verification_plan_sha256:verificationPlan.plan_sha256,
    summary:{schema_version:2,complete:true,redaction:{passed:true},satisfied_gate_ids:verificationPlan.required_gate_ids,
      missing_gate_ids:[],unverified_areas:[]}};const evidence={...pointer,slice_packages:{}};
  if(legacySessionPointer)evidence.session=pointer;const state=path.join(dir,'.claude',`deep-work.${session}.md`);
  fs.writeFileSync(state,updateFrontmatterText('',{schema_version:2,session_id:session,work_dir:`.deep-work/${session}`,
    verification_plan_json:canonicalJson(verificationPlan),verification_plan_sha256:verificationPlan.plan_sha256,
    review_execution_json:canonicalJson({evidence})}));return{state,work};
}

describe('wrap-receipt-envelope.js — test_passed verification signal', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('test_passed=false + outcome=merge → outcome KEPT, x-test-verified=false', () => {
    writePayload('merge');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge', 'outcome must record the real (already-done) action');
    assert.equal(payload['x-test-verified'], false);
    assert.equal('x-declared-outcome' in payload, false, 'no outcome shadow field');
  });

  it('test_passed=false + outcome=pr → outcome KEPT, x-test-verified=false', () => {
    writePayload('pr');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'pr');
    assert.equal(payload['x-test-verified'], false);
    assert.equal('x-declared-outcome' in payload, false);
  });

  it('test_passed missing entirely + outcome=merge → outcome KEPT, x-test-verified=false', () => {
    writePayload('merge');
    const state = writeState('finished_at: 2026-07-06T01:00:00Z'); // no test_passed line
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
    assert.equal(payload['x-test-verified'], false);
  });

  it('test_passed=true + outcome=merge → outcome intact, x-test-verified=true', () => {
    writePayload('merge');
    const state = writeState('test_passed: true');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
    assert.equal(payload['x-test-verified'], true);
    assert.equal('x-declared-outcome' in payload, false);
  });

  it('test_passed=false + outcome=discard → outcome KEPT, x-test-verified=false', () => {
    writePayload('discard');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'discard');
    assert.equal(payload['x-test-verified'], false);
  });

  it('no --session-state-file → payload untouched (backward compatible)', () => {
    writePayload('merge');
    const { r, payload } = runWrap([]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
    assert.equal('x-test-verified' in payload, false);
  });

  it('--session-state-file pointing at a missing file → gate skipped (fail-open)', () => {
    writePayload('merge');
    const { r, payload } = runWrap(['--session-state-file', path.join(dir, 'does-not-exist.md')]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
    assert.equal('x-test-verified' in payload, false);
  });
});

describe('wrap-receipt-envelope.js — committed evidence identity',()=>{
  beforeEach(setup);afterEach(cleanup);

  it('rejects a complete-looking package that does not match the persisted verification plan',()=>{
    writePayload('merge');const fixture=forgedEvidenceState({legacySessionPointer:true});
    const {r}=runWrap(['--evidence-state-file',fixture.state],fixture.work);
    assert.equal(r.status,2);assert.match(r.stderr,/committed evidence package is invalid/);
  });

  it('reads the canonical top-level session pointer instead of evidence.session',()=>{
    writePayload('merge');const fixture=forgedEvidenceState({legacySessionPointer:false});
    const {r}=runWrap(['--evidence-state-file',fixture.state],fixture.work);
    assert.equal(r.status,2);assert.match(r.stderr,/committed evidence package is invalid/);
    assert.doesNotMatch(r.stderr,/committed evidence pointer is missing/);
  });
});
