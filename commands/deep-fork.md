---
name: deep-fork
description: Fork a deep-work session to explore a different approach
aliases:
  - fork
argument_description: "[session-id] [--from-phase=PHASE]"
---

# /deep-fork — 세션 Fork

현재 또는 지정된 deep-work 세션을 fork하여 다른 접근법을 탐색합니다.

## Arguments

- `session-id` (optional): fork할 세션 ID. 생략 시 현재 활성 세션 자동 감지
- `--from-phase=PHASE` (optional): 재시작할 phase 지정 (`brainstorm|research|plan|implement`). 생략 시 대화형으로 선택

## 실행 단계

Output ALL messages in the user's detected language. Use Korean as template.

### Step 1: 대상 세션 해석

$ARGUMENTS에서 session-id와 --from-phase 플래그를 추출한다.

```
ARGS="$ARGUMENTS"
FROM_PHASE=""

# Extract --from-phase flag
if echo "$ARGS" | grep -q '\-\-from-phase='; then
  FROM_PHASE=$(echo "$ARGS" | grep -o '\-\-from-phase=[a-z]*' | cut -d= -f2)
  ARGS=$(echo "$ARGS" | sed 's/--from-phase=[a-z]*//')
fi

TARGET_SESSION=$(echo "$ARGS" | tr -s ' ' | xargs)
```

세션 ID가 비어있으면:
1. `$PROJECT_ROOT/.claude/deep-work-current-session` 포인터 파일에서 읽는다
2. 없으면 `$PROJECT_ROOT/.claude/deep-work-sessions.json`에서 활성(idle이 아닌) 세션 목록을 보여주고 선택하게 한다
3. 활성 세션이 없으면 에러: "활성 세션이 없습니다. /deep-work로 새 세션을 시작하세요."

### Step 2: Fork 대상 검증

대상 세션의 상태 파일(`$PROJECT_ROOT/.claude/deep-work.{SESSION_ID}.md`)을 읽는다.

**검증 항목:**
- 상태 파일이 존재하는지
- `current_phase`가 `idle`이 아닌지 (idle이면: "완료된 세션은 fork할 수 없습니다.")
- `fork_generation`이 3 미만인지 (3 이상이면: "이미 3세대 fork입니다. 복잡도가 높아질 수 있습니다. 계속하시겠습니까?" — AskUserQuestion으로 확인)

**Stale 부모 세션 검증:**

Git 환경:
```bash
PARENT_COMMIT=$(read_frontmatter_field "$PARENT_STATE" "worktree_base_commit")
if [[ -n "$PARENT_COMMIT" ]] && ! git cat-file -e "$PARENT_COMMIT" 2>/dev/null; then
  echo "부모 세션의 기준 commit이 더 이상 존재하지 않습니다. fork할 수 없습니다."
  exit 1
fi
```

Non-git 환경:
```bash
PARENT_WORK_DIR=$(read_frontmatter_field "$PARENT_STATE" "work_dir")
if [[ ! -d "$PROJECT_ROOT/$PARENT_WORK_DIR" ]]; then
  echo "부모 세션의 산출물이 삭제되었습니다. fork할 수 없습니다."
  exit 1
fi
```

### Step 3: 재시작 Phase 결정

`--from-phase`가 지정되지 않았으면 AskUserQuestion으로 선택:

현재 phase 이하의 phase만 선택 가능하다. Phase 순서: brainstorm < research < plan < implement.

예시 (부모가 implement인 경우):
```
어떤 phase부터 다시 시작하시겠습니까?
1. brainstorm — 처음부터 다시 구상
2. research — 리서치부터 다시
3. plan — 새로운 계획 수립
4. implement — 구현부터 (현재 phase)
```

### Step 4: 환경 감지 및 Fork 실행

#### Git 환경 감지

```bash
IS_GIT=$(git rev-parse --git-dir 2>/dev/null && echo "true" || echo "false")
```

#### Case A: Git 환경 (worktree 기반 전체 복제)

**A-1. Dirty 상태 검증:**

```bash
DIRTY_STATUS=$(git status --porcelain 2>/dev/null)
```

