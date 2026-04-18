const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Envelope fixtures', () => {
  for (const name of ['A', 'B', 'C']) {
    it(`envelope-${name}.json is valid JSON with required top-level keys`, () => {
      const content = JSON.parse(fs.readFileSync(path.join(__dirname, `envelope-${name}.json`), 'utf8'));
      assert.ok(content.session);
      assert.ok(content.loop);
      assert.ok(content.plugins);
      assert.ok(content.artifacts);
    });
  }

  it('Envelope A: recurring_findings exists (precondition for installation_suggestions)', () => {
    const a = JSON.parse(fs.readFileSync(path.join(__dirname, 'envelope-A.json'), 'utf8'));
    assert.ok(a.artifacts['deep-review']);
    assert.ok(a.artifacts['deep-review'].recurring_findings);
    assert.ok(a.artifacts['deep-review'].recurring_findings.total >= 3);
    assert.ok(!a.plugins.installed.includes('deep-evolve'));
  });

  it('Envelope B: already_executed contains deep-review (re-review context)', () => {
    const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'envelope-B.json'), 'utf8'));
    assert.ok(b.loop.already_executed.includes('deep-review'));
    assert.ok(b.session.changes.files_changed <= 3);
  });

  it('Envelope C: only docs changed', () => {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'envelope-C.json'), 'utf8'));
    assert.ok(c.session.changes.categories.docs > 0);
    assert.equal(c.session.changes.categories.src, 0);
    assert.equal(c.session.changes.categories.test, 0);
  });
});
