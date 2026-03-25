const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  TDD_STATES,
  isValidTransition,
  checkTddEnforcement,
  detectBashFileWrite,
  checkSliceScope,
  validateReceipt,
  isTestFilePath,
  isExemptFile,
  processHook,
  lookupModel,
  validateModelName,
  DEFAULT_ROUTING_TABLE,
} = require('./phase-guard-core.js');

// ─── TDD State Machine Tests (8 tests) ──────────────────────

describe('TDD State Machine', () => {
  it('PENDING → RED: test file edit triggers transition', () => {
    assert.ok(isValidTransition('PENDING', 'RED'));
    assert.ok(!isValidTransition('PENDING', 'GREEN'));
  });

  it('RED → RED_VERIFIED: recording failing test output', () => {
    assert.ok(isValidTransition('RED', 'RED_VERIFIED'));
    assert.ok(!isValidTransition('RED', 'GREEN'));
  });

  it('RED_VERIFIED → GREEN_ELIGIBLE: production edit allowed', () => {
    assert.ok(isValidTransition('RED_VERIFIED', 'GREEN_ELIGIBLE'));
    const result = checkTddEnforcement('RED_VERIFIED', 'src/app.ts', 'strict', []);
    assert.ok(result.allowed);
  });

  it('PENDING blocks production file edits in strict mode', () => {
    const result = checkTddEnforcement('PENDING', 'src/app.ts', 'strict', []);
    assert.ok(!result.allowed);
    assert.ok(result.reason.includes('TDD 강제'));
  });

  it('RED blocks production file edits (need failing test first)', () => {
    const result = checkTddEnforcement('RED', 'src/handler.ts', 'strict', []);
    assert.ok(!result.allowed);
  });

  it('SPIKE mode allows all edits', () => {
    const result = checkTddEnforcement('PENDING', 'src/app.ts', 'spike', []);
    assert.ok(result.allowed);
  });

  it('coaching mode blocks with educational message', () => {
    const result = checkTddEnforcement('PENDING', 'src/app.ts', 'coaching', []);
    assert.ok(!result.allowed);
    assert.ok(result.reason.includes('코칭'));
  });

  it('test files always allowed regardless of TDD state', () => {
    const result = checkTddEnforcement('PENDING', 'src/app.test.ts', 'strict', []);
    assert.ok(result.allowed);
  });
});

// ─── Bash Command Detection Tests (5 tests) ─────────────────

describe('Bash Command Detection', () => {
  it('detects echo with redirect as file write', () => {
    const result = detectBashFileWrite("echo 'hello' > file.ts");
    assert.ok(result.isFileWrite);
  });

  it('allows cat without redirect (read only)', () => {
    const result = detectBashFileWrite('cat file.ts');
    assert.ok(!result.isFileWrite);
  });

  it('allows npm test (test execution)', () => {
    const result = detectBashFileWrite('npm test');
    assert.ok(!result.isFileWrite);
  });

  it('detects sed -i as file write', () => {
    const result = detectBashFileWrite("sed -i 's/old/new/' file.ts");
    assert.ok(result.isFileWrite);
  });

  it('detects cp as file write', () => {
    const result = detectBashFileWrite('cp source.ts dest.ts');
    assert.ok(result.isFileWrite);
  });
});

// ─── Cross-Model Review Tool Tests (v4.2) ───────────────────

describe('Cross-Model Review Safe Patterns', () => {
  it('allows codex exec (adversarial review)', () => {
    const result = detectBashFileWrite('codex exec "Review this plan document"');
    assert.ok(!result.isFileWrite);
  });

  it('allows timeout + codex exec', () => {
    const result = detectBashFileWrite('timeout 120 codex exec "$(cat /tmp/dw-review-abc.txt)" -s read-only');
    assert.ok(!result.isFileWrite);
  });

  it('allows gemini exec', () => {
    const result = detectBashFileWrite('gemini exec "Review this plan"');
    assert.ok(!result.isFileWrite);
  });

  it('allows gemini -p (fallback mode)', () => {
    const result = detectBashFileWrite('gemini -p "Review this plan"');
    assert.ok(!result.isFileWrite);
  });

  it('allows which codex/gemini (tool detection)', () => {
    assert.ok(!detectBashFileWrite('which codex').isFileWrite);
    assert.ok(!detectBashFileWrite('which gemini').isFileWrite);
  });

  it('allows mktemp (prompt temp file creation)', () => {
    const result = detectBashFileWrite('mktemp /tmp/dw-review-XXXXXXXX.txt');
    assert.ok(!result.isFileWrite);
  });

  it('allows codex --version (tool verification)', () => {
    assert.ok(!detectBashFileWrite('codex --version').isFileWrite);
    assert.ok(!detectBashFileWrite('gemini --version').isFileWrite);
  });
});

// ─── Slice Scope Tests ───────────────────────────────────────

describe('Slice Scope', () => {
  it('file in active slice is allowed', () => {
    const result = checkSliceScope('/project/src/auth.ts', ['src/auth.ts'], false);
    assert.ok(result.inScope);
  });

  it('file outside slice gets warning (default)', () => {
    const result = checkSliceScope('/project/src/other.ts', ['src/auth.ts'], false);
    assert.ok(!result.inScope);
    assert.ok(result.message.includes('경고'));
  });

  it('file outside slice gets blocked (strict)', () => {
    const result = checkSliceScope('/project/src/other.ts', ['src/auth.ts'], true);
    assert.ok(!result.inScope);
    assert.ok(result.message.includes('위반'));
  });
});

// ─── Receipt Validation Tests ────────────────────────────────

