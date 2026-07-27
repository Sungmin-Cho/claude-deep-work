'use strict';

// Reference integrity for skills/ and agents/ markdown.
//
// Fence balance is checked because a `references/` split once truncated a
// fenced dashboard template mid-block: the entry kept the opening ``` and the
// first dozen template lines, the remainder moved behind a conditional
// pointer, and nothing failed. An odd fence count is the machine-detectable
// signature of that failure class.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function markdownFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'skills'));
  walk(path.join(ROOT, 'agents'));
  return out;
}

// Indented too: fences nested in a list item or a numbered step are still fences,
// and 24 of these files use them. A column-0-only match left two reference files
// (loop-exit, worktree-restore) with zero of their fences checked.
const FENCE = /^[ \t]*```/gm;

test('every skill and agent markdown file has balanced code fences', () => {
  const unbalanced = [];
  for (const file of markdownFiles()) {
    const fences = (fs.readFileSync(file, 'utf8').match(FENCE) || []).length;
    if (fences % 2 !== 0) unbalanced.push(`${path.relative(ROOT, file)} (${fences})`);
  }
  assert.deepEqual(unbalanced, [],
    `unclosed code fence — a split or edit truncated a fenced block:\n  ${unbalanced.join('\n  ')}`);
});

test('every referenced skill path resolves', () => {
  const patterns = [
    [/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9._/-]+\.(?:md|js|sh))/g, false],
    [/`(\.\.\/[A-Za-z0-9._/-]+\.md)(?:#[a-z0-9-]+)?`/g, true],
    [/\]\((\.\.?\/[A-Za-z0-9._/-]+\.md)\)/g, true],
    // Read("../shared/references/foo.md") — the double-quoted call form, used in
    // five phase skills. It resolves today but was outside the backtick pattern.
    [/Read\("(\.\.\/[A-Za-z0-9._/-]+\.md)(?:#[a-z0-9-]+)?"\)/g, true],
  ];
  const broken = [];
  let resolved = 0;
  for (const file of markdownFiles()) {
    const body = fs.readFileSync(file, 'utf8');
    for (const [re, isRelative] of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(body))) {
        const target = isRelative
          ? path.resolve(path.dirname(file), m[1])
          : path.join(ROOT, m[1]);
        if (fs.existsSync(target)) resolved += 1;
        else broken.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
      }
    }
  }
  assert.deepEqual(broken, [], `unresolvable reference:\n  ${broken.join('\n  ')}`);
  assert.ok(resolved > 0, 'sweep matched no references at all — the patterns have rotted');
});
