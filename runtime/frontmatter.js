'use strict';

const fs = require('node:fs');

function fail(code, message) {
  const error = new Error(`[${code}] ${message || code}`);
  error.code = code;
  throw error;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) fail('frontmatter-invalid', 'unterminated inline list');
    const inside = value.slice(1, -1).trim();
    if (!inside) return [];
    const out = [];
    let token = '';
    let quote = null;
    let escaped = false;
    for (const char of inside) {
      if (escaped) { token += char; escaped = false; continue; }
      if (char === '\\' && quote === '"') { token += char; escaped = true; continue; }
      if (quote) {
        token += char;
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
        token += char;
      } else if (char === ',') {
        out.push(parseScalar(token));
        token = '';
      } else token += char;
    }
    if (quote) fail('frontmatter-invalid', 'unterminated quoted list item');
    out.push(parseScalar(token));
    return out;
  }
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { fail('frontmatter-invalid', 'invalid quoted scalar'); }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) fail('frontmatter-invalid', 'invalid single-quoted scalar');
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseFrontmatter(text) {
  if (typeof text !== 'string') fail('frontmatter-input-type', 'frontmatter text must be a string');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  if (!text.startsWith(`---${newline}`)) return {fields:{}, body:text, newline, start:0, end:0};
  const closing = text.indexOf(`${newline}---${newline}`, 3 + newline.length);
  if (closing < 0) fail('frontmatter-unclosed', 'frontmatter closing delimiter is missing');
  const end = closing + newline.length + 3 + newline.length;
  const header = text.slice(3 + newline.length, closing);
  const fields = {};
  const lines = header === '' ? [] : header.split(newline);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) fail('frontmatter-invalid', `invalid frontmatter line ${index + 1}`);
    const key = match[1];
    if (Object.hasOwn(fields, key)) fail('frontmatter-duplicate', `duplicate frontmatter key: ${key}`);
    let raw = match[2] === undefined ? '' : match[2];
    if (raw === '') {
      const values = [];
      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
        index += 1;
        values.push(parseScalar(lines[index].replace(/^\s+-\s+/, '')));
      }
      fields[key] = values.length ? values : '';
    } else fields[key] = parseScalar(raw);
  }
  return {fields, body:text.slice(end), newline, start:0, end};
}

function formatScalar(value) {
  if (Array.isArray(value)) return `[${value.map(formatScalar).join(', ')}]`;
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string') fail('frontmatter-invalid-value', 'unsupported frontmatter value');
  if (value === '' || /^[-?:,\[\]{}#&*!|>'"%@`]|\s$|^\s|[\r\n]/.test(value) ||
      /\s|:\s|\s#/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function updateFrontmatterText(text, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    fail('frontmatter-patch-type', 'frontmatter patch must be an object');
  }
  const parsed = parseFrontmatter(text);
  const newline = parsed.newline;
  let lines = parsed.end
    ? text.slice(3 + newline.length, parsed.end - newline.length - 3 - newline.length).split(newline)
    : [];
  if (lines.length === 1 && lines[0] === '') lines = [];
  const pending = new Map(Object.entries(patch));
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
    if (!match || !pending.has(match[1])) {
      output.push(line);
      continue;
    }
    const key = match[1];
    while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) index += 1;
    const value = pending.get(key);
    pending.delete(key);
    if (value !== undefined) output.push(`${key}: ${formatScalar(value)}`);
  }
  for (const [key, value] of pending) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) fail('frontmatter-invalid-key', `invalid key: ${key}`);
    if (value !== undefined) output.push(`${key}: ${formatScalar(value)}`);
  }
  const header = `---${newline}${output.length ? `${output.join(newline)}${newline}` : ''}---${newline}`;
  return `${header}${parsed.body}`;
}

function capabilityPath(file, operation) {
  const { revalidatePathCapability } = require('./platform.js');
  return revalidatePathCapability(file, operation).path;
}

function readFrontmatter(file) {
  return parseFrontmatter(fs.readFileSync(capabilityPath(file, 'frontmatter-read'), 'utf8'));
}

function getFrontmatterField(file, key) {
  return readFrontmatter(file).fields[key];
}

function getFrontmatterList(file, key) {
  const value = getFrontmatterField(file, key);
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('frontmatter-field-not-list', `${key} is not a list`);
  return value;
}

function updateFrontmatter(file, patch, options = {}) {
  const { atomicWriteFile } = require('./platform.js');
  const current = fs.readFileSync(capabilityPath(file, 'frontmatter-update-read'), 'utf8');
  return atomicWriteFile(file, updateFrontmatterText(current, patch), options);
}

module.exports = {
  parseFrontmatter,
  updateFrontmatterText,
  readFrontmatter,
  getFrontmatterField,
  getFrontmatterList,
  updateFrontmatter,
};
