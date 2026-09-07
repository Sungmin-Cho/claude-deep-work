# Phase review gate

Use one current review plan and the authenticated execution/finding chain described by `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/adaptive-review-protocol.md`. Required role/tier and per-ID evidence come from the runtime policy. Self-review helps the author correct mistakes but is not an independent required reviewer.

Reuse only an unchanged qualifying review binding. Do not perform an identical second review because a phase entry and orchestrator both loaded this reference. Recheck material changes and unresolved findings; preserve unavailable/failed attempts.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/review-approval-workflow.md` for the combined packet/independent execution/approval-ref route. Consume the same exact combined approval once per named Spec and Plan phase. Publish phase review through its runtime route. The skill never writes reviewed/completed flags or review_execution_json. Already authorized internal corrections and continuation proceed without new generic approval. Ask only for genuinely missing intent/authority and state why.
