'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadRegistry, matchEcosystem, detectEcosystems } = require('./detect.js');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deep-work-detect-test-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function touch(dir, ...files) {
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f), '');
  }
}

// Test 1: loadRegistry loads registry.json and returns object with ecosystems
test('loadRegistry: loads registry.json, returns object with ecosystems', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  assert.ok(registry, 'registry should be truthy');
  assert.ok(typeof registry === 'object', 'registry should be an object');
  assert.ok('ecosystems' in registry, 'registry should have ecosystems key');
  assert.ok('typescript' in registry.ecosystems, 'ecosystems should include typescript');
  assert.ok('python' in registry.ecosystems, 'ecosystems should include python');
  assert.ok('javascript' in registry.ecosystems, 'ecosystems should include javascript');
});

// Test 2: matchEcosystem require AND — tsconfig.json + package.json → match typescript
test('matchEcosystem require AND: tsconfig.json + package.json matches typescript', () => {
  const dir = makeTempDir();
  try {
    touch(dir, 'tsconfig.json', 'package.json');
    const tsConfig = { require: ['tsconfig.json'], any_of: ['package.json'] };
    const result = matchEcosystem(dir, tsConfig);
    assert.equal(result, true, 'should match when both require and any_of are satisfied');
  } finally {
    cleanupDir(dir);
  }
});

// Test 3: matchEcosystem any_of OR — only pyproject.toml → match python
test('matchEcosystem any_of OR: only pyproject.toml matches python', () => {
  const dir = makeTempDir();
  try {
    touch(dir, 'pyproject.toml');
    const pyConfig = { any_of: ['pyproject.toml', 'setup.py', 'requirements.txt'] };
    const result = matchEcosystem(dir, pyConfig);
    assert.equal(result, true, 'should match when at least one any_of file exists');
  } finally {
    cleanupDir(dir);
  }
});

// Test 4: matchEcosystem require fail — package.json only → NOT match typescript
test('matchEcosystem require fail: package.json only does NOT match typescript', () => {
  const dir = makeTempDir();
  try {
    touch(dir, 'package.json');
    const tsConfig = { require: ['tsconfig.json'], any_of: ['package.json'] };
    const result = matchEcosystem(dir, tsConfig);
    assert.equal(result, false, 'should not match when require condition is not satisfied');
  } finally {
    cleanupDir(dir);
  }
});

// Test 5: matchEcosystem glob — MyApp.csproj exists → match csharp *.csproj
test('matchEcosystem glob: MyApp.csproj matches csharp *.csproj pattern', () => {
  const dir = makeTempDir();
  try {
    touch(dir, 'MyApp.csproj');
    const csharpConfig = { any_of: ['*.csproj', '*.sln'] };
    const result = matchEcosystem(dir, csharpConfig);
    assert.equal(result, true, 'should match glob pattern *.csproj');
  } finally {
    cleanupDir(dir);
  }
});

// Test 6: matchEcosystem empty dir — nothing → no match
test('matchEcosystem empty dir: empty directory does not match any ecosystem', () => {
  const dir = makeTempDir();
  try {
    const tsConfig = { require: ['tsconfig.json'], any_of: ['package.json'] };
    const pyConfig = { any_of: ['pyproject.toml', 'setup.py', 'requirements.txt'] };
    assert.equal(matchEcosystem(dir, tsConfig), false, 'typescript should not match empty dir');
    assert.equal(matchEcosystem(dir, pyConfig), false, 'python should not match empty dir');
  } finally {
    cleanupDir(dir);
  }
});

// Test 7: detectEcosystems empty — empty dir → empty ecosystems array
test('detectEcosystems empty: empty dir returns empty ecosystems array', () => {
  const dir = makeTempDir();
  try {
    const result = detectEcosystems(dir, REGISTRY_PATH);
    assert.ok(result, 'result should be truthy');
    assert.ok(Array.isArray(result.ecosystems), 'ecosystems should be an array');
    assert.equal(result.ecosystems.length, 0, 'empty dir should yield no ecosystems');
    assert.ok(typeof result.detected_at === 'string', 'detected_at should be a string');
  } finally {
    cleanupDir(dir);
  }
});

// Test 8: detectEcosystems typescript — package.json + tsconfig.json → detects typescript
test('detectEcosystems typescript: package.json + tsconfig.json detects typescript', () => {
  const dir = makeTempDir();
  try {
    touch(dir, 'package.json', 'tsconfig.json');
    const result = detectEcosystems(dir, REGISTRY_PATH);
    const names = result.ecosystems.map(e => e.name);
    assert.ok(names.includes('typescript'), 'should detect typescript');
    const ts = result.ecosystems.find(e => e.name === 'typescript');
    assert.ok(ts, 'typescript ecosystem entry should exist');
    assert.equal(ts.root, '.', 'root should be "."');
    assert.ok(ts.sensors, 'sensors should exist');
    assert.ok(Array.isArray(ts.file_extensions), 'file_extensions should be an array');
  } finally {
    cleanupDir(dir);
  }
});

// Test 9: detectEcosystems monorepo — package.json + tsconfig.json + pyproject.toml → detects both TS and Python
test('detectEcosystems monorepo: detects both typescript and python', () => {
  const dir = makeTempDir();
  try {
    touch(dir, 'package.json', 'tsconfig.json', 'pyproject.toml');
    const result = detectEcosystems(dir, REGISTRY_PATH);
    const names = result.ecosystems.map(e => e.name);
    assert.ok(names.includes('typescript'), 'should detect typescript');
    assert.ok(names.includes('python'), 'should detect python');
  } finally {
    cleanupDir(dir);
  }
});

// Test 10: JS vs TS distinction — package.json only → detects javascript, NOT typescript
test('JS vs TS distinction: package.json only detects javascript, NOT typescript', () => {
  const dir = makeTempDir();
  try {
    touch(dir, 'package.json');
    const result = detectEcosystems(dir, REGISTRY_PATH);
    const names = result.ecosystems.map(e => e.name);
    assert.ok(names.includes('javascript'), 'should detect javascript');
    assert.ok(!names.includes('typescript'), 'should NOT detect typescript without tsconfig.json');
  } finally {
    cleanupDir(dir);
  }
});
