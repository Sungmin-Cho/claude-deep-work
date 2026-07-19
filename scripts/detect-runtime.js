'use strict';
// 호스트 런타임 감지 (설계 §3.1). 마커 우선순위: 명시 override > codex > claude > unknown.
// codex 마커를 claude보다 먼저 보는 이유: codex 세션이 claude 관련 잔존 env를 물려받는
// 오염 시나리오에서 codex가 이겨야 Claude 모델명 유출(§3.3 불변식 위반)을 막는다.
// CODEX_ENV_MARKERS는 Task 12(실기 검증)에서 관측 근거로 갱신될 수 있다.
const CODEX_ENV_MARKERS = Object.freeze(['CODEX_HOME']);
const CLAUDE_ENV_MARKERS = Object.freeze(['CLAUDE_PLUGIN_ROOT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);

function detectRuntime(env = process.env) {
  const override = String(env.DEEP_WORK_RUNTIME || '').toLowerCase();
  if (override === 'claude' || override === 'codex') return override;
  if (CODEX_ENV_MARKERS.some((k) => env[k])) return 'codex';
  if (CLAUDE_ENV_MARKERS.some((k) => env[k])) return 'claude';
  return 'unknown';
}

module.exports = { detectRuntime, CODEX_ENV_MARKERS, CLAUDE_ENV_MARKERS };
