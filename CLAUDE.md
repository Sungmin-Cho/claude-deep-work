# deep-work v6.2.1

Evidence-Driven Development Protocol — `/deep-work "task"` 하나로 Brainstorm → Research → Plan → Implement → Test 전체 워크플로우를 자동 진행하는 Claude Code 플러그인.

## Structure

```
.claude-plugin/plugin.json          # 플러그인 매니페스트
commands/                            # 슬래시 커맨드 (thin wrappers + utilities)
hooks/hooks.json                     # 훅 설정 (P0 worktree guard + P1 phase transition)
hooks/scripts/                       # 훅 스크립트 및 테스트
skills/deep-work-orchestrator/       # Orchestrator Skill (초기화 + auto-flow)
skills/deep-brainstorm/              # Phase 0 Skill
skills/deep-research/                # Phase 1 Skill
skills/deep-plan/                    # Phase 2 Skill
skills/deep-implement/               # Phase 3 Skill
skills/deep-test/                    # Phase 4 Skill
skills/shared/references/            # 공통 레퍼런스 가이드 (14개)
skills/deep-work-workflow/           # 워크플로우 개요 Skill
templates/                           # CI 템플릿
```
