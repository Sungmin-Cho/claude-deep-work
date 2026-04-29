// scripts/parse-deep-work-flags.js
'use strict';

const RECOMMENDER_ALLOWLIST = /^(haiku|sonnet|opus)$/;
const EXEC_ALLOWLIST = /^(inline|delegate)$/;
// R3-D fix: profile name sanitization (yaml injection 차단)
const PROFILE_NAME_ALLOWLIST = /^[a-z0-9][a-z0-9_-]{0,30}$/i;
const TDD_ALLOWLIST = /^(strict|relaxed|coaching|spike)$/;
const RESUME_FROM_ALLOWLIST = /^(brainstorm|research|plan|implement|test)$/;
// SESSION_ID는 alphanumeric + dash + dot 조합만 허용 (shell injection 차단)
const SESSION_ALLOWLIST = /^[\w.-]+$/;
// WORKTREE_PATH: shell injection 차단 (세미콜론, 메타문자, 빈 값 거부)
const WORKTREE_PATH_BLOCKLIST = /[;|&`$(){}[\]<>!#*?\\]/;

function parseFlags(args) {
  const flags = {
    profile: null, recommender: null, no_ask: false, no_recommender: false,
    team: false, zero_base: false, skip_research: false, skip_brainstorm: false,
    skip_review: false, no_branch: false, skip_to_implement: false, skip_integrate: false,
    setup: false, tdd_mode: null, resume_from: null,
    exec_mode: null, // v6.4.0 --exec=<mode>
    session: null, // v6.3.x --session=<id>
    worktree: null, // v6.3.x --worktree=<path>
    cross_model: false, // --cross-model
    no_cross_model: false, // --no-cross-model
    force_rerun: false, // --force-rerun
    task: '', warnings: []
  };
  const taskParts = [];

  for (const arg of args) {
    if (arg === '--') continue; // boundary marker from bash invocation 'node ... -- $ARGUMENTS' — NOT POSIX argument terminator
    // (parser continues processing flags after this token; -- is a no-op marker for shell wrapping only)
    if (arg === '--no-ask') flags.no_ask = true;
    else if (arg === '--no-recommender') flags.no_recommender = true;
    else if (arg === '--setup') flags.setup = true;
    else if (arg === '--team') flags.team = true;
    else if (arg === '--zero-base') flags.zero_base = true;
    else if (arg === '--skip-research') flags.skip_research = true;
    else if (arg === '--skip-brainstorm') flags.skip_brainstorm = true;
    else if (arg === '--skip-review') flags.skip_review = true;
    else if (arg === '--no-branch') flags.no_branch = true;
    else if (arg === '--skip-to-implement') flags.skip_to_implement = true;
    else if (arg === '--skip-integrate') flags.skip_integrate = true;
    else if (arg === '--cross-model') flags.cross_model = true;
    else if (arg === '--no-cross-model') flags.no_cross_model = true;
    else if (arg === '--force-rerun') flags.force_rerun = true;
    else if (arg.startsWith('--profile=')) {
      // R3-D fix: profile name sanitization (yaml injection 차단)
      const v = arg.slice('--profile='.length);
      if (!v) flags.warnings.push('--profile= 빈 값 — 무시');
      else if (PROFILE_NAME_ALLOWLIST.test(v)) flags.profile = v;
      else flags.warnings.push(`'${v}' 잘못된 프리셋 이름 — 영문/숫자/-/_만 허용 (≤31자), 무시`);
    }
    else if (arg.startsWith('--tdd=')) {
      const v = arg.slice('--tdd='.length);
      if (v === '') flags.warnings.push('--tdd= 빈 값 — 무시. 허용: strict|relaxed|coaching|spike');
      else if (TDD_ALLOWLIST.test(v)) flags.tdd_mode = v;
      else flags.warnings.push(`'${v}' 허용되지 않는 tdd 모드 — 무시. 허용: strict|relaxed|coaching|spike`);
    }
    else if (arg.startsWith('--exec=')) {
      // C5 — v6.4.0 호환: execution_override
      const v = arg.slice('--exec='.length);
      if (v === '') flags.warnings.push('--exec=가 빈 값 — 무시. 허용: inline|delegate'); // I2 fix
      else if (EXEC_ALLOWLIST.test(v)) flags.exec_mode = v;
      else flags.warnings.push(`'${v}'은(는) 허용되지 않는 exec 모드 — 무시. 허용: inline|delegate`);
    }
    else if (arg.startsWith('--recommender=')) {
      const v = arg.slice('--recommender='.length);
      if (RECOMMENDER_ALLOWLIST.test(v)) flags.recommender = v;
      else flags.warnings.push(`'${v}'은(는) 허용되지 않는 recommender 모델 — sonnet으로 fallback. 허용: haiku|sonnet|opus`);
    }
    else if (arg.startsWith('--resume-from=')) {
      const v = arg.slice('--resume-from='.length);
      if (v === '') flags.warnings.push('--resume-from= 빈 값 — 무시. 허용: brainstorm|research|plan|implement|test');
      else if (RESUME_FROM_ALLOWLIST.test(v)) flags.resume_from = v;
      else flags.warnings.push(`'${v}' 허용되지 않는 resume phase — 무시. 허용: brainstorm|research|plan|implement|test`);
    }
    else if (arg.startsWith('--session=')) {
      const v = arg.slice('--session='.length);
      if (v === '') flags.warnings.push('--session= 빈 값 — 무시');
      else if (SESSION_ALLOWLIST.test(v)) flags.session = v;
      else flags.warnings.push(`'${v}' 잘못된 session ID — 영문/숫자/dash/dot만 허용, 무시`);
    }
    else if (arg.startsWith('--worktree=')) {
      const v = arg.slice('--worktree='.length);
      if (v === '') flags.warnings.push('--worktree= 빈 값 — 무시');
      else if (WORKTREE_PATH_BLOCKLIST.test(v)) flags.warnings.push(`'${v}' 잘못된 worktree 경로 — shell 메타문자 포함 불가, 무시`);
      else flags.worktree = v;
    }
    else taskParts.push(arg);
  }
  flags.task = taskParts.join(' ');

  // ── 우선순위 매트릭스 (spec §8.1) ──
  // 1. --no-recommender > --recommender=MODEL (W11)
  if (flags.no_recommender && flags.recommender) {
    flags.warnings.push('--no-recommender 활성 — --recommender 인자는 무시됨');
    flags.recommender = null;
  }
  // 2. --no-ask > recommender 활성화
  if (flags.no_ask && flags.recommender) {
    flags.warnings.push('--no-ask 활성 — recommender는 호출되지 않음');
    flags.recommender = null;
  }
  // 3. recommender 미지정 + 거부 없음 + no-recommender 없음 + no-ask 없음 → 기본 sonnet
  if (!flags.recommender && !flags.no_ask && !flags.no_recommender) {
    // invalid 입력으로 인한 fallback도 여기서 sonnet 적용
    flags.recommender = 'sonnet';
  }

  return flags;
}

module.exports = { parseFlags, RECOMMENDER_ALLOWLIST, EXEC_ALLOWLIST, PROFILE_NAME_ALLOWLIST, TDD_ALLOWLIST, RESUME_FROM_ALLOWLIST, SESSION_ALLOWLIST, WORKTREE_PATH_BLOCKLIST };

// ── CLI entrypoint ──
if (require.main === module) {
  const rawArgs = process.argv.slice(2);
  // C1 fix (R5): If a single string arg containing spaces is passed (quoted $ARGUMENTS
  // pass-through from bash: node parser.js -- "$ARGUMENTS"), split it by whitespace
  // BEFORE allowlist application — shell metacharacters never reach the shell evaluator.
  const args = rawArgs.length === 1 && /\s/.test(rawArgs[0])
    ? rawArgs[0].split(/\s+/).filter(Boolean)
    : rawArgs;
  process.stdout.write(JSON.stringify(parseFlags(args.filter(a => a !== '--'))) + '\n');
}
