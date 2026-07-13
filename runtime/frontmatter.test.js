'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseFrontmatter,
  updateFrontmatterText,
  readFrontmatter,
  getFrontmatterField,
  getFrontmatterList,
  updateFrontmatter,
} = require('./frontmatter.js');
const { issueProjectStateCapability } = require('./platform.js');

test('frontmatter parser reports fields, body, newline, and byte ranges', () => {
  const text = '---\ncurrent_phase: plan\ntags: [one, "two words"]\nenabled: true\n---\nbody\n';
  const got = parseFrontmatter(text);
  assert.deepEqual(got.fields, {
    current_phase:'plan', tags:['one', 'two words'], enabled:true,
  });
  assert.equal(got.body, 'body\n');
  assert.equal(got.newline, '\n');
  assert.equal(text.slice(got.start, got.end), '---\ncurrent_phase: plan\ntags: [one, "two words"]\nenabled: true\n---\n');
});

test('CRLF update preserves newline style, body, comments, and unrelated fields', () => {
  const before = '---\r\n# keep\r\ncurrent_phase: plan\r\nwork_dir: ".deep-work/한 글"\r\n---\r\nbody\r\n';
  const after = updateFrontmatterText(before, {current_phase:'implement'});
  assert.match(after, /current_phase: implement\r\n/);
  assert.match(after, /work_dir: "\.deep-work\/한 글"\r\n/);
  assert.match(after, /# keep\r\n/);
  assert.equal(after.endsWith('body\r\n'), true);
  assert.equal(after.replaceAll('\r\n', '').includes('\n'), false);
});

test('update adds and deletes scalar and list fields deterministically', () => {
  const before = '---\na: 1\nb: old\n---\n';
  const after = updateFrontmatterText(before, {a:2, b:undefined, tags:['x','two words']});
  assert.equal(after, '---\na: 2\ntags: [x, "two words"]\n---\n');
  assert.deepEqual(parseFrontmatter(after).fields, {a:2, tags:['x','two words']});
});

test('text without frontmatter receives a deterministic header', () => {
  assert.equal(updateFrontmatterText('body\n', {phase:'plan'}), '---\nphase: plan\n---\nbody\n');
  assert.deepEqual(parseFrontmatter('body\n'), {
    fields:{}, body:'body\n', newline:'\n', start:0, end:0,
  });
});

test('file frontmatter APIs require and revalidate a project-state capability', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-frontmatter-'));
  try {
    const claude = path.join(root, '.claude');
    fs.mkdirSync(claude);
    const file = path.join(claude, 'state.md');
    fs.writeFileSync(file, '---\nphase: plan\ntags: [a, b]\n---\nbody\n');
    const cap = issueProjectStateCapability(root, file, {role:'frontmatter'});
    assert.equal(readFrontmatter(cap).fields.phase, 'plan');
    assert.equal(getFrontmatterField(cap, 'phase'), 'plan');
    assert.deepEqual(getFrontmatterList(cap, 'tags'), ['a','b']);
    updateFrontmatter(cap, {phase:'implement'});
    assert.equal(getFrontmatterField(cap, 'phase'), 'implement');
    assert.throws(() => readFrontmatter(file), /path-capability/);
  } finally {
    fs.rmSync(root, {recursive:true, force:true});
  }
});

test('malformed and duplicate frontmatter fails closed', () => {
  assert.throws(() => parseFrontmatter('---\na: 1\na: 2\n---\n'), /frontmatter-duplicate/);
  assert.throws(() => parseFrontmatter('---\na: [unterminated\n---\n'), /frontmatter-invalid/);
  assert.throws(() => parseFrontmatter('---\na: 1\nbody\n'), /frontmatter-unclosed/);
});
