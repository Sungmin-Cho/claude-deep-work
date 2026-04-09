'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REGISTRY_PATH = path.join(__dirname, 'topology-registry.json');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deep-work-topology-test-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function touch(dir, ...files) {
  for (const f of files) {
    const fullPath = path.join(dir, f);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, '');
  }
}

function writePackageJson(dir, deps = {}, devDeps = {}) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }, null, 2)
  );
}

function writePyprojectToml(dir, deps = []) {
  const depsStr = deps.map(d => `"${d}"`).join(', ');
  fs.writeFileSync(
    path.join(dir, 'pyproject.toml'),
    `[project]\nname = "myproject"\ndependencies = [${depsStr}]\n`
  );
}

// Lazy-require after tests are defined (tests write files, then implementation is loaded)
let detectTopology;

// Test 1: Detects nextjs-app with next.config.js + app/ directory
test('detects nextjs-app: next.config.js + app/ dir + next dep', () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, { next: '^14.0.0', react: '^18.0.0' });
    touch(dir, 'next.config.js');
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });

    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'nextjs-app', 'should detect nextjs-app');
    assert.ok(result.confidence, 'should have confidence level');
    assert.equal(result.display_name, 'Next.js App Router');
  } finally {
    cleanupDir(dir);
  }
});

// Test 2: Detects react-spa with react but no next/express
test('detects react-spa: react dep without next or express', () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, { react: '^18.0.0', 'react-dom': '^18.0.0' });

    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'react-spa', 'should detect react-spa');
    assert.equal(result.display_name, 'React SPA');
  } finally {
    cleanupDir(dir);
  }
});

// Test 3: Detects express-api with express in deps
test('detects express-api: express dep without next', () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, { express: '^4.18.0' });

    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'express-api', 'should detect express-api');
    assert.equal(result.display_name, 'Express/Fastify API');
  } finally {
    cleanupDir(dir);
  }
});

// Test 4: Detects python-web with fastapi
test('detects python-web: pyproject.toml with fastapi dep', () => {
  const dir = makeTempDir();
  try {
    writePyprojectToml(dir, ['fastapi', 'uvicorn']);

    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'python-web', 'should detect python-web');
    assert.equal(result.display_name, 'Python Web Service');
  } finally {
    cleanupDir(dir);
  }
});

// Test 5: Detects python-lib without web framework
test('detects python-lib: pyproject.toml without web framework deps', () => {
  const dir = makeTempDir();
  try {
    writePyprojectToml(dir, ['click', 'rich']);

    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'python-lib', 'should detect python-lib');
    assert.equal(result.display_name, 'Python Library/CLI');
  } finally {
    cleanupDir(dir);
  }
});

// Test 6: Returns generic for unknown projects
test('returns generic for unknown project: empty directory', () => {
  const dir = makeTempDir();
  try {
    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'generic', 'should fall back to generic');
    assert.equal(result.display_name, 'Generic');
  } finally {
    cleanupDir(dir);
  }
});

// Test 7: Prefers higher priority (nextjs-app over react-spa)
test('priority: nextjs-app wins over react-spa when both conditions met', () => {
  const dir = makeTempDir();
  try {
    // Both react and next deps present, plus next.config.js and app/
    writePackageJson(dir, { next: '^14.0.0', react: '^18.0.0' });
    touch(dir, 'next.config.js');
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });

    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'nextjs-app', 'nextjs-app (priority 100) should beat react-spa (priority 90)');
  } finally {
    cleanupDir(dir);
  }
});

// Test 8: Detects fastify as express-api
test('detects fastify as express-api', () => {
  const dir = makeTempDir();
  try {
    writePackageJson(dir, { fastify: '^4.0.0' });

    if (!detectTopology) detectTopology = require('./topology-detector.js').detectTopology;
    const result = detectTopology(dir, REGISTRY_PATH);
    assert.equal(result.id, 'express-api', 'fastify should be detected as express-api');
    assert.equal(result.display_name, 'Express/Fastify API');
  } finally {
    cleanupDir(dir);
  }
});
