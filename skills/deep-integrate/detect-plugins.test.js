const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'detect-plugins.sh');
const TARGETS = ['deep-review', 'deep-evolve', 'deep-docs', 'deep-wiki', 'deep-dashboard'];

let tmpRoot;

function setup() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dip-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'plugins', 'cache', 'some-marketplace'), { recursive: true });
}

function cleanup() {
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
}

function installPlugin(name) {
  const dir = path.join(tmpRoot, 'plugins', 'cache', 'some-marketplace', name);
  fs.mkdirSync(dir, { recursive: true });
}

function run(extraArgs = []) {
  const stdout = execFileSync('bash', [SCRIPT, '--plugins-root', path.join(tmpRoot, 'plugins', 'cache'), ...extraArgs], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

describe('detect-plugins.sh', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('all 5 plugins installed → all in installed[], none in missing[]', () => {
    for (const p of TARGETS) installPlugin(p);
    const result = run();
    assert.deepEqual(new Set(result.installed), new Set(TARGETS));
    assert.deepEqual(result.missing, []);
  });

  it('3 plugins installed → exactly those in installed[], others in missing[]', () => {
    installPlugin('deep-review');
    installPlugin('deep-docs');
    installPlugin('deep-wiki');
    const result = run();
    assert.deepEqual(new Set(result.installed), new Set(['deep-review', 'deep-docs', 'deep-wiki']));
    assert.deepEqual(new Set(result.missing), new Set(['deep-evolve', 'deep-dashboard']));
  });

  it('no plugins installed → installed=[], missing=all', () => {
    const result = run();
    assert.deepEqual(result.installed, []);
    assert.deepEqual(new Set(result.missing), new Set(TARGETS));
  });

  it('non-existent root → optimistic fallback (all installed) + stderr warn', () => {
    // Pass a path that definitely does not exist — assert both stdout JSON and stderr warning
    const result = spawnSync('bash', [SCRIPT, '--plugins-root', '/nonexistent/path/xyz'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    const stdout = JSON.parse(result.stdout);
    assert.deepEqual(new Set(stdout.installed), new Set(TARGETS));
    assert.deepEqual(stdout.missing, []);
    assert.match(result.stderr, /plugins root not found/);
  });

  it('--plugins-root with missing/empty value → exit 0, uses default, warns', () => {
    // Missing value
    const r1 = spawnSync('bash', [SCRIPT, '--plugins-root'], { encoding: 'utf8' });
    assert.equal(r1.status, 0, 'missing value should still exit 0');
    assert.match(r1.stderr, /requires (a )?(non-empty )?value/);

    // Empty value
    const r2 = spawnSync('bash', [SCRIPT, '--plugins-root', ''], { encoding: 'utf8' });
    assert.equal(r2.status, 0, 'empty value should still exit 0');
    assert.match(r2.stderr, /requires (a )?(non-empty )?value/);
  });
});
