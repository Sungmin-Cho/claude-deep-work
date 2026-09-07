# Runtime execution spine

The agent reasons, authors source artifacts and invokes explicitly authorized operations. Load this shared reference once per unchanged plugin revision; a phase change does not require rereading it. The runtime derives state and authenticates evidence. This reference describes current commands; read `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for their exact flags/enums. Resolve the plugin root and every referenced target to contained real absolute paths before reading/executing. Substitute that literal root in shell commands; do not use command substitution inside a guarded call.

## Session and continuation

1. Parse the user's actual flags with the contained `${CLAUDE_PLUGIN_ROOT}/scripts/parse-deep-work-flags.js`. Write the task text and parsed flag/profile/default objects as setup files. Use `profile load` for an existing profile; preserve its explicit defaults. Fresh defaults are solo-adaptive.
2. `session initialize --task-file ... --flags-json ... --profile-json ...` returns the session ID and repository choice. `session repository prepare --session ... --mode current-branch|new-branch|worktree --task-file ... --defaults-json ...` persists the authoritative session and returns its state path. Write the initialization result’s `defaults` object to the file passed as --defaults-json and use its returned `mode`; do not reuse pre-initialization defaults. Respect the user's specified worktree; do not create another just because the plugin supports it.
3. `session context [--session ...]` resolves existing state. `session authority validate --state ...` validates the current phase's authority. Pre-plan is a legitimate status. Do not create a fake plan to resume Brainstorm.
4. Perform the reasoning/artifact work needed at the current phase. `phase continue --state ...` derives the next internal transition; it does not launch verification, dependency installation or external actions. Brainstorm and Research may be concise for Low risk. A compact Spec still binds every fresh V3 plan.
5. Draft Spec+Plan together at Spec, preview their bundle, publish the runtime packet, execute required independent reviews and publish its approval ref. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/review-approval-workflow.md` for exact commands. Both phase approval routes consume `--approval-ref-json`; reuse the same unchanged combined ref once per phase. The runtime calculates approval/projection hashes. Never write approval booleans or verification-plan JSON into state yourself.

Continue without a phase question when the task already authorizes internal work. An interactive-gates preference or genuinely missing intent can require conversation. Preferences are not permission for new external effects.

## Authored plan

Write one `## Execution Plan` section with one JSON fence in plan.md. Schema 3 seals `execution_policy`, Spec/risk binding, capability facts, closed environment and each slice's basis/scopes/contracts/oracles. Author the task-specific fields and omit mechanical contract_binding, capability_facts, outcome_environment and replan_epoch defaults; the compiler derives them from the validated Spec and authenticated context. Explicit conflicting values reject. Do not put derived `source_plan_sha256`, `plan_authority_sha256` or `plan_projection_sha256` into the authored source. The runtime's source compiler emits those derived identities and preserves historical V2 semantics separately.

Use the plan template at `${CLAUDE_PLUGIN_ROOT}/skills/shared/templates/plan-template-existing.md`. A source change classified non-functional still uses `slice_kind:functional` and an authorized production write scope. The source author cannot choose execution basis via a later receipt. Explicit strict-required slices remain strict.

Low tasks can use trusted file-content, JSON-pointer or existence oracles. Each oracle maps required IDs and a declared contrary target/input. Program checks use the runtime's registered Node/Python grammar; arbitrary shell, lifecycle scripts and eval/preload forms are unsupported. No caller HOME/TMPDIR or credential/behavior environment variables. The runtime creates fresh owned directories and records actual executable, argv, environment, input and dependency identities.

## Scoped writes and verification

`slice activate --state ... --plan ... --slice ...` selects a dependency-ready slice. `implement write begin --state ... --plan ... --slice ... --class ... --scope-sha256 ...` opens its declared window and returns operation/pre-manifest identity. The scope digest comes from the current plan/activation result. Edit only allowed files, then `implement write accept` with that exact identity. Do not run two slice windows in the same session.

Strict basis: write the failing test; `verification run-v2 --expected must-fail`; `verification red-transition`; `verification proof-publish`; then accepted production writes and `verification run-v2 --expected must-pass`. Preserve real RED/GREEN refs. Finish refactor or `implement refactor no-change`, applicable sensors, then `implement slice complete-v2` with current refs. A supported Node policy is checked before source writes. An unknown version is unavailable and requires an explicit supported toolchain/replan decision, never a fake proof.

Outcome basis: after accepted writes, or `outcome source observe` for an already-correct target, call `verification outcome-explain`. Inspect the returned prepared descriptor, then explicitly invoke `verification outcome-run` with its prepared digest under the actual host/user authorization. Positive and contrary checks use owned execution views of the final source. They share logical command, oracle, dependencies and environment; only the declared target/input counterexample differs. Production source is not reverted.

Use the returned positive/control refs and actual qualifying reviews with `outcome review publish`, then `implement outcome-complete`. Required per-ID conclusions must be satisfied and the counterexample relevant. Built-in deterministic controls do not fabricate a model review; mutable program oracles require actual independent review. Timeout, overflow, unavailable identity and infrastructure failure are not valid negative evidence.

## Independent reviews

