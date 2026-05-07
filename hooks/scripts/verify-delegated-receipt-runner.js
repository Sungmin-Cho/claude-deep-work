'use strict';
const fs = require('node:fs');
const path = require('node:path');

const [scriptDir, stateFile, receiptsDir, planMdPath, skipItemsCsv, onlyCompleted] =
  process.argv.slice(2);

const { verifyReceipts, parsePlanMd, parseStateFile } =
  require(path.join(scriptDir, 'verify-receipt-core.js'));
const { unwrapEnvelope } = require(path.join(scriptDir, 'envelope.js'));

// N-R2: state file is YAML frontmatter in a Markdown file
// (.claude/deep-work.{SESSION_ID}.md), NOT JSON. parseStateFile extracts
// just the fields we need (tdd_mode).
const state = parseStateFile(stateFile);
const plan = parsePlanMd(planMdPath);

let receipts = fs.readdirSync(receiptsDir)
  .filter((f) => /^SLICE-\d+\.json$/.test(f))
  .sort()
  .map((f) => {
    const obj = JSON.parse(fs.readFileSync(path.join(receiptsDir, f), 'utf8'));
    // v6.5.0 envelope-aware: unwrapEnvelope returns the original object for
    // legacy receipts and the payload for envelope-wrapped receipts. Identity
    // mismatch returns null — treat as missing receipt.
    const unwrapped = unwrapEnvelope(obj, 'slice-receipt');
    if (unwrapped === null) {
      throw new Error(`receipt ${f}: M3 envelope identity mismatch (producer / artifact_kind / schema.name)`);
    }
    return unwrapped;
  });

if (onlyCompleted === '1') {
  receipts = receipts.filter((r) => r.status === 'complete');
}

const skipItems = skipItemsCsv
  ? skipItemsCsv.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite)
  : [];

const result = verifyReceipts({
  receipts,
  plan,
  tdd_mode: state.tdd_mode || 'strict',
  skip_items: skipItems,
});

const hasErrors = !result.pass;
if (result.warnings && result.warnings.length > 0) {
  // N-R5: item 8 is advisory — log warnings but do not fail on them.
  console.log(`[verify-delegated-receipt] ${result.warnings.length} advisory warning(s):`);
  for (const w of result.warnings) console.log('  ' + w);
}

if (hasErrors) {
  console.log(`[verify-delegated-receipt] FAIL (${result.errors.length} error(s)):`);
  for (const e of result.errors) console.log('  ' + e);
  process.exit(1);
}
console.log(`[verify-delegated-receipt] all items pass (${receipts.length} receipts)`);
