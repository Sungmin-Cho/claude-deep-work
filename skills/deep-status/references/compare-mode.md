# Compare mode (`--compare`)

> Reference for `${CLAUDE_PLUGIN_ROOT}/skills/deep-status/SKILL.md`. Two-session comparison, including fork-relationship auto-detection. Read only when `--compare` is present.

---

### 0. Check for compare mode

If `$ARGUMENTS` contains `--compare`:

#### Fork 자동 감지

인자 없이 `--compare`만 사용하면 fork 관계를 자동 감지:
- 현재 세션의 상태 파일에서 `fork_info`가 있으면 → 부모 세션과 비교
- 현재 세션의 상태 파일에서 `fork_children`이 있으면 → 가장 최근 fork 자식과 비교
- fork 관계가 없으면 → 아래의 기존 수동 선택 플로우로 진행

Fork 관계로 자동 감지된 비교인 경우 출력에 라벨 추가:
```
📊 Session Comparison (fork relationship)
```

#### 기존 비교 플로우

1. List all session folders in `.deep-work/` directory
2. If fewer than 2 sessions exist, inform the user:
   ```
   ℹ️ 비교할 세션이 부족합니다. 최소 2개의 세션이 필요합니다.
   ```
3. Present the session list and ask the user to select 2 sessions to compare
4. Read research.md, plan.md, and report.md from both sessions
5. Display a comparison summary:
   ```
   세션 비교

   | 항목 | 세션 A | 세션 B |
   |------|--------|--------|
   | 작업 | [task A] | [task B] |
   | 접근법 | [approach A] | [approach B] |
   | 수정 파일 수 | [N] | [M] |
   | 검증 결과 | ✅/❌ | ✅/❌ |
   | 소요 시간 | [duration A] | [duration B] |

   ### 주요 차이점
   - **접근법 변화**: [description]
   - **수정 파일 차이**: [files only in A], [files only in B]
   - **검증 결과 차이**: [description]
   ```
6. Stop here (do not proceed to regular status display).

