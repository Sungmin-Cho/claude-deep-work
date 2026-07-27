# Session quality score computation

> Reference for `skills/deep-finish/SKILL.md`. Section 2-1: the 5-component score (test pass rate, rework cycles, plan fidelity, sensor clean rate, mutation score) and how not_applicable components are excluded proportionally.

---

### 2-1. Calculate Session Quality Score

Calculate a quality score (0-100) using the 5-component weighted system with not_applicable proportional redistribution.

**Data collection** — read these values from the state file and session artifacts:

1. **Test Pass Rate** (weight: 25%): Read `test_retry_count` from state. If 0 retries (passed first try) → 100. If 1 retry → 70. If 2 retries → 40. If 3+ retries → 10.
2. **Rework Cycles** (weight: 20%): Same as test_retry_count for this metric. Score: 0 retries → 100, 1 → 75, 2 → 50, 3+ → 20.
3. **Plan Fidelity** (weight: 25%): Read `fidelity_score` from state file (written by deep-test drift-check). If not present, default to 80 (assume reasonable fidelity when drift-check wasn't run).
4. **Sensor Clean Rate** (weight: 15%): Read all slice receipts' `sensor_results`. Count slices where all sensors are `pass` or `not_applicable`. Score: (clean_slices / total_slices_with_sensor_data) * 100. If all slices have `sensor_results` absent or all statuses are `not_applicable` → mark as `not_applicable` (exclude from denominator).
5. **Mutation Score** (weight: 15%): Read `mutation_testing.score` from state file (written by deep-test Section 4-7). If `status: "not_applicable"` or field absent → mark as `not_applicable` (exclude from denominator).

**Core Score formula (with not_applicable proportional redistribution)**:
```
applicable_weights = sum of weights for components that are NOT not_applicable
score = Σ (component_score × component_weight) / applicable_weights × 100
```

Round to the nearest integer. Clamp to 0-100.

Examples:
- All 5 applicable: score = (tpr×0.25 + rw×0.20 + fp×0.25 + sc×0.15 + ms×0.15)
- Sensor+Mutation not_applicable: score = (tpr×0.25 + rw×0.20 + fp×0.25) / 0.70 × 100

**Diagnostic Metrics** (informational only — NOT included in core score):

1. **Code Efficiency**: Read `$WORK_DIR/file-changes.log` to count total lines changed. Count total plan items from plan.md. Ratio = lines_changed / plan_items. Score: <50 lines/item → 100, 50-100 → 80, 100-200 → 60, 200+ → 40.
2. **Phase Balance**: Calculate (research_duration + plan_duration) / total_session_duration. Score: 20-50% → 100, 10-20% or 50-70% → 70, <10% or >70% → 40.

**Display**:
```
📈 Session Quality Score: [score]/100
   Test Pass Rate:    [N]/100 ([detail]) — weight: 25%
   Rework Cycles:     [N]/100 ([detail]) — weight: 20%
   Plan Fidelity:     [N]/100 — weight: 25%
   Sensor Clean Rate: [N]/100 ([N]/[total] slices) — weight: 15% [or: N/A (not_applicable)]
   Mutation Score:    [N]/100 ([N]%) — weight: 15% [or: N/A (not_applicable)]

   Diagnostics (참고용):
     Code Efficiency: [N]/100 ([detail])
     Phase Balance:   [N]/100 ([detail])
```

**Persist to session receipt**: Add `quality_score`, `quality_breakdown`
(object with all 5 component scores + not_applicable flags), and
`quality_diagnostics` (the 2 diagnostic metrics) to the
**`$WORK_DIR/.session-receipt.payload.json` temp file** generated in Step 2.1.