dirty가 아니면 바로 진행. dirty이면 AskUserQuestion:
- "커밋 후 fork" — `git add -A && git commit -m "deep-work: pre-fork snapshot"`
- "현재 상태로 fork" — `git stash push --include-untracked -m "deep-work: fork ${NEW_SESSION_ID}"`로 캡처. Worktree 생성 후 새 worktree에서 `git stash pop`으로 적용. fork-snapshot.yaml에 `parent_dirty: true`, `dirty_resolution: stash-apply` 기록. stash pop 실패 시 fork를 차단하고 에러 메시지 출력.
- "취소" — fork 중단

**A-2. 새 session ID 생성:**

```bash
source "$HOOKS_DIR/utils.sh"
NEW_SESSION_ID=$(generate_session_id)
```

**A-3. Branch/Worktree 이름 결정:**

Session ID 기반 suffix를 사용하여 충돌을 원천 차단한다 (카운터 기반 race condition 제거):

```bash
PARENT_BRANCH=$(read_frontmatter_field "$PARENT_STATE" "git_branch")
# session ID의 hex 부분을 suffix로 사용 — 전역 고유, 원자적
CURRENT_COMMIT=$(git rev-parse HEAD)
FORK_SUFFIX=$(echo "$NEW_SESSION_ID" | sed 's/^s-//')  # session ID 기반 suffix (충돌 불가)
WORKTREE_PATH="$(dirname "$PROJECT_ROOT")/$(basename "$PROJECT_ROOT")-wt-fork-${FORK_SUFFIX}"
FORK_BRANCH="${PARENT_BRANCH}-fork-${FORK_SUFFIX}"
git worktree add "$WORKTREE_PATH" -b "$FORK_BRANCH" "$CURRENT_COMMIT"
```

**A-3.5. Worktree 컨텍스트 전환 (중요):**

이후 모든 작업(산출물 복사, 상태 파일 생성, auto-flow)은 새 worktree 안에서 실행해야 한다. 기존 `/deep-work`의 worktree 계약과 동일하게, `FORK_PROJECT_ROOT`를 기준으로 작업한다:

```bash
FORK_PROJECT_ROOT="$WORKTREE_PATH"
# 이후 모든 경로는 $FORK_PROJECT_ROOT 기준
```

**A-4. 산출물 복사:**

부모의 `work_dir`에서 **fork worktree 내** 새 작업 디렉토리로 복사:

```bash
PARENT_WORK_DIR=$(read_frontmatter_field "$PARENT_STATE" "work_dir")
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TASK_SLUG=$(echo "$TASK_DESC" | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -c 30)
NEW_WORK_DIR=".deep-work/${TIMESTAMP}-${TASK_SLUG}-fork-${FORK_SUFFIX}"
mkdir -p "$FORK_PROJECT_ROOT/$NEW_WORK_DIR"
cp -r "$PROJECT_ROOT/$PARENT_WORK_DIR/"* "$FORK_PROJECT_ROOT/$NEW_WORK_DIR/" 2>/dev/null || true
```

**A-5. 재시작 phase 이후 산출물 제거:**

Phase 순서에 따라 이후 산출물을 삭제:
- brainstorm 이후: research.md, plan.md, receipts/, test-results.md, file-changes.log 삭제
- research 이후: plan.md, receipts/, test-results.md, file-changes.log 삭제
- plan 이후: receipts/, test-results.md, file-changes.log 삭제
- implement: 삭제 없음 (현재 phase 그대로)

#### Case B: Non-git 환경 (산출물만 복제)

**B-1. 새 session ID 및 작업 디렉토리 생성** (동일)

**B-2. 산출물만 복사:**

```bash
# 문서 파일만 복사 (코드 파일 제외)
for f in brainstorm.md research.md plan.md; do
  [[ -f "$PROJECT_ROOT/$PARENT_WORK_DIR/$f" ]] && cp "$PROJECT_ROOT/$PARENT_WORK_DIR/$f" "$PROJECT_ROOT/$NEW_WORK_DIR/"
done
[[ -d "$PROJECT_ROOT/$PARENT_WORK_DIR/receipts" ]] && cp -r "$PROJECT_ROOT/$PARENT_WORK_DIR/receipts" "$PROJECT_ROOT/$NEW_WORK_DIR/"
```

**B-3. 재시작 phase 이후 산출물 제거** (동일)

**B-4. Phase 상한 확인:**

