const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'gather-signals.sh');

let projectRoot;

function setup() {
  // /tmp 아래 mkdtemp (/tmp 는 git repo 아님) → changes==null 결정론 확보
  projectRoot = fs.mkdtempSync(path.join('/tmp', 'gs-test-'));
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
}

function cleanup() {
  if (projectRoot) {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    projectRoot = null;
  }
}

function writeStateFile(sessionId, workDirSlug, goal, phaseTimestamps = {}) {
  const frontmatter = [
    `session_id: ${sessionId}`,
    `work_dir: ${workDirSlug}`,
    `task_description: "${goal}"`,
    `current_phase: test`,
    ...Object.entries(phaseTimestamps).map(([k, v]) => `${k}: "${v}"`),
  ].join('\n');
  fs.writeFileSync(
    path.join(projectRoot, '.claude', `deep-work.${sessionId}.md`),
    `---\n${frontmatter}\n---\n`
  );
  fs.mkdirSync(path.join(projectRoot, workDirSlug), { recursive: true });
}

function writeSessionPointer(sessionId) {
  fs.writeFileSync(path.join(projectRoot, '.claude', 'deep-work-current-session'), sessionId);
}

function run(installed = ['deep-review', 'deep-docs'], missing = ['deep-evolve', 'deep-wiki', 'deep-dashboard'], envOverride = {}) {
  const stdout = execFileSync('bash', [
    SCRIPT,
    projectRoot,
    JSON.stringify({ installed, missing }),
  ], { encoding: 'utf8', cwd: projectRoot, env: { ...process.env, ...envOverride } });
  return JSON.parse(stdout);
}

describe('gather-signals.sh', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('all artifacts missing → placeholder objects with null fields (not whole null), session populated', () => {
    writeStateFile('s-abc123', '.deep-work/20260418-142300-test', 'JWT 인증', {
      brainstorm_completed_at: '2026-04-18T13:55:00Z',
      research_completed_at: '2026-04-18T14:00:00Z',
      plan_completed_at: '2026-04-18T14:10:00Z',
      implement_completed_at: '2026-04-18T14:20:00Z',
      test_completed_at: '2026-04-18T14:30:00Z',
    });
    writeSessionPointer('s-abc123');

    const env = run();
    assert.equal(env.session.id, 's-abc123');
    assert.equal(env.session.work_dir, '.deep-work/20260418-142300-test');
    assert.equal(env.session.goal, 'JWT 인증');
    // C7 fix: brainstorm 포함, 5 phases 전부
    assert.deepEqual(env.session.phases_completed, ['brainstorm', 'research', 'plan', 'implement', 'test']);
    // C2 fix: 미존재 아티팩트도 placeholder object로 반환 (whole-null 금지)
    assert.equal(env.artifacts['deep-review'].recurring_findings, null);
    assert.equal(env.artifacts['deep-docs'].last_scanned_at, null);
    assert.equal(env.artifacts['deep-docs'].issues_summary, null);
    assert.equal(env.artifacts['deep-evolve'], null);  // 미설치 플러그인만 whole-null
  });

  it('last-scan.json present → deep-docs.issues_summary populated', () => {
    writeStateFile('s-abc123', '.deep-work/w1', 'fix', { test_completed_at: '2026-04-18T14:30:00Z' });
    writeSessionPointer('s-abc123');
    fs.mkdirSync(path.join(projectRoot, '.deep-docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.deep-docs', 'last-scan.json'), JSON.stringify({
      scanned_at: '2026-04-16T04:49:52Z',
      documents: [
        { path: 'CLAUDE.md', issues: [{ severity: 'low' }] },
        { path: 'README.md', issues: [] },
      ],
    }));

    const env = run();
    assert.equal(env.artifacts['deep-docs'].last_scanned_at, '2026-04-16T04:49:52Z');
    assert.equal(env.artifacts['deep-docs'].issues_summary['CLAUDE.md'], 1);
    assert.equal(env.artifacts['deep-docs'].issues_summary['README.md'], 0);
  });

  it('corrupted JSON → placeholder with null fields, other artifacts preserved', () => {
    writeStateFile('s-abc123', '.deep-work/w1', 'fix', { test_completed_at: '2026-04-18T14:30:00Z' });
    writeSessionPointer('s-abc123');
    fs.mkdirSync(path.join(projectRoot, '.deep-docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.deep-docs', 'last-scan.json'), 'this is { not valid json');

    const env = run();
    // C2 fix: corrupted JSON도 placeholder object로 (whole-null 아님)
    assert.equal(env.artifacts['deep-docs'].last_scanned_at, null);
    assert.equal(env.artifacts['deep-docs'].issues_summary, null);
    assert.equal(env.session.id, 's-abc123');
  });

  it('non-git directory → session.changes === null (deterministic)', () => {
    writeStateFile('s-abc123', '.deep-work/w1', 'fix', { test_completed_at: '2026-04-18T14:30:00Z' });
    writeSessionPointer('s-abc123');
    // /tmp 아래 mkdtemp → git rev-parse 실패 보장
    const env = run();
    // W9 fix: 결정론적 assertion — null만 허용
    assert.equal(env.session.changes, null);
  });

  it('DEEP_WORK_SESSION_ID env var overrides pointer (W2 session resolution)', () => {
    writeStateFile('s-one', '.deep-work/w-one', 'goal one');
    writeStateFile('s-two', '.deep-work/w-two', 'goal two');
    writeSessionPointer('s-one');

    const env = run(
      [], ['deep-review','deep-evolve','deep-docs','deep-wiki','deep-dashboard'],
      { DEEP_WORK_SESSION_ID: 's-two' }
    );
    assert.equal(env.session.id, 's-two');
    assert.equal(env.session.work_dir, '.deep-work/w-two');
  });

  it('no active session (no pointer, no env) → session=null, no crash (C6 fix)', () => {
    // state file 없음, pointer 없음, env 없음 → unbound 크래시 없이 정상 종료
    const env = run();
    assert.equal(env.session, null);
    // artifacts.deep-work는 null (SESSION_ID 없으므로 path 조립 불가)
    assert.equal(env.artifacts['deep-work'], null);
  });

  it('W1: envelope size budget — large recurring-findings is summarized not dropped', () => {
    writeStateFile('s-big', '.deep-work/w1', 'big', { test_completed_at: '2026-04-18T14:30:00Z' });
    writeSessionPointer('s-big');
    fs.mkdirSync(path.join(projectRoot, '.deep-review'), { recursive: true });
    // 1000개 synthetic findings
    const findings = Array.from({ length: 1000 }, (_, i) => ({
      category: 'error-handling',
      severity: 'warning',
      description: `issue ${i}`,
    }));
    fs.writeFileSync(path.join(projectRoot, '.deep-review', 'recurring-findings.json'),
      JSON.stringify({ findings }));

    const env = run();
    // 축약되어 {total, top_category}만 남음 (전체 findings 배열 아님)
    const rf = env.artifacts['deep-review'].recurring_findings;
    assert.ok(rf, 'recurring_findings should not be null');
    assert.equal(rf.total, 1000);
    assert.equal(rf.top_category, 'error-handling');
  });
});
