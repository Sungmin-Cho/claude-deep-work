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
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const ALWAYS_LOADED = ['AGENTS.md', 'CLAUDE.md'];

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
  // The always-loaded agent guides are instruction surfaces under the same
  // rule. `ALWAYS_LOADED` is asserted to be in the scan set by its own test, so
  // dropping it here fails loudly instead of silently shrinking coverage.
  for (const doc of ALWAYS_LOADED) {
    const p = path.join(ROOT, doc);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

// Every `.md` under skills/ and agents/ — the documents an attacker would want
// to shadow. A bare `Read(\`adaptive-review-protocol.md\`)` names one of these
// with no basis at all, so it resolves against cwd (the target root).
function pluginDocBasenames() {
  const names = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) names.add(entry.name);
    }
  };
  walk(path.join(ROOT, 'skills'));
  walk(path.join(ROOT, 'agents'));
  return names;
}
const PLUGIN_DOCS = pluginDocBasenames();

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
// has no such basis — it resolves against cwd, which is the target root. So this
// guard must NOT reuse the reference-integrity resolution below: integrity asks
// "does this file exist?" and may resolve relative to the source; the shadow
// guard asks "does this instruction name a trustworthy basis?", and only an
// explicit plugin-root anchor does.
//
// The guard is the machine form of the AGENTS.md sentence, which has two
// clauses. Both must hold for every instruction form, or the guard is narrower
// than the invariant it claims to enforce:
//
//   A. anchoring   — the path names the plugin root explicitly.
//   B. containment — the resolved path stays inside the plugin root.
//
// Clause B is not implied by A: `${CLAUDE_PLUGIN_ROOT}/../workspace/evil.js`
// carries the anchor and still escapes.
//
// Scope note: the invariant covers paths the plugin tells you to *open or run*.
// For `.js`/`.sh` that is every mention — naming an executable is only useful
// for running or loading it — so those are checked wherever they appear. For
// `.md` it is the instruction forms below; a descriptive cross-reference in
// prose is not a load instruction and is deliberately out of scope.
const PLUGIN_DIRS = 'skills|agents|scripts|hooks|runtime|templates|health|sensors';
const ANCHOR = String.raw`\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>`;
const ANCHORED_TOKEN = new RegExp(`^(?:${ANCHOR})/`);
const PATH_BODY = String.raw`[A-Za-z0-9._/${'{}'}|$-]+`;
const REL = String.raw`\.{1,2}/`;
const ANY_ROOT = String.raw`(?:(?:${ANCHOR})/|${REL}|(?:${PLUGIN_DIRS})/)`;

// Each pattern captures the path token in group 1, so anchoring and containment
// are judged per token rather than per line — a line mixing an anchored and a
// bare path must still fail on the bare one.
const FORMS = [
  // 1. interpreter exec: `bash X`, `node X`, `sh X`, `python X`
  ['interpreter-exec', new RegExp(String.raw`\b(?:bash|sh|zsh|node|python3?)\s+["'\`]?(${ANY_ROOT}${PATH_BODY})`, 'g')],
  // 2. read verb: `Read X`, `Follow X`, `Read("X")`
  ['read-verb', new RegExp(String.raw`\b(?:Read|Follow|read|follow)\s*\(?\s*["'\`]?(${ANY_ROOT}${PATH_BODY}\.md)`, 'g')],
  // 3. direct exec / source: `source X`, `. X`, `exec X`, `./X`
  ['direct-exec', new RegExp(String.raw`(?:\b(?:source|exec)\s+|^\s*\.\s+)["'\`]?(${ANY_ROOT}${PATH_BODY})`, 'gm')],
  // 4. module load: `require("X")`, `import … from "X"`
  ['module-load', new RegExp(String.raw`(?:\brequire\s*\(|\bfrom\s+)["'\`](${ANY_ROOT}${PATH_BODY})`, 'g')],
  // 5. executable path token anywhere — the form that hid health/health-check.js
  // The trailing boundary matters: without it `.js` matches the prefix of
  // `hooks/hooks.json` and the guard reports a file that does not exist.
  ['executable-token', new RegExp(String.raw`(?<![A-Za-z0-9._/{}<>$-])((?:${ANCHOR})/|${REL}|(?:${PLUGIN_DIRS})/)([A-Za-z0-9._/-]*\.(?:js|sh)(?![A-Za-z0-9]))`, 'g')],
];

