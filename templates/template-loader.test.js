'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Lazy-load after test definitions (TDD: tests first)
let deepMerge;
let loadTemplate;

function getModule() {
  if (!deepMerge) {
    const mod = require('./template-loader.js');
    deepMerge = mod.deepMerge;
    loadTemplate = mod.loadTemplate;
  }
}

// Test 1: deepMerge replaces scalars
test('deepMerge replaces scalar values', () => {
  getModule();
  const base = { topology: 'generic', display_name: 'Generic' };
  const custom = { display_name: 'My Custom' };
  const result = deepMerge(base, custom);
  assert.equal(result.display_name, 'My Custom', 'scalar should be replaced');
  assert.equal(result.topology, 'generic', 'unspecified keys should be preserved');
});

// Test 2: deepMerge recursively merges objects
test('deepMerge recursively merges nested objects', () => {
  getModule();
  const base = {
    sensors: { priority: ['lint', 'typecheck'], recommended: ['coverage'] },
  };
  const custom = {
    sensors: { priority: ['lint'] },
  };
  const result = deepMerge(base, custom);
  assert.deepEqual(result.sensors.priority, ['lint'], 'custom array replaces base array');
  assert.deepEqual(result.sensors.recommended, ['coverage'], 'unspecified sub-key should be preserved');
});

// Test 3: deepMerge replaces arrays entirely (NOT append)
test('deepMerge replaces arrays entirely', () => {
  getModule();
  const base = {
    guides: { phase1: ['research A', 'research B'], phase3: ['impl A'] },
  };
  const custom = {
    guides: { phase3: ['custom impl only'] },
  };
  const result = deepMerge(base, custom);
  assert.deepEqual(result.guides.phase3, ['custom impl only'], 'custom array should completely replace base');
  assert.deepEqual(result.guides.phase1, ['research A', 'research B'], 'unspecified array key should be preserved');
  assert.equal(result.guides.phase3.length, 1, 'should NOT append — only custom items');
});

// Test 4: loadTemplate loads built-in template
test('loadTemplate loads built-in template by topology id', () => {
  getModule();
  const builtinsDir = path.join(__dirname, 'topologies');
  const result = loadTemplate('nextjs-app', builtinsDir);
  assert.equal(result.topology, 'nextjs-app', 'topology id should match');
  assert.ok(result.display_name, 'should have display_name');
  assert.ok(Array.isArray(result.sensors.priority), 'sensors.priority should be an array');
  assert.ok(Array.isArray(result.guides.phase1), 'guides.phase1 should be an array');
  assert.ok(Array.isArray(result.fitness_defaults.rules), 'fitness_defaults.rules should be an array');
});

// Test 5: loadTemplate returns generic for unknown topology
test('loadTemplate returns generic for unknown topology', () => {
  getModule();
  const builtinsDir = path.join(__dirname, 'topologies');
  const result = loadTemplate('does-not-exist', builtinsDir);
  assert.equal(result.topology, 'generic', 'unknown topology should fall back to generic');
});

// Test 6: loadTemplate merges custom template over built-in
test('loadTemplate merges custom template over built-in', () => {
  getModule();
  const builtinsDir = path.join(__dirname, 'topologies');
  const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-work-tmpl-test-'));
  try {
    // Write a partial custom override for nextjs-app
    const customOverride = {
      display_name: 'My Custom Next.js',
      guides: {
        phase3: ['always write tests first', 'use server actions only'],
      },
    };
    fs.writeFileSync(
      path.join(customDir, 'nextjs-app.json'),
      JSON.stringify(customOverride, null, 2)
    );

    const result = loadTemplate('nextjs-app', builtinsDir, customDir);
    assert.equal(result.display_name, 'My Custom Next.js', 'custom scalar should override built-in');
    assert.deepEqual(
      result.guides.phase3,
      ['always write tests first', 'use server actions only'],
      'custom array should completely replace built-in array'
    );
    // Built-in phase1 should still be present (not overridden)
    assert.ok(Array.isArray(result.guides.phase1) && result.guides.phase1.length > 0,
      'non-overridden guides.phase1 should be preserved from built-in');
    // topology id should be preserved from built-in
    assert.equal(result.topology, 'nextjs-app', 'topology id from built-in should be preserved');
  } finally {
    fs.rmSync(customDir, { recursive: true, force: true });
  }
});
