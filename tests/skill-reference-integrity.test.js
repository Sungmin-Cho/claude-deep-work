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
const { execFileSync } = require('node:child_process');

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

// `toKey` is the same kind of seam as repoKey's `relative`: it defaults to the
// production derivation and turns nothing off, but it lets a test build the index
// the way a Windows host spells it and then drive the real lookup against it. That
// is what makes both sides of the comparison behaviourally decidable from a POSIX
// runner — a source-text assertion can only pin the spelling of the call.
// The index must be what the plugin SHIPS, and the package already declares that
// — `package.json#files` is what npm packs, so it is the authority rather than a
// second list kept in this file. The previous `skip` set enumerated eight
// directory names to walk past and missed `.deep-review`, `.deep-loop`,
// `.deep-docs`, `.deep-memory` and `.serena`, all gitignored: 348 of 673 keys came
// from directories absent in a clean clone, plus an untracked scratch `PLAN.md`.
// So what deny-by-default could see differed between a maintainer's checkout and
// CI — with CI on the lax side. Intersecting tracked files with the shipped
// prefixes removes the whole class instead of extending the list.
//
// `docs/` and `tests/` fall out of this by themselves: `npm pack --dry-run` packs
// zero entries from either. They are maintainer-only, so a reference into them is
// not a runtime read an analysed workspace could shadow.
function shippedPrefixes() {
  const declared = require(path.join(ROOT, 'package.json')).files;
  assert.ok(Array.isArray(declared) && declared.length,
    'package.json#files is the shipped-set authority — the index has no source without it');
  return declared.map((f) => normalizePath(f).replace(/\/$/, ''));
}

function trackedFiles() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function buildPluginFiles({
  toKey = (p) => repoKey(ROOT, p),
  tracked = trackedFiles(),
  prefixes = shippedPrefixes(),
} = {}) {
  const rel = new Set();
  for (const gitPath of tracked) {
    const key = normalizePath(gitPath);
    if (!prefixes.some((p) => key === p || key.startsWith(`${p}/`))) continue;
    rel.add(normalizePath(toKey(path.join(ROOT, gitPath))));
  }
  return rel;
}

const PLUGIN_FILES = buildPluginFiles();

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