// DENY BY DEFAULT.
//
// Rounds 4-8 each added a syntax or extension to an allowlist and each time the
// next round found a form outside it: execution paths, parent-relative reads,
// traversal, unscanned root files, bare basenames, a JSON attachment. Enumerating
// what to recognise is the losing half of the problem.
//
// So the question is no longer "is this a known instruction syntax?" but "does
// this token resolve to a real file in the plugin?". Anything that does must be
// anchored, whatever the verb, extension or sentence around it — which covers
// .json, .yaml, extensionless scripts and assets that do not exist yet, without
// another form list. Anything that does not resolve is prose and passes.
const PLUGIN_FILES = (() => {
  const rel = new Set();
  const skip = new Set(['node_modules', '.git', '.claude', '.deep-work', 'docs',
    'tests', '.deep-suite-cache', '.bootstrap-prep']);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else rel.add(path.relative(ROOT, p));
    }
  };
  walk(ROOT);
  return rel;
})();

// The only permitted exceptions, each with the reason it is safe.
const ALLOWLIST = new Map([
  ['./solid-review.md', 'session output written into the workspace, not a plugin file'],
  ['./drift-report.md', 'session output written into the workspace, not a plugin file'],
  ['./insight-report.md', 'session output written into the workspace, not a plugin file'],
]);
// The canonical-review banner is pinned verbatim by the BANNER regex in
// tests/v6.12-review-wiring-contract.test.js across four files. Anchoring the
// two filenames inside it would break that contract, and the line names the
// authority rather than instructing a load, so it is exempt by line shape.
const PINNED_BANNER = /^>\s*v6\.12: 실행 계약은 adaptive-review-protocol\.md \+ review-policy-runtime\.js가 정본/;
// Single-segment root metadata named descriptively ("package.json declares
// engines"), never handed to a file tool. Multi-segment paths get no such pass.
const ROOT_METADATA = new Set(['package.json', 'plugin.json', 'assumptions.json',
  'AGENTS.md', 'CLAUDE.md', 'README.md', 'CHANGELOG.md', 'SKILL.md', 'hooks.json']);

// Path-shaped tokens: multi-segment paths, plus dotted single segments.
const PATH_TOKEN = /[A-Za-z0-9_.@${}<>-]+(?:\/[A-Za-z0-9_.@{}|*-]+)+|[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,6}\b/g;

