# deep-work v6.4.2

Evidence-Driven Development Protocol — `/deep-work "task"` 하나로 Brainstorm → Research → Plan → Implement → Test 전체 워크플로우를 자동 진행하는 Claude Code 플러그인. v6.4.2에서는 세션 초기화 흐름이 LLM 추천 기반 항목별 ask로 전환되었으며, profile v2→v3 자동 마이그레이션과 알림 시스템 전면 제거가 포함됩니다.

## Structure

```
.claude-plugin/plugin.json          # 플러그인 매니페스트
package.json                         # npm 매니페스트 (files 필드에 배포 대상 명시)
commands/                            # 슬래시 커맨드 (thin wrappers + utilities)
hooks/hooks.json                     # 훅 설정 (P0 worktree guard + P1 phase transition)
hooks/scripts/                       # 훅 스크립트 및 테스트
skills/deep-work-orchestrator/       # Orchestrator Skill (초기화 + auto-flow)
skills/deep-brainstorm/              # Phase 0 Skill
skills/deep-research/                # Phase 1 Skill
skills/deep-plan/                    # Phase 2 Skill
skills/deep-implement/               # Phase 3 Skill
skills/deep-test/                    # Phase 4 Skill
skills/shared/references/            # 공통 레퍼런스 가이드
skills/deep-work-workflow/           # 워크플로우 개요 Skill
sensors/                             # 센서 시스템 (linter/type/coverage detection + run)
health/                              # Health Engine (드리프트 탐지 + fitness functions)
templates/                           # CI 템플릿 + topology 엔진 (topologies/, topology-detector.js)
assumptions.json                     # assumption 기준선 (hook enforcement justification)
agents/                              # Claude Code subagents (research/implement delegation)
hooks/scripts/verify-delegated-receipt.sh      # Post-hoc receipt validation (delegate precondition)
hooks/scripts/verify-receipt-core.js # 8-item validation module
scripts/validate-agents.sh           # Static agent frontmatter check
scripts/migrate-profile-v2-to-v3.js  # Profile v2→v3 migration helper (native YAML)
scripts/load-v3-profile.js           # v3 schema profile reader (orchestrator §1-3-3)
scripts/parse-deep-work-flags.js     # CLI flag parser (allowlists, priority matrix)
scripts/recommender-input.js         # session-recommender input sanitization
scripts/recommender-parser.js        # session-recommender output parser (5-key validation)
scripts/detect-capability.js         # environment capability detection
scripts/format-ask-options.js        # AskUserQuestion option formatter
agents/session-recommender.md        # v6.4.2 session-init recommendation sub-agent
```

## Release Workflow — deep-suite marketplace 연동

deep-work는 [Sungmin-Cho/claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) marketplace를 통해 사용자에게 배포된다. 본 repo의 release(버전 bump + tag)가 사용자 환경에 적용되려면 deep-suite repo의 `marketplace.json` + 관련 문서가 같이 갱신되어야 한다.

**연동 working repo**: `/Users/sungmin/Dev/claude-plugins/deep-suite` (origin: `Sungmin-Cho/claude-deep-suite`)

**deep-work release 후 deep-suite에서 갱신해야 할 파일**:

```
.claude-plugin/marketplace.json               # plugins[].source.sha를 새 release commit으로
CLAUDE.md                                      # deep-work 버전/기능 변경 반영
README.md / README.ko.md                       # deep-work 섹션 갱신 (영어/한국어)
guides/integrated-workflow-guide.md            # deep-work 사용 가이드 (영어)
guides/integrated-workflow-guide.ko.md         # 동일 (한국어)
```

**절차** (deep-work main에 release commit이 들어간 후):

1. `git -C /Users/sungmin/Dev/claude-plugins/deep-work rev-parse main` → 새 sha 확보
2. `cd /Users/sungmin/Dev/claude-plugins/deep-suite`
3. `marketplace.json`의 `plugins[name="deep-work"].source.sha`를 새 sha로 갱신
4. 위 docs 4종에서 deep-work 관련 섹션을 새 버전 내용으로 갱신 (CHANGELOG의 신규 기능/변경/breaking 요약)
5. `git add … && git commit -m "chore: bump deep-work to vX.Y.Z — <한 줄 요약>"`
6. `git push origin main`

**중요 — 수정 금지 위치**:

- `~/.claude/plugins/marketplaces/claude-deep-suite/` — Claude Code의 marketplace cache. plugin install 상태 보유. 직접 수정하지 말고 위 working repo에서 push 후 `/plugin marketplace update` 명령으로 갱신.
- `~/.claude/plugins/cache/claude-deep-suite/` — plugin install cache. 마찬가지로 직접 수정 금지.

