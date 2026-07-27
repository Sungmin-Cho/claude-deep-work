# TDD red flags — rationalizations that must stop the loop

> Reference for `skills/deep-implement/SKILL.md`. The rationalization → reality table. Read when tempted to skip RED, defer tests, guess at a fix, or widen the slice scope.

---

## Red Flags — 이 생각이 들면 멈추세요

| 합리화 시도 | 현실 |
|------------|------|
| "이건 너무 단순해서 TDD 안 해도 돼" | 단순 코드도 깨진다. RED는 30초면 된다. |
| "테스트는 나중에 추가하지" | 나중에 쓴 테스트는 즉시 통과한다 — 아무것도 증명하지 않는다. |
| "일단 고쳐보고 안 되면 조사하자" | 추측 수정은 3회 연속 실패로 끝난다. Root cause 먼저. |
| "Plan에는 없지만 이것도 같이 하면 좋겠다" | Scope creep. Issues Encountered에 기록하고 넘어가라. |
| "이 파일도 살짝 리팩토링하면…" | 슬라이스 scope 밖이다. 다음 세션에서 하라. |
| "mock으로 빠르게 테스트하자" | Mock은 mock을 테스트한다. 실제 동작을 검증하라. |
| "GREEN인데 refactor는 건너뛰자" | 기술 부채가 다음 슬라이스에서 복리로 돌아온다. |
| "센서 경고는 무시해도 되겠지" | Advisory도 기록된다. 무시한 경고가 Phase 4에서 차단으로 돌아온다. |
| "이미 수동으로 테스트했으니까" | 수동 테스트는 증거가 아니다. Receipt에 남지 않는다. |
| "비슷한 코드를 복사해서 수정하면 빠르겠다" | Plan의 code sketch를 따르라. 복사한 코드는 컨텍스트가 다르다. |

**이 중 하나라도 해당되면**: 현재 작업을 멈추고, 해당 Red Flag의 "현실" 컬럼을 따르세요.

