# Scoped recovery

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. Authenticate the current plan, accepted write and producer/publication status before deciding what must be retried.

A missing public M3 after internal completion needs publication recovery only. A completed external effect needs post-check/receipt recovery only. Source or oracle drift requires its authenticated invalidation/replan path. Preserve healthy siblings and the user's unrelated work.

Use the runtime's slice reset, targeted Test retry, delegation rollback or replan operation that matches the recorded failure. Consume the exact snapshot/operation identities it authenticates. Do not clear delegation_snapshot or active takeover fields by editing state; do not issue a raw reset/stash over unrelated changes.

Existing internal recovery authorization remains valid. Ask only if the needed destructive action or task decision was not authorized; explain the concrete missing authority. A failed receipt is not a reason to repeat a generic phase-approval questionnaire.
