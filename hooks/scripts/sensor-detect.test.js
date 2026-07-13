'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSensorDetectHook } = require('./sensor-detect.js');

test('startup sensor detection writes one atomic structured cache', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sensor-hook-'));
  fs.mkdirSync(path.join(root, '.git')); fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  const result = await runSensorDetectHook({projectRoot:root});
  assert.equal(result.status, 0);
  const file = path.join(root, '.claude', '.sensor-detection-cache.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), result.plans);
  assert.deepEqual(fs.readdirSync(path.join(root, '.claude')).filter((name) => name.includes('.tmp.')), []);
});
