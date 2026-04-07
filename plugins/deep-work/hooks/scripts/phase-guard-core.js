#!/usr/bin/env node
/**
 * phase-guard-core.js — Node.js module for deep-work v4.0 Evidence-Driven Protocol
 *
 * Handles complex hook logic that bash cannot reliably do:
 * - TDD state machine enforcement
 * - Bash command file-write detection
 * - Receipt validation
 * - Slice scope enforcement
 *
 * Called by phase-guard.sh when the fast path (bash) determines
 * that complex validation is needed (implement phase, Bash tool).
 *
 * Input: JSON on stdin with { action, toolName, toolInput, state }
 * Output: JSON on stdout with { decision: "allow"|"block", reason?: string }
 */

const fs = require('fs');
const path = require('path');

// ─── TDD State Machine ───────────────────────────────────────

const TDD_STATES = {
  PENDING: 'PENDING',
  RED: 'RED',
  RED_VERIFIED: 'RED_VERIFIED',
  GREEN_ELIGIBLE: 'GREEN_ELIGIBLE',
  GREEN: 'GREEN',
  REFACTOR: 'REFACTOR',
  SPIKE: 'SPIKE',
};

const VALID_TRANSITIONS = {
  PENDING: ['RED', 'SPIKE'],
  RED: ['RED_VERIFIED', 'SPIKE'],
  RED_VERIFIED: ['GREEN_ELIGIBLE', 'SPIKE'],
  GREEN_ELIGIBLE: ['GREEN', 'SPIKE'],
  GREEN: ['REFACTOR', 'PENDING', 'SPIKE'],  // PENDING = next slice
  REFACTOR: ['GREEN', 'PENDING', 'SPIKE'],
  SPIKE: ['PENDING'],  // exit spike → restart TDD
};

