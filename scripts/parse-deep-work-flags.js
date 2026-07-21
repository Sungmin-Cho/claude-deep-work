// scripts/parse-deep-work-flags.js
'use strict';

const {
  parseFlags,
  RECOMMENDER_ALLOWLIST,
  EXEC_ALLOWLIST,
  PROFILE_NAME_ALLOWLIST,
  TDD_ALLOWLIST,
  RESUME_FROM_ALLOWLIST,
  SESSION_ALLOWLIST,
  WORKTREE_PATH_BLOCKLIST,
  POLICY_ALLOWLIST,
  RISK_ALLOWLIST,
  REVIEW_ALLOWLIST,
} = require('../runtime/flags-runtime.js');

module.exports = {
  parseFlags,
  RECOMMENDER_ALLOWLIST,
  EXEC_ALLOWLIST,
  PROFILE_NAME_ALLOWLIST,
  TDD_ALLOWLIST,
  RESUME_FROM_ALLOWLIST,
  SESSION_ALLOWLIST,
  WORKTREE_PATH_BLOCKLIST,
  POLICY_ALLOWLIST,
  RISK_ALLOWLIST,
  REVIEW_ALLOWLIST,
};

if (require.main === module) {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs.length === 1 && /\s/.test(rawArgs[0])
    ? rawArgs[0].split(/\s+/).filter(Boolean)
    : rawArgs;
  process.stdout.write(`${JSON.stringify(parseFlags(args.filter((arg) => arg !== '--')))}\n`);
}
