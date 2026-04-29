'use strict';

/**
 * pickEffectiveDefault — W12 fix.
 * If default_value has been disabled, fall back to the first allowed value.
 *
 * @param {string} default_value
 * @param {string[]} allowed  - enum values after removing disabled ones
 * @returns {string|null}
 */
function pickEffectiveDefault(default_value, allowed) {
  if (allowed.includes(default_value)) return default_value;
  return allowed[0] || null;
}

/**
 * formatOptions — build the ordered option list for AskUserQuestion.
 *
 * Display rules:
 *  - recommendation != default  → recommended first  + default second
 *  - recommendation == default  → "(추천 = default)" label
 *  - recommendation is null     → default first (no recommendation label)
 *  - disabled_values            → those values are omitted from output
 *  - all values disabled        → throw
 *
 * @param {object} opts
 * @param {string}        opts.item
 * @param {{value:string, reason:string}|null} opts.recommendation
 * @param {string}        opts.default_value
 * @param {string[]}      opts.enum_values
 * @param {string[]}      [opts.disabled_values=[]]
 * @returns {{ value: string, label: string }[]}
 */
function formatOptions({ item, recommendation, default_value, enum_values, disabled_values = [] }) {
  const allowed = enum_values.filter(v => !disabled_values.includes(v));

  if (allowed.length === 0) {
    throw new Error(`format-ask-options: ${item} 모든 enum 값이 disabled — 진행 불가`);
  }

  const effectiveDefault = pickEffectiveDefault(default_value, allowed);
  const opts = [];

  if (recommendation && allowed.includes(recommendation.value)) {
    const isDefault = recommendation.value === effectiveDefault;

    if (isDefault) {
      // recommendation == default → single merged label
      opts.push({
        value: recommendation.value,
        label: `${recommendation.value} (추천 = default) — ${recommendation.reason}`
      });
    } else {
      // recommendation != default → recommended first, default second
      opts.push({
        value: recommendation.value,
        label: `${recommendation.value} (추천) — ${recommendation.reason}`
      });
      if (effectiveDefault) {
        opts.push({ value: effectiveDefault, label: `${effectiveDefault} (default)` });
      }
    }

    // remaining options (neither recommendation nor default)
    for (const v of allowed) {
      if (v !== recommendation.value && v !== effectiveDefault) {
        opts.push({ value: v, label: v });
      }
    }
  } else {
    // recommendation is null or its value was disabled
    if (effectiveDefault) {
      opts.push({ value: effectiveDefault, label: `${effectiveDefault} (default)` });
    }
    for (const v of allowed) {
      if (v !== effectiveDefault) {
        opts.push({ value: v, label: v });
      }
    }
  }

  return opts;
}

/**
 * capabilityToDisabled — I24 / W7 helper.
 * Maps capability flags → the enum values that should be disabled for a given ask item.
 *
 * W7 rule: when git_worktree is not explicitly true, 'worktree' is disabled.
 *          when is_git is not explicitly true (full non-git env), 'new-branch' is ALSO disabled.
 *
 * I-1 fix: fail-closed (parity with recommender-parser.js).
 * capability flag가 명시적으로 true가 아니면 해당 옵션을 disable.
 * 호출자는 detectCapability() 출력을 사용하거나 명시적으로 모든 flag를 true로 설정해야 함.
 *
 * I-2 fix: KNOWN_ITEMS allowlist — unknown item throws to surface caller typos.
 *
 * @param {{ git_worktree: boolean, team_mode_available: boolean, is_git?: boolean }} capability
 * @param {string} item  - ask item name, e.g. 'git', 'team_mode'
 * @returns {string[]}
 */
const KNOWN_ITEMS = new Set(['team_mode', 'start_phase', 'tdd_mode', 'git', 'model_routing']);

function capabilityToDisabled(capability, item) {
  if (!KNOWN_ITEMS.has(item)) {
    throw new Error(`capabilityToDisabled: 알 수 없는 item '${item}' — 허용: ${[...KNOWN_ITEMS].join(', ')}`);
  }

  // I-1 fix: fail-closed — flag가 명시적으로 true가 아니면 disable.
  const disabled = [];

  if (item === 'team_mode' && capability.team_mode_available !== true) {
    disabled.push('team');
  }

  if (item === 'git') {
    if (capability.git_worktree !== true) disabled.push('worktree');
    // W7: full non-git repo → new-branch is also meaningless
    if (capability.is_git !== true) disabled.push('new-branch');
  }

  return disabled;
}

module.exports = { formatOptions, capabilityToDisabled, pickEffectiveDefault };
