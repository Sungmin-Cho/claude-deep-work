'use strict';
// 호스트 런타임 감지 (설계 §3.1). 마커 우선순위:
//   명시 override > claude-native 배타 마커 > codex 마커 > 비배타 claude 마커 > unknown.
//
// CLAUDECODE / CLAUDE_CODE_ENTRYPOINT는 claude-native 배타 마커다(Claude Code가 세팅하며
// codex-native 세션은 이 값을 설정하지 않는다). 이 그룹이 codex 마커보다 먼저 이겨야 한다 —
// 그렇지 않으면 정상 Claude Code 세션이 codex companion(orca 등)의 CODEX_HOME을 물려받는
// 병설 환경에서 codex로 오판되어 codex 모델명이 Claude Agent spawn에 유출된다
// (역방향 §3.3 불변식 위반 — impl-review H-1).
//
// CLAUDE_ENV_MARKERS(CLAUDE_PLUGIN_ROOT)는 비배타적이라 여전히 codex 마커보다 후순위다:
// codex 세션이 claude 관련 잔존 env를 물려받는 오염 시나리오에서 codex가 이겨야
// Claude 모델명 유출(§3.3 정방향 불변식)을 막는다. 순수 codex 세션은 CLAUDECODE를
// 설정하지 않으므로 native 그룹을 건너뛰고 이 정방향 보호가 그대로 유지된다.
// CODEX_ENV_MARKERS는 Task 12(실기 검증)에서 관측 근거로 갱신될 수 있다.
const CLAUDE_NATIVE_MARKERS = Object.freeze(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);
const CODEX_ENV_MARKERS = Object.freeze(['CODEX_HOME']);
const CLAUDE_ENV_MARKERS = Object.freeze(['CLAUDE_PLUGIN_ROOT']);

function detectRuntime(env = process.env) {
  const override = String(env.DEEP_WORK_RUNTIME || '').toLowerCase();
  if (override === 'claude' || override === 'codex') return override;
  if (CLAUDE_NATIVE_MARKERS.some((k) => env[k])) return 'claude';
  if (CODEX_ENV_MARKERS.some((k) => env[k])) return 'codex';
  if (CLAUDE_ENV_MARKERS.some((k) => env[k])) return 'claude';
  return 'unknown';
}

module.exports = { detectRuntime, CODEX_ENV_MARKERS, CLAUDE_ENV_MARKERS, CLAUDE_NATIVE_MARKERS };