Compile the required review roles/tier floors using `${CLAUDE_PLUGIN_ROOT}/runtime/review-policy-runtime.js`. Use actual observed capabilities. `review execution run` persists the request/prompt/artifact/binding, actual bounded process output and terminal identity. Its ref is evidence of execution, not automatic goal acceptance.

Keep requested/effective/observed model and effort distinct. The runtime may observe Codex identity from the fresh host-produced session trace, bound to the launched thread/cwd/time; assistant prose and requested argv are not observations. Missing observed identity stays unknown. Without an explicit reviewer pin, an unqualifying or unavailable transport can retry the same role/tier/request/binding on a new available CLI seat. Preserve both attempts and verify distinct reviewer sessions. A same-family fallback discloses limited diversity; required roles do not disappear. An explicit unavailable model pin needs the user's model decision, not a silent substitute.

A review CLI may need normal host authentication or app-server access unavailable inside the current sandbox. Inspect the producer's actual process error. When the task already authorizes this bounded review, request the concrete contained runtime review command through the host's supported per-command approval mechanism, then retry the same binding. Do not disable the sandbox globally, change credentials/caches, or repeatedly run an unchanged denied command. A host rejection remains unavailable evidence. A wrapper exit 0 is not reviewer success; inspect its recorded child exit and qualification.

Reuse only an exact unchanged request/artifact/contract/policy/dependency/source/recovery identity with qualifying terminal evidence. Independent first-round inputs exclude other reviewers' findings. Evaluate findings against source and the goal; accept or reject with evidence. Do not run duplicate reviews simply because another phase entry was loaded.

## Test and publication

The internal receipt directory for schema 3 is `$WORK_DIR/runtime-receipts`; `$WORK_DIR/receipts` contains ledger-bound public M3 projections. Legacy V2 paths and hashes remain unchanged. Reader selection follows the authenticated plan basis, never caller receipt fields.

Before Test consumption, publish the actual completion and contract evidence into its package. For required gate IDs supported by `${CLAUDE_PLUGIN_ROOT}/runtime/completion-evidence-runtime.js` (`GATES`), run `evidence record completion --state "$STATE_FILE" --plan "$WORK_DIR/plan.json" --gate-id "$GATE_ID" --evidence-id "$EVIDENCE_ID"`. For required contract/plan-alignment gates, run `evidence record contract --state "$STATE_FILE" --plan "$WORK_DIR/plan.json" --spec "$WORK_DIR/spec.md" --gate-id "$GATE_ID" --evidence-id "$EVIDENCE_ID"`. The producers authenticate the underlying current receipts and contract; they do not execute missing verification or accept a caller PASS. A slice receipt alone is not the Test evidence package.

For the final semantic check, `evidence review-binding --state ... --plan ... --format packet` exposes the compact task/Spec/Plan/source/observations and full escalation refs. `evidence review-run --state ... --plan ... --reviewer-json ... --timeout-ms ...` derives the exact request/prompt/binding for the selected role/model. Publish its actual refs through `evidence record review-executions` for the current required gate/evidence IDs. The runtime validates per-ID conclusions and unresolved findings; execution success alone is not goal acceptance.

Use owned gate-results through `temp create --purpose gate-results`. On a hook-enabled host, Write the bytes to the returned reserved path (shell pipes remain blocked), then `temp write` without `--stdin` to adopt them. Direct CLI/tests may still use `temp write --stdin`. Then `test pass`. On failure use targeted `test retry`/`test exhaust` or authenticated replan. Completion/publication recovery preserves healthy siblings and never reimplements completed source merely to reconstruct a missing envelope.

`session finish keep|publish-pr|merge|discard` checks readiness before any effect, records intent/result, publishes the stable session M3 and only then finalizes state/registry/pointer. A successful external effect followed by failed verification/publication is pending recovery, not a reason to repeat the effect. Confirm the exact operation identity on retry.

The sole M3 writer remains `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/wrap-receipt-envelope.js`, invoked by runtime publication. New envelope format is 1.0, registry schema version 1.1 and payload schema_version 1.1. Slice parent IDs reference the session ID preallocated at initialization. Do not hand-author completion payloads/envelopes.

Metrics are observations: unknown applicable evidence produces null. Goal acceptance is independently checked, never inferred from a score. Read `${CLAUDE_PLUGIN_ROOT}/skills/deep-finish/references/session-quality-score.md` only when interpreting metrics.

## Recovery and preparation

Material contract/scope/oracle/basis discoveries use the authenticated replan discovery/risk/root-cause routes. Record concrete observations and refresh affected evidence; preserve current authorization. Resume never clears authority or relabels V3 as legacy.

`session environment explain --manager npm|uv` derives a fixed lockfile-based preparation recipe; `session environment prepare --prepared-digest ...` executes only that reviewed descriptor. Unsupported recipes remain explicit. This operation is separate from verification and does not grant network/external permission.

`session park` archives exact state and leaves a non-completion tombstone, removing only its active registry/pointer entries. `session restore` authenticates the archive and current source before resuming. `session downgrade-check` distinguishes incompatible active authority from retained parked artifacts. Do not call a parked run finished or convert its receipts for an older reader.
