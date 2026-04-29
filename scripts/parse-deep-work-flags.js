// scripts/parse-deep-work-flags.js
'use strict';

const RECOMMENDER_ALLOWLIST = /^(haiku|sonnet|opus)$/;
const EXEC_ALLOWLIST = /^(inline|delegate)$/;
// R3-D fix: profile name sanitization (yaml injection 차단)
const PROFILE_NAME_ALLOWLIST = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

function parseFlags(args) {
  const flags = {
    profile: null, recommender: null, no_ask: false, no_recommender: false,
    team: false, zero_base: false, skip_research: false, skip_brainstorm: false,
    skip_review: false, no_branch: false, skip_to_implement: false, skip_integrate: false,
    setup: false, tdd_mode: null, resume_from: null,
    exec_mode: null, // v6.4.0 --exec=<mode>
    task: '', warnings: []
  };
  const taskParts = [];

  for (const arg of args) {
    if (arg === '--') continue; // separator skip (CLI usage: -- "$@")
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
    else if (arg.startsWith('--profile=')) {
      // R3-D fix: profile name sanitization (yaml injection 차단)
      const v = arg.slice('--profile='.length);
      if (!v) flags.warnings.push('--profile= 빈 값 — 무시');
      else if (PROFILE_NAME_ALLOWLIST.test(v)) flags.profile = v;
      else flags.warnings.push(`'${v}' 잘못된 프리셋 이름 — 영문/숫자/-/_만 허용 (≤31자), 무시`);
    }
    else if (arg.startsWith('--tdd=')) flags.tdd_mode = arg.slice('--tdd='.length);
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
    else if (arg.startsWith('--resume-from=')) flags.resume_from = arg.slice('--resume-from='.length);
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

module.exports = { parseFlags, RECOMMENDER_ALLOWLIST, EXEC_ALLOWLIST, PROFILE_NAME_ALLOWLIST };

// ── CLI entrypoint ──
if (require.main === module) {
  const args = process.argv.slice(2);
  process.stdout.write(JSON.stringify(parseFlags(args)) + '\n');
}
