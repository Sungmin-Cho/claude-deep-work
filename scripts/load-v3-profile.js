'use strict';
const fs = require('node:fs');

/**
 * v3 profile에서 preset의 defaults + interactive_each_session 추출.
 * yaml 의존성 없이 line-by-line scope tracking (migrate-model-routing.js 컨벤션 일관).
 */
function loadV3Profile(profilePath, opts = {}) {
  const text = fs.readFileSync(profilePath, 'utf8');
  const versionMatch = text.match(/^version:\s*(\d+)\s*$/m);
  if (!versionMatch || versionMatch[1] !== '3') {
    return { error: 'not-v3' };
  }

  // default_preset 또는 환경변수 override
  const defaultPresetMatch = text.match(/^default_preset:\s*(\S+)\s*$/m);
  const requestedPreset = opts.initialPreset || (defaultPresetMatch ? defaultPresetMatch[1] : null);
  if (!requestedPreset) return { error: 'no-default-preset' };

  // presets 블록 안에서 requestedPreset 찾기
  const lines = text.split('\n');
  const presetsIdx = lines.findIndex(l => /^presets:\s*$/.test(l));
  if (presetsIdx < 0) return { error: 'no-presets-block' };

  // 2-space 들여쓰기로 preset 이름 매칭
  const presetHeaderRe = new RegExp(`^( {2})${requestedPreset}:\\s*$`);
  let presetIdx = -1;
  for (let i = presetsIdx + 1; i < lines.length; i++) {
    if (presetHeaderRe.test(lines[i])) { presetIdx = i; break; }
    // presets 블록 종료 (들여쓰기 0으로 떨어짐)
    if (lines[i].trim() !== '' && !/^\s/.test(lines[i])) break;
  }
  if (presetIdx < 0) {
    return { error: 'preset-not-found', requested_preset: requestedPreset };
  }

  // preset 블록 범위
  let presetEnd = lines.length;
  for (let i = presetIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const indent = lines[i].match(/^( *)/)[1].length;
    if (indent <= 2) { presetEnd = i; break; }
  }

  // interactive_each_session 배열 추출
  const interactive = [];
  const ieIdx = lines.slice(presetIdx, presetEnd)
    .findIndex(l => /^ {4}interactive_each_session:\s*$/.test(l));
  if (ieIdx >= 0) {
    const realIdx = presetIdx + ieIdx;
    for (let i = realIdx + 1; i < presetEnd; i++) {
      const m = lines[i].match(/^ {6}-\s*(\S+)\s*$/);
      if (m) interactive.push(m[1]);
      else if (lines[i].trim() !== '' && !/^\s{6}/.test(lines[i])) break;
    }
  }

  // defaults 블록 추출 (단순화: 주요 5개 필드만)
  const defaults = {};
  const defaultsIdx = lines.slice(presetIdx, presetEnd)
    .findIndex(l => /^ {4}defaults:\s*$/.test(l));
  if (defaultsIdx >= 0) {
    const realIdx = presetIdx + defaultsIdx;
    let i = realIdx + 1;
    while (i < presetEnd) {
      const line = lines[i];
      // scalar fields (team_mode, start_phase, tdd_mode)
      const scalarMatch = line.match(/^ {6}(\w+):\s*(\S+)\s*$/);
      if (scalarMatch) {
        defaults[scalarMatch[1]] = scalarMatch[2];
        i++; continue;
      }
      // nested: git, model_routing
      const blockMatch = line.match(/^ {6}(\w+):\s*$/);
      if (blockMatch) {
        const blockKey = blockMatch[1];
        const block = {};
        i++;
        while (i < presetEnd) {
          const childMatch = lines[i].match(/^ {8}(\w+):\s*(\S+)\s*$/);
          if (childMatch) { block[childMatch[1]] = childMatch[2]; i++; }
          else break;
        }
        defaults[blockKey] = block;
        continue;
      }
      // 빈 줄 또는 같은 indent의 다른 필드
      if (line.trim() === '') { i++; continue; }
      break;
    }
  }

  return {
    preset_name: requestedPreset,
    interactive_each_session: interactive,
    defaults
  };
}

module.exports = { loadV3Profile };

// CLI entrypoint
if (require.main === module) {
  const profilePath = process.argv[2];
  if (!profilePath) {
    process.stderr.write('Usage: node load-v3-profile.js <profile-path>\n');
    process.exit(2);
  }
  const initialPreset = process.env.DEEP_WORK_INITIAL_PRESET || undefined;
  const result = loadV3Profile(profilePath, { initialPreset });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.error ? 1 : 0);
}
