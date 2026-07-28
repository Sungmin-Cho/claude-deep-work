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
//
// SEPARATORS. Windows is a supported host — v7.0.0 exists to bootstrap there
// without Git Bash — so `scripts\deep-work-runtime.js` names the same file as
// `scripts/deep-work-runtime.js`. A matcher that knows only `/` lets the whole
// deny-by-default invariant be bypassed with one character, which is what review
// measured: the slash form produced seven failures and the backslash form none.
//
// The fix is not to teach each matcher a second shape. That leaves the mixed
// form (`scripts\lib/x.js`) open and re-opens on the next rule added — the same
// enumeration trap rounds 4-8 kept falling into. Instead every extracted token is
// normalised once, at tokenisation, so deny-by-default, the FORMS, bare-basename
// and containment all judge one canonical spelling without being taught anything.
// Runs of separators collapse, so an escaped `scripts\\x.js` in a string literal
// normalises to the same path. Over-normalising is the safe direction here: a
// token only matters once it resolves to a real file in the plugin, and prose
// carrying a stray backslash resolves to nothing.
//
// normalizePath is also applied at the leaves — resolvesInPlugin, escapesRoot,
// escapesViaSymlink — where it is redundant today, because both tokenisers
// canonicalise before calling them. That redundancy is deliberate and is why
// mutating those three call sites alone fails nothing: they are not the fix,
// they are the thing that keeps a future caller from having to remember it.
const SEP = String.raw`[\\/]`;
const normalizePath = (token) => token.replace(/[\\/]+/g, '/');

const PLUGIN_DIRS = 'skills|agents|scripts|hooks|runtime|templates|health|sensors';
const ANCHOR = String.raw`\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>`;
const ANCHORED_TOKEN = new RegExp(`^(?:${ANCHOR})/`);
const PATH_BODY = String.raw`[A-Za-z0-9._/\\${'{}'}|$-]+`;
const REL = String.raw`\.{1,2}${SEP}`;
const ANY_ROOT = String.raw`(?:(?:${ANCHOR})${SEP}|${REL}|(?:${PLUGIN_DIRS})${SEP})`;

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
  ['executable-token', new RegExp(String.raw`(?<![A-Za-z0-9._/\\{}<>$-])((?:${ANCHOR})${SEP}|${REL}|(?:${PLUGIN_DIRS})${SEP})([A-Za-z0-9._/\\-]*\.(?:js|sh)(?![A-Za-z0-9]))`, 'g')],
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

// Repo-relative key, in the one spelling both sides of every PLUGIN_FILES
// comparison must use. `path.relative` returns the *host's* separator, so on
// Windows it hands back `scripts\lib\x.js` while the token being looked up has
// already been normalised to `scripts/lib/x.js` — the two never meet and the
// membership test misses every time. Normalising the token but not the key
// normalises one side of a comparison, which is not normalising at all.
// `relative` is injectable so the Windows spelling can be exercised from a POSIX
// CI run — path.win32.relative is the same implementation that host uses. It
// defaults to the host's and disables nothing, so it is a seam for emulation
// rather than a switch that can turn the rule off.
const repoKey = (from, to, relative = path.relative) => normalizePath(relative(from, to));