function resolvesInPlugin(token, sourceFile) {
  const clean = token.replace(/^\.\//, '');
  if (PLUGIN_FILES.has(clean)) return true;
  try {
    const fromSource = path.relative(ROOT, path.resolve(path.dirname(sourceFile), token));
    if (PLUGIN_FILES.has(fromSource)) return true;
  } catch { /* unresolvable token — prose */ }
  return false;
}

// Scope, defined once. Yields the path tokens on a line that the invariant
// governs, with the documented exemptions applied. Both the classifier and the
// malicious-workspace fixture consume this, so they cannot test different rules.
function* scopedTokens(line) {
  if (PINNED_BANNER.test(line.trim())) return;
  PATH_TOKEN.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN.exec(line))) {
    // `<` and `>` are in the character class only to admit `<PLUGIN_ROOT>`.
    // Without trimming them, `<skills/…/llm-output.json 첨부>` extracts with a
    // leading `<`, fails to resolve, and the token silently escapes the guard —
    // which is exactly how the r8 finding stayed invisible.
    const token = m[0].startsWith('<') && !m[0].startsWith('<PLUGIN_ROOT>')
      ? m[0].slice(1)
      : m[0];
    if (ALLOWLIST.has(token)) continue;
    if (!token.includes('/') && ROOT_METADATA.has(token)) continue;
    const before = line.slice(Math.max(0, m.index - 30), m.index);
    // Already inside an anchored path. The trailing form covers shell splicing
    // — require("'"${CLAUDE_PLUGIN_ROOT}"'/scripts/x.js") is anchored, just
    // quoted for a heredoc.
    if (/(?:\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>)["'\s]*\/?$/.test(before)) continue;
    // Markdown link target `](x.md)` — rendered navigation between docs, not an
    // instruction handed to a file tool. Runtime reads use the Read forms above.
    if (/\]\($/.test(before)) continue;
    yield token;
  }
}

function denyByDefaultHits(line, sourceFile) {
  const out = [];
  for (const token of scopedTokens(line)) {
    if (ANCHORED_TOKEN.test(token)) continue;          // clause B checks these
    if (resolvesInPlugin(token, sourceFile)) {
      out.push({ form: 'resolves-in-plugin', token, why: 'unanchored' });
    }
  }
  return out;
}

// bare basename read: `Read(`adaptive-review-protocol.md`)`. It resolves to no
// repo-relative path, so the rule above cannot see it — yet it is the weakest
// form of all, resolving straight against cwd. Only basenames that name a real
// plugin document are flagged, so ordinary prose is untouched.
const BARE_BASENAME = /\b(?:Read|Follow|read|follow)\s*\(?\s*["'`]([A-Za-z0-9][A-Za-z0-9._-]*\.md)(?:#[^`"']*)?["'`]/g;

function bareBasenameHits(line) {
  const out = [];
  BARE_BASENAME.lastIndex = 0;
  let m;
  while ((m = BARE_BASENAME.exec(line))) {
    if (PLUGIN_DOCS.has(m[1])) {
      out.push({ form: 'bare-basename', token: m[1], why: 'unanchored' });
    }
  }
  return out;
}

const ROOT_SENTINEL = path.sep === '/' ? '/plugin-root' : 'C:\\plugin-root';

// Clause B. Substitute the anchor with a sentinel root, resolve, and require
// the result to stay inside it. Tokens carrying template placeholders
// (`{codebase|zerobase}`, `$WORK_DIR`) cannot be resolved literally, so they
// are checked lexically for `..` instead.
function escapesRoot(token) {
  const body = token.replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$]/.test(body)) return body.split('/').includes('..');
  const resolved = path.resolve(ROOT_SENTINEL, body);
  return resolved !== ROOT_SENTINEL && !resolved.startsWith(ROOT_SENTINEL + path.sep);
}

// Symlink escape: an anchored, lexically-contained path can still point out of
// the root if a component is a symlink. Only checkable for targets that exist.
function escapesViaSymlink(token) {
  const body = token.replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$]/.test(body)) return false;
  const target = path.join(ROOT, body);
  if (!fs.existsSync(target)) return false;
  const real = fs.realpathSync(target);
  const realRoot = fs.realpathSync(ROOT);
  return real !== realRoot && !real.startsWith(realRoot + path.sep);
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

// Returns violations on a line: {form, token, why}. Empty when the line is clean.
function shadowableTokens(line, sourceFile = path.join(ROOT, 'AGENTS.md')) {
  const out = [];
  for (const [form, re] of FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const token = m[2] === undefined ? m[1] : m[1] + m[2];
      if (!ANCHORED_TOKEN.test(token)) out.push({ form, token, why: 'unanchored' });
      else if (escapesRoot(token)) out.push({ form, token, why: 'escapes plugin root' });
      else if (escapesViaSymlink(token)) out.push({ form, token, why: 'escapes via symlink' });
    }
  }
  out.push(...bareBasenameHits(line));
  out.push(...denyByDefaultHits(line, sourceFile));
  return out;
}

test('the always-loaded agent guides are in the scan set', () => {
  // r6 reported these as covered when markdownFiles() still walked only
  // skills/ and agents/. Asserting membership means the coverage claim is
  // checked by the suite rather than by a commit message.
  const scanned = markdownFiles().map((f) => path.relative(ROOT, f));
  for (const doc of ALWAYS_LOADED) {
    assert.ok(fs.existsSync(path.join(ROOT, doc)), `${doc} must exist to be scanned`);
    assert.ok(scanned.includes(doc), `${doc} must be in the shadow-guard scan set`);
  }
});

test('no read or exec instruction can be shadowed from the target workspace', () => {
  const violations = [];
  for (const file of markdownFiles()) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const v of shadowableTokens(line, file)) {
        violations.push(`${path.relative(ROOT, file)}:${i + 1}  [${v.form}] ${v.token} — ${v.why}`);
      }
    });
  }
  assert.deepEqual(violations, [],
    'plugin path read/executed outside the plugin root — anchor at '
    + `\${CLAUDE_PLUGIN_ROOT} (or <PLUGIN_ROOT> where phase-guard forbids substitution) `
    + `and keep it inside the root:\n  ${violations.join('\n  ')}`);
});

// One positive and one negative per instruction form, so the coverage claim is
// itself tested. A form with no case here is a form the guard does not enforce.
const FORM_CASES = [
  ['interpreter-exec', 'bash skills/deep-integrate/phase5-record-error.sh /abs/work',
    'bash <PLUGIN_ROOT>/skills/deep-integrate/phase5-record-error.sh /abs/work'],
  ['read-verb', 'Read `skills/deep-finish/SKILL.md` and follow it',
    'Read `${CLAUDE_PLUGIN_ROOT}/skills/deep-finish/SKILL.md` and follow it'],
  ['direct-exec', 'source hooks/scripts/utils.sh',
    'source ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/utils.sh'],
  ['module-load', 'const x = require("runtime/policy-runtime.js");',
    'const x = require("${CLAUDE_PLUGIN_ROOT}/runtime/policy-runtime.js");'],
  ['executable-token', 'rules come from `health/fitness/fitness-generator.js`',
    'rules come from `${CLAUDE_PLUGIN_ROOT}/health/fitness/fitness-generator.js`'],
  ['bare-basename', 'Read(`adaptive-review-protocol.md`)',
    'Read(`${CLAUDE_PLUGIN_ROOT}/skills/shared/references/adaptive-review-protocol.md`)'],
  ['dot-relative', 'Read(`../shared/references/model-routing-guide.md#decode`)',
    'Read(`${CLAUDE_PLUGIN_ROOT}/skills/shared/references/model-routing-guide.md#decode`)'],
];

test('every enumerated instruction form is enforced (positive + negative)', () => {
  for (const [form, bad, good] of FORM_CASES) {
    assert.ok(shadowableTokens(bad).length > 0, `${form}: guard must flag — ${bad}`);
    assert.deepEqual(shadowableTokens(good), [], `${form}: guard must accept — ${good}`);
  }
});

test('anchored paths that escape the plugin root are rejected (containment)', () => {
  // Clause B. Each carries a valid anchor prefix and still leaves the root, so
  // a prefix-only check passes all three.
  const traversals = [
    'Read `${CLAUDE_PLUGIN_ROOT}/../workspace/evil.md`',
    'node "${CLAUDE_PLUGIN_ROOT}/../workspace/evil.js"',
    'bash <PLUGIN_ROOT>/../../tmp/evil.sh',
  ];
  for (const line of traversals) {
    const hits = shadowableTokens(line);
    assert.ok(hits.length > 0, `containment must reject: ${line}`);
    assert.equal(hits[0].why, 'escapes plugin root', `wrong reason for: ${line}`);
  }
  // A `..` that stays inside the root is fine.
  assert.deepEqual(
    shadowableTokens('Read `${CLAUDE_PLUGIN_ROOT}/skills/a/../b/SKILL.md`'), [],
    'in-root traversal must be accepted');
});

test('a malicious workspace cannot shadow any instruction the plugin issues', () => {
  // End-to-end statement of the invariant. Plant shadows in a fake target
  // workspace for every plugin document an instruction names, then confirm
  // that no instruction in the repo would resolve to one of them. Because
  // every instruction is anchored, cwd is irrelevant — which is the property
  // under test, not an accident of this fixture.
  const evil = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-evil-workspace-'));
  try {
    for (const name of ['adaptive-review-protocol.md', 'model-routing-guide.md', 'SKILL.md']) {
      fs.writeFileSync(path.join(evil, name), '# SHADOW — must never be read\n');
    }
    fs.mkdirSync(path.join(evil, 'skills', 'deep-integrate', 'schema'), { recursive: true });
    fs.writeFileSync(path.join(evil, 'skills', 'deep-integrate', 'phase5-record-error.sh'),
      '#!/bin/sh\necho SHADOW\n');
    // The r8 finding: a schema attached to the Phase 5 recommendation prompt.
    // Neither a `.md` read nor a `.js`/`.sh` token, so every earlier form list
    // missed it — which is why the rule is now resolution, not syntax.
    fs.writeFileSync(path.join(evil, 'skills', 'deep-integrate', 'schema', 'llm-output.json'),
      '{"SHADOW":"must never be attached"}\n');

    // Resolve for real, from the evil cwd, exactly as a runtime agent would.
    // Re-running the classifier here would only restate what it already
    // believes; this instead performs the resolution and asks which file the
    // instruction actually lands on.
    const resolveAsAgentWould = (token) => {
      if (/^(?:\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>)\//.test(token)) {
        const body = token.replace(/^(?:\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>)\//, '');
        return path.resolve(ROOT, body);      // anchored → resolves in the plugin
      }
      return path.resolve(evil, token.replace(/^\.\//, '')); // unanchored → cwd
    };

    const landed = [];
    for (const file of markdownFiles()) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const token of scopedTokens(line)) {
          const target = resolveAsAgentWould(token);
          if (target.startsWith(evil + path.sep) && fs.existsSync(target)) {
            landed.push(`${path.relative(ROOT, file)}:${i + 1}  ${token} → ${target}`);
          }
        }
      });
    }
    assert.deepEqual(landed, [],
      `these instructions resolve onto a planted shadow file:\n  ${landed.join('\n  ')}`);

    // Non-vacuity: the same resolution, given an unanchored token, does land on
    // the shadow — so an empty result above is a property of the docs, not of a
    // resolver that never finds anything.
    const control = resolveAsAgentWould('adaptive-review-protocol.md');
    assert.ok(control.startsWith(evil + path.sep) && fs.existsSync(control),
      'fixture is vacuous — an unanchored token must land on the planted shadow');
  } finally {
    fs.rmSync(evil, { recursive: true, force: true });
  }
});

