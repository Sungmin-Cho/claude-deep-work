---
name: deep-work-orchestrator
description: "This skill should be used when the user invokes /deep-work \"task\", asks to start a new deep-work session, or requests evidence-driven workflow auto-flow across Brainstorm → Research → Plan → Implement → Test phases. Handles session initialization (profile v3 load, capability detection, session-recommender sub-agent, AskUserQuestion 5-key ask, flag parsing) and dispatches the 5-phase pipeline with Exit Gates between each phase."
---

# Step 1: 세션 초기화

사용자 입력: **$ARGUMENTS**

> `--resume-from=<phase>` 가 지정된 경우: Step 1의 **interactive/setup 대화(프로필 질문, 작업 모드 선택 등)만 건너뛴다**. `SESSION_ID`는 `--session`에서 결정되고, 기존 state file을 재사용하며 새 세션 파일을 쓰지 않는다.
>
> **반드시 수행 (NO2 + NP1 fix)**:
> 1. Step 1-2 state file 로드: `.claude/deep-work.{SESSION_ID}.md`에서 `work_dir`, `task_description`, `worktree_enabled`, `worktree_path`, `team_mode`, `cross_model_enabled`, `tdd_mode`, `iteration_count`, `skipped_phases`, `research_approved`, `research_approved_hash`, `plan_approved`, `plan_approved_hash`, `current_phase` 등 모든 상태 변수 로드.
> 2. `$WORK_DIR` 변수 초기화 (state의 `work_dir`에서). §3-2/§3-3 hash check 등 파일 경로 참조 시 필수.
> 3. Step 2 (조건 변수 조립 — `ARGS`, `tdd_mode` 등) 수행하여 Skill 호출에 session/worktree/tdd context 보존.
>
> 그 후 Step 3의 해당 `<phase>` branch로 점프한다.

### Step 1-3: Model Routing Migration (v6.4.0)

State load 직후, Step 3 dispatch 전에 migration helper 를 호출하여 `model_routing.{research,implement,test} == "main"` 값을 `"sonnet"` 으로 atomic 치환한다. `model_routing.plan` 은 migration 대상에서 제외 (Plan phase는 대화형 메인 세션이 설계상 필수 — spec §3 D1 W1).

**호출 조건**: `$STATE_FILE`이 이미 존재할 때만 호출 (W-1.1 fix — 새 세션은 §1-9에서 state를 생성하므로 이 시점엔 파일이 없을 수 있음).

실행:
```bash
if [ -f "$STATE_FILE" ]; then
  result=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-model-routing.js" "$STATE_FILE" 2>&1 || true)
fi
```

또는 동등한 JS import (orchestrator가 Node 런타임 내에서 실행 가능한 경우):
```javascript
const { migrateStateFile } = require('./scripts/migrate-model-routing.js');
// migrateStateFile 자체가 fs.existsSync 가드를 내부에서 처리 (W-2.2)
const { replaced, warnings } = migrateStateFile(stateFile);
```

출력 결과:
- `replaced`가 비어있지 않으면 각 필드별로 1회 알림:
  `[migration v6.4.0] model_routing.research='main' deprecated → 'sonnet' 적용`
- `warnings`가 있으면 그대로 stderr에 출력 (치환 없이 원본 유지).
- 치환이 발생한 경우 atomic `writeFile + rename` 으로 state file에 persist됨.

(spec §5.7, §6.1 참조)

## 1-1. Update Check

SessionStart hook의 update-check.sh 출력 처리:
- `JUST_UPGRADED` → 업그레이드 완료 메시지, 계속 진행
- `UPGRADE_AVAILABLE` → AskUserQuestion으로 업그레이드 제안 (업그레이드 / 건너뜀)

## 1-2. 기존 세션 확인 (Multi-Session)

### Legacy 마이그레이션
`.claude/deep-work.local.md` 존재 + active → `migrate_legacy_state` 실행

### Stale 세션 감지
`detect_stale_sessions` → 각 stale 세션에 대해 AskUserQuestion:
1. 이어서 진행 → state 읽기 + worktree 확인 + artifact 복원 → **Step 3으로 jump**
2. 종료 처리 → idle 설정, registry 해제
3. 무시 → 계속

### Active 세션 목록
Registry에서 활성 세션 표시. 5개 이상이면 경고.

### 세션 ID 생성
```
SESSION_ID=$(generate_session_id)
write_session_pointer "$SESSION_ID"
```

## 1-3. 프로필 로드 + 플래그 파싱 (v6.4.2)

### 플래그 표

