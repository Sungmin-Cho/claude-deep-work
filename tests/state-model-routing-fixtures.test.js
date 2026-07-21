'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseFrontmatter, updateFrontmatterText } = require('../runtime/frontmatter.js');
const { selectSessionPointer } = require('../runtime/session-store.js');
const { issueProjectStateCapability } = require('../runtime/platform.js');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'state-model-routing');
const CASES = [
  {
    file: 'engine-auto.md',
    sessionId: 's-a0a0a0a0',
    routing: { brainstorm: 'main', research: 'sonnet', plan: 'main', implement: 'sonnet', test: 'haiku' },
    meta: {
      runtime: 'claude',
      scale: 'medium',
      difficulty: 'medium',
      tiers: { brainstorm: 'main', research: 'standard', plan: 'main', implement: 'standard', test: 'light' },
      pinned: {},
      catalog_version: 1,
      decided_at: '2026-07-21T00:00:00.000Z',
    },
  },
  {
    file: 'pinned.md',
    sessionId: 's-b1b1b1b1',
    routing: { brainstorm: 'main', research: 'sonnet', plan: 'main', implement: 'opus', test: 'haiku' },
    meta: {
      runtime: 'claude',
      scale: 'medium',
      difficulty: 'medium',
      tiers: { brainstorm: 'main', research: 'standard', plan: 'main', implement: 'deep', test: 'light' },
      pinned: { implement: 'deep' },
      catalog_version: 1,
      decided_at: '2026-07-21T00:00:00.000Z',
    },
  },
];

function deterministicState({ sessionId, routing, meta }) {
  const base = `---\nsession_id: ${sessionId}\nwork_dir: .deep-work/${sessionId}\ncurrent_phase: implement\n---\n# Fixture state\n`;
  return updateFrontmatterText(base, {
    model_routing_json: JSON.stringify(routing),
    model_routing_meta_json: JSON.stringify(meta),
  });
}

async function readThroughSessionStore(raw, sessionId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-model-routing-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.claude'));
  const statePath = path.join(root, '.claude', `deep-work.${sessionId}.md`);
  fs.writeFileSync(statePath, raw);
  fs.writeFileSync(path.join(root, '.claude', 'deep-work-sessions.json'), `${JSON.stringify({
    version: 1,
    shared_files: [],
    sessions: {
      [sessionId]: {
        pid: process.pid,
        task_description: 'fixture',
        work_dir: `.deep-work/${sessionId}`,
        current_phase: 'implement',
        file_ownership: [],
        last_activity: '2026-07-21T00:00:00.000Z',
      },
    },
  })}\n`);
  const projectCapability = issueProjectStateCapability(root, root, { role: 'project-root' });
  const stateCapability = issueProjectStateCapability(root, statePath, { role: 'session-state' });
  await selectSessionPointer({ projectCapability, sessionId, stateCapability });
}

test('canonical routing fixtures are deterministic and pass both state readers with JSON round-trip', async () => {
  for (const fixtureCase of CASES) {
    const fixturePath = path.join(FIXTURE_DIR, fixtureCase.file);
    const raw = fs.readFileSync(fixturePath, 'utf8');
    assert.equal(raw, deterministicState(fixtureCase), `${fixtureCase.file} drifted from updateFrontmatterText output`);
    const { fields } = parseFrontmatter(raw);
    assert.deepEqual(JSON.parse(fields.model_routing_json), fixtureCase.routing);
    assert.deepEqual(JSON.parse(fields.model_routing_meta_json), fixtureCase.meta);
    await readThroughSessionStore(raw, fixtureCase.sessionId);
  }
});

test('legacy nested fixture is explicitly labelled and documented as fallback-only', () => {
  const names = fs.readdirSync(FIXTURE_DIR);
  const legacyNames = names.filter((name) => name.startsWith('legacy-') && name.endsWith('.md'));
  assert.deepEqual(legacyNames, ['legacy-nested.md']);
  const readme = fs.readFileSync(path.join(FIXTURE_DIR, 'README.md'), 'utf8');
  assert.match(readme, /legacy-nested\.md/);
  assert.match(readme, /best-effort fallback/i);
});
