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

// Workspace-shadow guard.
//
// A bare `bash skills/deep-integrate/foo.sh` or `Read skills/x/SKILL.md`
// resolves against the *target workspace*, not the plugin. A repository under
// analysis can put a file at that path and have it read as instructions or run
// with the caller's Bash permissions — and phase-guard.sh normalises relative
// helper paths against PROJECT_ROOT, so the shadowed location is one it allows.
//
// Parent-relative forms (`../shared/references/x.md`) are just as shadowable.
// A markdown link resolves against the source file, but a runtime `Read` call
// has no such basis — it resolves against cwd, which is the target root. That
// is why this guard must NOT reuse the reference-integrity resolution below:
// the two ask different questions. Reference integrity asks "does this file
// exist?" and may legitimately resolve relative to the source. The shadow guard
// asks "does this instruction name a trustworthy basis?" — and only an explicit
// plugin-root anchor does.
const PLUGIN_DIRS = 'skills|agents|scripts|hooks|runtime|templates|health|sensors';
const ANCHOR = String.raw`\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>`;
const ANCHORED_TOKEN = new RegExp(`^(?:${ANCHOR})/`);

// Each pattern captures the *path token* in group 1 so anchoring is judged
// per token, not per line — a line mixing an anchored and a bare path must
// still fail on the bare one.
const PATH_BODY = String.raw`[A-Za-z0-9._/${'{}'}$-]+`;
const SHADOWABLE = [
  // exec: `bash skills/…`, `node scripts/…`, `sh ../shared/…`, `bash ./x/y.sh`
  new RegExp(String.raw`\b(?:bash|sh|node)\s+["'\`]?((?:\.{1,2}/|(?:${PLUGIN_DIRS})/)${PATH_BODY})`, 'g'),
  // read: `Read skills/…`, `Follow ../shared/…`, `Read("./x.md")`
  new RegExp(String.raw`\b(?:Read|Follow|read|follow)\s*\(?\s*["'\`]?((?:\.{1,2}/|(?:${PLUGIN_DIRS})/)${PATH_BODY}\.md)`, 'g'),
];

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

// Returns the unanchored path tokens on a line (empty when the line is clean).
function shadowableTokens(line) {
  const out = [];
  for (const re of SHADOWABLE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      if (!ANCHORED_TOKEN.test(m[1])) out.push(m[1]);
    }
  }
  return out;
}

test('no read or exec instruction can be shadowed from the target workspace', () => {
  const unanchored = [];
  for (const file of markdownFiles()) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const token of shadowableTokens(line)) {
        unanchored.push(`${path.relative(ROOT, file)}:${i + 1}  ${token}`);
      }
    });
  }
  assert.deepEqual(unanchored, [],
    'plugin file read/executed by a workspace-relative path — anchor it at '
    + `\${CLAUDE_PLUGIN_ROOT} (or <PLUGIN_ROOT> where phase-guard forbids substitution):\n  ${unanchored.join('\n  ')}`);
});

test('the workspace-shadow guard fires on bare, dot-relative and mixed lines', () => {
  // Proves the matcher is live rather than vacuously passing.
  const mustFlag = [
    'bash skills/deep-integrate/phase5-record-error.sh /abs/work',
    'Read `skills/deep-finish/SKILL.md` and follow it',
    'node scripts/validate-spec-contract.js --spec x',
    'Read(`../shared/references/model-routing-guide.md#decode`)',
    'Read("./local-notes.md")',
    'bash ../shared/helpers/run.sh',
    // Mixed: one anchored token and one bare token on the same line. A
    // line-level anchor check would pass this; the token-level check must not.
    'Read `${CLAUDE_PLUGIN_ROOT}/skills/a/SKILL.md` then Read `../shared/references/b.md`',
  ];
  for (const line of mustFlag) {
    assert.ok(shadowableTokens(line).length > 0, `guard must flag: ${line}`);
  }

  const mustPass = [
    'bash <PLUGIN_ROOT>/skills/deep-integrate/phase5-record-error.sh /abs/work',
    'Read `${CLAUDE_PLUGIN_ROOT}/skills/deep-finish/SKILL.md` and follow it',
    'Read(`${CLAUDE_PLUGIN_ROOT}/skills/shared/references/model-routing-guide.md#decode`)',
  ];
  for (const line of mustPass) {
    assert.deepEqual(shadowableTokens(line), [], `guard must accept: ${line}`);
  }
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
