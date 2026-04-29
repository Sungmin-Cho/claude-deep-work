// scripts/recommender-input.js
const MAX_TASK_BYTES = 2048;
const MAX_COMMITS = 5;
const MAX_DIRS = 10;
const MAX_DIR_LEN = 30;

function truncateBytes(s, max) {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= max) return s;
  // multi-byte 경계 보정: 연속 바이트(0x80~0xBF)에서 시작 바이트(0xxxxxxx 또는 11xxxxxx)로 backtrack
  let end = max;
  while (end > 0 && (buf[end] & 0xC0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8') + '[truncated]';
}

function sanitizeInput({ task_description, recent_commits, top_level_dirs, current_defaults, capability, git_status, ask_items }) {
  return {
    task_description: truncateBytes(String(task_description || ''), MAX_TASK_BYTES),
    workspace_meta: {
      git_status: git_status || 'clean', // caller가 channel; 미제공 시 'clean' fallback
      recent_commits: (recent_commits || []).slice(0, MAX_COMMITS).map(s => String(s)),
      top_level_dirs: (top_level_dirs || [])
        .filter(d => typeof d === 'string' && !d.includes('..') && !d.startsWith('/') && !/[\\:]/.test(d))
        .slice(0, MAX_DIRS)
        .map(d => d.length > MAX_DIR_LEN ? d.slice(0, MAX_DIR_LEN) : d)
    },
    // R3-W2 fix: profile의 interactive_each_session을 caller가 전달 (없으면 5개 default)
    ask_items: ask_items || ['team_mode', 'start_phase', 'tdd_mode', 'git', 'model_routing'],
    current_defaults: current_defaults || {},
    capability: capability || { git_worktree: true, team_mode_available: true }
  };
}

module.exports = { sanitizeInput, truncateBytes, MAX_TASK_BYTES, MAX_COMMITS, MAX_DIRS };

// ── CLI entrypoint ──
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const parsed = JSON.parse(input);
      const out = sanitizeInput(parsed);
      process.stdout.write(JSON.stringify(out) + '\n');
      process.exit(0);
    } catch (e) {
      process.stderr.write(`recommender-input parse error: ${e.message}\n`);
      process.exit(1);
    }
  });
}
