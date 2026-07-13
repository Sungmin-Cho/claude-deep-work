'use strict';

const path = require('node:path');
const fs = require('node:fs');

function typedError(code, message, field) {
  const error = {code, message};
  if (field !== undefined) error.field = field;
  return error;
}

function invalidContext(source, error) {
  return {
    valid:false,
    source,
    host:'unknown',
    toolName:'',
    canonicalTool:'unknown',
    toolInput:null,
    hostSessionId:'',
    error:error && error.code ? error : typedError('invalid-json', String(error)),
  };
}

function parseObjectPayload(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {valid:false, error:typedError('empty-payload', 'hook payload is empty')};
  }
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {valid:false, error:typedError('payload-not-object', 'hook payload must be an object')};
    }
    return {valid:true, value};
  } catch (cause) {
    return {valid:false, error:typedError('invalid-json', cause.message)};
  }
}

function canonicalizeTool(name) {
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'apply_patch') {
    return 'write';
  }
  if (name === 'Bash') return 'shell';
  return 'unknown';
}

function cleanMarker(value) {
  if (typeof value !== 'string' || value === '') return null;
  const cleaned = value.trimEnd();
  if (/[\x00-\x1f\x7f]/u.test(cleaned)) return null;
  if (!cleaned) return null;
  const api = /^[A-Za-z]:[\\/]|^\\\\/.test(cleaned) ? path.win32 : path;
  return api.normalize(cleaned);
}

function sameMarker(a, b) {
  const left = cleanMarker(a);
  const right = cleanMarker(b);
  if (!left || !right) return false;
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(left) || /^[A-Za-z]:[\\/]|^\\\\/.test(right);
  if (windows ? left.toLowerCase() === right.toLowerCase() : left === right) return true;
  try {
    const leftReal = fs.realpathSync(left);
    const rightReal = fs.realpathSync(right);
    return windows ? leftReal.toLowerCase() === rightReal.toLowerCase() : leftReal === rightReal;
  } catch { return false; }
}

function markerState(env) {
  const codexRoot = env.PLUGIN_ROOT;
  const claudeRoot = env.CLAUDE_PLUGIN_ROOT;
  const codexData = env.PLUGIN_DATA;
  const claudeData = env.CLAUDE_PLUGIN_DATA;
  const malformed = [codexRoot, claudeRoot, codexData, claudeData]
    .some((value) => value !== undefined && cleanMarker(value) === null);
  if (malformed) return {consistent:false, codex:false, claude:false};
  if (codexRoot && claudeRoot && !sameMarker(codexRoot, claudeRoot)) {
    return {consistent:false, codex:false, claude:false};
  }
  if (codexData && claudeData && !sameMarker(codexData, claudeData)) {
    return {consistent:false, codex:false, claude:false};
  }
  if ((codexRoot && claudeData && !codexData) || (claudeRoot && codexData && !claudeData)) {
    return {consistent:false, codex:false, claude:false};
  }
  return {
    consistent:true,
    codex:Boolean(codexRoot),
    claude:Boolean(claudeRoot && !codexRoot),
  };
}

function hostForContext(name, env) {
  const markers = markerState(env);
  const claudeToolMarker = Boolean(env.CLAUDE_TOOL_USE_TOOL_NAME || env.CLAUDE_TOOL_NAME);
  if (!markers.consistent || (markers.codex && claudeToolMarker)) return 'unknown';
  if (markers.codex) return new Set(['Bash','apply_patch']).has(name) ? 'codex' : 'unknown';
  if (markers.claude || claudeToolMarker) {
    return new Set(['Bash','Write','Edit','MultiEdit']).has(name) ? 'claude' : 'unknown';
  }
  return 'unknown';
}

function buildContext(source, toolName, toolInput, env, hostSessionId = '') {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return invalidContext(source, typedError('tool-input-not-object', 'tool input must be an object'));
  }
  return {
    valid:true,
    source,
    host:hostForContext(toolName, env),
    toolName,
    canonicalTool:canonicalizeTool(toolName),
    toolInput,
    hostSessionId:typeof hostSessionId === 'string' ? hostSessionId : '',
    error:null,
  };
}

function parseHookContext(raw, env = {}) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) env = {};
  const envName = typeof env.CLAUDE_TOOL_USE_TOOL_NAME === 'string' && env.CLAUDE_TOOL_USE_TOOL_NAME
    ? env.CLAUDE_TOOL_USE_TOOL_NAME
    : typeof env.CLAUDE_TOOL_NAME === 'string' ? env.CLAUDE_TOOL_NAME : '';
  const parsed = parseObjectPayload(raw);
  if (!parsed.valid) return invalidContext(envName ? 'env-direct' : 'stdin', parsed.error);
  if (envName) return buildContext('env-direct', envName, parsed.value, env);
  const outer = parsed.value;
  if (typeof outer.tool_name === 'string' && outer.tool_name && outer.tool_input !== null &&
      typeof outer.tool_input === 'object' && !Array.isArray(outer.tool_input)) {
    return buildContext('stdin-wrapper', outer.tool_name, outer.tool_input, env, outer.session_id);
  }
  if (Object.hasOwn(outer, 'tool_name') || Object.hasOwn(outer, 'tool_input')) {
    return invalidContext('stdin-wrapper', typedError('invalid-wrapper',
      'tool_name must be a nonempty string and tool_input must be an object'));
  }
  return buildContext('stdin-flat', '', outer, env, outer.session_id);
}

