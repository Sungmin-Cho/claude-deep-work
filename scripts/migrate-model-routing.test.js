const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { migrateStateFile } = require('./migrate-model-routing.js');

function makeStateFile(frontmatter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const file = path.join(dir, 'state.md');
  fs.writeFileSync(file, `---\n${frontmatter}\n---\n\n# body\n`);
  return file;
}

describe('migrate-model-routing', () => {
  it('replaces model_routing.research="main" with "sonnet"', () => {
    const f = makeStateFile([
      'model_routing:',
      '  research: "main"',
      '  plan: "main"',
      '  implement: "main"',
      '  test: "main"',
    ].join('\n'));
    const result = migrateStateFile(f);
    const content = fs.readFileSync(f, 'utf8');
    // research/implement/test → sonnet
    assert.match(content, /research:\s*"sonnet"/);
    assert.match(content, /implement:\s*"sonnet"/);
    assert.match(content, /test:\s*"sonnet"/);
    // plan preserved
    assert.match(content, /plan:\s*"main"/);
    assert.equal(result.replaced.sort().join(','), 'implement,research,test');
  });

  it('idempotent: second call makes no change', () => {
    const f = makeStateFile([
      'model_routing:',
      '  research: "main"',
    ].join('\n'));
    migrateStateFile(f);
    const after1 = fs.readFileSync(f, 'utf8');
    const result2 = migrateStateFile(f);
    const after2 = fs.readFileSync(f, 'utf8');
    assert.equal(after1, after2);
    assert.equal(result2.replaced.length, 0);
  });

  it('preserves unknown values (e.g. "main-strict")', () => {
    const f = makeStateFile([
      'model_routing:',
      '  research: "main-strict"',
    ].join('\n'));
    const result = migrateStateFile(f);
    assert.equal(result.replaced.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /unknown.*main-strict/i);
    assert.match(fs.readFileSync(f, 'utf8'), /research:\s*"main-strict"/);
  });

  it('exits silently when model_routing field absent', () => {
    const f = makeStateFile('work_dir: /tmp');
    const result = migrateStateFile(f);
    assert.equal(result.replaced.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it('handles inline YAML comments on the value line (N-R4)', () => {
    const f = makeStateFile([
      'model_routing:',
      '  research: "main"  # legacy default',
      '  plan: "main"      # Plan is exempt',
    ].join('\n'));
    const result = migrateStateFile(f);
    const content = fs.readFileSync(f, 'utf8');
    assert.deepEqual(result.replaced, ['research']);
    assert.match(content, /research:\s*"sonnet"\s*#/);
    assert.match(content, /plan:\s*"main"\s*#/);  // Plan preserved
  });

  it('does NOT touch "research: main" OUTSIDE model_routing block (N-R4)', () => {
    const f = makeStateFile([
      'other_section:',
      '  research: "main"',  // unrelated field, same name
      'model_routing:',
      '  research: "main"',  // this one SHOULD migrate
      '  implement: "sonnet"',
    ].join('\n'));
    const result = migrateStateFile(f);
    const content = fs.readFileSync(f, 'utf8');
    // The one inside model_routing is replaced; the one outside is NOT.
    const insideReplaced = /model_routing:\s*\n\s+research:\s*"sonnet"/.test(content);
    const outsidePreserved = /other_section:\s*\n\s+research:\s*"main"/.test(content);
    assert.ok(insideReplaced, 'inside model_routing should be migrated');
    assert.ok(outsidePreserved, 'outside model_routing must be preserved');
    assert.deepEqual(result.replaced, ['research']);
  });

  it('handles unquoted "main" (no quotes around value)', () => {
    const f = makeStateFile([
      'model_routing:',
      '  research: main',
    ].join('\n'));
    migrateStateFile(f);
    assert.match(fs.readFileSync(f, 'utf8'), /research:\s*"sonnet"/);
  });
});