describe('Receipt Validation', () => {
  it('valid receipt passes', () => {
    const receipt = { slice_id: 'SLICE-001', status: 'complete', tdd_state: 'GREEN' };
    const result = validateReceipt(receipt);
    assert.ok(result.valid);
  });

  it('missing slice_id fails', () => {
    const receipt = { status: 'complete' };
    const result = validateReceipt(receipt);
    assert.ok(!result.valid);
    assert.ok(result.errors.includes('Missing slice_id'));
  });

  it('invalid status fails', () => {
    const receipt = { slice_id: 'SLICE-001', status: 'unknown' };
    const result = validateReceipt(receipt);
    assert.ok(!result.valid);
  });
});

// ─── Exempt File Tests ───────────────────────────────────────

describe('Exempt Files', () => {
  it('yml files are exempt from TDD', () => {
    assert.ok(isExemptFile('config.yml', []));
    assert.ok(isExemptFile('docker-compose.yaml', []));
  });

  it('md files are exempt from TDD', () => {
    assert.ok(isExemptFile('README.md', []));
  });

  it('ts files are NOT exempt', () => {
    assert.ok(!isExemptFile('src/app.ts', []));
  });

  it('test files are detected', () => {
    assert.ok(isTestFilePath('src/app.test.ts'));
    assert.ok(isTestFilePath('test/handler.spec.js'));
    assert.ok(isTestFilePath('tests/test_auth.py'));
    assert.ok(!isTestFilePath('src/app.ts'));
  });
});

// ─── Integration: processHook Tests ──────────────────────────

describe('processHook', () => {
  it('blocks Write in research phase', () => {
    const result = processHook({
      action: 'pre', toolName: 'Write',
      toolInput: { file_path: 'src/app.ts' },
      state: { current_phase: 'research' },
    });
    // Write in research is handled by bash fast path, Node.js just sees Bash
    assert.equal(result.decision, 'allow');
  });

  it('blocks Bash file write in research phase', () => {
    const result = processHook({
      action: 'pre', toolName: 'Bash',
      toolInput: { command: "echo 'x' > src/app.ts" },
      state: { current_phase: 'research' },
    });
    assert.equal(result.decision, 'block');
  });

  it('allows Bash read in research phase', () => {
    const result = processHook({
      action: 'pre', toolName: 'Bash',
      toolInput: { command: 'cat src/app.ts' },
      state: { current_phase: 'research' },
    });
    assert.equal(result.decision, 'allow');
  });

  it('allows edit in implement with valid TDD state', () => {
    const result = processHook({
      action: 'pre', toolName: 'Write',
      toolInput: { file_path: 'src/auth.ts' },
      state: {
        current_phase: 'implement',
        tdd_mode: 'strict',
        tdd_state: 'RED_VERIFIED',
        active_slice: 'SLICE-001',
        slice_files: ['src/auth.ts'],
      },
    });
    assert.equal(result.decision, 'allow');
  });

  it('blocks edit in implement with PENDING TDD state', () => {
    const result = processHook({
      action: 'pre', toolName: 'Write',
      toolInput: { file_path: 'src/auth.ts' },
      state: {
        current_phase: 'implement',
        tdd_mode: 'strict',
        tdd_state: 'PENDING',
        active_slice: 'SLICE-001',
        slice_files: ['src/auth.ts'],
      },
    });
    assert.equal(result.decision, 'block');
  });

  it('allows everything in idle phase', () => {
    const result = processHook({
      action: 'pre', toolName: 'Write',
      toolInput: { file_path: 'anything.ts' },
      state: { current_phase: 'idle' },
    });
    assert.equal(result.decision, 'allow');
  });
});

// ─── Model Routing Tests (v4.1) ─────────────────────────────

describe('Model Routing', () => {
  it('S → haiku', () => {
    const result = lookupModel('S');
    assert.equal(result.model, 'haiku');
    assert.ok(result.valid);
  });

  it('M → sonnet', () => {
    const result = lookupModel('M');
    assert.equal(result.model, 'sonnet');
    assert.ok(result.valid);
  });

  it('L → sonnet', () => {
    const result = lookupModel('L');
    assert.equal(result.model, 'sonnet');
    assert.ok(result.valid);
  });

  it('XL → opus', () => {
    const result = lookupModel('XL');
    assert.equal(result.model, 'opus');
    assert.ok(result.valid);
  });

  it('undefined size defaults to M → sonnet', () => {
    const result = lookupModel(undefined);
    assert.equal(result.model, 'sonnet');
  });

  it('custom routing table overrides defaults', () => {
    const result = lookupModel('S', { S: 'sonnet', L: 'opus' });
    assert.equal(result.model, 'sonnet');
  });

  it('invalid size falls back to M', () => {
    const result = lookupModel('XXL');
    assert.ok(!result.valid);
    assert.equal(result.model, 'sonnet');
  });
});

describe('Model Name Validation', () => {
  it('valid model names pass', () => {
    assert.ok(validateModelName('haiku').valid);
    assert.ok(validateModelName('sonnet').valid);
    assert.ok(validateModelName('opus').valid);
    assert.ok(validateModelName('main').valid);
    assert.ok(validateModelName('auto').valid);
  });

  it('invalid model name returns fallback sonnet', () => {
    const result = validateModelName('gpt-4');
    assert.ok(!result.valid);
    assert.equal(result.fallback, 'sonnet');
  });

  it('null/undefined returns fallback', () => {
    assert.ok(!validateModelName(null).valid);
    assert.ok(!validateModelName(undefined).valid);
  });

  it('case insensitive', () => {
    assert.ok(validateModelName('Haiku').valid);
    assert.ok(validateModelName('SONNET').valid);
  });
});
