# deep-work v6.6.3

Evidence-Driven Development Protocol — `/deep-work "task"` 하나로 Brainstorm → Research → Plan → Implement → Test 전체 워크플로우를 자동 진행하는 Claude Code 플러그인. v6.6.3 (M5.5 hardening)에서는 `phase-guard` hook의 non-implement dangerous-command denylist가 강화되어 `curl|sh` pipe-shell, `rm -rf`, `npm publish`, `kubectl destructive`, SQL `DROP/DELETE`, `dd/mkfs/fdisk` 등을 정규식으로 차단하고 per-family `CLAUDE_ALLOW_*` override를 지원합니다 (8 golden 시나리오 + 5 override fall-through 시나리오 테스트). v6.5.0에서는 `session-receipt.json`과 `receipts/SLICE-*.json`이 claude-deep-suite M3 cross-plugin envelope으로 전환되어 cross-plugin run_id chain trace가 가능해졌고, v6.4.2에서는 세션 초기화 흐름이 LLM 추천 기반 항목별 ask로 전환되었으며 profile v2→v3 자동 마이그레이션과 알림 시스템 전면 제거가 포함되었습니다.

## v6.5.0 — M3 Envelope Adoption (claude-deep-suite Phase 2 #3)

`session-receipt.json` 및 `receipts/SLICE-*.json` 모두 다음 형식으로 emit:

```
{
  "schema_version": "1.0",
  "envelope": {
    "producer": "deep-work",
    "producer_version": "6.6.3",
    "artifact_kind": "session-receipt|slice-receipt",
    "run_id": "<ULID>",
    "session_id": "<dw-session-id>",
    "parent_run_id": "<consumed evolve-insights run_id, optional>",
    "generated_at": "<RFC 3339>",
    "schema": { "name": "<same as artifact_kind>", "version": "1.0" },
    "git": { "head": "<sha>", "branch": "<name>", "dirty": false },
    "provenance": {
      "source_artifacts": [{ "path": "...", "run_id": "..." }],
      "tool_versions": { "node": "v20.x" }
    }
  },
  "payload": { /* legacy session/slice receipt body — schema_version: "1.0" preserved */ }
}
```

**Writer**: `hooks/scripts/wrap-receipt-envelope.js`(markdown agent prompt에서 호출하는 CLI helper). `agents/implement-slice-worker.md`(slice receipts)와 `commands/deep-finish.md`(session receipt, Section 7-Z) 양쪽이 이 helper를 사용. helper는 자기 모듈 path 기준으로 plugin의 `.claude-plugin/plugin.json`에서 `producer_version`을 읽는다 (handoff §4 literal-cwd-resolve 회피).

**Reader**: 모든 internal reader(`hooks/scripts/verify-delegated-receipt-runner.js`, `validate-receipt.sh`, `session-end.sh`, `receipt-migration.js`)와 cross-plugin consumer(`skills/deep-integrate/gather-signals.sh`, `skills/deep-research/SKILL.md`)가 M3 envelope 형태를 감지하고 identity guard(`producer === "deep-work"` + `artifact_kind` + `schema.name === artifact_kind`)를 검증한 뒤 `.payload`로 unwrap하고 legacy 필드를 읽는다. Legacy non-envelope receipt는 그대로 통과 (forward-compat).

**Self-test**: `scripts/validate-envelope-emit.js`가 suite envelope schema를 미러링한 zero-dep release-lint. `tests/envelope-emit.test.js` + `tests/envelope-chain.test.js`가 identity guard, corrupt-payload defense, ULID Crockford alphabet (I/L/O/U 거부), SemVer 2.0.0 strict, cross-plugin chain assertion (session-receipt.parent_run_id === consumed evolve-insights.run_id)를 cover.

> **Suite-side 갱신**(marketplace.json SHA bump, payload-registry placeholder → authoritative, adoption ledger T+0 line)은 claude-deep-suite Phase 3 batch에서 일괄 처리 (handoff §1 정책). Phase 2 plugin PR은 plugin repo만 수정한다.

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
skills/deep-integrate/               # Phase 5 Skill (cross-plugin integrate, optional)
skills/deep-work-workflow/           # 워크플로우 개요 Skill
skills/shared/references/            # 공통 레퍼런스 가이드
sensors/                             # 센서 시스템 (linter/type/coverage detection + run)
health/                              # Health Engine (드리프트 탐지 + fitness functions)
templates/                           # CI 템플릿 + topology 엔진 (topologies/, topology-detector.js)
tests/                               # 회귀 테스트 (envelope-emit/-chain, handoff-roundtrip, phase-guard golden/denylist)
assumptions.json                     # assumption 기준선 (hook enforcement justification)
agents/                              # Claude Code subagents (research/implement delegation)
agents/session-recommender.md        # v6.4.2 session-init recommendation sub-agent
hooks/scripts/verify-delegated-receipt.sh      # Post-hoc receipt validation (delegate precondition)
hooks/scripts/verify-receipt-core.js # 8-item validation module
hooks/scripts/wrap-receipt-envelope.js # v6.5.0 M3 envelope writer (called by implement-slice-worker + deep-finish §7-Z)
hooks/scripts/phase-guard.sh         # v6.6.x non-implement dangerous-command denylist + per-family CLAUDE_ALLOW_* override
hooks/scripts/phase-guard-core.js    # phase-guard regex engine (denylist evaluation)
scripts/validate-agents.sh           # Static agent frontmatter check
scripts/validate-envelope-emit.js    # v6.5.0 zero-dep release-lint (mirrors suite envelope schema)
scripts/migrate-profile-v2-to-v3.js  # Profile v2→v3 migration helper (native YAML)
scripts/load-v3-profile.js           # v3 schema profile reader (orchestrator §1-3-3)
scripts/parse-deep-work-flags.js     # CLI flag parser (allowlists, priority matrix)
scripts/recommender-input.js         # session-recommender input sanitization
scripts/recommender-parser.js        # session-recommender output parser (5-key validation)
scripts/detect-capability.js         # environment capability detection
scripts/format-ask-options.js        # AskUserQuestion option formatter
scripts/migrate-model-routing.js     # v6.4.0 model_routing legacy "main" → "sonnet" atomic migration
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