function isValidTransition(from, to) {
  if (!VALID_TRANSITIONS[from]) return false;
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Determines if a file edit should be allowed based on TDD state.
 * @param {string} tddState - Current TDD state of the active slice
 * @param {string} filePath - File being edited
 * @param {string} tddMode - Session TDD mode: strict|relaxed|coaching|spike
 * @param {string[]} exemptPatterns - File patterns exempt from TDD (e.g., *.yml)
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkTddEnforcement(tddState, filePath, tddMode, exemptPatterns, tddOverride) {
  // spike mode at session level = all edits allowed
  if (tddMode === 'spike') {
    return { allowed: true };
  }

  // relaxed mode = no TDD enforcement
  if (tddMode === 'relaxed') {
    return { allowed: true };
  }

  // TDD override = slice-level skip (user chose to bypass TDD via AskUserQuestion)
  if (tddOverride) {
    return { allowed: true };
  }

  // Check exempt file patterns
  if (isExemptFile(filePath, exemptPatterns)) {
    return { allowed: true };
  }

  const isTestFile = isTestFilePath(filePath);

  // Test files can always be edited (writing tests is always allowed)
  if (isTestFile) {
    return { allowed: true };
  }

  // Production file edits require RED_VERIFIED or later states
  const productionAllowedStates = [
    TDD_STATES.RED_VERIFIED,
    TDD_STATES.GREEN_ELIGIBLE,
    TDD_STATES.GREEN,
    TDD_STATES.REFACTOR,
    TDD_STATES.SPIKE,
  ];

  if (!productionAllowedStates.includes(tddState)) {
    const isCoaching = tddMode === 'coaching';
    if (isCoaching) {
      return {
        allowed: false,
        reason: `💡 TDD 코칭: 이 slice에서 먼저 테스트를 작성해보세요.\n` +
          `현재 상태: ${tddState} — 먼저 failing test를 작성하고 실행하면\n` +
          `production 코드를 수정할 수 있습니다.\n\n` +
          `팁: 어떤 동작을 테스트해야 할지 생각해보세요.\n\n` +
          `TDD를 건너뛰려면:\n` +
          `  /deep-slice spike SLICE-NNN — 이 slice만 자유 코딩 (merge 불가)\n` +
          `  /deep-slice reset SLICE-NNN — slice 리셋 후 재시작\n` +
          `  (auto-flow 사용 시 /deep-implement 내에서 자동 관리됩니다)`,
      };
    }
    return {
      allowed: false,
      reason: `⛔ TDD 강제: production 코드 수정이 차단되었습니다.\n` +
        `현재 TDD 상태: ${tddState}\n` +
        `먼저 failing test를 작성하고 실행하세요 (RED → RED_VERIFIED 필요).\n` +
        `파일: ${filePath}\n\n` +
        `TDD를 건너뛰려면:\n` +
        `  /deep-slice spike SLICE-NNN — 이 slice만 자유 코딩 (merge 불가)\n` +
        `  /deep-slice reset SLICE-NNN — slice 리셋 후 재시작\n` +
        `  (auto-flow 사용 시 /deep-implement 내에서 자동 관리됩니다)`,
    };
  }

  return { allowed: true };
}

// ─── Bash Command Detection ──────────────────────────────────

/**
 * File-writing shell patterns that bypass Write/Edit tools.
 * Each pattern has a regex and a description.
 */
const FILE_WRITE_PATTERNS = [
  { pattern: /(?:^|[|;]|\s)(?:>{1,2})\s*\S+/, desc: 'output redirection (> or >>)' },
  { pattern: /\btee\s+(?:-a\s+)?\S+/, desc: 'tee command' },
  { pattern: /\bsed\s+-i/, desc: 'sed in-place edit' },
  { pattern: /\bcp\s+/, desc: 'cp (file copy)' },
  { pattern: /\bmv\s+/, desc: 'mv (file move)' },
  { pattern: /\binstall\s+-/, desc: 'install command' },
  { pattern: /\bdd\s+.*of=/, desc: 'dd with output file' },
  { pattern: /\bcat\s+.*>\s*\S+/, desc: 'cat with redirect' },
  { pattern: /\becho\s+.*>\s*\S+/, desc: 'echo with redirect' },
  { pattern: /\bprintf\s+.*>\s*\S+/, desc: 'printf with redirect' },
  { pattern: /\bpatch\s+/, desc: 'patch command' },
  { pattern: /\bchmod\s+/, desc: 'chmod (permission change)' },
  { pattern: /\bchown\s+/, desc: 'chown (ownership change)' },
  { pattern: /\bperl\s+.*-[^\s]*i/, desc: 'perl in-place edit' },
  { pattern: /\bnode\s+-e\s+.*(?:writeFile|appendFile|createWriteStream|fs\.)/, desc: 'node -e file system write' },
  { pattern: /\bawk\s+.*-i\s+inplace\b/, desc: 'awk in-place edit' },
  { pattern: /\bpython[23]?\s+-c\s+.*(?:open\s*\(|write|\.dump)/, desc: 'python -c file write' },
  { pattern: /\bruby\s+-e\s+.*(?:File\.|IO\.|open\s*\()/, desc: 'ruby -e file write' },
  { pattern: /\bswift\s+-e\s+.*(?:write|FileManager|contentsOf)/, desc: 'swift -e file write' },
  { pattern: /\btruncate\s+/, desc: 'truncate command' },
  { pattern: /\bsponge\s+/, desc: 'sponge (moreutils) write' },
  { pattern: /\bgit\s+(push|reset\s+--hard|checkout\s+--\s|clean\s+-f)/, desc: 'destructive git operation' },
  { pattern: /\bcurl\s+.*-[^\s]*o\s/, desc: 'curl output to file' },
  { pattern: /\bwget\s+.*-[^\s]*O\s/, desc: 'wget output to file' },
  { pattern: /\bln\s+(?:-[^\s]*\s+)*\S+\s+\S+/, desc: 'ln (link creation)' },
  { pattern: /\btar\s+.*x/, desc: 'tar extract (file creation)' },
  { pattern: /\bunzip\s+/, desc: 'unzip (file extraction)' },
  { pattern: /\bcpio\s+/, desc: 'cpio archive extraction' },
  { pattern: /\brsync\s+/, desc: 'rsync (file sync)' },
  { pattern: /\bwriteFile\b/, desc: 'Node.js writeFile API call' },
];

/**
 * Safe commands that look like they might write but don't, or are
 * needed for test execution / normal development.
 */
const SAFE_COMMAND_PATTERNS = [
  /\bnpm\s+test\b/, /\bnpm\s+run\s+test\b/, /\byarn\s+test\b/,
  /\bnpx\s+/, /\bbun\s+test\b/, /\bcargo\s+test\b/,
  /\bpytest\b/, /\bpython\s+-m\s+pytest\b/, /\bpython\s+-m\s+unittest\b/,
  /\bgo\s+test\b/, /\bmake\s+test\b/,
  /\bgit\s+(status|log|diff|branch|show|stash|fetch)\b/,
  /\bgit\s+add\b/, /\bgit\s+commit\b/,
  /\bls\b/, /\bpwd\b/, /\bwhich\b/, /\bcat\s+[^<>]/, /\bhead\b/, /\btail\b/,
  /\bgrep\b/, /\bfind\b/, /\bwc\b/, /\bsort\b/, /\buniq\b/, /\bdiff\b/, /\bfile\b/,
  /\bnode\s+--test\b/,
  /\bmkdir\s/, /\brm\s/, /\brmdir\s/,  // directory operations, not file writes to source
  // v4.2: cross-model review tools (adversarial review in plan phase)
  /\bcodex\s+exec\b/, /\bcodex\s+--version\b/,
  /\bgemini\s+exec\b/, /\bgemini\s+-p\b/, /\bgemini\s+--version\b/,
  /\btimeout\s+\d+\s+codex\b/, /\btimeout\s+\d+\s+gemini\b/,
  /\bmktemp\b/,
  /\bdocker\s+(ps|images|inspect|logs)\b/, /\bkubectl\s+(get|describe|logs)\b/,
  /\bcargo\s+(build|check|clippy|fmt\s+--check|bench)\b/, /\bgo\s+(build|vet|fmt)\b/,
  /\bdeno\s+(test|check|lint|fmt\s+--check)\b/, /\bbun\s+(run|x)\b/,
  /\benv\b/, /\bprintenv\b/, /\btype\s/, /\bcommand\s+-v\b/,
  /\bstat\s/, /\bdu\s/, /\bdf\s/, /\bfree\s/, /\buname\b/, /\bhostname\b/,
  /\btsc\s+--noEmit\b/, /\bpython\s+-m\s+py_compile\b/,
];

/**
 * Extracts the target file path from a bash command that writes files.
 * Used to determine whether the target is a test file or production file
 * for TDD enforcement on bash commands.
 *
 * @param {string} command - The bash command string
 * @returns {string} extracted file path, or '' if not extractable (treated as production = fail-closed)
 */
function extractBashTargetFile(command) {
  if (!command || typeof command !== 'string') return '';
  const trimmed = command.trim();

  // sed -i [flags] 's/...' FILE
  const sedMatch = trimmed.match(/\bsed\s+(?:-[^i]*)?-i[^\s]*\s+(?:'[^']*'|"[^"]*"|\S+)\s+(\S+)/);
  if (sedMatch) return sedMatch[1];

  // tee [-a] FILE
  const teeMatch = trimmed.match(/\btee\s+(?:-a\s+)?(\S+)/);
  if (teeMatch) return teeMatch[1];

  // cp SRC DEST — target is last argument
  const cpMatch = trimmed.match(/\bcp\s+(?:-[^\s]+\s+)*\S+\s+(\S+)\s*$/);
  if (cpMatch) return cpMatch[1];

  // mv SRC DEST — target is last argument
  const mvMatch = trimmed.match(/\bmv\s+(?:-[^\s]+\s+)*\S+\s+(\S+)\s*$/);
  if (mvMatch) return mvMatch[1];

  // dd of=FILE
  const ddMatch = trimmed.match(/\bdd\s+.*\bof=(\S+)/);
  if (ddMatch) return ddMatch[1];

  // perl -pi -e '...' FILE
  const perlMatch = trimmed.match(/\bperl\s+.*-[^\s]*i[^\s]*\s+(?:-e\s+)?(?:'[^']*'|"[^"]*"|\S+)\s+(\S+)/);
  if (perlMatch) return perlMatch[1];

  // Redirect: ... > FILE or ... >> FILE
  const redirectMatch = trimmed.match(/>{1,2}\s*(\S+)\s*$/);
  if (redirectMatch) return redirectMatch[1];

  // Could not extract — return empty string (fail-closed: treated as production)
  return '';
}

/**
 * Splits a shell command string on &&, ||, ;, and | operators,
 * respecting single and double quotes.
 * @param {string} command - The shell command string
 * @returns {string[]} Array of individual sub-commands (trimmed)
 */
function splitCommands(command) {
  if (!command || typeof command !== 'string') return [];

  const parts = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let parenDepth = 0;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    // Handle escape inside double quotes
    if (ch === '\\' && inDouble && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 2;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }

    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += ch;
      i++;
      continue;
    }

    // Track $() subshell depth
    if (ch === '(' && !inSingle && !inDouble && !inBacktick) {
      parenDepth++;
      current += ch;
      i++;
      continue;
    }
    if (ch === ')' && !inSingle && !inDouble && !inBacktick && parenDepth > 0) {
      parenDepth--;
      current += ch;
      i++;
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick && parenDepth === 0) {
      // Check for && or ||
      if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
        parts.push(current.trim());
        current = '';
        i += 2;
        continue;
      }
      // Check for ; or single |
      if (ch === ';' || ch === '|') {
        parts.push(current.trim());
        current = '';
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  const last = current.trim();
  if (last) parts.push(last);

  return parts.filter(p => p.length > 0);
}

/**
 * Checks if a bash command attempts to write files.
 * Splits chained commands and checks each sub-command independently.
 * @param {string} command - The bash command string
 * @returns {{ isFileWrite: boolean, pattern?: string }}
 */
function detectBashFileWrite(command) {
  if (!command || typeof command !== 'string') {
    return { isFileWrite: false };
  }

  const subCommands = splitCommands(command);

  for (const sub of subCommands) {
    // Check file-write patterns FIRST (security-critical)
    let writeMatch = null;
    for (const { pattern, desc } of FILE_WRITE_PATTERNS) {
      if (pattern.test(sub)) {
        writeMatch = desc;
        break;
      }
    }

    // If file-write detected, return immediately (safe patterns cannot override)
    if (writeMatch) {
      return { isFileWrite: true, pattern: writeMatch };
    }

    // Check safe patterns — if no write detected and command is safe, skip it
    let isSafe = false;
    for (const safe of SAFE_COMMAND_PATTERNS) {
      if (safe.test(sub)) {
        isSafe = true;
        break;
      }
    }
    if (isSafe) continue;
  }

  return { isFileWrite: false };
}

// ─── Slice Scope Enforcement ─────────────────────────────────

/**
 * Checks if a file is within the active slice's scope.
 * @param {string} filePath - Absolute file path being modified
 * @param {string[]} sliceFiles - List of files in the active slice
 * @param {boolean} strictScope - If true, block; if false, warn only
 * @returns {{ inScope: boolean, message?: string }}
 */
function checkSliceScope(filePath, sliceFiles, strictScope) {
  if (!sliceFiles || sliceFiles.length === 0) {
    return { inScope: true }; // no slice files defined = no enforcement
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const inScope = sliceFiles.some(sf => {
    const normalizedSliceFile = sf.replace(/\\/g, '/');
    return normalizedPath.endsWith(normalizedSliceFile) ||
      normalizedPath === normalizedSliceFile;
  });

  if (inScope) {
    return { inScope: true };
  }

  if (strictScope) {
    return {
      inScope: false,
      message: `⛔ Slice scope 위반: ${filePath}은(는) 현재 활성 slice의 파일 목록에 없습니다.\n` +
        `허용 파일: ${sliceFiles.join(', ')}`,
    };
  }

  // Warning only (default behavior)
  return {
    inScope: false,
    message: `⚠️ Slice scope 경고: ${filePath}은(는) 현재 활성 slice의 파일 목록 밖입니다.\n` +
      `허용 파일: ${sliceFiles.join(', ')}`,
  };
}

// ─── Receipt Validation ──────────────────────────────────────

/**
 * Validates a receipt JSON file against the expected schema.
 * @param {object} receipt - Parsed receipt object
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateReceipt(receipt) {
  const errors = [];

  if (!receipt) {
    return { valid: false, errors: ['Receipt is null or undefined'] };
  }

  // Schema version check
  if (receipt.schema_version && receipt.schema_version !== '1.0') {
    errors.push(`Unknown schema_version: ${receipt.schema_version}. Expected: 1.0`);
  }

  // Required fields
  if (!receipt.slice_id) errors.push('Missing slice_id');
  if (!receipt.status) errors.push('Missing status');

  const validStatuses = ['complete', 'in_progress', 'partial', 'pending'];
  if (receipt.status && !validStatuses.includes(receipt.status)) {
    errors.push(`Invalid status: ${receipt.status}. Expected: ${validStatuses.join(', ')}`);
  }

  const validTddStates = Object.values(TDD_STATES);
  if (receipt.tdd_state && !validTddStates.includes(receipt.tdd_state)) {
    errors.push(`Invalid tdd_state: ${receipt.tdd_state}`);
  }

  // TDD section validation (if present)
  if (receipt.tdd) {
    if (receipt.tdd.failing_test_output && typeof receipt.tdd.failing_test_output !== 'string') {
      errors.push('tdd.failing_test_output must be a string');
    }
    if (receipt.tdd.passing_test_output && typeof receipt.tdd.passing_test_output !== 'string') {
      errors.push('tdd.passing_test_output must be a string');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Utility Functions ───────────────────────────────────────

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /test_.*\.py$/,
  /.*_test\.py$/,
  /.*_test\.go$/,
  /.*_test\.rb$/,
  /.*\.test\.rb$/,
  /spec\/.*_spec\.rb$/,
  /.*_test\.rs$/,           // Rust
  /.*Test\.java$/,          // Java
  /.*Tests\.java$/,         // Java (plural)
  /.*Tests?\.cs$/,          // C#
  /.*Test\.kt$/,            // Kotlin
  /.*Tests?\.swift$/,       // Swift
  /.*_test\.exs?$/,         // Elixir
  /.*\.test\.lua$/,         // Lua
  /.*\.test\.dart$/,        // Dart/Flutter
  /.*_test\.dart$/,         // Dart (alt)
  /.*\.test\.vue$/,         // Vue
  /tests?\//,
  /__tests__\//,
  /spec\//,                 // RSpec, etc.
  /fixtures?\//,            // Test fixtures
  /__fixtures__\//,         // Jest fixtures
  /__mocks__\//,            // Jest mocks
];

function isTestFilePath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return TEST_FILE_PATTERNS.some(p => p.test(normalized));
}

const DEFAULT_EXEMPT_PATTERNS = [
  /\.ya?ml$/,
  /\.json$/,
  /\.toml$/,
  /\.ini$/,
  /\.cfg$/,
  /\.lock$/,
  /\.editorconfig$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.gif$/,
  /\.md$/,
  /\.txt$/,
  /\.env/,
  /\.gitignore$/,
  /Dockerfile$/,
  /\.dockerignore$/,
  /Makefile$/,
];

function isExemptFile(filePath, customPatterns) {
  const normalized = filePath.replace(/\\/g, '/');
  const allPatterns = [
    ...DEFAULT_EXEMPT_PATTERNS,
    ...(customPatterns || []).map(p => new RegExp(p)),
  ];
  return allPatterns.some(p => p.test(normalized));
}

/**
 * Truncates a string to the last N lines.
 * @param {string} text
 * @param {number} maxLines
 * @returns {string}
 */
function truncateOutput(text, maxLines) {
  if (!text) return '';
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join('\n');
}

// ─── Main Entry Point ────────────────────────────────────────

/**
 * Process a hook invocation.
 * @param {object} input - { action, toolName, toolInput, state }
 *   action: "pre" | "post"
 *   toolName: "Write" | "Edit" | "Bash" | etc.
 *   toolInput: { file_path?, command?, ... }
 *   state: { current_phase, tdd_mode, active_slice, tdd_state, slice_files, strict_scope, exempt_patterns }
 * @returns {{ decision: "allow"|"block"|"warn", reason?: string }}
 */
function processHook(input) {
  const { action, toolName, toolInput, state } = input;

  if (!state || !state.current_phase) {
    return { decision: 'allow' };
  }

  const phase = state.current_phase;

  // ─── Artifacts-only fork restriction (v5.6) ───────────
  if (state.fork_mode === 'artifacts-only' && ['implement', 'test'].includes(phase)) {
    return {
      decision: 'block',
      reason: `🚫 Non-git fork는 plan phase까지만 진행 가능합니다.\n` +
        `구현을 진행하려면 git 환경에서 /deep-fork를 사용하세요.`,
    };
  }

  // ─── Non-implement phases: block all writes ────────────
  if (['research', 'plan', 'test', 'brainstorm'].includes(phase)) {
    if (toolName === 'Bash') {
      const { isFileWrite, pattern } = detectBashFileWrite(toolInput.command);
      if (isFileWrite) {
        return {
          decision: 'block',
          reason: `⛔ Deep Work Guard: ${phase} 단계에서 파일 쓰기가 차단되었습니다.\n` +
            `감지된 패턴: ${pattern}\n명령: ${toolInput.command}`,
        };
      }
      return { decision: 'allow' };
    }
    // Write/Edit already handled by bash fast path — shouldn't reach here
    return { decision: 'allow' };
  }

  // ─── Implement phase: TDD + Slice enforcement ──────────
  if (phase === 'implement') {
    // Validate TDD state is a known value (defensive)
    const knownState = state.tdd_state || TDD_STATES.PENDING;
    if (!Object.values(TDD_STATES).includes(knownState)) {
      return {
        decision: 'block',
        reason: `⛔ Deep Work Guard: 알 수 없는 TDD 상태입니다: ${knownState}\n` +
          `/deep-status로 현재 상태를 확인하세요.`,
      };
    }

    // Bash tool: check for file writes
    if (toolName === 'Bash') {
      const { isFileWrite, pattern } = detectBashFileWrite(toolInput.command);
      if (isFileWrite) {
        // Apply TDD enforcement to bash file writes too
        const tddResult = checkTddEnforcement(
          state.tdd_state || TDD_STATES.PENDING,
          extractBashTargetFile(toolInput.command),  // extract actual target file
          state.tdd_mode || 'strict',
          state.exempt_patterns,
          !!state.tdd_override,
        );
        if (!tddResult.allowed) {
          return { decision: 'block', reason: tddResult.reason };
        }
      }
      return { decision: 'allow' };
    }

    // Write/Edit: TDD + Slice scope
    const filePath = toolInput.file_path || '';

    // Check TDD enforcement
    const tddResult = checkTddEnforcement(
      state.tdd_state || TDD_STATES.PENDING,
      filePath,
      state.tdd_mode || 'strict',
      state.exempt_patterns,
      !!state.tdd_override,
    );
    if (!tddResult.allowed) {
      return { decision: 'block', reason: tddResult.reason };
    }

    // Check slice scope
    if (state.slice_files && state.active_slice) {
      const scopeResult = checkSliceScope(
        filePath,
        state.slice_files,
        state.strict_scope || false,
      );
      if (!scopeResult.inScope) {
        return {
          decision: state.strict_scope ? 'block' : 'warn',
          reason: scopeResult.message,
        };
      }
    }

    return { decision: 'allow' };
  }

  // Unknown phase (not idle): warn but allow
  if (phase !== 'idle') {
    return {
      decision: 'allow',
      reason: `⚠️ Deep Work Guard: 알 수 없는 phase '${phase}'. 기본 허용합니다.`,
    };
  }

  // idle phase: allow
  return { decision: 'allow' };
}

// ─── CLI Entry ───────────────────────────────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const parsed = JSON.parse(input);
      const result = processHook(parsed);
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    } catch (err) {
      // On any error, block (fail-closed for security)
      // Log to stderr for debugging
      process.stderr.write(`phase-guard-core error: ${err.message}\n`);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '⛔ Deep Work Guard: hook 검증 중 내부 오류가 발생했습니다. 다시 시도해주세요.'
      }));
      process.exit(2);
    }
  });
}

