---
allowed-tools: Skill, Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion
---

> **Internal (v6.3.0)** — orchestrator §3-1이 `Skill("deep-brainstorm", ...)`로 호출하는 Phase 0 진입점. `/deep-work` auto-flow가 기본 경로이며, 특정 phase만 재실행할 때 수동 호출도 가능합니다.

# /deep-brainstorm

Phase 0: 문제 정의 및 접근법 탐색 — 왜(why)를 먼저 탐구.

Skill("deep-brainstorm", args="$ARGUMENTS")
