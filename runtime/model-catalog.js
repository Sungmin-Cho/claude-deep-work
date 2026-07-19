'use strict';

const TIERS = Object.freeze(['light', 'standard', 'deep']);
const MAIN = 'main';
const CATALOG_VERSION = 1;
// codex 슬롯은 Task 12(실기 검증)에서 pin — 그 전까지 null = main fail-safe (설계 §3.2)
const DEFAULT_CATALOG = Object.freeze({
  claude: Object.freeze({ light: 'haiku', standard: 'sonnet', deep: 'opus', main: MAIN }),
  codex: Object.freeze({ light: null, standard: null, deep: null, main: MAIN }),
});

function mergeCatalog(override) {
  const merged = {};
  for (const runtime of Object.keys(DEFAULT_CATALOG)) {
    merged[runtime] = { ...DEFAULT_CATALOG[runtime] };
    const layer = override && typeof override === 'object' ? override[runtime] : null;
    if (!layer || typeof layer !== 'object') continue;
    for (const tier of [...TIERS, MAIN]) {
      if (typeof layer[tier] === 'string' && layer[tier]) merged[runtime][tier] = layer[tier];
    }
  }
  return merged;
}

function resolveTier(tier, runtime, catalog = DEFAULT_CATALOG) {
  if (tier === MAIN) return { model: MAIN, warning: null };
  if (!TIERS.includes(tier)) {
    return { model: MAIN, warning: `'${tier}'은(는) 유효한 tier가 아님 — main(세션 모델) fallback` };
  }
  const layer = catalog && catalog[runtime];
  if (!layer) return { model: MAIN, warning: `런타임 '${runtime}' 카탈로그 없음(unknown 포함) — main fallback` };
  const model = layer[tier];
  if (typeof model !== 'string' || !model) {
    return { model: MAIN, warning: `${runtime} 카탈로그의 '${tier}' 미지정(pin 전) — main fallback` };
  }
  return { model, warning: null };
}

function concreteModelsFor(runtime, catalog = DEFAULT_CATALOG) {
  const layer = catalog[runtime] || {};
  return TIERS.map((t) => layer[t]).filter((v) => typeof v === 'string' && v && v !== MAIN);
}

function allConcreteModels(catalog = DEFAULT_CATALOG) {
  return Object.keys(catalog).flatMap((r) => concreteModelsFor(r, catalog));
}

module.exports = { TIERS, MAIN, CATALOG_VERSION, DEFAULT_CATALOG, mergeCatalog, resolveTier,
  concreteModelsFor, allConcreteModels };
