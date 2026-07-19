'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectCodebaseSignals, classifyRepoScale, SCALE_SMALL_MAX, SCALE_MEDIUM_MAX,
} = require('./model-routing-runtime.js');

function makeFixture(fileCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-sig-'));
  fs.mkdirSync(path.join(dir, 'src'));
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(dir, 'src', `f${i}.js`), 'const a = 1;\nconst b = 2;\n');
  }
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'a.test.js'), 'test();\n');
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { x: '1' }, devDependencies: { y: '1' } }));
  return dir;
}

test('fs walk 기반 신호 수집 (비-git 픽스처)', () => {
  const dir = makeFixture(10);
  const s = collectCodebaseSignals(dir, { gitLsFiles: () => null }); // git 경로 강제 차단
  assert.strictEqual(typeof s.tracked_files, 'number');
  assert.ok(s.tracked_files >= 11); // src 10 + tests 1 (+ package.json은 소스 외)
  assert.ok(s.loc_estimate > 0);
  assert.ok(s.languages >= 1);
  assert.strictEqual(s.has_tests, true);
  assert.strictEqual(s.deps_count, 2);
  assert.deepStrictEqual(s.errors, []);
});

test('git ls-files 성공 시 그 count를 사용', () => {
  const dir = makeFixture(3);
  const s = collectCodebaseSignals(dir, { gitLsFiles: () => ['a.js', 'b.js', 'c.py', 'd.md'] });
  assert.strictEqual(s.tracked_files, 4);
});

test('수집 실패 시 null + errors 기록 (throw 금지)', () => {
  const s = collectCodebaseSignals('/nonexistent-path-xyz', { gitLsFiles: () => null });
  assert.strictEqual(s.tracked_files, null);
  assert.ok(s.errors.length >= 1);
});

test('규모 분류: tracked_files 우선, null→medium (리뷰 Low-7)', () => {
  assert.strictEqual(classifyRepoScale({ tracked_files: SCALE_SMALL_MAX - 1 }), 'small');
  assert.strictEqual(classifyRepoScale({ tracked_files: SCALE_SMALL_MAX }), 'medium');
  assert.strictEqual(classifyRepoScale({ tracked_files: SCALE_MEDIUM_MAX }), 'large');
  assert.strictEqual(classifyRepoScale({ tracked_files: null }), 'medium');
  assert.strictEqual(classifyRepoScale({}), 'medium');
});