const PLUGIN_FILES = (() => {
  const rel = new Set();
  const skip = new Set(['node_modules', '.git', '.claude', '.deep-work', 'docs',
    'tests', '.deep-suite-cache', '.bootstrap-prep']);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else rel.add(repoKey(ROOT, p));
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
// The separator element is `+`, not a single character: `skills\\deep-finish\\x`
// is how the path appears inside a string literal, and a one-character element
// cannot span it — the match dies at the second backslash, the second
// alternative then extracts the bare basename, and ROOT_METADATA exempts it. So
// the escaped spelling of a plugin path was invisible to deny-by-default even
// after the matchers learned `\`. Collapsing the run here is what makes
// normalizePath's own run-collapsing reachable.
const PATH_TOKEN = /[A-Za-z0-9_.@${}<>-]+(?:[\\/]+[A-Za-z0-9_.@{}|*-]+)+|[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,6}\b/g;

function resolvesInPlugin(token, sourceFile) {
  const clean = normalizePath(token).replace(/^\.\//, '');
  if (PLUGIN_FILES.has(clean)) return true;
  try {
    const fromSource = repoKey(ROOT, path.resolve(path.dirname(sourceFile), normalizePath(token)));
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
    const raw = m[0].startsWith('<') && !m[0].startsWith('<PLUGIN_ROOT>')
      ? m[0].slice(1)
      : m[0];
    // Normalise once, here, so every consumer of scopedTokens — the classifier,
    // the ALLOWLIST and ROOT_METADATA lookups, and the malicious-workspace
    // fixture alike — judges the same string. Doing it any later means the
    // basename exemption below sees `SKILL.md` where the whole token was
    // `skills\deep-finish\SKILL.md`, which is precisely the hole.
    const token = normalizePath(raw);
    if (ALLOWLIST.has(token)) continue;
    if (!token.includes('/') && ROOT_METADATA.has(token)) continue;
    const before = line.slice(Math.max(0, m.index - 30), m.index);
    // Already inside an anchored path, written with either separator. The
    // trailing form covers shell splicing —
    // require("'"${CLAUDE_PLUGIN_ROOT}"'/scripts/x.js") is anchored, just
    // quoted for a heredoc.
    if (/(?:\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>)["'\s]*[\\/]?$/.test(before)) continue;
    // Markdown link target `](x.md)` — rendered navigation between docs, not an
    // instruction handed to a file tool. Runtime reads use the Read forms above.
    if (/\]\($/.test(before)) continue;
    yield token;
  }
}

// `pluginRequire("runtime/x.js")` is anchored *programmatically*: the helper
// resolves against a realpath'd process.env.CLAUDE_PLUGIN_ROOT and throws if the
// result leaves the root, which is stronger than a text anchor because it cannot
// be defeated by a quoting context. It is only accepted where the file actually
// defines that helper with its containment check — otherwise the name would
// become a magic word that turns the guard off.
const PLUGIN_REQUIRE_CALL = /\bpluginRequire\s*\(\s*["'`]([^"'`]+)["'`]/g;
function definesPluginRequire(body) {
  return /const\s+pluginRequire\s*=/.test(body)
    && /realpathSync\s*\(\s*process\.env\.CLAUDE_PLUGIN_ROOT/.test(body)
    && /escapes root/.test(body);
}

function denyByDefaultHits(line, sourceFile, body) {
  const programmatic = new Set();
  if (body && definesPluginRequire(body)) {
    PLUGIN_REQUIRE_CALL.lastIndex = 0;
    let pm;
    while ((pm = PLUGIN_REQUIRE_CALL.exec(line))) programmatic.add(pm[1]);
  }
  const out = [];
  for (const token of scopedTokens(line)) {
    if (ANCHORED_TOKEN.test(token)) continue;          // clause B checks these
    if (programmatic.has(token)) continue;             // anchored by the helper
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

// EXPANSION SAFETY.
//
// An anchor is only an anchor if the shell actually expands it. Inside a
// single-quoted string `${CLAUDE_PLUGIN_ROOT}` survives as a literal, and the
// consumer then reads a path *named* `${CLAUDE_PLUGIN_ROOT}/...` relative to the
// workspace — so anchoring a path into a single-quoted JSON payload converts a
// fixed reference into a shadowable one. That regression was introduced by this
// PR's own anchoring pass, which is why it is checked mechanically.
//
// Quote state must be tracked as a small machine, not by counting quotes: in
// `node -e "…require('fs')…"` the single quotes are JS-level, sit inside a
// double-quoted shell word, and expansion still happens. A naive counter calls
// that broken and is wrong twice over four real cases.
function expansionState(line, index) {
  let state = 'normal';
  for (let k = 0; k < index; k += 1) {
    const c = line[k];
    // POSIX sh does not treat a backslash as an escape inside single quotes:
    // `'C:\tmp\'` is the literal `C:\tmp\` and the quote closes. Honouring it
    // there flips the parity, so a line ending a Windows path in `\` before an
    // anchor reported `normal` and the non-expanding anchor went unflagged.
    //
    // Consume the escaped character rather than looking back at the previous
    // one. Looking back fails on `"C:\tmp\\"`: the second backslash of the pair
    // is itself treated as escaped, so the closing quote also looks escaped and
    // the double-quote state never ends — a following single-quoted anchor never
    // reaches `single` and goes unflagged. Both spellings are forms this branch
    // legitimised, and the guard's own fixtures pin `"C:\\Users\\me\\notes.md"`
    // as legal, so the pair form is not hypothetical.
    if (state !== 'single' && c === '\\') { k += 1; continue; }
    if (state === 'normal') {
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
    } else if (state === 'single') {
      if (c === "'") state = 'normal';
    } else if (c === '"') state = 'normal';
  }
  return state;
}

// Only a line that is actually a command can suffer this; prose containing an
// apostrophe is not a shell word.
const SHELL_COMMAND = /\b(?:echo|printf|cat|node|bash|sh|zsh|jq|awk|sed|curl|export)\b/;

// A command is written inside an inline-code span in these documents; prose is
// written outside one. So an anchor inside backticks is in a command context
// whatever the verb, and an apostrophe in "the plugin's root" is outside one and
// cannot open a quote. Judging context structurally instead of by a command-name
// list is what covers `cp`, `mv`, `install`, `rsync` and any future wrapper —
// enumeration left every one of them unflagged, which is a missed detection, not
// a blocked edit: the anchor stays literal and resolves against the workspace.
// Yields [start, end) offsets of each inline-code span on the line.
function inlineCodeSpans(line) {
  const spans = [];
  const re = /(`+)([^`]|[^`][\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(line))) spans.push([m.index + m[1].length, m.index + m[0].length - m[1].length]);
  return spans;
}


// `${...}` only interpolates in a JS *template literal*. In a quoted string it
// is inert, and a specifier that does not start with ./ ../ or / is a bare
// package specifier — so `require("${CLAUDE_PLUGIN_ROOT}/runtime/x.js")` sends
// Node looking in `node_modules/${CLAUDE_PLUGIN_ROOT}/runtime/x.js` inside the
// *workspace*. Planting that module is arbitrary code execution, which makes
// this the most severe form of the expansion axis rather than a broken path.
// Backticks included deliberately. A template literal interpolates a *local
// variable* of that name, not the environment — an undefined one is a
// ReferenceError, and a defined one is attacker-influenced. Excluding backticks
// is how the r10 matcher missed the r8 regression at orchestrator:37.
// `from` alone is not enough once backticks are in play: markdown inline code
// makes "rules come from `${CLAUDE_PLUGIN_ROOT}/health/…`" look like an import.
// So `from` must be preceded by `import` on the same line.
const JS_SPECIFIER = /(?:\brequire\s*\(|\bimport\s*\(|\bimport\b[^;\n]*?\bfrom\s+)\s*(["'`])((?:(?!\1).)*\$\{[^}]+\}(?:(?!\1).)*)\1/g;

// JSON and YAML have no interpolation at all: a `${...}` in a value is data.
const JSON_YAML_VALUE = /"[A-Za-z_][A-Za-z0-9_]*"\s*:\s*"[^"]*\$\{CLAUDE_PLUGIN_ROOT\}[^"]*"|^\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*["']?[^"'\n]*\$\{CLAUDE_PLUGIN_ROOT\}/;

// The expansion axis, generalised by language. Each context answers one
// question: given where this anchor sits, does anything expand it?
function nonExpandingAnchors(line) {
  const out = [];
  const flag = (why) => out.push({ form: 'non-expanding-anchor', token: '${CLAUDE_PLUGIN_ROOT}', why });

  // 1. shell — single quotes and quoted heredocs leave it literal
  let i = line.indexOf('${CLAUDE_PLUGIN_ROOT}');
  while (i !== -1) {
    const __span = inlineCodeSpans(line).find(([s, e]) => i >= s && i < e);
      const __literal = __span
        ? expansionState(line.slice(__span[0], __span[1]), i - __span[0]) === 'single'
        : SHELL_COMMAND.test(line) && expansionState(line, i) === 'single';
      if (__literal) {
      flag('single-quoted shell — literal, so the path resolves against the workspace');
    }
    i = line.indexOf('${CLAUDE_PLUGIN_ROOT}', i + 1);
  }

  // 2. JS/TS quoted string used as a module specifier — bare specifier → node_modules
  JS_SPECIFIER.lastIndex = 0;
  let m;
  while ((m = JS_SPECIFIER.exec(line))) {
    if (m[1] === "`") {
      flag("JS template literal — interpolates a local variable of that name, not the "
        + "environment; undefined is a ReferenceError and a defined one is attacker-influenced");
    } else {
      flag(`JS ${m[1] === '"' ? 'double' : 'single'}-quoted specifier — not interpolated, `
        + 'so Node resolves it as a bare package name under the workspace node_modules');
    }
  }

  // 3. JSON / YAML value — no interpolation in either format. An
  // angle-bracketed value is this repo's convention for "described, not
  // literal" (`"<from ${CLAUDE_PLUGIN_ROOT}/…>"` documents where a field comes
  // from), so it is a schema annotation rather than a path anyone resolves.
  const angleDescribed = /<[^<>]*\$\{CLAUDE_PLUGIN_ROOT\}[^<>]*>/.test(line);
  if (JSON_YAML_VALUE.test(line) && !SHELL_COMMAND.test(line) && !angleDescribed) {
    flag('JSON/YAML value — neither format interpolates, so the anchor is stored literally');
  }

  return out;
}

const ROOT_SENTINEL = path.sep === '/' ? '/plugin-root' : 'C:\\plugin-root';

// Clause B. Substitute the anchor with a sentinel root, resolve, and require
// the result to stay inside it. Tokens carrying template placeholders
// (`{codebase|zerobase}`, `$WORK_DIR`) cannot be resolved literally, so they
// are checked lexically for `..` instead.
function escapesRoot(token) {
  const body = normalizePath(token).replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$]/.test(body)) return body.split('/').includes('..');
  const resolved = path.resolve(ROOT_SENTINEL, body);
  return resolved !== ROOT_SENTINEL && !resolved.startsWith(ROOT_SENTINEL + path.sep);
}

// Symlink escape: an anchored, lexically-contained path can still point out of
// the root if a component is a symlink. Only checkable for targets that exist.
function escapesViaSymlink(token) {
  const body = normalizePath(token).replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$]/.test(body)) return false;
  const target = path.join(ROOT, body);
  if (!fs.existsSync(target)) return false;
  const real = fs.realpathSync(target);
  const realRoot = fs.realpathSync(ROOT);
  return real !== realRoot && !real.startsWith(realRoot + path.sep);
}

// Resolve a token for real, from a given cwd, exactly as a runtime agent would.
// Re-running the classifier tells you only what the classifier already believes;
// this performs the resolution and asks which file the instruction lands on. It
// is the second, independent layer, and it is shared by every fixture that needs
// it so no two of them can disagree about what resolution means.
function resolveAsAgentWould(token, cwd) {
  if (/^(?:\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>)\//.test(token)) {
    const body = token.replace(/^(?:\$\{CLAUDE_PLUGIN_ROOT\}|<PLUGIN_ROOT>)\//, '');
    return path.resolve(ROOT, body);              // anchored → resolves in the plugin
  }
  return path.resolve(cwd, token.replace(/^\.\//, '')); // unanchored → cwd
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
function shadowableTokens(line, sourceFile = path.join(ROOT, 'AGENTS.md'), body = '') {
  const out = [];
  const programmaticAll = new Set();
  if (body && definesPluginRequire(body)) {
    PLUGIN_REQUIRE_CALL.lastIndex = 0;
    let pm;
    while ((pm = PLUGIN_REQUIRE_CALL.exec(line))) programmaticAll.add(pm[1]);
  }
  for (const [form, re] of FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const token = normalizePath(m[2] === undefined ? m[1] : m[1] + m[2]);
      if (programmaticAll.has(token)) continue;
      if (!ANCHORED_TOKEN.test(token)) out.push({ form, token, why: 'unanchored' });
      else if (escapesRoot(token)) out.push({ form, token, why: 'escapes plugin root' });
      else if (escapesViaSymlink(token)) out.push({ form, token, why: 'escapes via symlink' });
    }
  }
  out.push(...bareBasenameHits(line));
  out.push(...denyByDefaultHits(line, sourceFile, body));
  out.push(...nonExpandingAnchors(line));
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
    const body = fs.readFileSync(file, 'utf8');
    body.split('\n').forEach((line, i) => {
      for (const v of shadowableTokens(line, file, body)) {
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
  // The "safe" side is NOT require("${CLAUDE_PLUGIN_ROOT}/…") — that is the r10
  // vulnerability, since JS does not interpolate a quoted string and Node then
  // resolves it as a bare package under the workspace node_modules.
  ['module-load', 'const x = require("runtime/policy-runtime.js");',
    'const x = pluginRequire("runtime/policy-runtime.js");'],
  ['executable-token', 'rules come from `health/fitness/fitness-generator.js`',
    'rules come from `${CLAUDE_PLUGIN_ROOT}/health/fitness/fitness-generator.js`'],
  ['bare-basename', 'Read(`adaptive-review-protocol.md`)',
    'Read(`${CLAUDE_PLUGIN_ROOT}/skills/shared/references/adaptive-review-protocol.md`)'],
  ['dot-relative', 'Read(`../shared/references/model-routing-guide.md#decode`)',
    'Read(`${CLAUDE_PLUGIN_ROOT}/skills/shared/references/model-routing-guide.md#decode`)'],
];

// A body that defines the helper with its containment check. pluginRequire is
// only trusted where this definition is present — the name alone must not
// disable the guard, so the negative side is asserted without it.
const HELPER_BODY = [
  'const PLUGIN_ROOT = nodeFs.realpathSync(process.env.CLAUDE_PLUGIN_ROOT || "");',
  'const pluginRequire = (rel) => { throw new Error("plugin path escapes root: " + rel); };',
].join(String.fromCharCode(10));

test('every enumerated instruction form is enforced (positive + negative)', () => {
  for (const [form, bad, good] of FORM_CASES) {
    assert.ok(shadowableTokens(bad, undefined, HELPER_BODY).length > 0,
      `${form}: guard must flag — ${bad}`);
    assert.deepEqual(shadowableTokens(good, undefined, HELPER_BODY), [],
      `${form}: guard must accept — ${good}`);
  }
});

test('pluginRequire is not a magic word — it only counts where the helper is defined', () => {
  const call = 'const x = pluginRequire("runtime/policy-runtime.js");';
  assert.deepEqual(shadowableTokens(call, undefined, HELPER_BODY), [],
    'accepted when the containment helper is defined in the same document');
  assert.ok(shadowableTokens(call, undefined, '// no helper here').length > 0,
    'rejected when the document never defines the helper');
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

    const landed = [];
    for (const file of markdownFiles()) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const token of scopedTokens(line)) {
          const target = resolveAsAgentWould(token, evil);
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
    const control = resolveAsAgentWould('adaptive-review-protocol.md', evil);
    assert.ok(control.startsWith(evil + path.sep) && fs.existsSync(control),
      'fixture is vacuous — an unanchored token must land on the planted shadow');
  } finally {
    fs.rmSync(evil, { recursive: true, force: true });
  }
});

test('an anchor the shell will not expand counts as unanchored', () => {
  // Each pair was checked against a real shell before being pinned here.
  // [line, expected reason] — the reason is asserted per case, because the axis
  // now spans languages and "single-quoted" is only the shell answer.
  const mustFlag = [
    // single-quoted JSON payload — the r9 finding, introduced by our own anchoring
    [`echo '{"registryPath":"\${CLAUDE_PLUGIN_ROOT}/assumptions.json"}' | node x.js`, /single-quoted shell/],
    [`printf '%s' '\${CLAUDE_PLUGIN_ROOT}/hooks/scripts/utils.sh'`, /single-quoted shell/],
    // template literal — the form the r10 matcher excluded, which is how the
    // r8 regression at orchestrator:37 survived a round
    ['const { m } = require(\`\${CLAUDE_PLUGIN_ROOT}/scripts/migrate-model-routing.js\`);', /template literal/],
    ['const x = require("\${CLAUDE_PLUGIN_ROOT}/runtime/model-catalog.js");', /bare package name/],
    ['import x from \'\${CLAUDE_PLUGIN_ROOT}/runtime/x.js\';', /bare package name/],
    // A Windows path ending in a backslash, immediately before the anchor.
    // POSIX sh does not escape inside single quotes — `'C:\tmp\'` is literal and
    // the quote closes — so the anchor really is single-quoted and really is not
    // expanded. Verified against bash: the anchor came back as its own literal.
    // Honouring the backslash as an escape flipped the parity and reported
    // `normal`, which reported nothing. Only reachable once a backslash became
    // legitimate path content.
    [`node 'C:\\tmp\\' '\${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js'`, /single-quoted shell/],
    // The double-quoted twin. Looking back at the previous character got this one
    // wrong: the second backslash of the `\\` pair looked escaped, so the closing
    // quote did too and the double-quote state never ended, leaving the anchor
    // that follows unflagged. bash returns that anchor as its own literal, so it
    // genuinely does not expand. Without this row the consume fix can regress in
    // silence — the single-quoted row above passes under both implementations.
    [`node "C:\\tmp\\\\" '\${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js'`, /single-quoted shell/],
  ];
  for (const [line, reason] of mustFlag) {
    const hits = nonExpandingAnchors(line);
    assert.equal(hits.length, 1, `must flag non-expanding anchor: ${line}`);
    assert.match(hits[0].why, reason, `wrong reason for: ${line}`);
  }

  const mustPass = [
    // double-quoted shell word: the inner single quotes are JS-level, and the
    // shell still expands. A naive quote counter gets this one wrong.
    `node -e "JSON.parse(require('fs').readFileSync('\${CLAUDE_PLUGIN_ROOT}/.codex-plugin/plugin.json','utf8'))"`,
    // close-single / open-double splice inside a single-quoted heredoc body
    `  const { x } = require("'"\${CLAUDE_PLUGIN_ROOT}"'/scripts/detect-capability.js");`,
    // plain expanding position
    `node "\${CLAUDE_PLUGIN_ROOT}/hooks/scripts/verify-receipt-core.js"`,
    // prose, not a command
    'Reads `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` for producer_version',
  ];
  for (const line of mustPass) {
    assert.deepEqual(nonExpandingAnchors(line), [], `must accept: ${line}`);
  }
});

// HOST CAPABILITIES.
//
// Two fixtures below drive a real POSIX harness — a `bash -c` script and a
// symlink — because the properties they prove (shell expansion, realpath
// containment) cannot be demonstrated any other way. On a Windows host without
// Git Bash, spawnSync returns ENOENT; without Developer Mode, symlinkSync throws
// EPERM. Either turns a green suite red for a reason that has nothing to do with
// the invariant, which is the same "npm test is red on Windows" failure the
// separator index bug caused.
//
// These are probed, not inferred from process.platform: a Windows host WITH Git
// Bash should still run the shell fixture, and a Linux CI that somehow lost bash
// should not silently skip a security test. The skip reason is a string so it
// prints, rather than a bare `true` that vanishes into the summary.
const BASH_AVAILABLE = (() => {
  const r = require('node:child_process').spawnSync('bash', ['-c', 'exit 0']);
  return r.status === 0;
})();
const SYMLINKS_AVAILABLE = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-symlink-probe-'));
  try {
    fs.writeFileSync(path.join(probe, 'target'), 'x');
    fs.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'));
    return true;
  } catch {
    return false;                       // EPERM on unprivileged Windows
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

test('the documented report command survives real shell semantics', {
  skip: BASH_AVAILABLE ? false : 'no working bash on this host (Windows without Git Bash)',
}, () => {
  // Runs the shape deep-report documents, from a malicious cwd that has planted
  // a file at the literal path a non-expanding anchor would produce. Proves
  // three things at once: the canonical registry is what gets consumed, the
  // planted marker never reaches the output, and an unresolvable root aborts.
  const evil = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-shell-evil-'));
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-shell-plugin-'));
  try {
    // The literal path a single-quoted anchor leaves behind.
    fs.mkdirSync(path.join(evil, '${CLAUDE_PLUGIN_ROOT}'), { recursive: true });
    fs.writeFileSync(path.join(evil, '${CLAUDE_PLUGIN_ROOT}', 'assumptions.json'),
      JSON.stringify({ marker: 'SHADOW-REGISTRY' }));
    fs.writeFileSync(path.join(fakeRoot, 'assumptions.json'),
      JSON.stringify({ marker: 'CANONICAL-REGISTRY' }));

    const script = `
      PLUGIN_ROOT="$(cd "\${CLAUDE_PLUGIN_ROOT:?unset}" 2>/dev/null && pwd -P)"
      [ -n "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/assumptions.json" ] || { echo "ABORT" >&2; exit 1; }
      node -e 'process.stdout.write(JSON.stringify({registryPath:process.argv[1]}))' "$PLUGIN_ROOT/assumptions.json"
    `;
    const run = (env, cwd) => require('node:child_process')
      .spawnSync('bash', ['-c', script], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });

    const ok = run({ CLAUDE_PLUGIN_ROOT: fakeRoot }, evil);
    assert.equal(ok.status, 0, ok.stderr);
    const chosen = JSON.parse(ok.stdout).registryPath;
    assert.equal(fs.realpathSync(chosen), fs.realpathSync(path.join(fakeRoot, 'assumptions.json')),
      'must consume the canonical plugin registry, not the planted one');
    assert.equal(JSON.parse(fs.readFileSync(chosen, 'utf8')).marker, 'CANONICAL-REGISTRY');
    assert.doesNotMatch(ok.stdout, /SHADOW-REGISTRY|\$\{CLAUDE_PLUGIN_ROOT\}/,
      'planted marker and literal anchor must never reach the output');

    // Non-vacuity: the planted shadow is genuinely reachable if the anchor
    // stays literal, which is exactly what the old single-quoted form did.
    const literal = path.join(evil, '${CLAUDE_PLUGIN_ROOT}', 'assumptions.json');
    assert.equal(JSON.parse(fs.readFileSync(literal, 'utf8')).marker, 'SHADOW-REGISTRY');

    // Fail-closed when the root does not resolve.
    const bad = run({ CLAUDE_PLUGIN_ROOT: path.join(evil, 'does-not-exist') }, evil);
    assert.notEqual(bad.status, 0, 'unresolvable plugin root must abort');
    assert.match(bad.stderr, /ABORT/);
  } finally {
    fs.rmSync(evil, { recursive: true, force: true });
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test('the plugin obeys the rules it states', () => {
  // Self-consistency axis. Both round-9 findings had the same shape: a rule
  // this PR added, violated inside the very file that states it, or two lines
  // below. Writing a rule is not enforcing it, so the mechanically checkable
  // ones are asserted here.
  const violations = [];
  for (const file of markdownFiles()) {
    const rel = path.relative(ROOT, file);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const at = `${rel}:${i + 1}`;

      // "이 파일 위치에서 상대 유도하지 말 것" — a path derived from the
      // document's own location resolves against the workspace once the
      // document is read from there.
      if (/directory containing this|이 파일이 있는 (디렉터리|디렉토리)/.test(line)
          && !/말 것|하지 마|never|must not/i.test(line)) {
        violations.push(`${at}  source-relative derivation`);
      }

      // "Never `git add -A`" — the statement itself is allowed, an instruction
      // to do it is not.
      if (/git add -A/.test(line) && !/Never|절대|금지|하지 ?마/i.test(line)) {
        violations.push(`${at}  instructs 'git add -A'`);
      }

      // phase-guard rejects `$(...)` in the Phase 5 helper calls, so a
      // documented call that uses it would be blocked at runtime.
      if (/phase5-(?:finalize|record-error)\.sh/.test(line) && /\$\(/.test(line)) {
        violations.push(`${at}  command substitution in a phase-guard helper call`);
      }
    });
  }
  assert.deepEqual(violations, [],
    `the plugin violates a rule it states:\n  ${violations.join('\n  ')}`);
});

test('a planted node_modules shadow cannot hijack a plugin require', () => {
  // The r10 exploit, executed rather than argued. `require("${VAR}/x.js")` is a
  // *bare* specifier — not absolute — so Node walks node_modules from cwd.
  const evil = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-nm-evil-'));
  const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-nm-plugin-'));
  const { spawnSync } = require('node:child_process');
  try {
    const shadowDir = path.join(evil, 'node_modules', '${CLAUDE_PLUGIN_ROOT}', 'runtime');
    fs.mkdirSync(shadowDir, { recursive: true });
    fs.writeFileSync(path.join(shadowDir, 'model-catalog.js'),
      'module.exports = { marker: "ATTACKER" };\n');
    fs.mkdirSync(path.join(realRoot, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(realRoot, 'runtime', 'model-catalog.js'),
      'module.exports = { marker: "CANONICAL" };\n');

    const run = (src) => spawnSync(process.execPath, ['-e', src],
      { cwd: evil, env: { ...process.env, CLAUDE_PLUGIN_ROOT: realRoot }, encoding: 'utf8' });

    // Non-vacuity: the planted module really is reachable via the broken form.
    const vulnerable = run('console.log(require("${CLAUDE_PLUGIN_ROOT}/runtime/model-catalog.js").marker)');
    assert.equal(vulnerable.status, 0, vulnerable.stderr);
    assert.equal(vulnerable.stdout.trim(), 'ATTACKER',
      'fixture is vacuous — the planted shadow must be reachable via the unsafe form');

    // The documented pattern resolves from env, with containment.
    const safe = run(`
      const nodePath = require("node:path"), nodeFs = require("node:fs");
      const PLUGIN_ROOT = nodeFs.realpathSync(process.env.CLAUDE_PLUGIN_ROOT || "");
      const pluginRequire = (rel) => {
        const t = nodePath.resolve(PLUGIN_ROOT, rel);
        if (t !== PLUGIN_ROOT && !t.startsWith(PLUGIN_ROOT + nodePath.sep)) {
          throw new Error("plugin path escapes root: " + rel);
        }
        return require(t);
      };
      console.log(pluginRequire("runtime/model-catalog.js").marker);
    `);
    assert.equal(safe.status, 0, safe.stderr);
    assert.equal(safe.stdout.trim(), 'CANONICAL',
      'the documented pattern must load the plugin module, never the planted one');

    // Containment: a traversing relative path is refused, not resolved.
    const escaping = run(`
      const nodePath = require("node:path"), nodeFs = require("node:fs");
      const PLUGIN_ROOT = nodeFs.realpathSync(process.env.CLAUDE_PLUGIN_ROOT || "");
      const pluginRequire = (rel) => {
        const t = nodePath.resolve(PLUGIN_ROOT, rel);
        if (t !== PLUGIN_ROOT && !t.startsWith(PLUGIN_ROOT + nodePath.sep)) {
          throw new Error("plugin path escapes root: " + rel);
        }
        return require(t);
      };
      pluginRequire("../evil.js");
    `);
    assert.notEqual(escaping.status, 0, 'an escaping path must throw');
    assert.match(escaping.stderr, /escapes root/);
  } finally {
    fs.rmSync(evil, { recursive: true, force: true });
    fs.rmSync(realRoot, { recursive: true, force: true });
  }
});

test('markdown link destinations are never environment variables', () => {
  // The mirror image of the anchor rule. Markdown does not interpolate, so an
  // anchored link destination is a literal broken URL. r8 declared link targets
  // an exception class in the guard; this asserts the exception is actually
  // honoured in the documents, which it was not for seven links.
  const broken = [];
  for (const file of markdownFiles()) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const re = /\]\((\$\{[^)]*|<PLUGIN_ROOT>[^)]*)\)/g;
      let m;
      while ((m = re.exec(line))) {
        broken.push(`${path.relative(ROOT, file)}:${i + 1}  ](${m[1]})`);
      }
    });
  }
  assert.deepEqual(broken, [],
    'markdown link destination uses a variable that nothing expands — use a '
    + `source-relative path instead:\n  ${broken.join('\n  ')}`);
});

test('pluginRequire refuses a symlink that leaves the plugin root', {
  skip: SYMLINKS_AVAILABLE ? false : 'this host cannot create symlinks (unprivileged Windows)',
}, () => {
  // path.resolve is lexical, so a symlink inside the root pointing outside
  // passes a prefix check and require then follows it. The helper documented in
  // the skills realpaths the target; this pins that it must.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-symlink-plugin-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-symlink-outside-'));
  const { spawnSync } = require('node:child_process');
  try {
    fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'evil.js'), 'module.exports={marker:"OUTSIDE"};\n');
    fs.writeFileSync(path.join(root, 'runtime', 'ok.js'), 'module.exports={marker:"INSIDE"};\n');
    fs.symlinkSync(path.join(outside, 'evil.js'), path.join(root, 'runtime', 'evil.js'));

    const helper = `
      const nodePath = require("node:path"), nodeFs = require("node:fs");
      const PLUGIN_ROOT = nodeFs.realpathSync(process.env.CLAUDE_PLUGIN_ROOT || "");
      const pluginRequire = (rel) => {
        const target = nodeFs.realpathSync(nodePath.resolve(PLUGIN_ROOT, rel));
        if (target !== PLUGIN_ROOT && !target.startsWith(PLUGIN_ROOT + nodePath.sep)) {
          throw new Error("plugin path escapes root: " + rel);
        }
        return require(target);
      };`;
    const run = (src) => spawnSync(process.execPath, ['-e', helper + src],
      { env: { ...process.env, CLAUDE_PLUGIN_ROOT: root }, encoding: 'utf8' });

    const escaped = run('console.log(pluginRequire("runtime/evil.js").marker);');
    assert.notEqual(escaped.status, 0, 'a symlink out of the root must be refused');
    assert.match(escaped.stderr, /escapes root/);

    const inside = run('console.log(pluginRequire("runtime/ok.js").marker);');
    assert.equal(inside.status, 0, inside.stderr);
    assert.equal(inside.stdout.trim(), 'INSIDE', 'an in-root module must still load');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('the documented pluginRequire helpers realpath their target', () => {
  // The runtime behaviour above is only protective if the skills document it.
  const missing = [];
  for (const file of markdownFiles()) {
    const body = fs.readFileSync(file, 'utf8');
    if (!/const\s+pluginRequire\s*=/.test(body)) continue;
    if (!/realpathSync\s*\(\s*nodePath\.resolve\s*\(\s*PLUGIN_ROOT/.test(body)) {
      missing.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(missing, [],
    `pluginRequire resolves lexically without realpath — a symlink out of the `
    + `root would be followed:\n  ${missing.join('\n  ')}`);
});

test('a backslash separator does not hide a path from the guard', () => {
  // The bypass table from review, used verbatim as the fixture. Measured on the
  // commit before this fix by planting one line at a time into AGENTS.md in a
  // detached copy and running this guard: every slash row failed the build and
  // every backslash row scored zero. The same unanchored reference to the same
  // real file, invisible because the matchers knew only `/`.
  //
  // Mixed separators matter as much as pure backslash: a rule taught to
  // recognise "a backslash path" as a second shape would still miss
  // `hooks\scripts/envelope.js`. That is the argument for normalising at
  // tokenisation rather than per matcher — every rule underneath, present and
  // future, sees one canonical spelling without being taught anything.
  const TABLE = [
    ['unanchored slash', 'Run `node scripts/deep-work-runtime.js` now.'],
    ['unanchored backslash', 'Run `node scripts\\deep-work-runtime.js` now.'],
    ['read-verb slash', 'Read `skills/deep-finish/SKILL.md` first.'],
    ['read-verb backslash', 'Read `skills\\deep-finish\\SKILL.md` first.'],
    ['mixed separators', 'Run `node hooks\\scripts/envelope.js` now.'],
    ['read-verb mixed', 'Read `skills/deep-finish\\SKILL.md` first.'],
  ];
  for (const [label, line] of TABLE) {
    assert.ok(shadowableTokens(line).length > 0, `${label} must be flagged: ${line}`);
  }

  // An anchored traversal written with backslashes is still a traversal, and
  // must be rejected for that reason rather than as "unanchored". Asserting the
  // reason is what keeps this row from passing for the wrong cause: with
  // normalizePath removed the token stays `${CLAUDE_PLUGIN_ROOT}\..\…`, fails
  // ANCHORED_TOKEN, and is flagged — correctly, but as an anchoring failure.
  const traversal = shadowableTokens('node "${CLAUDE_PLUGIN_ROOT}\\..\\workspace\\evil.js"');
  assert.ok(traversal.length > 0, 'anchored backslash traversal must be flagged');
  assert.equal(traversal[0].why, 'escapes plugin root',
    `traversal must fail on containment, not anchoring: ${JSON.stringify(traversal)}`);

  // Escape parity: a doubled backslash is how the same path appears inside a
  // string literal, and separator runs collapse, so it resolves identically.
  assert.ok(shadowableTokens('const p = "hooks\\\\scripts\\\\envelope.js";').length > 0,
    'an escaped backslash path must be flagged too');

  // …and the same spelling where only deny-by-default can see it: `.md`, so no
  // executable-token FORM, no read verb, and a basename ROOT_METADATA exempts.
  // This is the case that showed a one-character separator element in PATH_TOKEN
  // cannot span `\\` — the match died at the second backslash and the bare
  // basename was extracted and exempted instead.
  assert.ok(shadowableTokens('const p = "skills\\\\deep-finish\\\\SKILL.md";').length > 0,
    'an escaped backslash path must survive tokenisation as one whole token');

  // PER-AXIS ISOLATION. The rows above are caught by several rules at once, so
  // they prove the bug is closed without proving which piece closed it. Each
  // case below is chosen so exactly one piece can see it — verified by mutating
  // that piece alone and watching only this test fail.

  // PATH_TOKEN + the normalise-before-exemption ordering, isolated. No read
  // verb, so no FORM matches, and a basename ROOT_METADATA exempts on its own —
  // so if the token is not extracted whole and canonicalised before the
  // exemption lookup, nothing sees it at all.
  assert.ok(
    shadowableTokens('워크플로우 정본은 `skills\\deep-finish\\SKILL.md` 이다.').length > 0,
    'deny-by-default must extract a backslash path whole, not just its basename');

  // ANY_ROOT/REL separator, isolated. Deny-by-default asks whether a token
  // resolves inside the plugin, so a path to a file that does not exist is
  // invisible to it — only a FORM can match, and only if the separator directly
  // after the root directory is accepted.
  assert.ok(shadowableTokens('Read `skills\\missing.md` before starting.').length > 0,
    'a FORM must accept a backslash directly after the root directory');

  // PATH_BODY separator, isolated. Slash after the root so ANY_ROOT matches
  // either way; the backslash is inside the body, and the file does not exist so
  // deny-by-default cannot cover for it.
  assert.ok(shadowableTokens('Read `skills/zzz\\missing.md` before starting.').length > 0,
    'a FORM must match a backslash inside the path body');

  // executable-token, isolated. This is the form that hid health/health-check.js
  // and it has its own inline copy of the root and body patterns rather than
  // sharing ANY_ROOT/PATH_BODY, so the other FORMS learning `\` does not teach
  // it anything. No interpreter, no read verb, and deliberately not `from` —
  // that word alone puts module-load on the line — and a file that does not
  // exist, so this rule is the only one that can see it.
  for (const line of [
    'the generator is at `health\\fitness\\missing-generator.js`',
    'the helper `hooks\\scripts\\missing-helper.sh` is invoked at Stop',
  ]) {
    const hits = shadowableTokens(line);
    assert.deepEqual(hits.map((h) => h.form), ['executable-token'],
      `executable-token must be the rule that catches this, alone: ${line}`);
  }

  // NEGATIVES live in their own test below, because "stays silent" turns out to
  // have two different mechanisms behind it and pinning the wrong one is how a
  // negative assertion becomes decorative. The two accepts here are about
  // anchoring rather than over-flagging, so they stay.
  assert.deepEqual(
    shadowableTokens('Read `${CLAUDE_PLUGIN_ROOT}\\skills\\deep-finish\\SKILL.md`'), [],
    'an anchored backslash path must be accepted, not flagged as unanchored');
  // The heredoc quote-splice, spelled for Windows. This is the isolating case
  // for the anchored-prefix lookbehind: PATH_TOKEN cannot start a match on the
  // leading `\`, so the token arrives as a bare `scripts/…` and only the
  // preceding-context check knows it was anchored.
  assert.deepEqual(
    shadowableTokens('const { x } = require("\'"${CLAUDE_PLUGIN_ROOT}"\'\\scripts\\detect-capability.js");'), [],
    'a spliced anchor followed by a backslash must still count as anchored');
});

test('a separator run reaches the planted file, not just the classifier', () => {
  // The defect this pins is invisible to a failure count. With a one-character
  // separator element in PATH_TOKEN, a run-spelled path (`skills\\x\\y.sh`) still
  // makes the classifier report — a FORM matches the raw text — while the
  // reachability fixture goes blind, because scopedTokens dies at the second
  // separator and yields only the bare basename. Counting failures reads that as
  // "caught"; it is the layer that proves an instruction *actually lands on a
  // planted file* that has stopped working, and that is the only layer that
  // demonstrates the attack rather than describing it.
  //
  // So the two layers are asserted separately, by what each concludes. Verified
  // by reverting PATH_TOKEN's run element alone: the classifier assertion keeps
  // passing and the reachability assertion fails, for every run row below.
  const evil = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-run-evil-'));
  try {
    fs.mkdirSync(path.join(evil, 'skills', 'deep-integrate'), { recursive: true });
    fs.writeFileSync(path.join(evil, 'skills', 'deep-integrate', 'phase5-record-error.sh'),
      '#!/bin/sh\necho SHADOW\n');

    for (const [label, line] of [
      ['single slash', 'bash skills/deep-integrate/phase5-record-error.sh /abs/work'],
      ['single backslash', 'bash skills\\deep-integrate\\phase5-record-error.sh /abs/work'],
      ['backslash run', 'bash skills\\\\deep-integrate\\\\phase5-record-error.sh /abs/work'],
      ['slash run', 'bash skills//deep-integrate//phase5-record-error.sh /abs/work'],
      ['mixed run', 'bash skills\\/deep-integrate\\/phase5-record-error.sh /abs/work'],
    ]) {
      assert.ok(shadowableTokens(line).length > 0,
        `layer 1 (classifier) must flag: ${label} — ${line}`);

      const landed = [...scopedTokens(line)]
        .map((t) => resolveAsAgentWould(t, evil))
        .filter((t) => t.startsWith(evil + path.sep) && fs.existsSync(t));
      assert.ok(landed.length > 0,
        `layer 2 (reachability) must land on the planted shadow: ${label} — ${line}. `
        + `scopedTokens yielded ${JSON.stringify([...scopedTokens(line)])}`);
    }

    // Non-vacuity for layer 2: an anchored spelling of the same path must NOT
    // land in the workspace, so "landed" is a property of the token and not of a
    // resolver that points everything at the evil root.
    const anchored = resolveAsAgentWould(
      '${CLAUDE_PLUGIN_ROOT}/skills/deep-integrate/phase5-record-error.sh', evil);
    assert.equal(anchored.startsWith(evil + path.sep), false,
      'an anchored token must resolve into the plugin, never the workspace');
  } finally {
    fs.rmSync(evil, { recursive: true, force: true });
  }
});

test('the plugin file index and the tokens looked up in it use one spelling', () => {
  // Normalising the token but not the index normalises one side of a comparison,
  // which is not normalising at all. `path.relative` returns the host's
  // separator, so on Windows every PLUGIN_FILES key would read
  // `scripts\deep-work-runtime.js` while every token looked up in it reads
  // `scripts/deep-work-runtime.js` — deny-by-default would then resolve nothing
  // at all, and the isolating cases above would fail on Windows only.
  //
  // Windows is emulated here rather than assumed: path.win32.relative is the
  // same implementation that host runs, so this reproduces the mismatch on macOS
  // and Linux CI instead of waiting for a Windows user to find it.
  const wrongSpelling = [...PLUGIN_FILES].filter((k) => k.includes('\\'));
  assert.deepEqual(wrongSpelling, [],
    'PLUGIN_FILES keys must be canonicalised at construction, not left in the '
    + `host separator:\n  ${wrongSpelling.slice(0, 10).join('\n  ')}`);

  const winRel = path.win32.relative(
    'C:\\plugin-root', 'C:\\plugin-root\\scripts\\deep-work-runtime.js');
  assert.equal(winRel, 'scripts\\deep-work-runtime.js',
    'precondition — win32 relative must produce the backslash spelling');
  assert.equal(normalizePath(winRel), 'scripts/deep-work-runtime.js');

  // The real index must contain the canonical form and not the host-shaped one.
  // The second assertion is what makes the first non-vacuous: it shows the two
  // spellings are genuinely different keys, so agreeing on one is load-bearing.
  assert.ok(PLUGIN_FILES.has(normalizePath(winRel)),
    'the canonical spelling must be a key in the index');
  assert.equal(PLUGIN_FILES.has(winRel), false,
    'the host-shaped spelling must not be — otherwise this test proves nothing');

  // The derivation itself, driven by the Windows implementation.
  assert.equal(
    repoKey('C:\\plugin-root', 'C:\\plugin-root\\scripts\\deep-work-runtime.js',
      path.win32.relative),
    'scripts/deep-work-runtime.js',
    'repoKey must canonicalise whatever separator its host relative() returns');

  // End-to-end: rebuild the entire index the way a Windows host would spell it —
  // every real plugin file, re-rooted under a win32 path, run back through the
  // same derivation — and require the result to be identical. This is what makes
  // the whole axis provable from a POSIX runner: with the normalisation removed
  // from repoKey, every one of these keys comes back with backslashes.
  const winRoot = 'C:\\plugin-root';
  const rebuilt = new Set([...PLUGIN_FILES].map((key) =>
    repoKey(winRoot, path.win32.join(winRoot, ...key.split('/')), path.win32.relative)));
  assert.deepEqual([...rebuilt].sort(), [...PLUGIN_FILES].sort(),
    'the index a Windows host builds must be key-for-key identical to this one');
  assert.ok(rebuilt.size > 100,
    `emulation swept only ${rebuilt.size} keys — the index is too small to be real`);

  // The two call sites cannot be told apart behaviourally from a POSIX runner:
  // path.relative already returns `/` here, so `repoKey(...)` and
  // `path.relative(...)` produce identical output and no assertion can
  // distinguish them. The Windows difference is real but undecidable from this
  // host, so the call sites are pinned structurally instead — the same technique
  // this file already uses to require the documented pluginRequire helpers to
  // realpath. Mutating either site back to a raw path.relative fails here.
  const src = fs.readFileSync(__filename, 'utf8');
  assert.match(src, /rel\.add\(repoKey\(ROOT, p\)\)/,
    'the index must be built through repoKey, not a raw path.relative');
  assert.match(src, /const fromSource = repoKey\(ROOT,/,
    'the source-relative lookup must go through repoKey too — it is the other '
    + 'side of the same comparison');
});

test('normalising separators does not promote prose into a path', () => {
  // Collapsing separator runs makes over-flagging the failure mode to watch, so
  // the text that must stay silent is pinned. But "produces no violation" has
  // two mechanisms behind it, and asserting only the outcome hides which one is
  // load-bearing — the first draft of this test asserted silence for five lines
  // and four of them were silent for a reason the rule never touched.
  //
  // So each line declares its mechanism and is checked against it.

  // A. The tokeniser must not see a path here at all. Escape sequences and
  //    regex bodies are the shapes most at risk once `\` is a separator.
  for (const line of [
    'escape a quote with \\" and a backslash with \\\\',
    'Use `\\n` for a newline and `\\t` for a tab.',
    'A literal backslash is written `\\\\` in a JS string literal.',
    'The validator matches /^[A-Za-z]+\\/[a-z-]+$/ against each entry.',
  ]) {
    assert.deepEqual([...scopedTokens(line)], [],
      `no path token may be extracted from: ${line}`);
    assert.deepEqual(shadowableTokens(line), [], `must not be flagged: ${line}`);
  }

  // B. Here the tokeniser does extract something — a Windows path quoted inside
  //    user input is genuinely path-shaped — and it stays silent only because it
  //    resolves to no plugin file. That is a claim about the rule, so it gets the
  //    non-vacuity check: declare those exact tokens plugin files and the line
  //    must be flagged. Nothing is stubbed; only the file set the rule consults
  //    is changed, so what runs is the real classifier.
  for (const [line, expected] of [
    ['Windows paths in user input (`C:\\Users\\me\\project`) are normalised before use.',
      ['Users/me/project']],
    ['The workspace was at `D:\\repos\\acme\\notes.md` on that machine.',
      ['repos/acme/notes.md']],
    ['const p = "C:\\\\Users\\\\me\\\\notes.md";', ['Users/me/notes.md']],
  ]) {
    assert.deepEqual([...scopedTokens(line)], expected,
      `separator runs must collapse to one canonical token: ${line}`);
    assert.deepEqual(shadowableTokens(line), [], `must not be flagged: ${line}`);

    for (const t of expected) PLUGIN_FILES.add(t);
    try {
      assert.ok(shadowableTokens(line).length > 0,
        'vacuous negative — this line stays silent even when its tokens name real '
        + `plugin files, so asserting its silence proves nothing: ${line}`);
    } finally {
      for (const t of expected) PLUGIN_FILES.delete(t);
    }
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
  // Either separator, everywhere. This resolver bypasses tokenization on
  // purpose — it reads the raw body — so normalizePath cannot reach it and each
  // pattern has to accept `\` itself. A slash-only resolver made the backslash
  // spelling *weaker* than the slash one: `${CLAUDE_PLUGIN_ROOT}\..\evil.json`
  // matched no FORM, was waved through by deny-by-default as anchored, and then
  // matched nothing here either, so an out-of-root reference was invisible to
  // every layer. Captures are normalised before resolution so `path.join` sees
  // one shape.
  const patterns = [
    // Trailing boundary, same reason as the guard: without it `.js` matches the
    // prefix of `.json` and the resolver reports files that never existed.
    [/\$\{CLAUDE_PLUGIN_ROOT\}[\\/]([A-Za-z0-9._\\/-]+\.(?:md|js|sh|json|yaml)(?![A-Za-z0-9]))/g, false],
    [/`(\.\.[\\/][A-Za-z0-9._\\/-]+\.md)(?:#[a-z0-9-]+)?`/g, true],
    [/\]\((\.\.?[\\/][A-Za-z0-9._\\/-]+\.md)\)/g, true],
    // Read("../shared/references/foo.md") — the double-quoted call form, used in
    // five phase skills. It resolves today but was outside the backtick pattern.
    [/Read\("(\.\.[\\/][A-Za-z0-9._\\/-]+\.md)(?:#[a-z0-9-]+)?"\)/g, true],
  ];
  // Pin the separator symmetry before walking real files: a slash-only resolver
  // here made the backslash spelling of an out-of-root reference invisible to
  // every layer, because deny-by-default defers anchored tokens to the FORMS and
  // `.json` matches none of them.
  //
  // Every pattern, not just the first. Two of the four match nothing in the
  // current corpus, so a real-file sweep gives them no coverage at all and only
  // this loop can hold their separator class. One sample per pattern, in both
  // spellings, so a revert fails on the axis rather than on whatever file happens
  // to be in the tree.
  const samples = [
    ['${CLAUDE_PLUGIN_ROOT}/../workspace/evil.json',
      '${CLAUDE_PLUGIN_ROOT}\\..\\workspace\\evil.json'],
    ['`../shared/references/x.md`', '`..\\shared\\references\\x.md`'],
    ['[label](../shared/x.md)', '[label](..\\shared\\x.md)'],
    ['Read("../shared/x.md")', 'Read("..\\shared\\x.md")'],
  ];
  patterns.forEach(([re], i) => {
    for (const spelling of samples[i]) {
      re.lastIndex = 0;
      assert.ok(re.exec(spelling), `pattern ${i} must see both spellings: ${spelling}`);
    }
  });

  // Normalising the capture below is load-bearing but NOT pinned, and this pair
  // does not pin it — it proves only that normalisation is what makes a
  // backslash spelling resolve, not that the resolver applies it. Removing
  // `normalizePath` from the resolution site breaks no test today, because no
  // shipped document is written that way: the failure would appear the first time
  // one is, as a false `missing` on a file that exists. Same disposition as the
  // three leaf normalisations this file already labels unproven — recorded, not
  // claimed.
  {
    // `path.posix.join` on purpose. With `path.join` these two are byte-identical
    // on Windows — `\` is a separator there, so the "un-normalised" form names
    // the same existing file and the pair contradicts itself, turning the suite
    // deterministically red on the platform 7.1.1 claims to have fixed.
    const raw = 'scripts\\deep-work-runtime.js';
    assert.ok(fs.existsSync(path.posix.join(ROOT, normalizePath(raw))),
      'normalising a backslash spelling is what makes it resolve');
    assert.ok(!fs.existsSync(path.posix.join(ROOT, raw)),
      'the pair is vacuous unless the un-normalised form really fails');
    // The reason, asserted rather than only commented, because it cannot be
    // pinned on a POSIX host: `path.join` would make the pair contradict itself
    // on Windows, where `\` is a separator and both spellings name one file.
    // This holds on every platform, so the rationale cannot be lost even though
    // the fix itself is unobservable here.
    assert.equal(
      path.win32.join('C:\\r', 'a\\b.js'),
      path.win32.join('C:\\r', normalizePath('a\\b.js')),
      'win32 joins both spellings to one path — hence path.posix above',
    );
  }

  const broken = [];
  let resolved = 0;
  const realRoot = fs.realpathSync(ROOT);
  for (const file of markdownFiles()) {
    const body = fs.readFileSync(file, 'utf8');
    for (const [re, isRelative] of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(body))) {
        const spelling = normalizePath(m[1]);
        const target = isRelative
          ? path.resolve(path.dirname(file), spelling)
          : path.join(ROOT, spelling);
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