artifacts-only fork에서 `FROM_PHASE`가 implement 또는 test이면 에러:
"Non-git fork는 plan까지만 진행 가능합니다. 구현을 진행하려면 git 환경에서 /deep-fork를 사용하세요."

### Step 5: Fork Snapshot 생성

새 작업 디렉토리에 `fork-snapshot.yaml` 작성:

```yaml
forked_at: "{ISO_TIMESTAMP}"
parent_session: "{PARENT_SESSION_ID}"
parent_phase_at_fork: "{PARENT_CURRENT_PHASE}"
restart_phase: "{FROM_PHASE}"
parent_work_dir: "{PARENT_WORK_DIR}"
fork_mode: "worktree"  # 또는 "artifacts-only"
parent_commit: "{CURRENT_COMMIT}"  # git 환경에서만
parent_dirty: false  # dirty 상태였는지
dirty_resolution: null  # commit | stash-apply | null
artifacts_copied:
  - brainstorm.md  # 실제 복사된 파일 목록
  - research.md
  - plan.md
artifacts_removed:
  - receipts/  # 실제 제거된 항목 목록
```

### Step 6: 상태 파일 생성

새 세션의 상태 파일을 생성한다. Git 환경에서는 `$FORK_PROJECT_ROOT/.claude/deep-work.{NEW_SESSION_ID}.md`, Non-git에서는 `$PROJECT_ROOT/.claude/deep-work.{NEW_SESSION_ID}.md`에 생성한다.

부모 상태 파일에서 YAML frontmatter를 복제하되:
- `session_id`: 새 ID로 교체
- `current_phase`: `FROM_PHASE`로 설정
- `fork_info` 블록 추가:
  ```yaml
  fork_info:
    parent_session: "{PARENT_SESSION_ID}"
    forked_at: "{ISO_TIMESTAMP}"
    parent_phase_at_fork: "{PARENT_CURRENT_PHASE}"
    restart_phase: "{FROM_PHASE}"
    fork_mode: "worktree"  # 또는 "artifacts-only"
    fork_generation: {GENERATION}
  ```
- `work_dir`: 새 작업 디렉토리로 변경
- `git_branch`: 새 branch로 변경 (git) 또는 null (non-git)
- `worktree_enabled`: true (git) 또는 false (non-git)
- `worktree_path`: 새 worktree 경로 (git) 또는 null (non-git)
- `worktree_branch`: 새 branch (git) 또는 null (non-git)
- `worktree_base_commit`: fork 시점 commit (git) 또는 null (non-git)
- 재시작 phase 이후 필드 초기화:
  - `plan_approved: false` (plan 이후라면)
  - `test_retry_count: 0`
  - `fidelity_score: null`
  - `implement_completed_at: null` (implement 이후라면)
  - `test_completed_at: null`
  - `review_state: idle`
  - `review_results: {}`
  - `plan_review_retries: 0`

### Step 7: 레지스트리 등록 및 부모 업데이트

```bash
# 원자적 fork 등록: 레지스트리 등록 + 부모 fork_children 업데이트를 한 번에 수행
register_fork_session "$NEW_SESSION_ID" "$PARENT_SESSION_ID" "$FORK_GENERATION" "$TASK_DESC" "$NEW_WORK_DIR" "$FROM_PHASE"

# 포인터 파일 업데이트 (새 세션을 current로)
write_session_pointer "$NEW_SESSION_ID"
```

### Step 8: 결과 출력 및 Auto-flow 시작

결과 메시지 출력:

```
🔀 Session forked successfully
  Parent:  {PARENT_SESSION_ID} ({PARENT_PHASE} phase)
  Fork:    {NEW_SESSION_ID} (restarting from {FROM_PHASE})
  Work dir: {NEW_WORK_DIR}
  Branch:  {FORK_BRANCH}  (worktree)     ← git일 때만
  Mode:    artifacts-only (plan까지)      ← non-git일 때만
```

**Auto-flow 시작:**

선택한 `FROM_PHASE`에 해당하는 커맨드의 지침을 따라 자동으로 진행한다:
- brainstorm → `/deep-brainstorm` 지침 실행
- research → `/deep-research` 지침 실행
- plan → `/deep-plan` 지침 실행
- implement → `/deep-implement` 지침 실행

이전 phase의 산출물이 있으면 해당 산출물을 읽어서 컨텍스트로 활용한다.
