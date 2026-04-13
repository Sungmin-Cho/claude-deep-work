# Model Routing Guide

## 개요

Phase별 최적 모델을 배정하여 토큰 비용을 30~40% 절감한다.

## 기본 모델 매핑

| Phase | 기본 모델 | 근거 | Agent 위임 |
|-------|----------|------|-----------|
| Research | sonnet | 탐색/분석에 충분 | ✅ Solo: Agent 스폰 / Team: model 파라미터 |
| Plan | (메인 세션) | 대화형 피드백 루프 필요 | ❌ |
| Implement | sonnet | 코드 작성에 충분 | ✅ Solo: Agent 스폰 / Team: model 파라미터 |
| Test | haiku | 테스트 실행/파싱만 | ✅ Agent 스폰 |

## 커스터마이징

`/deep-work` 초기화 시 커스텀 설정 선택 가능. 유효 값: sonnet, haiku, opus.

## Plan이 메인 세션을 사용하는 이유

Plan Phase는 사용자와의 대화형 피드백 루프가 핵심이다. Agent에 위임하면 사용자 피드백을 받을 수 없으므로 메인 세션에서 실행한다.

## 하위 호환

`model_routing` 필드가 없는 v3.0.0 세션 파일에서는 기본값이 사용된다.
