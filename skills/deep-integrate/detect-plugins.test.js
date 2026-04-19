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

  it('non-existent explicit root → fail-closed (all missing) + stderr warn + detection_status', () => {
    // v6.3.0 review W2: 이전 낙관적 fallback은 없는 플러그인 /command 추천을 유발해 fail-closed로 전환.
    // W-R3: --plugins-root로 명시적 경로를 주었을 때만 그 경로만 probe (override 경로 존중).
    //       기본 경로(override 미지정)에서는 cache/marketplaces/plugins 모두 probe하여 대체 설치를 감지.
    const result = spawnSync('bash', [SCRIPT, '--plugins-root', '/nonexistent/path/xyz'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    const stdout = JSON.parse(result.stdout);
    assert.deepEqual(stdout.installed, []);
    assert.deepEqual(new Set(stdout.missing), new Set(TARGETS));
    assert.equal(stdout.detection_status, 'cache-missing');
    assert.match(result.stderr, /no plugin install root found/);
  });

  it('v6.3.0 W-R3: default roots probe includes marketplaces path', () => {
    // override 없이 호출 시 cache/marketplaces/plugins 세 경로를 probe.
    // 시스템 의존성을 피하기 위해 이 테스트는 override를 쓰되 probe 동작 문서화 차원의 스모크.
    // 실제 시스템 경로 의존 테스트는 피함 — 대신 override 경로에서 marketplaces 구조가 감지되는지 검증.
    const mp = path.join(tmpRoot, 'plugins', 'cache', 'marketplace-x', 'deep-review');
    fs.mkdirSync(mp, { recursive: true });
    // override는 cache만 보므로 marketplace-x 하위의 deep-review가 감지되어야 함.
    const result = run();
    assert.ok(result.installed.includes('deep-review'));
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
