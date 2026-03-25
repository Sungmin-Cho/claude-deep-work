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
function checkTddEnforcement(tddState, filePath, tddMode, exemptPatterns) {
  // spike mode at session level = all edits allowed
  if (tddMode === 'spike') {
    return { allowed: true };
  }

  // relaxed mode = no TDD enforcement
  if (tddMode === 'relaxed') {
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
          `팁: 어떤 동작을 테스트해야 할지 생각해보세요.`,
      };
    }
    return {
      allowed: false,
      reason: `⛔ TDD 강제: production 코드 수정이 차단되었습니다.\n` +
        `현재 TDD 상태: ${tddState}\n` +
        `먼저 failing test를 작성하고 실행하세요 (RED → RED_VERIFIED 필요).\n` +
        `파일: ${filePath}`,
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
  { pattern: /(?:^|\|)\s*(?:>\s*|>>)\s*\S+/, desc: 'output redirection (> or >>)' },
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
];

/**
 * Safe commands that look like they might write but don't, or are
 * needed for test execution / normal development.
 */
const SAFE_COMMAND_PATTERNS = [
  /\bnpm\s+test\b/, /\bnpm\s+run\s+test\b/, /\byarn\s+test\b/,
  /\bnpx\s+/, /\bbun\s+test\b/, /\bcargo\s+test\b/,
  /\bpytest\b/, /\bpython\s+-m\s+pytest\b/,
  /\bgo\s+test\b/, /\bmake\s+test\b/,
  /\bgit\s+(status|log|diff|branch|show|stash|fetch)\b/,
  /\bgit\s+add\b/, /\bgit\s+commit\b/,
  /\bls\b/, /\bpwd\b/, /\bwhich\b/, /\bcat\s+[^>]/, /\bhead\b/, /\btail\b/,
  /\bgrep\b/, /\bfind\b/, /\bwc\b/, /\bsort\b/, /\buniq\b/,
  /\bnode\s+--test\b/, /\bnode\s+-e\b/,
  /\bmkdir\s/, /\brm\s/,  // directory operations, not file writes to source
];

/**
 * Checks if a bash command attempts to write files.
 * @param {string} command - The bash command string
 * @returns {{ isFileWrite: boolean, pattern?: string }}
 */
function detectBashFileWrite(command) {
  if (!command || typeof command !== 'string') {
    return { isFileWrite: false };
  }

  const trimmed = command.trim();

  // Check safe patterns first — if a command is clearly safe, allow
  for (const safe of SAFE_COMMAND_PATTERNS) {
    if (safe.test(trimmed)) {
      return { isFileWrite: false };
    }
  }

  // Check file-write patterns
  for (const { pattern, desc } of FILE_WRITE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isFileWrite: true, pattern: desc };
    }
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
  /tests?\//,
  /__tests__\//,
];

function isTestFilePath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return TEST_FILE_PATTERNS.some(p => p.test(normalized));
}

const DEFAULT_EXEMPT_PATTERNS = [
  /\.ya?ml$/,
  /\.json$/,
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
    // Bash tool: check for file writes
    if (toolName === 'Bash') {
      const { isFileWrite, pattern } = detectBashFileWrite(toolInput.command);
      if (isFileWrite) {
        // Apply TDD enforcement to bash file writes too
        const tddResult = checkTddEnforcement(
          state.tdd_state || TDD_STATES.PENDING,
          toolInput.command,  // use command as "path" for TDD check
          state.tdd_mode || 'strict',
          state.exempt_patterns,
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

  // idle or unknown phase: allow
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
      // On any error, output allow (fail-open for robustness)
      // But log to stderr for debugging
      process.stderr.write(`phase-guard-core error: ${err.message}\n`);
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      process.exit(0);
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
  const normalizedSize = (size || 'M').toUpperCase();
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
  const normalized = model.toLowerCase().trim();
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