function resolvesInPlugin(token, sourceFile, files = PLUGIN_FILES, relative = path.relative) {
  const clean = normalizePath(token).replace(/^\.\//, '');
  if (files.has(clean)) return true;
  try {
    const fromSource = repoKey(ROOT, path.resolve(path.dirname(sourceFile), clean), relative);
    if (files.has(fromSource)) return true;
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

// Shared, so the classifier and the malicious-workspace fixture cannot disagree
// about what counts as anchored. They did: the fixture called the tokeniser
// without `body`, so it could not apply this exemption, and every documented
// `pluginRequire("runtime/x.js")` — the SAFE form, per FORM_CASES — was resolved
// against the evil cwd and reported as a landing.
function programmaticallyAnchored(line, body) {
  const out = new Set();
  if (body && definesPluginRequire(body)) {
    PLUGIN_REQUIRE_CALL.lastIndex = 0;
    let pm;
    while ((pm = PLUGIN_REQUIRE_CALL.exec(line))) out.add(pm[1]);
  }
  return out;
}

function denyByDefaultHits(line, sourceFile, body) {
  const programmatic = programmaticallyAnchored(line, body);
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

// The executable twin. A read verb on a `.md` was covered; an interpreter on a
// runnable file was not, and that shape is strictly more dangerous: `node
// prep-scout.js` resolves against cwd — the analysed workspace — and running a
// planted file there is arbitrary code execution with the caller's permissions.
// Membership in the shipped set is still required, so prose that merely names a
// script is untouched; it is the interpreter that makes it an instruction.
const BARE_EXEC_BASENAME =
  /\b(?:node|python3?|deno|bun|bash|sh|zsh)\s+["'`]?([A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|cjs|mjs|py|sh))["'`]?/g;

function bareBasenameHits(line) {
  const out = [];
  BARE_BASENAME.lastIndex = 0;
  let m;
  while ((m = BARE_BASENAME.exec(line))) {
    if (PLUGIN_DOCS.has(m[1])) {
      out.push({ form: 'bare-basename', token: m[1], why: 'unanchored' });
    }
  }
  const shippedBasenames = new Set([...PLUGIN_FILES].map((f) => f.split('/').pop()));
  BARE_EXEC_BASENAME.lastIndex = 0;
  let em;
  while ((em = BARE_EXEC_BASENAME.exec(line))) {
    if (shippedBasenames.has(em[1])) {
      out.push({ form: 'bare-exec-basename', token: em[1], why: 'unanchored' });
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

// An inline span was only half the structure. Commands are mostly written in
// FENCED blocks, and a line inside one carries no backticks of its own — so the
// span test finds nothing there and the code fell back to the verb list it was
// meant to replace. Measured before fixing: a fenced
// `cp '${CLAUDE_PLUGIN_ROOT}/<a shipped script>' /tmp/staged.js` was flagged by
// no layer at all, here and in two sibling repos.
//
// There is deliberately NO list of languages exempted by info string. A first
// version had one, and it was the same defect one level down: exempting `python`,
// `js`, `diff` or `markdown` asserts "an anchor is safe here", and in every one of
// those an anchor inside single quotes is exactly as literal — and as
// workspace-relative — as it is in shell. What decides is not the language but
// whether anything expands the anchor, and `expansionState` already answers that:
// shell double quotes expand, everything else leaves it literal. Removing the list
// produced zero new violations across the shipped documents of three repos.

function fenceBlocks(body) {
  const id = [];
  let open = null;
  let n = 0;
  body.split('\n').forEach((line) => {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const ch = m[1][0];
      const len = m[1].length;
      // CommonMark closes a fence only on the SAME marker character, at least as
      // long as the one that opened it. Toggling on anything fence-shaped inverts
      // the state for the whole rest of the document — and wrapping a ```bash
      // example inside a ````markdown block is the standard way to document
      // fenced blocks, which these repos do.
      if (open === null) { open = { ch, len }; n += 1; } else if (ch === open.ch && len >= open.len) open = null;
      id.push(null);                       // the marker line is not content
      return;
    }
    id.push(open === null ? null : n);
  });
  return id;
}

function fencedCommandLines(body) {
  const id = fenceBlocks(body);
  const inside = new Set();
  id.forEach((block, i) => { if (block !== null) inside.add(i); });
  return inside;
}

// The clause comment has promised "single quotes and quoted heredocs" since it was
// written, but only the first half was ever implemented. A quoted delimiter makes
// the whole body literal, and each body line carries no quotes of its own, so the
// quote-state reading returns `normal` and the anchor went unflagged. Checked
// against a real shell:
//
//   cat <<'EOF' … ${ANCHOR}/x.js … EOF     literal   → flag
//   cat <<"EOF" … ${ANCHOR}/x.js … EOF     literal   → flag
//   cat <<\EOF  … ${ANCHOR}/x.js … EOF     literal   → flag
//   cat <<-'EOF' … ${ANCHOR}/x.js … EOF    literal   → flag
//   cat <<EOF   … ${ANCHOR}/x.js … EOF     EXPANDS   → clean
//
// An opener whose delimiter never appears again is not a heredoc — that is not
// valid shell — so it is ignored rather than swallowing the rest of the document.
// Without that, a stray `a << b` in prose would flag everything below it.
const HEREDOC_OPEN = /<<-?[ \t]*(?:'([^']+)'|"([^"]+)"|\\([A-Za-z_]\w*)|([A-Za-z_]\w*))(?!<)/;

function quotedHeredocLines(body) {
  const literal = new Set();
  const lines = body.split('\n');
  const block = fenceBlocks(body);
  for (let i = 0; i < lines.length; i += 1) {
    if (block[i] === null) continue;              // a heredoc outside a fenced block
    const m = HEREDOC_OPEN.exec(lines[i]);        // is prose describing one
    if (!m) continue;
    const delim = m[1] || m[2] || m[3] || m[4];
    const quoted = Boolean(m[1] || m[2] || m[3]);
    const dashed = /<<-/.test(lines[i]);
    const indent = /^[ \t]*/.exec(lines[i])[0];
    let end = -1;
    for (let j = i + 1; j < lines.length && block[j] === block[i]; j += 1) {
      // The terminator must sit at the opener's own indentation. Bash closes only
      // at column 0 and `<<-` strips leading TABS alone, so accepting any
      // indentation ends the body early and leaves everything after it unmarked —
      // fail-open. Matching the opener is what a dedented run does, which is how
      // these documents present commands: deep-work's real heredoc sits three
      // spaces deep inside a numbered list, opener and terminator alike.
      const line = dashed ? lines[j].replace(/^\t+/, indent) : lines[j];
      if (line === `${indent}${delim}`) { end = j; break; }
    }
    if (end === -1) continue;                     // never terminated → not a heredoc
    if (quoted) for (let j = i + 1; j < end; j += 1) literal.add(j);
    i = end;
  }
  return literal;
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
function nonExpandingAnchors(line, inFence = false, inQuotedHeredoc = false) {
  const out = [];
  const flag = (why) => out.push({ form: 'non-expanding-anchor', token: '${CLAUDE_PLUGIN_ROOT}', why });

  // A line whose single quotes never close is not a command at all — bash refuses
  // to parse it — so the shell clause has nothing to say about it. Checked against
  // a real shell before being pinned:
  //
  //   cp '${A}/x.js'                       literal   → flag
  //   a'b ${A}/a'                          literal   → flag
  //   the plugin's root is ${A}/x          SYNTAX ERROR
  //   don't touch the plugin's ${A}/x      expands   → clean
  //
  // This replaced a narrower rule that skipped an apostrophe flanked by word
  // characters. That rule removed the prose false positives but also silenced
  // `a'b ${A}/a'`, which really does open a quote and really does leave the anchor
  // literal — its justification, that a genuine opening quote is never flanked on
  // both sides, was simply false. Asking whether the line parses is both correct
  // and narrower: prose with an odd number of apostrophes is a syntax error, and
  // prose with an even number closes its own quote and expands.
  //
  // Known limit, unchanged from before: a quoted string continued across fenced
  // lines leaves each line individually unterminated, so an anchor on the second
  // line is not flagged. It was not flagged by the previous verb-list gate either.
  const parsesAsCommand = expansionState(line, line.length) !== 'single';
  // 0. quoted heredoc body — the delimiter decides for the whole body, so no
  // per-line quote state applies. This is the half of the clause comment that
  // was documented from the start and never implemented.
  if (inQuotedHeredoc && line.includes('${CLAUDE_PLUGIN_ROOT}')) {
    flag('quoted heredoc body — the delimiter is quoted, so nothing expands');
  }

  // 1. shell — single quotes and quoted heredocs leave it literal
  let i = line.indexOf('${CLAUDE_PLUGIN_ROOT}');
  while (i !== -1) {
    const span = inlineCodeSpans(line).find(([s, e]) => i >= s && i < e);
    // Three command contexts, and the answer is their disjunction rather than a
    // first-match. A span narrows the view to the backticks, which loses any
    // quote the span sits *inside*: ``node '`${CLAUDE_PLUGIN_ROOT}`/x.js'`` is
    // single-quoted on the line and unquoted within the span, and evaluating
    // only the span called it safe. Either reading finding it literal is enough.
    const literalInSpan = !!span
      && expansionState(line.slice(span[0], span[1]), i - span[0]) === 'single';
    const literalOnLine = parsesAsCommand && (inFence || SHELL_COMMAND.test(line))
      && expansionState(line, i) === 'single';
    if (literalInSpan || literalOnLine) {
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
function shadowableTokens(line, sourceFile = path.join(ROOT, 'AGENTS.md'), body = '', inFence = false, inQuotedHeredoc = false) {
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
  out.push(...nonExpandingAnchors(line, inFence, inQuotedHeredoc));
  return out;
}

test('the always-loaded agent guides are in the scan set', () => {
  // r6 reported these as covered when markdownFiles() still walked only
  // skills/ and agents/. Asserting membership means the coverage claim is
  // checked by the suite rather than by a commit message.
  // Root-level entries in ALWAYS_LOADED have no separator, so a Windows
  // emulation over them alone cannot fail — it would be a decorative
  // assertion. The derivation is pinned against a real nested document
  // instead, which is where the spelling actually diverges. `relative` is a
  // seam, not a switch: it defaults to the host's and turns nothing off.
  const scanKeys = (rel = path.relative) =>
    markdownFiles().map((f) => normalizePath(rel(ROOT, f)));
  const scanned = scanKeys();
  for (const doc of ALWAYS_LOADED) {
    assert.ok(fs.existsSync(path.join(ROOT, doc)), `${doc} must exist to be scanned`);
    assert.ok(scanned.includes(doc), `${doc} must be in the shadow-guard scan set`);
  }
  const nested = scanned.find((k) => k.includes('/'));
  assert.ok(nested,
    'the scan set must hold a nested document, or the next assertion proves nothing');
  assert.ok(scanKeys(path.win32.relative).includes(nested),
    `the Windows spelling of ${nested} must be the same key as the host's — `
    + 'otherwise every membership check against a slash literal misses there');
});

test('no read or exec instruction can be shadowed from the target workspace', () => {
  const violations = [];
  for (const file of markdownFiles()) {
    const body = fs.readFileSync(file, 'utf8');
    const fenced = fencedCommandLines(body);
    const heredoc = quotedHeredocLines(body);
    body.split('\n').forEach((line, i) => {
      for (const v of shadowableTokens(line, file, body, fenced.has(i), heredoc.has(i))) {
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
    // Derived, not enumerated. This repo is the one the siblings were ported
    // from, and it is the only one that kept a hand list — 3 basenames plus 2
    // specific files against a 300-plus-key index. Measured consequence: five
    // unsafe spellings (read-verb, direct-exec, module-load, executable-token,
    // separator-run) planted into AGENTS.md fired the classifier while this
    // layer — the only one that proves a planted file is actually reached —
    // stayed silent, because nothing had been planted where they would land.
    // A hand list covers the paths someone remembered; deriving from the index
    // makes coverage follow the tree.
    //
    // Repo-relative paths only. Planting bare basenames as well was tried and
    // reverted: a document that merely mentions a shipped basename in prose then
    // registers as a landing. That shape is handled by detection instead
    // (BARE_EXEC_BASENAME), where an interpreter is what makes it an instruction.
    for (const rel of PLUGIN_FILES) {
      const dest = path.join(evil, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, '# SHADOW — must never be read\n');
    }
    // Two plants the index cannot supply, kept deliberately.
    // The r8 finding: a schema attached to the Phase 5 recommendation prompt.
    // Neither a `.md` read nor a `.js`/`.sh` token, so every earlier form list
    // missed it — which is why the rule is now resolution, not syntax.
    for (const extra of [
      path.join('skills', 'deep-integrate', 'schema', 'llm-output.json'),
      'adaptive-review-protocol.md', // bare basename, the non-vacuity control below
    ]) {
      const dest = path.join(evil, extra);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, '{"SHADOW":"must never be attached"}\n');
    }

    // Excluding directory landings is safe only while no shipped directory is a
    // Node LOAD_AS_DIRECTORY target. `<dir>/index.js` or `<dir>/package.json#main`
    // would make a planted DIRECTORY reachable again — the same resolution path
    // the pinned version-read exemption documents as arbitrary code execution —
    // and nothing else would notice, because `isFile()` would keep skipping it.
    assert.deepEqual(
      [...PLUGIN_FILES].filter((k) => /(^|\/)(index\.[cm]?js|package\.json)$/.test(k)).sort(),
      [],
      'a shipped directory just became loadable by name — the isFile() landing '
      + 'filter now hides a reachable shadow, and must be revisited');

    const landed = [];
    for (const file of markdownFiles()) {
      const body = fs.readFileSync(file, 'utf8');
      body.split('\n').forEach((line, i) => {
        // Same exemption the classifier applies. Without `body` this layer
        // cannot see it, and then every `pluginRequire("runtime/x.js")` — the
        // form FORM_CASES enumerates as SAFE — reads as a landing.
        const programmatic = programmaticallyAnchored(line, body);
        for (const token of scopedTokens(line)) {
          if (programmatic.has(token)) continue;
          const target = resolveAsAgentWould(token, evil);
          // A landing must be a FILE. Planting every shipped path creates the
          // directories above it, so `existsSync` alone reports a hit for any
          // prose that names a shipped directory — `hooks/scripts`, say — where
          // nothing shadowable was planted at all.
          if (target.startsWith(evil + path.sep)
              && fs.existsSync(target) && fs.statSync(target).isFile()) {
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

test('a quoted heredoc body is literal, an unquoted one expands', () => {
  // The clause comment promised "single quotes and quoted heredocs" from the
  // start; only the first half was implemented. A quoted delimiter makes the whole
  // body literal, and a body line carries no quotes of its own, so the quote-state
  // reading returned `normal` and the anchor went unflagged. Every row was checked
  // against a real shell before being pinned.
  const ANCHOR = '${CLAUDE_PLUGIN_ROOT}';
  const payload = `${ANCHOR}/scripts/x.js`;
  const fenced = (...lines) => ['```bash', ...lines, '```'].join('\n');

  for (const [open, literal] of [
    [`cat <<'EOF' > /tmp/x`, true],
    [`cat <<"EOF" > /tmp/x`, true],
    [`cat <<\\EOF > /tmp/x`, true],
    [`cat <<-'EOF' > /tmp/x`, true],
    [`cat <<EOF > /tmp/x`, false],          // unquoted delimiter → bash expands it
  ]) {
    const heredoc = quotedHeredocLines(fenced(open, payload, 'EOF'));
    assert.equal(heredoc.has(2), literal,
      `${open} — body ${literal ? 'is literal' : 'expands'}`);
    assert.equal(nonExpandingAnchors(payload, false, heredoc.has(2)).length > 0, literal,
      `${open} — anchor must ${literal ? 'flag' : 'stay clean'}`);
  }

  // The terminator must sit at the OPENER's indentation. Bash closes only at
  // column 0, so accepting any indentation ends the body early and leaves the
  // lines after it unmarked — fail-open. Matching the opener is what a dedented
  // run does, which is how these documents present commands: this repo's real
  // heredoc sits three spaces deep inside a numbered list, opener and terminator
  // alike, and must still close.
  const listed = quotedHeredocLines(fenced(`   cat <<'EOF'`, `   ${payload}`, '   EOF', '   after'));
  assert.ok(listed.has(2) && !listed.has(4),
    'a heredoc indented as a list item closes at its own indentation');
  const mismatched = quotedHeredocLines(
    fenced(`cat <<'EOF'`, 'BODY-ONE', '   EOF', payload, 'EOF'));
  assert.ok(mismatched.has(4),
    'an indented terminator does not close a column-0 heredoc — bash agrees, and '
    + 'ending the body there would leave this anchor unmarked');

  // Opener and terminator must be in the SAME fenced block. Without that a stray
  // delimiter anywhere later in the document pairs with the opener and marks all
  // the prose between them as a literal body.
  const split = ['```bash', `cat <<'EOF'`, '```', `prose ${payload}`, '```text', 'EOF', '```'];
  assert.equal(quotedHeredocLines(split.join('\n')).size, 0,
    'an opener cannot pair with a delimiter in a different fenced block');
  assert.equal(quotedHeredocLines([`cat <<'EOF'`, payload, 'EOF'].join('\n')).size, 0,
    'a heredoc written outside any fenced block is prose describing one');

  // An opener whose delimiter never reappears is not a heredoc — that is not valid
  // shell. Without this, a stray opener in prose swallows every line below it. The
  // probe must use a QUOTED opener: with an unquoted one the `quoted` guard
  // suppresses the lines anyway, so the case would pass whether or not the
  // termination check exists.
  const stray = fenced(`documented as a heredoc: cat <<'EOF' writes a literal body`,
    payload, 'more prose');
  assert.equal(quotedHeredocLines(stray).size, 0,
    'an unterminated quoted opener must claim no lines');

  // And the terminator ends it: a line after the delimiter is outside the body.
  const closed = quotedHeredocLines(fenced(`cat <<'EOF'`, payload, 'EOF', payload));
  assert.ok(closed.has(2) && !closed.has(4), 'the delimiter line closes the body');
});

test('a fenced code block is a command context, whatever the verb', () => {
  // The gap this pins was live in three repos at once and invisible to every
  // layer: `inlineCodeSpans` finds only INLINE spans, a line inside a ```bash
  // block has no backticks of its own, and the fallback was the very verb list
  // the span rule was introduced to replace. Commands are mostly written in
  // fenced blocks, so that fallback covered the minority case.
  const ANCHOR = '${CLAUDE_PLUGIN_ROOT}';
  const cmd = `cp '${ANCHOR}/x.js' /tmp/staged.js`;   // no backticks, unlisted verb

  assert.equal(nonExpandingAnchors(cmd, false).length, 0,
    'outside a fence this line is prose to the verb list — that is the gap, stated');
  assert.ok(nonExpandingAnchors(cmd, true).length > 0,
    'inside a fence the same line is a command and the anchor is literal');

  // Double quotes DO expand, so the same line must stay clean inside a fence —
  // otherwise this rule would flag every correct command in the documentation.
  assert.equal(nonExpandingAnchors(`cp "${ANCHOR}/x.js" /tmp/staged.js`, true).length, 0,
    'a double-quoted anchor expands; a fence must not turn that into a violation');

  // Prose inside a fence must stay clean, and a real quoted command inside one must
  // not. Both halves are decided by whether the LINE PARSES: bash refuses a line
  // whose single quotes never close, so it can never be an instruction that runs.
  // Every row was checked against a real shell before being pinned here.
  //
  //   cp '${A}/x.js' /tmp/y              literal        → flag
  //   cp "${A}/x.js" /tmp/y              expands        → clean
  //   echo a'b ${A}/a'                   literal        → flag
  //   # the plugin's root is ${A}/x      SYNTAX ERROR   → clean
  //   # don't touch the plugin's ${A}/x  expands        → clean
  //   don't a it's b plugin's ${A}/x     SYNTAX ERROR   → clean
  //
  // Row 3 is why this is not the narrower rule it replaced. Skipping an apostrophe
  // flanked by word characters removed the prose false positives, but it also
  // silenced `a'b …/a'` — which genuinely opens a quote and genuinely leaves the
  // anchor literal. The claim that a real opening quote is never flanked on both
  // sides is false, and bash says so directly.
  for (const [line, mustFlag] of [
    [`cp '${ANCHOR}/x.js' /tmp/y`, true],
    [`cp "${ANCHOR}/x.js" /tmp/y`, false],
    [`echo a'b ${ANCHOR}/a'`, true],
    [`# the plugin's root is ${ANCHOR}/x`, false],
    [`# don't touch the plugin's ${ANCHOR}/x`, false],
    [`don't a it's b plugin's ${ANCHOR}/x`, false],
  ]) {
    assert.equal(nonExpandingAnchors(line, true).length > 0, mustFlag,
      `${mustFlag ? 'must flag' : 'must stay clean'} inside a fence: ${line}`);
  }

  // No language is exempt by info string, and that is deliberate. An earlier
  // version exempted `python`, `js`, `diff`, `markdown` and more — the same
  // enumeration defect one level down, because a single-quoted anchor is exactly
  // as literal in each of them. What decides is expansion, not language.
  for (const info of ['bash', '', 'python', 'js', 'diff', 'markdown', 'json']) {
    const body = ['prose', '```' + info, cmd, '```'].join('\n');
    assert.ok(fencedCommandLines(body).has(2),
      `a line inside a \`\`\`${info || '(unlabelled)'} block is a command line`);
  }

  // Fence marker parity, per CommonMark: a fence closes only on the SAME marker
  // character, at least as long as the one that opened it. Toggling on anything
  // fence-shaped inverts the state for the entire rest of the document, and
  // wrapping a ```bash example in a ````markdown block is the standard way to
  // document fenced blocks — which these repos do.
  const wrapped = ['````markdown', '```bash', cmd, '```', '````', 'prose'].join('\n');
  assert.ok(fencedCommandLines(wrapped).has(2),
    'a shorter inner fence must not close a longer outer one');
  assert.ok(!fencedCommandLines(wrapped).has(5),
    'and the outer fence must still close, or the rest of the file inverts');

  const tilde = ['```bash', '~~~', cmd, '```', 'prose'].join('\n');
  assert.ok(fencedCommandLines(tilde).has(2),
    'a tilde run must not close a backtick fence');
  assert.ok(!fencedCommandLines(tilde).has(4),
    'the matching backtick fence must still close it');

  // And the ordinary case still works, so the parity rule did not break closing.
  const plain = ['prose', '```bash', cmd, '```', 'prose'].join('\n');
  const f = fencedCommandLines(plain);
  assert.ok(f.has(2) && !f.has(0) && !f.has(4), 'a plain fenced block opens and closes');
  assert.ok(![1, 3].some((n) => f.has(n)), 'the fence markers are not content lines');
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

// ---------------------------------------------------------------------------
// Maintainer-only paths named in shipped documents.
//
// A gitignored directory does not exist in an installed plugin, so a path under
// one can only ever resolve against the ANALYSED PROJECT. Naming it in a shipped
// instruction hands that instruction to the project under analysis — the same
// substitution the anchoring rules exist to prevent, arriving by a route
// deny-by-default cannot see, because the path resolves nowhere in the index.
//
// This repo had no such rule. A cross-repo sweep planted
// `See `docs/UNDECLARED_RULES.md` for the rest.` in four sibling guards: two
// flagged it, this one did not. `docs/` is gitignored here, so the class is real
// and was simply unguarded.
//
// Not every gitignored directory qualifies. `.deep-*` is the suite's naming
// convention for a plugin's workspace output root, and for those, resolving
// against the analysed project is the CONTRACT rather than the defect — including
// a SIBLING's root, since telling an agent to read `.deep-review/…` in the project
// is a correct reference. The split asks that convention instead of guessing, and
// is asserted in both directions below.
const IGNORED_DIRS = (() => {
  const body = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  return body.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!') && line.endsWith('/'))
    .map((line) => line.replace(/\/$/, ''));
})();
// Three arms, each with a stated authority, and no list of variable names.
//
// (1) ASK THE CODE — a directory this plugin WRITES into a project is its own output
//     root. Writing is the discriminator, not joining: deep-work's release gate joins
//     `docs` onto `stateCapability.projectRoot` and only READS it, because `docs/`
//     belongs to whatever project is being analysed. An earlier version of this probe
//     matched any join and classified `docs/` as an output root — the rule silencing
//     the exact class it exists for. A variable-name allowlist was then tried to
//     separate them and is what this replaces: it admitted 0 of 8 call sites in a
//     sibling repo, where the project root is simply called `root`.
// (2) ASK THE CONVENTION — `.deep-*` is the suite's name for a plugin output root.
//     This covers a SIBLING's root, which this plugin never writes but a document may
//     correctly tell an agent to read in the project.
// (3) ASK THE HOST — a tool's per-project directory. `.claude` is Claude Code's,
//     `.vscode` and `.idea` are the editors'. None belongs to any plugin, all live in
//     the analysed project, and a document may correctly name one. This arm IS a small
//     enumeration and saying so is the point: its growth condition is known — a new
//     host or editor project directory — and the alternative, treating anything
//     unproven as a workspace output, is fail-open. `.vscode` and `.idea` were found
//     missing by a cross-repo sweep, flagged in a sibling that gitignores both.
const HOST_PROJECT_DIRS = new Set(['.claude', '.vscode', '.idea']);

function pluginWrittenDirs(dirs) {
  const WRITE = /(mkdirSync|writeFileSync|appendFileSync|createWriteStream|rmSync|cpSync|renameSync)/;
  const found = new Set();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.[cm]?js$/.test(e.name) || /\.test\.[cm]?js$/.test(e.name)) continue;
      const body = fs.readFileSync(p, 'utf8');
      for (const d of dirs) {
        if (found.has(d)) continue;
        const re = new RegExp(`['"\`]${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'g');
        let m;
        while ((m = re.exec(body))) {
          if (WRITE.test(body.slice(Math.max(0, m.index - 260), m.index + 260))) { found.add(d); break; }
        }
      }
    }
  };
  ['runtime', 'scripts', 'hooks', 'lib'].forEach((s) => walk(path.join(ROOT, s)));
  return found;
}

const WORKSPACE_OUTPUT_DIRS = new Set([
  ...pluginWrittenDirs(IGNORED_DIRS),
  ...IGNORED_DIRS.filter((d) => d.startsWith('.deep-')),
  ...IGNORED_DIRS.filter((d) => HOST_PROJECT_DIRS.has(d)),
]);
const MAINTAINER_ONLY_DIRS = IGNORED_DIRS
  .filter((d) => !WORKSPACE_OUTPUT_DIRS.has(d) && d !== 'node_modules');

// Declared exceptions: a maintainer-only path a document may name, and the clauses
// that earn the exception. The declaration is not a waiver — the test below makes
// the naming document carry each clause, so an entry here without the sentence is
// a failure, not a bypass.
const NON_SHIPPED_DECLARED = new Map([
  ['docs/DOCS_RULE.md', [
    /ships with nothing/,
    /never try to open it at runtime/,
    /only place that path can resolve in an installed plugin is the project being analysed/,
  ]],
]);

test('a path the plugin never ships carries the sentence that makes it safe', () => {
  const missing = [];
  for (const [declared, clauses] of NON_SHIPPED_DECLARED) {
    for (const file of markdownFiles()) {
      // Whitespace-normalised, blockquote markers dropped: a caveat's meaning does
      // not depend on where it wraps, and a test that breaks on rewrapping teaches
      // people to rewrap rather than to keep the sentence.
      const body = fs.readFileSync(file, 'utf8')
        .replace(/\n\s*>?\s*/g, ' ')
        .replace(/\s+/g, ' ');
      if (!body.includes(declared)) continue;
      for (const clause of clauses) {
        if (!clause.test(body)) {
          missing.push(`${path.relative(ROOT, file)} names ${declared} but is missing: ${clause.source}`);
        }
      }
    }
  }
  assert.deepEqual(missing, [],
    'a document names a path that ships with nothing, without the caveat that keeps a '
    + `reader from opening it in the analysed project:\n  ${missing.join('\n  ')}`);
});

test('the workspace-output split is derived from the convention, and is two-way', () => {
  assert.ok(IGNORED_DIRS.length > 0, '.gitignore yielded no ignored directories');
  assert.ok(MAINTAINER_ONLY_DIRS.includes('docs'),
    'docs must be swept — it is the class this rule exists for');
  for (const dir of MAINTAINER_ONLY_DIRS) {
    assert.ok(!dir.startsWith('.deep-'), `${dir} is an output root but is swept`);
  }
  assert.ok(WORKSPACE_OUTPUT_DIRS.size > 0,
    'no output root was recognised — then the split is doing nothing and every '
    + 'project-relative reference this plugin makes is about to be flagged');
  // The probe's failure mode, pinned. `docs/` IS joined onto a project root in this
  // family — deep-work's release gate reads `docs/DOCS_RULE.md` from the project it
  // is releasing — so a probe that keys on *joining* classifies it as an output root
  // and silences the rule for the exact class it exists for. Writing is what
  // separates them: nothing in this family ever writes `docs/`.
  assert.ok(!WORKSPACE_OUTPUT_DIRS.has('docs'),
    'docs is read, never written — a probe that classes it as an output root has '
    + 'silenced the rule');
  assert.ok(MAINTAINER_ONLY_DIRS.length < IGNORED_DIRS.length,
    'nothing was split off — the rule is unchanged, which is not what its comment claims');
});

test('no undeclared path under a maintainer-only directory is named', () => {
  // Lexical over raw lines, never consulting the resolver: that is what makes it
  // immune to any index blind spot, and why both separators are spelled out —
  // `normalizePath` never reaches here, so with `/` alone the backslash spelling
  // walks straight past.
  //
  // Negative lookbehind rather than a prefix list. Enumerating the characters that
  // may precede a path makes every character nobody thought of a bypass:
  // `**docs/X.md**` and `[docs/Y.md](…)` are ordinary markdown and slip past a
  // space/backtick/quote/paren list.
  const escaped = MAINTAINER_ONLY_DIRS.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(String.raw`(?<![A-Za-z0-9._\\/-])((?:${escaped})[\\/][A-Za-z0-9._\\/-]+)`, 'g');

  // Both spellings and both prefix shapes, pinned on the axis rather than left to
  // whatever the corpus happens to contain today.
  for (const probe of ['See `docs/backlog.md` for the rest.', 'See `docs\\backlog.md` too.',
    '**docs/bold.md** matters', '[docs/link.md](x) matters']) {
    re.lastIndex = 0;
    assert.ok(re.exec(probe), `the sweep must see: ${probe}`);
  }
  re.lastIndex = 0;
  assert.equal(re.exec('nodocs/notapath.md is mid-token'), null,
    'a match must not start mid-token');

  const violations = [];
  for (const file of markdownFiles()) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        if (NON_SHIPPED_DECLARED.has(m[1])) continue;   // earned by the caveat test above
        violations.push(`${path.relative(ROOT, file)}:${i + 1}  ${m[1]}`);
      }
    });
  }
  assert.deepEqual(violations, [],
    'a path under a maintainer-only directory is named in a shipped document; it '
    + 'resolves only against the analysed project:\n  ' + violations.join('\n  '));
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


// Which variables may root a path at this plugin. NOT a list of names, and NOT
// derived from what the runtime READS out of the environment — that was the first
// version's mistake and it was structural about the wrong thing. The runtime
// reading `env.CURSOR_PLUGIN_ROOT` for host *detection* says nothing about whether
// a document may spell the anchor that way; deep-memory's runtime reads four names
// and its contract sanctions two.
//
// The question a reader of these documents faces is: **is this variable guaranteed
// to hold the plugin root at the moment this line runs?** Two things guarantee it,
// and neither needs a name:
//
//   1. The spelling is sanctioned. The set is written here, in the security test,
//      and pinned against the contract document — not scraped out of it. Scraping
//      matched a syntactic shape and called it a sanction, so the sentence that most
//      explicitly FORBIDS a spelling was the sentence that permitted it:
//      `Never use \${ZZZ_PLUGIN_ROOT} — no host in this family sets it.` widened the
//      accept-set, and so did an HTML comment, which renders as nothing at all. A
//      shape cannot carry a sentence's meaning. Widening now takes an edit to this
//      file, which is the gate that should be hardest to pass.
//   2. The variable is bound earlier in the same fenced region, from an already
//      accepted anchor. A local needs no host to set it. This is the real reason
//      deep-report's `PLUGIN_ROOT="$(cd "\${CLAUDE_PLUGIN_ROOT:?…}" && pwd -P)"` is
//      safe, and the first version accepted those three lines for an unrelated
//      reason — it would have accepted them just as readily without the binding.
const CONTRACT_DOC = 'AGENTS.md';
const ANCHOR_VARS = new Set(['CLAUDE_PLUGIN_ROOT']);

// A local binding is `VAR=` (optionally `export VAR=`) whose RIGHT-HAND SIDE
// references an accepted anchor, on an earlier line with no fence marker in between.
//
// The right-hand side, not the line. Testing the line let a COMMENT do the work:
//
//     X_ROOT="$PWD"   # CLAUDE_PLUGIN_ROOT is unset on this host
//     node "$X_ROOT/<shipped>.js"
//
// went silent — a plausible line for someone documenting a non-Claude fallback, which
// roots the path at the working directory (the analysed project) and then runs a
// shipped script name from it. That is the whole attack, with the guard quiet. The
// same slip admitted `X_ROOT="\${CLAUDE_PLUGIN_ROOT_BACKUP}"`, where an accepted name
// is merely a substring of a variable nothing sets, so the reference is matched with
// a boundary rather than by `includes`.
//
// Regions are delimited by fence markers, not by `fenceBlocks()`'s CommonMark block
// ids, and the difference is load-bearing here. `skills/deep-report/SKILL.md` nests
// a ```bash example inside a ```markdown template using the same fence length, so by
// CommonMark the outer block ends at the inner opener and the binding lands in a
// different block from its use — three correct, fail-closed lines would be flagged.
// The property that actually matters is not which block markdown thinks a line is
// in; it is whether a reader copying from the binding to the use crosses a boundary,
// because two fenced blocks are two shell invocations and the second does not
// inherit the first's variables. Any fence marker between them is that boundary.
//
// Region 0 is everything before the document's first fence, where no shell runs at
// all, so a binding there is prose and cannot bind anything. RESIDUAL, stated rather
// than claimed away: prose sitting BETWEEN two fenced blocks gets a region of its own
// and can still read as a binding. Closing that needs open/close state, which is
// exactly what the nesting above makes unreliable here.
// A marker WITH an info string opens; a bare marker closes. That convention, not
// CommonMark's same-length matching, is what these documents actually follow — and it
// is the only reading under which `skills/deep-report/SKILL.md`'s ```bash nested in a
// ```markdown template puts its own lines inside a block. Depth is clamped at zero, so
// a document that opens with a bare marker under-counts and its bindings are rejected
// rather than trusted.
function fenceRegions(body) {
  let region = 0;
  let depth = 0;
  return body.split('\n').map((line) => {
    const m = /^[ \t]*(?:`{3,}|~{3,})(.*)$/.exec(line);
    if (m) {
      region += 1;
      depth = m[1].trim() ? depth + 1 : Math.max(0, depth - 1);
      return null;
    }
    return depth > 0 ? region : null;   // prose binds nothing — no shell runs it
  });
}
function bindsAnchor(line, name) {
  const assign = new RegExp(`(?:^|[;&|]\\s*)(?:export\\s+)?${name}=`);
  const m = assign.exec(line);
  if (!m) return false;
  let rhs = line.slice(m.index + m[0].length);
  // A trailing unquoted `#` comment is not part of the value. Quotes are tracked so
  // a `#` inside one stays in the value.
  let q = null;
  for (let i = 0; i < rhs.length; i += 1) {
    const c = rhs[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(rhs[i - 1]))) { rhs = rhs.slice(0, i); break; }
  }
  return [...ANCHOR_VARS].some((a) =>
    new RegExp(`\\$\\{?${a}(?![A-Za-z0-9_])`).test(rhs));
}
function locallyBound(lines, regions, upTo, name) {
  const region = regions[upTo];
  if (region === null) return false;   // the use is not inside a block
  for (let j = 0; j < upTo; j += 1) {
    if (regions[j] !== region) continue;
    if (bindsAnchor(lines[j], name)) return true;
  }
  return false;
}

test('a variable-rooted path that resolves in the plugin uses a sanctioned anchor', () => {
  // The guard recognised `${CLAUDE_PLUGIN_ROOT}` and flagged a BARE `sensors/x.js`,
  // but any variable root silenced it: `$ANYTHING/sensors/x.js` was clean. So a
  // second spelling of the plugin root passed unnoticed — measured live in this
  // family as `$PLUGIN_DIR/`, which nothing exports. Unset it expands to nothing;
  // set by the analysed project's environment it resolves wherever that points,
  // and `node` runs it.
  //
  // The rule cannot be "no variable roots" — `$WORK_DIR` and `$PROJECT_ROOT` are
  // legitimate workspace roots and outnumber the anchor here. What separates them
  // needs no list of names: **does the tail resolve in the shipped index?**
  // Measured across every variable-rooted path in this family's scanned documents
  // (counts are deep-work's; the shape is the same in deep-evolve and deep-memory):
  //
  //   $CLAUDE_PLUGIN_ROOT  185 tails resolve   (the anchor)
  //   $PLUGIN_DIR            4 resolve, 0 not  (rogue)
  //   $PLUGIN_ROOT           3 resolve, 0 not  (locally bound — see below)
  //   $WORK_DIR              0 resolve, 179 not
  //   $PROJECT_ROOT          0 resolve,  16 not
  //
  // Zero overlap. A variable whose tail names a shipped file is rooting a path at
  // this plugin, whatever it is called.
  assert.ok(ANCHOR_VARS.has('CLAUDE_PLUGIN_ROOT'),
    'the Claude spelling is the baseline and must be accepted');
  // The set lives in this file, so it cannot drift from the contract silently: every
  // accepted spelling must also be written in the contract document as a variable.
  // The first version had this backwards — it read the names OUT of the runtime and
  // justified the width with "AGENTS.md says so", which was true in two sibling repos
  // and false here.
  const contract = fs.readFileSync(path.join(ROOT, CONTRACT_DOC), 'utf8');
  for (const name of ANCHOR_VARS) {
    assert.match(contract, new RegExp(`\\$\\{?${name}(?![A-Za-z0-9_])`),
      `${CONTRACT_DOC} must document \${${name}} as an anchor, or the guard accepts `
      + 'a spelling the contract never sanctioned');
  }
  // What the set EXCLUDES is the half that can rot. A rule asserting only what its
  // accept-list contains can widen forever and stay green; the first version did
  // exactly that, and a single added comment was enough to whitelist a new name.
  for (const rogue of ['PLUGIN_DIR', 'CLAUDE_PLUGIN_DIR', 'SOME_OTHER_ROOT']) {
    assert.ok(!ANCHOR_VARS.has(rogue),
      `${rogue} is not an anchor spelling and must never be accepted`);
  }

  const VAR_ROOTED = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?[\\/]([A-Za-z0-9._\\/-]+)/g;
  // `normalizePath` collapses separators but leaves `.` and `..` alone, so an
  // exact-string index lookup let `$PLUGIN_DIR/./sensors/detect.js` and
  // `$PLUGIN_DIR/sensors/../sensors/detect.js` through — the same shipped file by
  // a spelling the index does not hold. Resolve before looking up.
  const resolveTail = (t) => normalizePath(t).split('/').reduce((acc, seg) => {
    if (seg === '.' || seg === '') return acc;
    if (seg === '..') { acc.pop(); return acc; }
    acc.push(seg);
    return acc;
  }, []).join('/');

  const offenders = [];
  for (const file of markdownFiles()) {
    const body = fs.readFileSync(file, 'utf8');
    const lines = body.split('\n');
    const regions = fenceRegions(body);
    lines.forEach((line, i) => {
      VAR_ROOTED.lastIndex = 0;
      let m;
      while ((m = VAR_ROOTED.exec(line))) {
        if (ANCHOR_VARS.has(m[1])) continue;
        if (locallyBound(lines, regions, i, m[1])) continue;
        if (!PLUGIN_FILES.has(resolveTail(m[2]))) continue;
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}  $${m[1]}/${m[2]}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'a path rooted at a variable that is neither a sanctioned anchor nor bound in '
    + `the same fenced region resolves to a shipped file:\n  ${offenders.join('\n  ')}`);

  // Non-vacuity, on every axis this rule decides. A control that cannot fire proves
  // nothing about the case beside it.
  const shipped = [...PLUGIN_FILES].find((k) => k.includes('/'));
  const hits = (text) => {
    const out = [];
    const lines = text.split('\n');
    const regions = fenceRegions(text);
    lines.forEach((line, i) => {
      VAR_ROOTED.lastIndex = 0;
      let m;
      while ((m = VAR_ROOTED.exec(line))) {
        if (ANCHOR_VARS.has(m[1])) continue;
        if (locallyBound(lines, regions, i, m[1])) continue;
        if (PLUGIN_FILES.has(resolveTail(m[2]))) out.push(m[1]);
      }
    });
    return out;
  };
  assert.deepEqual(hits(`node "$SOME_OTHER_ROOT/${shipped}"`), ['SOME_OTHER_ROOT'],
    'the rule must fire on a rogue spelling of the plugin root');
  assert.deepEqual(hits('cat "$WORK_DIR/research/notes.md"'), [],
    'a workspace root must stay silent — its tail does not name a shipped file');
  assert.deepEqual(hits(`node "\${CLAUDE_PLUGIN_ROOT}/${shipped}"`), [],
    'the sanctioned anchor must stay silent');
  // Traversal and `.` spellings of the same shipped file, which the exact-string
  // lookup used to miss.
  const dir = shipped.slice(0, shipped.lastIndexOf('/'));
  const base = shipped.slice(shipped.lastIndexOf('/') + 1);
  assert.deepEqual(hits(`node "$SOME_OTHER_ROOT/./${shipped}"`), ['SOME_OTHER_ROOT'],
    'a `.` segment must not hide a shipped tail');
  assert.deepEqual(hits(`node "$SOME_OTHER_ROOT/${dir}/../${dir}/${base}"`), ['SOME_OTHER_ROOT'],
    'a `..` round trip must not hide a shipped tail');
  // Local binding: same line, same block, bound vs unbound.
  const bound = ['```bash', `X_ROOT="\${CLAUDE_PLUGIN_ROOT}"`, `node "$X_ROOT/${shipped}"`, '```'].join('\n');
  const unbound = ['```bash', `node "$X_ROOT/${shipped}"`, '```'].join('\n');
  assert.deepEqual(hits(bound), [], 'a variable bound from the anchor in the same block is safe');
  assert.deepEqual(hits(unbound), ['X_ROOT'],
    'the same variable unbound must fire, or the binding arm is accepting everything');
  const otherBlock = ['```bash', `X_ROOT="\${CLAUDE_PLUGIN_ROOT}"`, '```', '', '```bash',
    `node "$X_ROOT/${shipped}"`, '```'].join('\n');
  assert.deepEqual(hits(otherBlock), ['X_ROOT'],
    'a binding in a different block must not carry over — the reader copies one block');
  // Review found each of these silent, so each gets its own case. Every one is a
  // complete attack: the path ends up rooted somewhere in the analysed project and a
  // shipped script name is run from it.
  const inBlock = (...body) => ['```bash', ...body, '```'].join('\n');
  assert.deepEqual(
    hits(inBlock(`X_ROOT="$PWD"   # ${[...ANCHOR_VARS][0]} is unset on this host`,
      `node "$X_ROOT/${shipped}"`)), ['X_ROOT'],
    'an anchor named only in a trailing COMMENT must not count as the binding');
  assert.deepEqual(
    hits(inBlock(`X_ROOT="\${${[...ANCHOR_VARS][0]}_BACKUP}"`, `node "$X_ROOT/${shipped}"`)),
    ['X_ROOT'],
    'an accepted name that is merely a SUBSTRING of the bound variable must not count');
  assert.deepEqual(
    hits([`X_ROOT=\${${[...ANCHOR_VARS][0]}} is the convention below.`,
      `$X_ROOT/${shipped}`].join('\n')), ['X_ROOT'],
    'a binding written in PROSE binds nothing — no shell runs it');
  // And the accept-set cannot be widened from the corpus at all: the names live in
  // this file. A sentence in the contract document that FORBIDS a spelling used to
  // permit it, because the scraper matched a shape and called it a sanction.
  assert.ok(!ANCHOR_VARS.has('ZZZ_PLUGIN_ROOT'),
    'the accept-set is declared here, not scraped from prose');
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

  // Both call sites, driven behaviourally rather than pinned by source text. A
  // source-text assertion pins the spelling of a call; it cannot see the
  // normalisation being removed from inside the function that call names. The
  // seams make the real thing decidable: build the index the way a Windows host
  // spells it, then run the production lookup against it.
  const winKeys = buildPluginFiles({
    toKey: (p) => path.relative(ROOT, p).split(path.sep).join('\\'),
  });
  assert.ok(winKeys.has('scripts/deep-work-runtime.js'),
    'key generation must normalise, not merely store what the platform produced');

  // Nested source on purpose: from a root-level document `dirname` is ROOT, so the
  // source-relative branch reproduces the direct branch and would rescue an
  // un-normalised token, hiding what these assertions claim to pin.
  const nested = path.join(ROOT, 'skills', 'deep-implement', 'SKILL.md');
  assert.equal(resolvesInPlugin('scripts/deep-work-runtime.js', nested, winKeys), true,
    'a slash-shaped lookup must resolve against Windows-shaped keys');
  assert.equal(resolvesInPlugin('scripts\\deep-work-runtime.js', nested, winKeys), true,
    'a backslash-shaped lookup must resolve too');

  // The `fromSource` half. On POSIX `path.relative` already returns slashes, so
  // removing repoKey's normalisation there is a no-op no local mutation can see —
  // driving the production call with a win32 `relative` is what makes it visible.
  const nestedTarget = [...winKeys].find((k) => k.includes('/'));
  const dir = nestedTarget.slice(0, nestedTarget.lastIndexOf('/'));
  const base = nestedTarget.slice(nestedTarget.lastIndexOf('/') + 1);
  const winRelative = (from, to) => path.relative(from, to).split('/').join('\\');
  // This pin is vacuous unless the DIRECT branch misses. `resolvesInPlugin`
  // strips the leading `./` and looks the bare basename up first; if a file of
  // that name sits at the repo root it returns there and the source-relative
  // branch — the thing being pinned — never runs, while the assertion still sees
  // `true`. Deriving the target from the shipped set protects against the target
  // MOVING, which fails loudly; it does nothing about this, which fails silently.
  assert.equal(winKeys.has(base), false,
    `a root-level ${base} would make the next assertion vacuous`);
  assert.equal(
    resolvesInPlugin(`./${base}`, path.join(ROOT, dir, 'sibling.md'), winKeys, winRelative),
    true,
    'the source-relative branch must normalise its own result before looking it up');

  // Non-vacuity, with a backslash token on purpose. A slash token makes this pair
  // decorative — the un-normalised key set misses either way, so it passes however
  // the token was handled (measured: with the slash spelling, removing the token
  // normalisation fails nothing). The backslash spelling discriminates.
  //
  // It is *dominated* in the current arrangement: the backslash lookup above fails
  // first on the same mutation, so this line does not execute and adds no detection
  // today. It is kept as a backstop, because the assertion that dominates it is an
  // enumeration of spellings — and enumerations get trimmed. Neutralise the spelling
  // above and remove the token normalisation, and this is what fails.
  const rawKeys = new Set([...winKeys].map((k) => k.split('/').join('\\')));
  assert.equal(resolvesInPlugin('scripts\\deep-work-runtime.js', nested, rawKeys), false,
    'un-normalised keys must not be reachable by an un-normalised token');
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
    // A string comparison, not a filesystem probe. Both earlier attempts probed
    // the disk and both were wrong on Windows: `path.join` makes the two
    // spellings identical there, and `path.posix.join` only stops *join* from
    // folding — `fs` folds `/` to `\\` below it, so the un-normalised form still
    // names the existing file and the pair contradicted itself either way. What
    // the block is actually documenting is that normalisation changes the string,
    // and that holds on every platform.
    const raw = 'scripts\\deep-work-runtime.js';
    assert.notEqual(normalizePath(raw), raw,
      'normalisation must change a backslash spelling, or nothing below it matters');
    assert.ok(fs.existsSync(path.join(ROOT, normalizePath(raw))),
      'and the normalised spelling must name a file that exists');
    // Load-bearing but unpinned: removing `normalizePath` at the resolution site
    // breaks no test, because no shipped document is written that way yet. The
    // failure would first appear as a false `missing` on a file that exists.
    // Recorded, not claimed — same label this file gives its leaf normalisations.
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