function getAlias(input, first, second, errors, required = true) {
  const hasFirst = Object.hasOwn(input, first);
  const hasSecond = Object.hasOwn(input, second);
  const a = hasFirst ? input[first] : undefined;
  const b = hasSecond ? input[second] : undefined;
  if (hasFirst && typeof a !== 'string') {
    errors.push(typedError('invalid-mutation-field', `${first} must be a string`, first));
    return null;
  }
  if (hasSecond && typeof b !== 'string') {
    errors.push(typedError('invalid-mutation-field', `${second} must be a string`, second));
    return null;
  }
  if (hasFirst && hasSecond && a !== b) {
    errors.push(typedError('ambiguous-field', `${first} and ${second} conflict`, `${first}|${second}`));
    return null;
  }
  const value = hasFirst ? a : b;
  if ((value === undefined || value === '') && required) {
    errors.push(typedError('missing-mutation-field', `${first} or ${second} is required`, `${first}|${second}`));
    return null;
  }
  return value;
}

function extractPatchTargets(patchText, errors) {
  if (typeof patchText !== 'string') return [];
  if (/\0|\r(?!\n)/.test(patchText)) {
    errors.push(typedError('invalid-patch-header', 'patch contains a forbidden control character', 'command'));
    return [];
  }
  patchText = patchText.replace(/\r\n/g, '\n');
  const targets = [];
  const beginPatch = patchText.includes('*** Begin Patch');
  for (const line of patchText.split('\n')) {
    let match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (!match) match = line.match(/^\*\*\* Move to: (.+)$/);
    if (match) {
      const value = match[1];
      if (!value || /^\/dev\/null$/.test(value)) continue;
      targets.push(value);
      continue;
    }
    if (!beginPatch) {
      match = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
      if (match && match[1] !== '/dev/null') targets.push(match[1]);
    }
  }
  if (targets.length === 0) {
    errors.push(typedError('invalid-patch-header', 'patch has no valid file header', 'command'));
  }
  return targets;
}

function extractShellTargets(command, errors) {
  if (typeof command !== 'string' || command === '') {
    errors.push(typedError('missing-mutation-field', 'command is required', 'command'));
    return [];
  }
  if (/\0|\r(?!\n)/.test(command)) {
    errors.push(typedError('invalid-mutation-field', 'command contains a forbidden control character', 'command'));
    return [];
  }
  command = command.replace(/\r\n/g, '\n');
  const targets = [];
  const patterns = [
    /(?:^|[;&|]\s*|\s)(?:>>?|2>>?)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g,
    /\b(?:cp|mv)\s+(?:-[^\s]+\s+)*(?:"[^"]+"|'[^']+'|[^\s]+)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g,
    /\bsed\s+-i(?:\.[^\s]+)?\s+(?:"[^"]*"|'[^']*'|[^\s]+)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g,
  ];
  for (const pattern of patterns) {
    for (const match of command.matchAll(pattern)) targets.push(match[1] || match[2] || match[3]);
  }
  return targets;
}

function extractMutationTargets(context) {
  if (!context || context.valid !== true) {
    return {valid:false, targets:[], errors:[typedError('invalid-context', 'hook context is invalid')]};
  }
  const input = context.toolInput;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {valid:false, targets:[], errors:[typedError('tool-input-not-object',
      'tool input must be an object')]};
  }
  const errors = [];
  let targets = [];
  if (context.toolName === 'Write' || context.toolName === 'Edit') {
    const target = getAlias(input, 'file_path', 'path', errors);
    if (target !== null) targets.push(target);
  } else if (context.toolName === 'MultiEdit') {
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      errors.push(typedError('invalid-edits', 'edits must be a nonempty array', 'edits'));
    } else {
      input.edits.forEach((edit, index) => {
        if (edit === null || typeof edit !== 'object' || Array.isArray(edit)) {
          errors.push(typedError('invalid-edits', 'each edit must be an object', `edits[${index}]`));
          return;
        }
        const target = getAlias(edit, 'file_path', 'path', errors);
        if (target !== null) targets.push(target);
      });
    }
  } else if (context.toolName === 'apply_patch') {
    const patchText = getAlias(input, 'command', 'patch', errors);
    if (patchText !== null) targets.push(...extractPatchTargets(patchText, errors));
  } else if (context.toolName === 'Bash') {
    if (Object.hasOwn(input, 'command') && typeof input.command === 'string') {
      targets.push(...extractShellTargets(input.command, errors));
    } else {
      errors.push(typedError('missing-mutation-field', 'command is required', 'command'));
    }
  } else {
    errors.push(typedError('unsupported-tool', `unsupported mutation tool: ${context.toolName}`,
      'toolName'));
  }
  targets = [...new Set(targets)];
  return errors.length ? {valid:false, targets:[], errors} : {valid:true, targets, errors:[]};
}

module.exports = {
  parseHookContext,
  extractMutationTargets,
};