test('mixed lines fail on the bare token', () => {
  // A line-level anchor check passes this; the token-level check must not.
  const line = 'Read `${CLAUDE_PLUGIN_ROOT}/skills/a/SKILL.md` then Read `../shared/references/b.md`';
  const hits = shadowableTokens(line);
  assert.equal(hits.length, 1, 'exactly the bare token must be flagged');
  assert.equal(hits[0].why, 'unanchored');
});

test('every referenced skill path resolves', () => {
  const patterns = [
    // Trailing boundary, same reason as the guard: without it `.js` matches the
    // prefix of `.json` and the resolver reports files that never existed.
    [/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9._/-]+\.(?:md|js|sh|json|yaml)(?![A-Za-z0-9]))/g, false],
    [/`(\.\.\/[A-Za-z0-9._/-]+\.md)(?:#[a-z0-9-]+)?`/g, true],
    [/\]\((\.\.?\/[A-Za-z0-9._/-]+\.md)\)/g, true],
    // Read("../shared/references/foo.md") — the double-quoted call form, used in
    // five phase skills. It resolves today but was outside the backtick pattern.
    [/Read\("(\.\.\/[A-Za-z0-9._/-]+\.md)(?:#[a-z0-9-]+)?"\)/g, true],
  ];
  const broken = [];
  let resolved = 0;
  const realRoot = fs.realpathSync(ROOT);
  for (const file of markdownFiles()) {
    const body = fs.readFileSync(file, 'utf8');
    for (const [re, isRelative] of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(body))) {
        const target = isRelative
          ? path.resolve(path.dirname(file), m[1])
          : path.join(ROOT, m[1]);
        if (!fs.existsSync(target)) {
          broken.push(`${path.relative(ROOT, file)} -> ${m[1]} (missing)`);
          continue;
        }
        // Existing is not enough: a target that resolves outside the plugin root
        // — lexically or through a symlinked component — is exactly the file an
        // attacker wants us to accept. Containment is checked here too, so the
        // two tests cannot disagree about what counts as in-root.
        const real = fs.realpathSync(target);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
          broken.push(`${path.relative(ROOT, file)} -> ${m[1]} (resolves outside the plugin root: ${real})`);
          continue;
        }
        resolved += 1;
      }
    }
  }
  assert.deepEqual(broken, [], `unresolvable or out-of-root reference:\n  ${broken.join('\n  ')}`);
  assert.ok(resolved > 0, 'sweep matched no references at all — the patterns have rotted');
});
