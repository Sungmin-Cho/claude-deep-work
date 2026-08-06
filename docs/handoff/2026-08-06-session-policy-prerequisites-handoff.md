# WS2 session-policy prerequisites — self-contained handoff

Date: 2026-08-06

Repository: `/Users/sungmin/Dev/claude-plugins/deep-work`

Code baseline: `df9c953374b4d7b612599f25f4453fbc7141c862` (`main`, PR #67 merge)

Suite pin: `d611054` in `claude-deep-suite`

Prior logical run: `01KZ8P9KGY7GW2EY59J5WSVTWT`

## Purpose

This document is the complete starting contract for a new WS2 that may eventually
replace the orchestrator's inline provisional session-policy pipeline with one
authoritative CLI. It intentionally carries the prior decision and evidence in
this file so the removed evaluation worktree is not required.

Do **not** begin by adding `scripts/session-policy-cli.js`. The previous WS2 ended
as an independently approved no-go because a safe wrapper depends on repository-
wide identity, approval, route/state, and containment authorities that do not yet
exist as complete contracts. Build and approve those prerequisites first.

## Current state

- WS1 is integrated through PR #67. The implementation phase now classifies
  plan/reality mismatches by their impact on the acceptance contract, public
  interface, scope, and verification evidence.
- The current session-policy flow is unchanged and remains the production path:
  `risk-profile-cli.js --risk-only` → methodology authority →
  `model-routing-cli.js` → `risk-profile-cli.js --reuse-input`.
- `scripts/session-policy-cli.js` does not exist.
- The prior WS2 produced no production or test diff. Its terminal checker approved
  completion of the evaluation with Critical 0, Warning 0, Info 0, while setting
  `implementation_may_proceed: false`.
- Focused baseline at that boundary: 258 passed, 0 failed. WS1's focused contract
  suite was 42/42 and its stable full-suite evidence was 1830 passed, 0 failed,
  17 skipped.

The inline production path is pinned at:

- `skills/deep-work-orchestrator/SKILL.md` §1-8.5 and §1-8.6
- `tests/v6.12-routing-wiring-contract.test.js`, especially the ordering contract
  beginning near the `risk-only -> methodology authority -> routing facade` test
- `scripts/risk-profile-cli.js`
- `scripts/model-routing-cli.js`
- `runtime/policy-runtime.js`
- `runtime/model-routing-runtime.js`

## Why the bounded wrapper was rejected

Six successive independent design reviews found concrete, expanding blockers.
The findings are cumulative; none is optional merely because the wrapper is small.

| Round | Checker SHA-256 | Load-bearing result |
|---|---|---|
| 1 | `93ed55f3d7f3affaf3026db6543015369bdb3d3dcf265ccc693aee0817dfef5a` | approval binding, exact state carriers, fallback outcome, target containment |
| 2 | `dca2abd89882323bb908da6181c1d55c9002741eb7f22877ab770c724fa43818` | identical-input replay, first-risk evidence, wrapper-self containment |
| 3 | `dd51d4659a677838e0f85b430e85322f0291cc40509d8abb4ca63bf9a19920b4` | current session ID is not demonstrably fresh replay identity |
| 4 | `feb19285d1a72a1fc45b0bab8da97add6088304983e269133a1fbcba1afdf4f4` | alternate allocators/locks, ID grammar, pre-write marker containment |
| 5 | `9968c4c4a62b01901ea48b8cce0924badaba7c91e35f5675939de6dc87552da2` | raw initializer, fork lock order, marker locator, review override |
| 6 | `25228b58f5618a0ffb6829081e186cfa20a9fd1213c0f657693caad44f37dfde` | repository-prepare admission, immutable challenge provenance, transitive module containment |

The final independent no-go report had SHA-256
`c750f4a2382210c8425f627db8816723c239bedb95c0eb1696c432214ed457f2`.
It approved the **decision not to implement in that run**, not the wrapper design.

Current-source facts behind the decision:

- `runtime/session-store.js` creates an unreserved `s-` plus eight-hex session ID.
- `prepareSessionRepository()` accepts a caller-provided session ID and begins
  durable repository/state work without a common reservation-admission authority.
- `runtime/dispatcher-routes.js` exposes both `session initialize` and direct
  `session repository prepare`; fork creates another ID path.
- Both child CLIs load transitive plugin modules. Validating only the wrapper
  pathname would not prove that every subsequently loaded module is contained in
  the resolved plugin root.
- The state carriers include methodology policy, model-routing metadata, policy
  shadow, risk errors/acceptances, and review-mode override. A facade that drops,
  recomputes, or weakens one of them is not behaviorally equivalent.

## Required workstreams

### P1 — Session identity admission

Define one repository-scoped authority for all new session identities.

It must cover at least:

- `session initialize`
- `session repository prepare`
- fork/child-session creation
- retry and crash recovery
- existing state/registry/pointer collision checks

Required properties:

- reservation and admission are durable and replay-safe;
- the same logical operation reuses its identity, while a foreign operation cannot;
- lock order composes with repository, session, journal, pointer, registry, and
  state locks without inversion;
- no state file, registry row, worktree, branch, pointer, or marker is written
  before identity admission succeeds;
- the ID grammar remains compatible with all readers or is migrated explicitly.

### P2 — One-time approval authority

Create a durable transition for any risk-lowering approval rather than passing an
ambient Boolean or mutable acknowledgment.

The minimum state machine is `pending → consumed`, bound to:

- session identity and operation identity;
- exact risk transition `{from, to}`;
- reason and scope;
- challenge/preimage digest;
- creation and consumption timestamps;
- immutable provenance sufficient to distinguish retry from replay.

Consumption must be journaled and crash-recoverable. A consumed challenge cannot
authorize a second downgrade. Missing, stale, foreign, malformed, or ambiguous
evidence fails closed.

### P3 — Canonical session-policy projection

Specify the CLI input and output as a versioned contract before implementing it.
The facade must preserve the same effective input across risk-only, routing, and
policy snapshot compilation, while separating methodology authority from actual
provider-routing results.

At minimum, the result must carry without loss:

1. risk profile and structured risk errors;
2. immutable input reference/digest and reused-signal status;
3. methodology authority plus its verified policy digest;
4. concrete model routing, tiers, pins, floors, runtime, and routing warnings;
5. provisional policy shadow and any approved risk acceptance;
6. `review_execution_json.review_mode_override`.

Define explicit fallback semantics for each child failure. Preserve the current
fail-open behavior only where it is already contractual; identity, approval,
policy-digest, runtime resolution, and containment ambiguity must fail closed.

### P4 — Transitive plugin-module containment

Before any plugin child code executes, resolve the literal absolute plugin root
and prove that the wrapper and every transitive plugin module are regular,
non-symlink escapes contained beneath it. An anchored path followed through `..`
or an outward symlink is invalid.

Do not validate only the first executable and then let ordinary `require()` load
unchecked targets. Choose and review an enforceable module-loading boundary, and
cover pre-load races, package resolution, built-in modules, and test seams.

### P5 — Facade integration and parity

Only after P1–P4 are approved may the single CLI be introduced. Replace the
orchestrator block with one anchored call plus an explicit output-field contract.
Preserve host detection by actual `Agent` tool availability; manifests and stale
environment/session markers are not runtime authority.

Parity must be demonstrated for success, downgrade approval, pin override,
unknown runtime, malformed inputs, child fallback, digest mismatch, replay,
collision, crash recovery, and containment failure.

## Recommended execution order and gates

1. **Fresh-read design**: map config/CLI → dispatcher → constructor → runtime
   gate → state consumer for every identity and policy carrier.
2. **P1 design review**: do not combine identity admission with the facade diff.
3. **P1 implementation review**: require crash/replay and alternate-entry tests.
4. **P2 design and implementation reviews**: require durable one-time evidence.
5. **P3 contract review**: freeze exact JSON schemas, versioning, and fallback
   matrix before production edits.
6. **P4 adversarial review**: include symlink escape, path swap, and transitive
   module cases before choosing the loading mechanism.
7. **P5 implementation**: introduce the CLI and reduce orchestrator prose only
   after all prerequisite receipts are terminal and approved.
8. **Independent final review**: compare the whole branch with this handoff and
   the unchanged baseline, then run the full suite in isolation.

Each phase must have a maker receipt, exact hashes, focused test counts, and an
independent checker verdict. A missing receipt or unresolved checker is not
completion evidence.

## Model routing

Use only the `gpt-5.6` family for the new run. Route design, implementation, test,
and review effort automatically from the repository's current model-routing
authority. Final/adversarial reviewers should route to `gpt-5.6-sol` when the
catalog and runtime allow it. Record requested model/effort separately from the
provider-verifiable actual model/effort; never claim an actual identity when the
host exposes no receipt.

## Minimum verification

Run focused tests continuously and the full suite only after the branch is
stable. The pre-change focused baseline command is:

```bash
node --test \
  runtime/session-store.test.js \
  runtime/transaction-runtime.test.js \
  scripts/deep-work-runtime.test.js \
  scripts/parse-deep-work-flags.test.js \
  tests/v6.12-routing-wiring-contract.test.js \
  tests/risk-state-roundtrip.test.js \
  tests/skill-reference-integrity.test.js
```

Also require:

```bash
node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8'))"
npm test
git diff --check
```

Do not call a timed-out suite green. Record terminal exit status and exact
pass/fail/skip counts.

## Scope boundaries

- Start from current `main` in a new branch and new worktree; do not revive the
  removed evaluation worktree or its abandoned branch.
- Preserve the existing inline pipeline until P1–P4 are independently approved.
- No version bump, release, marketplace sync, merge, publish, worktree deletion,
  or remote branch deletion is implied by this handoff.
- Do not weaken route/state checks or test expectations to make the facade fit.
- Keep plugin paths anchored at the resolved `${CLAUDE_PLUGIN_ROOT}` and verify
  containment before reading or executing them.

## Completion definition

WS2 is complete only when all of the following are true:

- every session creator uses the reviewed identity-admission authority;
- approval evidence is one-time, durable, replay-safe, and provenance-bound;
- the versioned session-policy result preserves all six carrier groups;
- transitive plugin loading is contained before execution;
- orchestrator behavior is parity-tested across both supported hosts;
- focused and full suites terminate green with exact counts;
- independent final review reports no unresolved critical or warning finding;
- integration has its own explicit human authorization.

Until then, the correct production state is the existing inline pipeline.