| 플래그 | 효과 |
|--------|------|
| `--setup` | 프로필 재설정 강제 |
| `--team` | team_mode → "team" (해당 항목 ask 우회) |
| `--zero-base` | project_type → "zero-base" |
| `--skip-research` | start_phase → "plan" (해당 항목 ask 우회) |
| `--skip-brainstorm` | brainstorm 건너뜀 |
| `--tdd=MODE` | strict / relaxed / coaching / spike (해당 항목 ask 우회) |
| `--skip-review` | review_state → "skipped" |
| `--no-branch` | git → "current-branch" (해당 항목 ask 우회) |
| `--skip-to-implement` | Plan까지 전부 건너뜀, 인라인 slice |
| `--skip-integrate` | Phase 5 Integrate 건너뜀 (v6.3.0) |
| `--profile=X` | 프리셋 X 직접 선택 (ask 단계는 진행, v6.4.2 의미 유지) |
| `--no-ask` | 신규 (v6.4.2): ask 단계 모두 skip + 추천 skip (가장 빠른 경로) |
| `--recommender=MODEL` | 신규 (v6.4.2): 추천 모델 override. allowlist `^(haiku\|sonnet\|opus)$`, 그 외 거부 + sonnet fallback + 1회 경고 |
| `--no-recommender` | 신규 (v6.4.2): 추천 sub-agent skip (defaults 값으로 ask 진입) |
| `--exec=<inline\|delegate>` | (v6.4.0) Implement 단계 실행 방식 override. parser → state.execution_override → deep-implement §1.5에서 read |
| `--resume-from=<phase>` | Step 1 초기화 건너뛰고 기존 state로 `<phase>`(research/plan/implement/test) 해당 Step 3-N부터 재개. `deep-resume.md`가 사용. |

### §1-3-1. 플래그 파서 호출

orchestrator 본문에서 직접 실행 (process scope 일관 — R3-B):

````bash
# C1 fix (R5): $ARGUMENTS를 double-quoted single arg로 전달 — shell metacharacters가
# parser allowlist 적용 전에 shell에 의해 평가되지 않음.
# parser CLI entrypoint는 단일 공백 포함 인자를 split-before-allowlist로 처리.
PARSE_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/parse-deep-work-flags.js" -- "$ARGUMENTS" 2>/tmp/dw-parse-err.txt)
parse_rc=$?
````

- `parse_rc` 비-zero → `/tmp/dw-parse-err.txt` 내용 표시 + AskUserQuestion (재입력 / 종료). `2>&1 || true` 패턴 사용 금지 (R3-C).
- `PARSE_OUT` (JSON) → `TASK_TEXT`, `FLAGS` 객체 추출.
- `TASK_TEXT` 비어 있으면 AskUserQuestion("작업 내용을 입력해 주세요.").

> `scripts/parse-deep-work-flags.js`는 Task 4에서 구현. 본 task는 호출 step만 박제.

### §1-3-2. 프로필 v2→v3 마이그레이션

파서 결과로 `DEEP_WORK_INITIAL_PRESET`(= `FLAGS.profile` 또는 null)이 채워진 후 migration 호출 (R3-W1):

