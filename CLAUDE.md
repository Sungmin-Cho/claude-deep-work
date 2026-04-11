# deep-work v6.0.2

Evidence-Driven Development Protocol — `/deep-work "task"` 하나로 Brainstorm → Research → Plan → Implement → Test 전체 워크플로우를 자동 진행하는 Claude Code 플러그인.

## Structure

```
.claude-plugin/plugin.json        # 플러그인 매니페스트
commands/                          # 슬래시 커맨드 (21개)
hooks/hooks.json                   # 훅 설정
hooks/scripts/                     # 훅 스크립트 및 테스트
skills/deep-work-workflow/SKILL.md # 메인 스킬
skills/deep-work-workflow/references/ # 레퍼런스 가이드 (12개)
templates/                         # CI 템플릿
```
