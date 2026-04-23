'use strict';
const fs = require('node:fs');

const FIELDS_TO_MIGRATE = ['research', 'implement', 'test'];  // plan excluded (W1)

/**
 * Atomically migrate `model_routing.{research,implement,test}: "main"`
 * to "sonnet" in a deep-work state file (YAML frontmatter).
 *
 * Scanning rules (N-R4 hardening):
 *   1. Operate ONLY within the `model_routing:` YAML block (scoped to prevent
 *      false-positive matches on unrelated fields that happen to be named
 *      "research"/"implement"/"test" in other sections).
 *   2. Allow optional inline `# comment` after the value.
 *   3. Tolerate both quoted ("main", 'main') and unquoted (main) values.
 *
 * Returns { replaced: [...field names], warnings: [...messages] }.
 */
function migrateStateFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const replaced = [];
  const warnings = [];

  // N-R4: locate the model_routing: block by scanning line-by-line and
  // tracking indent. The block starts at a line `^model_routing:\s*$` (no
  // quote/value) and ends at the next line with shallower-or-equal indent
  // to the header.
  const lines = src.split('\n');
  const modelRoutingIdx = lines.findIndex((l) => /^model_routing:\s*(#.*)?$/.test(l));

  if (modelRoutingIdx < 0) {
    return { replaced, warnings };  // No model_routing block — nothing to migrate
  }

  // Determine block range: header is at indent 0; block members are indented.
  let blockEnd = lines.length;
  for (let i = modelRoutingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;  // blank lines OK
    if (!/^\s/.test(line)) { blockEnd = i; break; }  // first non-indented → end
  }

  let modified = false;

  for (let i = modelRoutingIdx + 1; i < blockEnd; i++) {
    const line = lines[i];
    // Match: indent + field: + optional quote + value + optional quote + optional comment
    const fieldRe = /^(\s+)(\w+):\s*(["']?)([^"'\s#]+)\3(\s*(?:#.*)?)$/;
    const m = line.match(fieldRe);
    if (!m) continue;
    const [, indent, field, , value, suffix] = m;

    if (!FIELDS_TO_MIGRATE.includes(field)) continue;

    if (value === 'main') {
      lines[i] = `${indent}${field}: "sonnet"${suffix}`;
      replaced.push(field);
      modified = true;
    } else if (/^main-/.test(value)) {
      warnings.push(`unknown model_routing.${field} value "${value}" — preserved as-is`);
    }
  }

  if (modified) {
    // Atomic write: temp file + rename (POSIX)
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o644 });
    fs.renameSync(tmp, filePath);
  }

  return { replaced, warnings };
}

module.exports = { migrateStateFile, FIELDS_TO_MIGRATE };

// CLI usage: node migrate-model-routing.js <state-file>
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: migrate-model-routing.js <state-file>');
    process.exit(2);
  }
  const { replaced, warnings } = migrateStateFile(target);
  for (const w of warnings) console.error(`[migration v6.4.0] ${w}`);
  for (const field of replaced) {
    console.log(`[migration v6.4.0] model_routing.${field}='main' deprecated → 'sonnet' 적용`);
  }
  process.exit(0);
}