````bash
PROFILE_FILE="$PROJECT_ROOT/.claude/deep-work-profile.yaml"
migrate_stderr=$(mktemp)
MIGRATE_OUT=$(DEEP_WORK_INITIAL_PRESET="${FLAGS.profile}" \
  node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-profile-v2-to-v3.js" "$PROFILE_FILE" 2>"$migrate_stderr")
migrate_rc=$?
````

- `migrate_rc` 비-zero → `$migrate_stderr` 내용 표시 + AskUserQuestion (수동 이전 / 새 v3 강제 생성 / 종료). `2>&1 || true` 패턴 사용 금지 (R3-C).
- `MIGRATE_OUT` (JSON stdout):
  - `{ "migrated": true, "reason": "v2-to-v3" }` → 1회 안내:
    > "프로필을 v3로 마이그레이션했습니다. 알림 설정은 제거되었고, 매 세션마다 5개 항목(team/start/tdd/git/model)에 대해 LLM 추천 + 확인을 거칩니다. ask 항목 변경: `/deep-work --setup`. 빠른 경로: `/deep-work --profile=X --no-ask`."

    이후 migrate warnings 표시:
    ```bash
    if echo "$MIGRATE_OUT" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); process.exit(r.warnings && r.warnings.length ? 0 : 1)'; then
      echo "$MIGRATE_OUT" | node -e '
        const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
        for (const w of (r.warnings || [])) console.error("[migrate] " + w);
      '
    fi
    ```
  - `{ "migrated": false, "reason": "already-v3" }` → silent.
  - `{ "migrated": false, "reason": "not-found-created-v3" }` → 1회 안내:
    > "신규 프로필 (v3 형식)을 작성했습니다: `$PROFILE_FILE`. 매 세션마다 5개 항목 ask + 추천이 진행됩니다. 빠른 경로: `--profile=solo-strict --no-ask`."

### §1-3-3. v3 프로필 로더 호출

````bash
# W3 fix (R5): --profile=X가 loader에 전달되도록 DEEP_WORK_INITIAL_PRESET export
# (§1-3-2의 migrate-profile 호출과 동일한 env 전달 패턴으로 parity 확보)
PROFILE_OUT=$(DEEP_WORK_INITIAL_PRESET="${FLAGS.profile}" \
  node "${CLAUDE_PLUGIN_ROOT}/scripts/load-v3-profile.js" "$PROFILE_FILE" 2>/tmp/dw-profile-err.txt)
profile_rc=$?
````

- `profile_rc` 비-zero → `/tmp/dw-profile-err.txt` 내용 표시 + AskUserQuestion (재시도 / 종료).
- `PROFILE_OUT` (JSON stdout) → `PROFILE_DATA` (presets, default_preset, interactive_each_session, defaults) 추출.

> `scripts/load-v3-profile.js`는 Task 3.5에서 구현. 본 task는 호출 step만 박제.

### §1-3-4. 플래그 우선순위 적용

아래 우선순위 순서로 in-memory `current_defaults` 구성 (나중 단계가 앞 단계를 override):

1. `PROFILE_DATA.defaults` (프리셋 기본값)
2. `--profile=X` 선택 프리셋 defaults (명시 선택 시)
3. CLI 플래그 (`--team`, `--tdd=MODE`, `--no-branch`, `--skip-research` 등)
4. `--no-ask` → `interactive_each_session` 전 항목 건너뜀 표시

`current_defaults`는 §1-4 ask 흐름의 입력값. `--no-ask` 지정 시 §1-4 전체 skip.

### §1-3-5. 파싱 경고 표시

`FLAGS.warnings` 배열 비어있지 않으면 각 경고를 1회씩 표시:
- 알 수 없는 플래그: `"⚠ 알 수 없는 플래그 무시됨: --foo"`
- `--recommender=` allowlist 위반: `"⚠ --recommender=gpt4 불인식 → sonnet fallback"`
- 기타 파서 경고: 그대로 표시.

### --setup 사용 시

`FLAGS.setup` = true → 기존 프로필 존재하면 프리셋 관리 UI (편집 / 새로 만들기).

## 1-4. 항목별 대화형 설정 (v6.4.2)

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
# W2 fix (R5): env-only IS_GIT 의존 제거 — 실 git 명령으로 직접 검출
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

const input = sanitizeInput({
  task_description: TASK_TEXT,
  recent_commits: RECENT_COMMITS,
  top_level_dirs: TOP_DIRS,
  current_defaults: current_defaults,
  capability: CAPABILITY,
  ask_items: PROFILE_DATA.interactive_each_session
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
````

`parsed.ok=false` 또는 30초 timeout → recommender skip + `(자동 추천 실패 — 직접 선택)` 라벨로 ask 진입.

### §1-4-3. interactive_each_session 항목별 AskUserQuestion (in-memory only)

`PROFILE_DATA.interactive_each_session` 배열을 순회하며 각 항목별 AskUserQuestion. CLI 플래그로 이미 override된 항목은 건너뜀.

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

## 1-5. 작업 디렉토리 생성

```
mkdir -p .deep-work
TASK_FOLDER="${TIMESTAMP}-${SLUG}"
mkdir -p ".deep-work/${TASK_FOLDER}"
```

Legacy `deep-work/` → `.deep-work/` 마이그레이션 자동 처리.

## 1-6. Cross-model 도구 감지

codex/gemini 설치 여부 확인 → 프로필의 `cross_model_preference`에 따라 자동 활성화 / AskUserQuestion.

## 1-7. Assumption Health Check

세션 히스토리 충분 시 (>=5):
- assumption engine auto-adjust 실행
- 자동 조정 결과 표시 (tdd_mode 등)
- 사용자 --tdd 플래그가 override

## 1-8. Git Branch + Worktree

Git repository인 경우:
- 프로필/플래그에 따라 worktree 격리 / 새 브랜치 / 현재 브랜치 유지
- Worktree 성공 시: `worktree_enabled: true`, `worktree_path`, `worktree_branch` state에 기록
- 이후 모든 파일 작업은 worktree 절대 경로 기준

## 1-9. State 파일 + Registry 생성 (atomic + 권한 600)

`.claude/deep-work.{SESSION_ID}.md` 생성 (YAML frontmatter):
- session_id, current_phase, task_description, work_dir
- team_mode, tdd_mode, model_routing, worktree_*, cross_model_*
- 각 phase timestamp, test_retry_count, max_test_retries 등
- **`recommendations: { ... }`** (v6.4.2 신규) — §1-4-2 sub-agent 응답 + §1-4-3 사용자 최종 선택 (옵셔널 필드, phase-guard enforcement에는 영향 없음)
- `execution_override: {FLAGS.exec_mode | null}` — v6.4.0 호환, deep-implement Section 1.5에서 read

**작성 절차** (atomic + 권한 600):

````bash
state_tmp="${state_path}.tmp"
write_yaml_to "$state_tmp"   # state file 내용 작성 (YAML frontmatter)
chmod 600 "$state_tmp"
sync_file "$state_tmp"
mv -f "$state_tmp" "$state_path"   # atomic rename
````

§1-4-2/§1-4-3의 in-memory 결과는 이 시점에 `recommendations` 필드로 직렬화. phase-guard는 `current_phase`, `*_completed_at`, `*_approved` 필드만 검사하며 `recommendations` 필드는 enforcement에 영향을 미치지 않는다.

Registry 등록: `register_session "$SESSION_ID" ...`

## 1-10. 프로필 저장 (첫 실행 시)

프로필 미존재 시 `.claude/deep-work-profile.yaml`에 **v3 형식**으로 저장 (v2 형식 사용 금지). §1-3-2의 migration 단계가 `not-found-created-v3` 응답 시 이미 v3 파일이 생성되므로, 본 단계에서는 §1-4-3 ask 결과를 반영하여 해당 프리셋 defaults를 업데이트한다.

## 1-11. 세션 확인 표시

```
Deep Work 세션이 시작되었습니다!

작업: $ARGUMENTS
작업 폴더: $WORK_DIR
프리셋: [preset_name]
작업 모드: Solo / Team
TDD 모드: strict / relaxed / coaching / spike
모델 라우팅: R=[model] P=main I=[model] T=[model]

워크플로우:
  Phase 0: deep-brainstorm  [← 현재 / ✅ 건너뜀]
  Phase 1: deep-research
  Phase 2: deep-plan
  Phase 3: deep-implement
  Phase 4: deep-test
  Phase 5: deep-integrate  [skippable]

각 phase 완료 시 진행 확인을 받으며 순차 실행합니다. "다음 phase로 진행" 선택 시 추가 확인 없이 즉시 다음 단계를 시작합니다.
```

# Step 2: 조건 변수 조립

```
ARGS="--session={SESSION_ID}"
if worktree_enabled: ARGS += " --worktree={worktree_path}"
if team_mode=team:   ARGS += " --team"
if cross_model_enabled: ARGS += " --cross-model"
if tdd_mode:         ARGS += " --tdd={tdd_mode}"
```

# Step 3: Auto-flow Dispatch

State의 `current_phase`에서 시작점 결정:
- brainstorm → 3-1 | research → 3-2 | plan → 3-3 | implement → 3-4 | test → 3-5

## 3-1. Brainstorm (skip 가능)

`skipped_phases` / `start_phase` 확인. 건너뛰면 Exit Gate 생략하고 `current_phase: research`로 직접 전환 → 3-2.

Skill("deep-brainstorm", args=ARGS)

Brainstorm skill의 Section 3 완료 메시지 출력 후:

### Exit Gate (Phase 0 → Phase 1)

AskUserQuestion:

- header: "Phase 0 (Brainstorm) 완료. 어떻게 진행할까요?"
- multiSelect: false
- options:
  1. label: "다음 phase로 진행", description: "즉시 Phase 1 Research를 시작합니다"
  2. label: "이 phase 재실행/수정", description: "Brainstorm을 재실행하거나 brainstorm.md를 편집합니다"
  3. label: "일시정지", description: "세션 유지. /deep-resume으로 복귀 시 이 Exit Gate로 돌아옵니다"

분기:
- option 1 → **즉시 `current_phase: research` 설정** (F1 Option A) → **§3-2 Research로 dispatch** (§3-2 body가 Resume check + Skill 호출 담당). 본 branch에서 Skill을 직접 호출하지 않는다 — §3-2 본문과 중복 실행 방지 (v6.3.1 NO1 fix).
- option 2 → **재실행 전 completion marker clear (v6.3.1 NC2 symmetric)**: `brainstorm_completed_at: null` 설정 → 이후 사용자 상세 지시 청취. brainstorm.md 직접 편집(phase-guard 허용) 또는 `Skill("deep-brainstorm", args=ARGS + " --force-rerun")` 재호출. 재실행이 완료된 뒤에만 `brainstorm_completed_at`이 다시 기록되어 Resume fast-path가 정상 동작.
- option 3 → current_phase는 `brainstorm` 유지. "세션 유지됨. `/deep-resume {SESSION_ID}`로 복귀 시 Exit Gate가 재표시됩니다." 출력 후 턴 종료.

## 3-2. Research

`skipped_phases`에 "research" 포함 시 Exit Gate 생략하고 `current_phase: plan`으로 직접 전환 → 3-3.

**Resume 분기 (v6.3.1 F1 + NW5 integrity check)**: state의 `research_approved: true`가 이미 있고 `$ARGUMENTS`에 `--force-rerun`이 없으면 paused-after-approval 복귀 후보 경로이다. 단, **approval integrity check**가 추가로 필요:

1. `research_approved_hash` (state) 와 현재 `$WORK_DIR/research.md`의 sha256을 비교:
   - `Bash({ command: "shasum -a 256 \"$WORK_DIR/research.md\" | awk '{print $1}'" })` (or `sha256sum` on Linux)
   - 해시 일치 → approval은 유효. Skill 호출과 review+approval을 **건너뛰고** 바로 아래 Exit Gate 실행.
   - 해시 불일치 → **out-of-band 편집 감지 → data preservation + in-place review** (v6.3.1 NO3 fix + NP3 collision fix):
     1. 현재 `$WORK_DIR/research.md`를 `$WORK_DIR/research.v{iteration_count+1}-edit.md`로 복사 (편집 내용 백업). **`-edit` 접미사** 사용 — deep-research skill의 기존 `research.v{iteration_count}.md` backup과 파일명 충돌 방지 (NP3).
     2. `iteration_count`을 1 증가.
     3. Approval state invalidate: `research_approved: false`, `research_approved_at: null`, `research_approved_hash: null`.
     4. 경고: "⚠️ research.md가 승인 이후 외부에서 수정되었습니다. 편집 내용은 research.v{N}-edit.md로 백업되었습니다. 편집된 현재 문서를 대상으로 Review+Approval을 재실행합니다."
     5. **Skill 재호출 없이** 아래 Review+Approval workflow (Step 1-6)로 직접 진입 — 현재 수정된 문서를 in-place review. template 기반 재생성 path는 스킵하여 사용자 편집 보존.
     6. 최종 승인 시 새 `research_approved_hash` 기록 (현재 편집된 파일의 sha256).
     7. 사용자가 거부 시 옵션 제공: 직접 수정 / `Skill("deep-research", args + " --force-rerun")`로 완전 재생성. `-edit` 접미사 덕분에 force-rerun 경로에서 skill의 자체 backup(`v{N}.md`)과 collision 없이 원본 편집 backup 보존됨.
   - `research_approved_hash` 필드 부재 (pre-v6.3.1 세션 또는 재실행 후 미승인) → Skill 재실행 + review+approval. pre-v6.3.1 세션은 fresh approval flow로 가는 것이 safer default.
   - 파일 missing → 복구 불가능. Skill 재실행 + review+approval (edited doc 소실 시점을 감출 수 없음).

2. `research.md`가 아닌 state만 가진 drift 상태 또한 invalidate (복구 불가능 상태를 감춘 채 진행하지 않음).

주의: `research_completed_at` / `research_complete`는 skill Section 3에서 기록하는 marker이며 review+approval **이전**에 set된다. Resume fast-path의 조건으로 사용 금지 — Orchestrator review+approval Step 6가 성공한 뒤에만 set되는 `research_approved: true` + `research_approved_hash` 한 쌍이 정확한 approval-state 증거이다.

그 외 경우:

Skill("deep-research", args=ARGS)

완료 후: **Review + Approval Workflow 실행** (문서 수정 승인 단계).

Phase Skill 완료 후:
1. 산출물 Read → Auto Review (subagent + codex)
2. Main 에이전트가 findings 판단 → 동의/비동의 분류
3. 1차 승인: 수정 항목을 사용자에게 제시 (AskUserQuestion — 문서 수정 대상)
4. 승인된 항목 반영
5. 2차 승인: 최종 문서 확인 (AskUserQuestion — 문서 최종 승인)
→ 상세: Read("../shared/references/review-approval-workflow.md")

문서 최종 승인 후 → State 부분 업데이트:
- `research_approved: true` (Resume fast-path baseline — v6.3.1 NC1 fix)
- `research_approved_at`: current ISO timestamp
- `research_approved_hash`: `Bash({ command: "shasum -a 256 \"$WORK_DIR/research.md\" | awk '{print $1}'" })` 결과 (v6.3.1 NW5 integrity snapshot)

→ 아래 Exit Gate 실행.

### Exit Gate (Phase 1 → Phase 2)

AskUserQuestion:

- header: "Phase 1 (Research) 완료. 어떻게 진행할까요?"
- options:
  1. "다음 phase로 진행" — 즉시 Phase 2 Plan 시작
  2. "이 phase 재실행/수정"
  3. "일시정지"

분기:
- option 1 → **즉시 `current_phase: plan` 설정** → **§3-3 Plan으로 dispatch** (§3-3 body가 Resume check + Skill 호출 담당). 본 branch에서 Skill 직접 호출하지 않음 (NO1 fix).
- option 2 → **재실행 전 approval state clear (NC2 규칙 + NW5)**: `research_approved: false`, `research_approved_at: null`, `research_approved_hash: null`로 state 업데이트 → 이후 `Skill("deep-research", args=ARGS + " --force-rerun")` 재호출 또는 사용자 지시 편집 (phase-guard 허용 범위). 크기에 관계없이 post-approval 편집이면 approval clear 필수.
- option 3 → current_phase는 `research` 유지. 재개 안내 후 턴 종료.

## 3-3. Plan

`skipped_phases` / `--skip-to-implement` 포함 시 Exit Gate 생략하고 `current_phase: implement` + `plan_approved: true` + `plan_approved_at` 설정으로 직접 전환 → 3-4.

**Resume 분기 (v6.3.1 F1 + NW5 integrity check)**: state의 `plan_approved: true`가 이미 있고 `$ARGUMENTS`에 `--force-rerun`이 없으면 paused-after-approval 복귀 후보 경로이다. 단, **approval integrity check**가 추가로 필요:

1. `plan_approved_hash` (state) 와 현재 `$WORK_DIR/plan.md`의 sha256을 비교:
   - `Bash({ command: "shasum -a 256 \"$WORK_DIR/plan.md\" | awk '{print $1}'" })` (or `sha256sum`)
   - 해시 일치 → approval 유효. Skill 호출과 review+approval을 **건너뛰고** 바로 아래 Exit Gate 실행.
   - 해시 불일치 → **out-of-band 편집 감지 → data preservation + in-place review** (v6.3.1 NO3 fix + NP3 collision fix):
     1. 현재 `$WORK_DIR/plan.md`를 `$WORK_DIR/plan.v{iteration_count+1}-edit.md`로 복사. **`-edit` 접미사** 사용 — deep-plan skill의 기존 `plan.v{iteration_count}.md` backup(Pre-steps Backup 단계)과 파일명 충돌 방지 (NP3).
     2. `iteration_count`을 1 증가.
     3. Approval state invalidate: `plan_approved: false`, `plan_approved_at: null`, `plan_approved_hash: null`.
     4. 경고: "⚠️ plan.md가 승인 이후 외부에서 수정되었습니다. 편집 내용은 plan.v{N}-edit.md로 백업되었습니다. 편집된 현재 문서를 대상으로 Review+Approval을 재실행합니다."
     5. **Skill 재호출 없이** 아래 Review+Approval workflow로 직접 진입 — 편집된 문서 in-place review.
     6. 최종 승인 시 새 `plan_approved_hash` + `plan_approved_at` 기록 (drift baseline 정정).
     7. 거부 시 사용자 선택: 직접 수정 / `Skill("deep-plan", args + " --force-rerun")`로 완전 재생성. `-edit` 접미사 덕분에 collision 없음.
   - `plan_approved_hash` 필드 부재 (pre-v6.3.1 세션 또는 재실행 후 미승인) → Skill 재실행 + review+approval.
   - 파일 missing → 복구 불가능. Skill 재실행.

2. drift gate의 `plan_approved_at`이 실제 최종 plan과 일치하도록 hash check가 추가 가드 역할.

그 외 경우:

Skill("deep-plan", args=ARGS)

완료 후: **Review + Approval Workflow 실행** (Research와 동일 패턴 — 문서 수정 승인).
→ 상세: Read("../shared/references/review-approval-workflow.md")

문서 최종 승인 후 → State 부분 업데이트:
- `plan_approved: true`
- `plan_approved_at`: current ISO timestamp (drift baseline)
- `plan_approved_hash`: `Bash({ command: "shasum -a 256 \"$WORK_DIR/plan.md\" | awk '{print $1}'" })` 결과 (v6.3.1 NW5 integrity snapshot)
- **`current_phase`는 이 시점에서는 변경하지 않는다.** Exit Gate "진행" 시에 `implement`로 전환.

### Exit Gate (Phase 2 → Phase 3)

AskUserQuestion:

- header: "Phase 2 (Plan) 완료. 어떻게 진행할까요?"
- options:
  1. "다음 phase로 진행"
  2. "이 phase 재실행/수정"
  3. "일시정지"

분기:
- option 1 → **즉시 `current_phase: implement` 설정** → **§3-4 Implement로 dispatch** (§3-4 body가 Skill 호출 담당). 본 branch에서 Skill 직접 호출하지 않음 (NO1 fix).
- option 2 → **재실행 전 approval state clear (NC2 fix + NW5)**: `plan_approved: false`, `plan_approved_at: null`, `plan_approved_hash: null`로 state 업데이트 → 이후 `Skill("deep-plan", args=ARGS + " --force-rerun")` 재호출 또는 사용자 지시 편집. 모든 편집은 Step 6 re-approval을 거치며, approval clear가 없으면 Resume fast-path가 stale approval을 재사용함. 크기에 관계없이 post-approval 편집이면 approval clear 필수 — drift gate baseline의 `plan_approved_at` + `plan_approved_hash`가 실제 최종 plan과 일치하도록.
- option 3 → current_phase는 `plan` 유지. 재개 안내 후 턴 종료.

## 3-4. Implement

`skipped_phases`에 "implement" 포함 시 Exit Gate 생략하고 `current_phase: test`로 직접 전환 → 3-5. (드문 경로이지만 spike 세션 등에서 활용)

Skill("deep-implement", args=ARGS + " --tdd={tdd_mode}")

Implement skill의 Section 3 완료 후:

### Exit Gate (Phase 3 → Phase 4)

AskUserQuestion:

- header: "Phase 3 (Implement) 완료. 어떻게 진행할까요?"
- options:
  1. "다음 phase로 진행"
  2. "이 phase 재실행/수정"
  3. "일시정지"

분기:
- option 1 → **즉시 `current_phase: test` 설정** (F1 Option A) → **§3-5 Test로 dispatch** (§3-5 body가 Skill 호출 담당). 본 branch에서 Skill 직접 호출하지 않음 (NO1 fix).
- option 2 → **재실행/수정 전 completion state clear (v6.3.1 NC3 fix)**: completion marker + receipts + slice checklist 모두 invalidate해야 resume 시 stale evidence를 재사용하지 않는다.
   - `implement_completed_at: null` 설정
   - 영향 받는 slice의 receipt (`$WORK_DIR/receipts/SLICE-NNN.json`) status를 `"invalidated"`로 기록
   - plan.md의 해당 slice `[x]` → `[ ]`로 해제 (Implement skill Resume Detection이 미완료로 인식하도록)
   - 그 후 사용자 상세 지시 청취 또는 `Skill("deep-implement", args=ARGS + " --tdd={tdd_mode} --force-rerun")` 재호출. 재구현 완료 시 새 receipt + `implement_completed_at` 기록.
- option 3 → current_phase는 `implement` 유지. 재개 안내 후 턴 종료.

## 3-5. Test

Skill("deep-test", args=ARGS)

`/deep-test`가 내부적으로 implement-test retry loop 관리 (max 3회).

**Retry exhausted**: auto-flow 중단. 사용자 수동 개입. Exit Gate 실행하지 않음. current_phase는 `implement` 유지 (수동 수정 경로).

**All pass** (`test_passed: true`): 아래 Exit Gate 실행.

### Exit Gate (Phase 4 → Phase 5 / Finish)

`$ARGUMENTS`에 `--skip-integrate` 포함 시 Exit Gate 생략하고 바로 §3-6 Finish 진입.

AskUserQuestion:

- header: "Phase 4 (Test) 완료. 어떻게 진행할까요?"
- options:
  1. "다음 phase로 진행" — Phase 5 Integrate
  2. "Integrate 건너뛰고 Finish"
  3. "Test 재실행"
  4. "일시정지"

분기:
- option 1 → current_phase는 `test` 유지 (Integrate는 idle로 전환함) → **§3-5b Integrate로 dispatch** (§3-5b body가 Skill 호출 담당). 본 branch에서 Skill 직접 호출하지 않음 (NO1 fix).
- option 2 → `$ARGUMENTS`에 **실제로 `--skip-integrate` 플래그 추가** (ARGS mutation) → §3-5b를 건너뛰고 **§3-6 Finish로 직접 분기**. `--skip-integrate` 미설정된 채 §3-5b 진입하면 skip이 반영되지 않으므로 반드시 실제 ARGS 변경 필요 (NO1 fix).
- option 3 → **재실행 전 Test state clear (v6.3.1 NW4 fix)**: `test_passed: false`, `test_completed_at: null`, `test_retry_count: 0` 설정 → 그 후 `Skill("deep-test", args=ARGS + " --force-rerun")` 재호출. 이렇게 해야 재실행 도중 세션 중단 시 `/deep-resume`이 stale `test_passed: true` marker를 재사용해 quality gate를 건너뛰는 것을 방지한다 (failing rerun을 "passed"로 기만하는 경로 차단).
- option 4 → current_phase는 `test` 유지. 재개 안내 후 턴 종료.

## 3-5b. Integrate (v6.3.0, skippable)

Phase 5: 설치된 deep-suite 플러그인 아티팩트를 읽어 AI가 다음 단계를 추천하는 대화형 루프.

- `$ARGUMENTS`에 `--skip-integrate` 포함 시 → 3-6로 직진 (state 변경 없음).
- 없으면 → `Skill("deep-integrate", args=ARGS)` 호출.
  - 스킬이 정상 종료하면 → 3-6로 진행.
  - 스킬이 에러로 종료하면 경고 메시지 출력 후 **`--skip-integrate`를 추가하여** 3-6로 진행한다. Phase 5는 진입 시 `phase5_entered_at`을 기록했지만 `phase5_completed_at`이 없으므로, `--skip-integrate` 없이 `/deep-finish`를 호출하면 "Phase 5 중단" 분기에 걸려 세션이 idle-but-unfinishable 상태에 고착된다(v6.3.0 review C2). `--skip-integrate`가 이 분기를 우회하여 정상 finish 경로를 보장한다.
  - 스킬이 `terminated_by: "interrupted"` 상태로 남기고 종료하면 auto-flow 중단 (재진입 대기).

> current_phase 변경 주체: deep-integrate Skill이 Phase 5 진입 시 `idle`로 전환하고 `phase5_entered_at` + **`phase5_work_dir_snapshot`**(v6.3.0 review RC3-1) 필드를 기록한다. Phase 5 종료 시 `skills/deep-integrate/phase5-finalize.sh`로 `phase5_completed_at`만 atomically 기록한다. `current_phase` 자체는 `idle` 유지 (phase-guard Phase 5 mode와 호환). `phase5_work_dir_snapshot`은 phase-guard가 enforcement 기준으로 사용하는 불변 snapshot — state file의 `work_dir`이 런타임에 변조돼도 snapshot 값으로 방어된다. finished 같은 신규 state는 도입하지 않는다.

## 3-6. Finish

Read `/deep-finish` → 완료 옵션 제시:
- **Merge**: worktree를 base branch에 merge
- **PR**: GitHub PR 생성
- **Keep**: branch/worktree 유지, 나중에 처리
- **Discard**: branch/worktree 삭제

세션 히스토리 기록 (JSONL), Session Quality Score 계산.

Finish 완료 후: `current_phase: idle` 설정.
Registry 해제: `unregister_session "$SESSION_ID"`.

# current_phase 변경 주체 정리 (v6.3.1 Option A — 일원화)

| Phase | Review | 사용자 승인 | current_phase 변경 주체 | 변경 시점 |
|-------|--------|------------|----------------------|----------|
| Brainstorm | 선택적 | Exit Gate 필수 | **Orchestrator** | Exit Gate "진행" 선택 시 |
| Research | 필수 | review+approval + Exit Gate 필수 | **Orchestrator** | Exit Gate "진행" 선택 시 |
| Plan | 필수 | review+approval + Exit Gate 필수 | **Orchestrator** | Exit Gate "진행" 선택 시 |
| Implement | Phase Review | Exit Gate 필수 | **Orchestrator** | Exit Gate "진행" 선택 시 |
| Test | 자동 | Exit Gate 필수 | **Orchestrator** (유지: `test` → `test`; Integrate 진입 시에도 test 유지, Integrate skill이 idle로 전환) | Exit Gate "진행" 선택 시 |
| Integrate (v6.3.0) | 선택적 | 불필요 | **Integrate Phase Skill (`idle` + phase5_*_at 필드)** | 기존 동작 유지 |

**핵심 변화** (v6.3.0 → v6.3.1):
- 기존에는 Brainstorm/Implement phase skill이 Section 3에서 직접 current_phase를 다음 값으로 전환 → Exit Gate 이전에 state가 이동되어 pause/resume 시 Exit Gate 재표시 불가
- v6.3.1: 모든 phase skill은 `*_completed_at` marker만 기록하고 current_phase 변경을 Orchestrator에 위임
- pause 선택 시 current_phase는 현재 값 유지 → resume 시 Orchestrator가 해당 phase를 재호출 → skill의 Section 1 완료-marker 감지 분기가 Orchestrator로 제어 반환 → Exit Gate 재표시
