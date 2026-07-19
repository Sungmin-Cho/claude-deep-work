'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCALE_SMALL_MAX = 200;
const SCALE_MEDIUM_MAX = 2000;
const FS_WALK_CAP = 5000;
const LOC_SAMPLE_CAP = 200;
const LOC_FILE_BYTE_CAP = 1024 * 1024;
const SOURCE_EXTS = Object.freeze(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go',
  '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.sh', '.ps1']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.claude', '.deep-work', '.deep-loop']);

function defaultGitLsFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', timeout: 3000 });
    return out.split('\n').filter(Boolean);
  } catch { return null; }
}

function walkFiles(root, cap) {
  const out = []; const stack = [root];
  while (stack.length && out.length < cap) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.length >= cap) break;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(dir, e.name)); }
      else if (e.isFile()) out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function collectCodebaseSignals(root, deps = {}) {
  const gitLsFiles = deps.gitLsFiles || defaultGitLsFiles;
  const errors = [];
  let files = null;
  const tracked = gitLsFiles(root);
  if (Array.isArray(tracked)) files = tracked.map((f) => path.join(root, f));
  else {
    try {
      if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
      files = walkFiles(root, FS_WALK_CAP);
    } catch (e) { errors.push(`walk: ${e.message}`); }
  }
  if (files === null) {
    return { tracked_files: null, loc_estimate: null, languages: null, has_tests: null, deps_count: null, errors };
  }
  const sourceFiles = files.filter((f) => SOURCE_EXTS.includes(path.extname(f).toLowerCase()));
  const exts = new Set(sourceFiles.map((f) => path.extname(f).toLowerCase()));
  const sample = sourceFiles.slice(0, LOC_SAMPLE_CAP);
  let sampleLoc = 0; let sampled = 0;
  for (const f of sample) {
    try {
      const st = fs.statSync(f);
      if (st.size > LOC_FILE_BYTE_CAP) continue;
      sampleLoc += fs.readFileSync(f, 'utf8').split('\n').length; sampled += 1;
    } catch { /* 개별 파일 실패는 무시 — 샘플에서 제외 */ }
  }
  const locEstimate = sampled > 0 ? Math.round((sampleLoc / sampled) * sourceFiles.length) : null;
  const hasTests = files.some((f) => {
    const rel = path.relative(root, f);
    return /(^|[\\/])(tests?|__tests__|spec)([\\/])/.test(rel) || /\.(test|spec)\.[a-z]+$/.test(rel);
  });
  let depsCount = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    depsCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
  } catch { /* 매니페스트 없음 — null 유지 */ }
  return { tracked_files: files.length, loc_estimate: locEstimate, languages: exts.size,
    has_tests: hasTests, deps_count: depsCount, errors };
}

function classifyRepoScale(signals = {}) {
  const n = signals.tracked_files;
  if (typeof n !== 'number') return 'medium'; // null/부재 → medium 수렴 (리뷰 Low-7: LOC은 보조 신호)
  if (n < SCALE_SMALL_MAX) return 'small';
  if (n < SCALE_MEDIUM_MAX) return 'medium';
  return 'large';
}

module.exports = { SCALE_SMALL_MAX, SCALE_MEDIUM_MAX, FS_WALK_CAP, LOC_SAMPLE_CAP,
  collectCodebaseSignals, classifyRepoScale };
