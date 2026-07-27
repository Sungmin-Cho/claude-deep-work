# Interactive session setup (§1-4)

> Reference for `skills/deep-work-orchestrator/SKILL.md`. Assumption auto-adjust integration, the session-recommender sub-agent call, the per-item AskUserQuestion loop, result accumulation, and pause/re-entry. Read when §1-4 runs — that is, unless `--no-ask` skipped it.

---

## 1-4. 항목별 대화형 설정

`--no-ask` 또는 `--profile=X --no-ask` 지정 시 §1-4 전체 skip → §1-5로 진행.

### §1-4-1. Assumption auto-adjust 결과 통합

§1-7(Assumption Health Check)이 §1-4 이전에 실행되어 `tdd_mode` 등을 auto-adjust한 결과를 in-memory `current_defaults`에 반영. 이후 recommender 호출의 입력 `current_defaults`가 됨.

(§1-7은 번호 유지, §1-4-1이 §1-7 결과를 consume하는 방식으로 연결 — 섹션 번호 재정렬 회피.)

### §1-4-2. session-recommender sub-agent 호출 (in-memory only)

조건:
- `--no-recommender` 미지정 + sanitize 후 입력 토큰 ≤ 8k인 경우만 호출
- 그 외: 추천 없이 ask 진입 (옵션 라벨 = "(자동 추천 실패 — 직접 선택)")

capability 감지:

````bash
# env-only IS_GIT 의존 제거 — 실 git 명령으로 직접 검출
IS_GIT=$(git rev-parse --is-inside-work-tree 2>/dev/null || echo "false")
WORKTREE_SUPPORTED=$(git worktree list >/dev/null 2>&1 && echo "true" || echo "false")
TEAM_ENV=$([ -n "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}" ] && echo "true" || echo "false")

export IS_GIT WORKTREE_SUPPORTED TEAM_ENV
CAP=$(node -e '
  const { detectCapability } = require("'"${CLAUDE_PLUGIN_ROOT}"'/scripts/detect-capability.js");
  const cap = detectCapability({
    is_git: process.env.IS_GIT === "true",
    worktree_supported: process.env.WORKTREE_SUPPORTED === "true",
    team_env_set: process.env.TEAM_ENV === "true"
  });
  process.stdout.write(JSON.stringify(cap));
')
````

호출 (`deep-work:session-recommender` → 2단계 fallback):

````javascript
const { sanitizeInput } = require("${CLAUDE_PLUGIN_ROOT}/scripts/recommender-input.js");
const { parseRecommendation } = require("${CLAUDE_PLUGIN_ROOT}/scripts/recommender-parser.js");
const { filterAskItems } = require("${CLAUDE_PLUGIN_ROOT}/runtime/recommender-runtime.js");

const input = sanitizeInput({
  task_description: TASK_TEXT,
  recent_commits: RECENT_COMMITS,
  top_level_dirs: TOP_DIRS,
  current_defaults: current_defaults,
  capability: CAPABILITY,
  ask_items: filterAskItems(PROFILE_DATA.interactive_each_session)  // model_routing은 영구 제거 (구프로필 포함)
});

let result;
try {
  result = await Agent({
    subagent_type: "deep-work:session-recommender",
    model: RECOMMENDER_MODEL,  // sonnet 기본, --recommender= override
    prompt: JSON.stringify(input)
  });
} catch (e) {
  if (/subagent_type.*not found/i.test(e.message || '')) {
    result = await Agent({
      subagent_type: "session-recommender",
      model: RECOMMENDER_MODEL,
      prompt: JSON.stringify(input)
    });
  } else {
    throw e;
  }
}

const parsed = parseRecommendation(result.text, { capability: input.capability });

// 자동 모델 결정(§1-8.5)의 난이도 입력. parsed.ok=false거나 task_difficulty 부재면 빈 값 → 무보정.
const REC_TASK_DIFFICULTY = (parsed.ok && parsed.data.task_difficulty) ? parsed.data.task_difficulty.value : "";
````

`parsed.ok=false` 또는 30초 timeout → recommender skip + `(자동 추천 실패 — 직접 선택)` 라벨로 ask 진입.

**호스트에 `Agent` 도구가 없을 때 (Codex)**: 위 `Agent({...})` 호출은 존재하지 않으므로
실행하지 말고, `${CLAUDE_PLUGIN_ROOT}/agents/session-recommender.md`의 프롬프트와 출력
스키마를 그대로 사용해 **인라인으로 추천을 산출**한 뒤, 같은 `parseRecommendation(result.text, ...)`
에 먹일 수 있도록 `result`를 직접 구성한다:

- `result.text`는 `json` 코드 펜스를 **정확히 하나만** 포함해야 한다 (0개면 `no-json-fence`,
  2개 이상이면 `multiple-fences`로 fallback 처리된다).
  그 펜스 안에 `team_mode` / `start_phase` / `tdd_mode` / `git` / `task_difficulty` 5개 키를
  각각 `{ value, reason }` 형태로 담는다.
- 인라인 산출이 실패하거나 스키마를 만족시키지 못하면 `parsed.ok=false`와 동일하게 취급하여
  recommender를 skip하고 `(자동 추천 실패 — 직접 선택)` 라벨로 ask에 진입한다.

규칙 정본은 `AGENTS.md` §Host differences.

### §1-4-3. interactive_each_session 항목별 AskUserQuestion (in-memory only)

> **주의**: 순회 전 `filterAskItems()`(recommender-runtime)를 적용한다 — 구프로필 `interactive_each_session`에 `model_routing`이 남아 있어도 ask하지 않는다(모델은 §1-8.5에서 자동 결정).

`filterAskItems(PROFILE_DATA.interactive_each_session)` 배열을 순회하며 각 항목별 AskUserQuestion. CLI 플래그로 이미 override된 항목은 건너뜀.

각 ask 항목별로 옵션 라벨 빌드:

````javascript
const { formatOptions, capabilityToDisabled } = require("${CLAUDE_PLUGIN_ROOT}/scripts/format-ask-options.js");
const disabled = capabilityToDisabled(CAP, item);
const opts = formatOptions({
  item,
  recommendation: REC[item] || null,
  default_value: DEFAULTS[item],
  enum_values: ENUMS[item],
  disabled_values: disabled
});
// AskUserQuestion(opts.map(o => ({ label: o.label, value: o.value })))
````

### §1-4-4. 결과 누적

ask 결과는 orchestrator 변수에 누적. **state file 미생성**. §1-9 시점에 한 번에 atomic write.

### §1-4-5. 일시정지 시 재진입

ask 도중 사용자 일시정지 → state file 미생성 상태로 종료. 복귀(`/deep-work` 재호출) 시 §1-1부터 재시작 (recommender도 재호출).

