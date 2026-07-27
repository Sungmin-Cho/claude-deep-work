# Flag parser, profile migration and precedence

> Reference for `skills/deep-work-orchestrator/SKILL.md`. §1-3-1 through §1-3-5 plus `--setup`: how to invoke the flag parser, migrate a v2 profile to v3, call the v3 loader, apply flag precedence, and surface parse warnings. Read after the flag table, before §1-4.

---

### §1-3-1. 플래그 파서 호출

orchestrator 본문에서 직접 실행 (process scope 일관):

````bash
# $ARGUMENTS를 double-quoted single arg로 전달 — shell metacharacters가
# parser allowlist 적용 전에 shell에 의해 평가되지 않음.
# parser CLI entrypoint는 단일 공백 포함 인자를 split-before-allowlist로 처리.
PARSE_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/parse-deep-work-flags.js" -- "$ARGUMENTS" 2>/tmp/dw-parse-err.txt)
parse_rc=$?
````

- `parse_rc` 비-zero → `/tmp/dw-parse-err.txt` 내용 표시 + AskUserQuestion (재입력 / 종료). `2>&1 || true` 패턴 사용 금지.
- `PARSE_OUT` (JSON) → `TASK_TEXT`, `FLAGS` 객체 추출.
- `TASK_TEXT` 비어 있으면 AskUserQuestion("작업 내용을 입력해 주세요.").

### §1-3-2. 프로필 v2→v3 마이그레이션

파서 결과로 `DEEP_WORK_INITIAL_PRESET`(= `FLAGS.profile` 또는 null)이 채워진 후 migration 호출:

````bash
PROFILE_FILE="$PROJECT_ROOT/.claude/deep-work-profile.yaml"
migrate_stderr=$(mktemp)
MIGRATE_OUT=$(DEEP_WORK_INITIAL_PRESET="${FLAGS.profile}" \
  node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-profile-v2-to-v3.js" "$PROFILE_FILE" 2>"$migrate_stderr")
migrate_rc=$?
````

- `migrate_rc` 비-zero → `$migrate_stderr` 내용 표시 + AskUserQuestion (수동 이전 / 새 v3 강제 생성 / 종료). `2>&1 || true` 패턴 사용 금지.
- `MIGRATE_OUT` (JSON stdout):
  - `{ "migrated": true, "reason": "v2-to-v3" }` → 1회 안내:
    > "프로필을 v3로 마이그레이션했습니다. 알림 설정은 제거되었고, 매 세션마다 4개 항목(team/start/tdd/git)에 대해 LLM 추천 + 확인을 거칩니다. 모델은 코드베이스 규모·난이도로 자동 선택됩니다. ask 항목 변경: `/deep-work --setup`. 빠른 경로: `/deep-work --profile=X --no-ask`."

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
    > "신규 프로필 (v3 형식)을 작성했습니다: `$PROFILE_FILE`. 매 세션마다 4개 항목 ask + 추천이 진행됩니다(모델은 자동 선택). 빠른 경로: `--profile=solo-strict --no-ask`."

### §1-3-3. v3 프로필 로더 호출

````bash
# --profile=X가 loader에 전달되도록 DEEP_WORK_INITIAL_PRESET export
# (§1-3-2의 migrate-profile 호출과 동일한 env 전달 패턴으로 parity 확보)
PROFILE_OUT=$(DEEP_WORK_INITIAL_PRESET="${FLAGS.profile}" \
  node "${CLAUDE_PLUGIN_ROOT}/scripts/load-v3-profile.js" "$PROFILE_FILE" 2>/tmp/dw-profile-err.txt)
profile_rc=$?
````

- `profile_rc` 비-zero → `/tmp/dw-profile-err.txt` 내용 표시 + AskUserQuestion (재시도 / 종료).
- `PROFILE_OUT` (JSON stdout) → `PROFILE_DATA` (presets, default_preset, interactive_each_session, defaults) 추출.

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