// ─── Model Routing (v4.1) ───────────────────────────────────

const DEFAULT_ROUTING_TABLE = {
  S: 'haiku',
  M: 'sonnet',
  L: 'sonnet',
  XL: 'opus',
};

const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'main', 'auto'];

/**
 * Looks up the model for a given slice size.
 * @param {string} size - S, M, L, or XL
 * @param {object} [customTable] - Custom routing table (optional)
 * @returns {{ model: string, valid: boolean }}
 */
function lookupModel(size, customTable) {
  const table = { ...DEFAULT_ROUTING_TABLE, ...(customTable || {}) };
  const normalizedSize = (size || 'M').toString().toUpperCase().trim();
  const model = table[normalizedSize];
  if (!model) {
    return { model: table['M'] || 'sonnet', valid: false };
  }
  return { model, valid: true };
}

/**
 * Validates a model name.
 * @param {string} model - Model name to validate
 * @returns {{ valid: boolean, fallback: string }}
 */
function validateModelName(model) {
  if (!model || typeof model !== 'string') {
    return { valid: false, fallback: 'sonnet' };
  }
  const normalized = model.toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
  if (VALID_MODELS.includes(normalized)) {
    return { valid: true, fallback: normalized };
  }
  return { valid: false, fallback: 'sonnet' };
}

// ─── Exports (for testing) ───────────────────────────────────

module.exports = {
  TDD_STATES,
  VALID_TRANSITIONS,
  isValidTransition,
  checkTddEnforcement,
  detectBashFileWrite,
  splitCommands,
  extractBashTargetFile,
  checkSliceScope,
  validateReceipt,
  isTestFilePath,
  isExemptFile,
  truncateOutput,
  processHook,
  DEFAULT_ROUTING_TABLE,
  VALID_MODELS,
  lookupModel,
  validateModelName,
};
