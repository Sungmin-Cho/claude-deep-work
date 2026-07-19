# Model Routing Guide (v6.10.0 — 자동 선택)

## 개요

모델 라우팅은 유저가 선택하지 않는다. 세션 init 시 엔진이 코드베이스 규모·작업 난이도로
phase별 tier(light/standard/deep/main)를 결정하고, 런타임(Claude Code/Codex) 카탈로그로
실제 모델명을 해석해 state에 기록한다. 근거는 세션 시작 메시지에 표시된다.

## 결정 흐름

tier 결정에 실제로 쓰이는 신호는 tracked 파일 수(규모 분류)와 언어 수(대형 다언어 시 research
상향) 두 가지뿐이다.

1. 결정론적 신호 수집: tracked 파일 수(규모 분류 신호), 언어 수(다언어 판별 신호)
2. LOC 추정·테스트 유무도 함께 수집되나, v1 tier 결정에는 사용되지 않는다(관측/향후용)
3. baseline 규칙표(§설계 2.2) 적용
4. recommender `task_difficulty`로 ±1 보정(실패 시 무보정)
5. 런타임 카탈로그 해석: claude(light→haiku/standard→sonnet/deep→opus), codex(카탈로그 pin 값)
6. 판별 불가 런타임/미pin 카탈로그 → `main`(세션 모델) fail-safe

## Override 우선순위 (강한 순)

1. `--model-routing=implement=deep,test=light` (콤마 구분·공백 불가; tier명 또는 현재 런타임 모델명)
2. 프로필 defaults의 concrete 값(user-pinned — 엔진 skip)
3. `/deep-slice model SLICE-NNN <model>` (per-slice)
4. 엔진 자동

## Implement per-slice 규칙

엔진 자동 경로에서 slice 크기별 tier = clamp(sizeTier(S/M/L/XL) + 세션 난이도 offset).
세션 tier standard이면 기존 auto와 동일: S→haiku, M/L→sonnet, XL→opus.

## Plan/Brainstorm이 main인 이유

대화형 피드백 루프가 핵심 — Agent 위임 불가(기존 설계 유지).

## 하위 호환

- `model_routing` 필드 없는 구세션: 기존 기본값 경로.
- `model_routing_meta` 없는 구세션: legacy migration(main→sonnet)이 그대로 적용되고 재해석은 skip.
- 구프로필의 per-phase concrete 값은 user-pinned로 그대로 존중(엔진 skip).
