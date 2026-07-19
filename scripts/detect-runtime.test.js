'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectRuntime, CODEX_ENV_MARKERS, CLAUDE_ENV_MARKERS } = require('./detect-runtime.js');

test('명시 override가 최우선 (대소문자 무시)', () => {
  assert.strictEqual(detectRuntime({ DEEP_WORK_RUNTIME: 'codex', CLAUDE_PLUGIN_ROOT: '/x' }), 'codex');
  assert.strictEqual(detectRuntime({ DEEP_WORK_RUNTIME: 'Claude', CODEX_HOME: '/y' }), 'claude');
});

test('override 무효값은 무시하고 마커 감지로 진행', () => {
  assert.strictEqual(detectRuntime({ DEEP_WORK_RUNTIME: 'gpt', CLAUDE_PLUGIN_ROOT: '/x' }), 'claude');
});

test('codex 마커 > claude 마커 (codex 세션 안에서 claude 잔존 env 오탐 방지)', () => {
  const env = { CODEX_HOME: '/home/u/.codex', CLAUDE_PLUGIN_ROOT: '/stale' };
  assert.strictEqual(detectRuntime(env), 'codex');
});

test('claude 마커 단독', () => {
  assert.strictEqual(detectRuntime({ CLAUDE_PLUGIN_ROOT: '/p' }), 'claude');
  assert.strictEqual(detectRuntime({ CLAUDECODE: '1' }), 'claude');
  assert.strictEqual(detectRuntime({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'claude');
});

test('마커 부재 → unknown (fail-safe)', () => {
  assert.strictEqual(detectRuntime({}), 'unknown');
  assert.strictEqual(detectRuntime({ PATH: '/usr/bin' }), 'unknown');
});

test('마커 목록은 비어있지 않은 export', () => {
  assert.ok(CODEX_ENV_MARKERS.length >= 1);
  assert.ok(CLAUDE_ENV_MARKERS.length >= 1);
});
