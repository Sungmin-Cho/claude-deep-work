// scripts/recommender-parser.js
const ENUMS = {
  team_mode:     ['solo', 'team'],
  start_phase:   ['brainstorm', 'research', 'plan'],
  tdd_mode:      ['strict', 'coaching', 'relaxed', 'spike'],
  git:           ['worktree', 'new-branch', 'current-branch'],
  model_routing: ['default', 'custom']
};

function parseRecommendation(rawText, ctx = {}) {
  // multi-fence detect — sub-agent system prompt가 "정확히 하나만"을 강제하므로
  // 둘 이상이면 spec violation으로 간주하고 fallback (W16)
  const fences = [...String(rawText).matchAll(/```json\s*([\s\S]*?)```/g)];
  if (fences.length === 0) return { ok: false, fallback_reason: 'no-json-fence' };
  if (fences.length > 1) return { ok: false, fallback_reason: 'multiple-fences' };

  let data;
  try {
    data = JSON.parse(fences[0][1]);
  } catch (e) {
    return { ok: false, fallback_reason: `json-parse-error: ${e.message}` };
  }

  // 5-key 완전성 (C8) — partial output silent pass 차단
  for (const key of Object.keys(ENUMS)) {
    if (!data[key] || typeof data[key].value !== 'string') {
      return { ok: false, fallback_reason: `missing key: ${key}` };
    }
    if (typeof data[key].reason !== 'string' || data[key].reason.length === 0) {
      return { ok: false, fallback_reason: `missing reason: ${key}` };
    }
  }

  // enum validation
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(data[key].value)) {
      return { ok: false, fallback_reason: `enum violation: ${key}=${data[key].value}` };
    }
  }

  // capability check (fail-closed: must be explicitly true to allow team/worktree)
  const cap = ctx.capability || {};
  if (cap.team_mode_available !== true && data.team_mode.value === 'team') {
    return { ok: false, fallback_reason: 'capability: team_mode unavailable (or unset)' };
  }
  if (cap.git_worktree !== true && data.git.value === 'worktree') {
    return { ok: false, fallback_reason: 'capability: worktree unavailable (or unset)' };
  }
  return { ok: true, data };
}

module.exports = { parseRecommendation, ENUMS };
