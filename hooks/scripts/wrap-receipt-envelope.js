#!/usr/bin/env node
'use strict';

/**
 * wrap-receipt-envelope.js — CLI to wrap a deep-work receipt payload in the
 * M3 cross-plugin envelope (cf. claude-deep-suite/docs/envelope-migration.md §1).
 *
 * Designed to be called from markdown agent prompts (deep-finish.md,
 * agents/implement-slice-worker.md) via the Bash tool. The agent writes the
 * domain payload to a temp file, then invokes this helper to produce the final
 * receipt artifact at the canonical path.
 *
 * Usage:
 *   node wrap-receipt-envelope.js \
 *     --artifact-kind <session-receipt|slice-receipt> \
 *     --payload-file <path-to-payload.json> \
 *     --output <path-to-final-receipt.json> \
 *     [--parent-run-id <ULID>] \
 *     [--session-id <id>] \
 *     [--source-artifacts-glob <glob>]   (slice receipts → session-receipt: aggregate intra-plugin chain)
 *     [--source-evolve-insights <path>]  (cross-plugin chain — also fills parent_run_id if not set)
 *     [--source-harnessability <path>]   (cross-plugin chain — adds to source_artifacts only)
 *
 * Exit codes:
 *   0 — wrote envelope-wrapped receipt
 *   2 — usage / IO / argv error
 *
 * Self-contained: no external deps. The envelope shape is enforced by the
 * companion validator (scripts/validate-envelope-emit.js).
 */

const fs = require('node:fs');
const path = require('node:path');

const env = require('./envelope');

function usage(extra) {
  if (extra) process.stderr.write(`error: ${extra}\n`);
  process.stderr.write(
    'usage: wrap-receipt-envelope.js --artifact-kind <session-receipt|slice-receipt>\n' +
      '                                 --payload-file <payload.json>\n' +
      '                                 --output <receipt.json>\n' +
      '                                 [--parent-run-id <ULID>]\n' +
      '                                 [--session-id <id>]\n' +
      '                                 [--source-artifacts-glob <glob>]\n' +
      '                                 [--source-evolve-insights <path>]\n' +
      '                                 [--source-harnessability <path>]\n',
  );
  process.exit(2);
}

const KNOWN_FLAGS = new Set([
  'artifact-kind',
  'payload-file',
  'output',
  'parent-run-id',
  'session-id',
  'source-artifacts-glob',
  'source-evolve-insights',
  'source-harnessability',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      usage(`unexpected positional argument: ${a}`);
    }
    let key;
    let value;
    if (a.includes('=')) {
      const eq = a.indexOf('=');
      key = a.slice(2, eq);
      value = a.slice(eq + 1);
    } else {
      key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        usage(`flag --${key} expects a value`);
      }
      value = next;
      i++;
    }
    if (!KNOWN_FLAGS.has(key)) {
      usage(`unknown flag --${key}`);
    }
    args[key] = value;
  }
  return args;
}

function readJson(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    process.stderr.write(`error: cannot read ${p}: ${err.message}\n`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`error: cannot parse ${p} as JSON: ${err.message}\n`);
    process.exit(2);
  }
}

function tryReadEnvelopeRunId(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (env.isEnvelope(obj) && obj.envelope && typeof obj.envelope.run_id === 'string') {
      return obj.envelope.run_id;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

function expandSourceArtifactsGlob(globArg, baseCwd) {
  // Minimal POSIX-style glob: supports a single trailing `*` segment within
  // a literal directory path (e.g. `WORK_DIR/receipts/SLICE-*.json`).
  // Sufficient for deep-work's session-receipt → slice-receipt aggregation.
  if (!globArg) return [];
  const abs = path.isAbsolute(globArg) ? globArg : path.resolve(baseCwd, globArg);
  const dir = path.dirname(abs);
  const pattern = path.basename(abs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const re = new RegExp('^' + escaped + '$');
  return fs.readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['artifact-kind', 'payload-file', 'output'];
  for (const r of required) {
    if (!args[r]) usage(`missing required flag --${r}`);
  }

  const artifactKind = args['artifact-kind'];
  if (!env.ALLOWED_ARTIFACT_KINDS.has(artifactKind)) {
    usage(
      `--artifact-kind must be one of ${[...env.ALLOWED_ARTIFACT_KINDS].join(', ')}, got "${artifactKind}"`,
    );
  }

  const payloadPath = path.resolve(process.cwd(), args['payload-file']);
  const outputPath = path.resolve(process.cwd(), args['output']);

  const payload = readJson(payloadPath);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    process.stderr.write(
      `error: payload at ${payloadPath} must be a non-null, non-array object\n`,
    );
    process.exit(2);
  }

  // Cross-plugin chain: harvest run_ids from consumed artifacts.
  const sourceArtifacts = [];

  // Cross-plugin: deep-evolve evolve-insights (handoff §3.3 chain row).
  let parentRunId = args['parent-run-id'] || undefined;
  if (args['source-evolve-insights']) {
    const evolvePath = path.resolve(process.cwd(), args['source-evolve-insights']);
    const evolveRunId = tryReadEnvelopeRunId(evolvePath);
    sourceArtifacts.push({
      path: args['source-evolve-insights'],
      ...(evolveRunId ? { run_id: evolveRunId } : {}),
    });
    if (!parentRunId && evolveRunId) {
      parentRunId = evolveRunId;
    }
  }

  // Cross-plugin: deep-dashboard harnessability-report (multi-source, no parent).
  if (args['source-harnessability']) {
    const harnPath = path.resolve(process.cwd(), args['source-harnessability']);
    const harnRunId = tryReadEnvelopeRunId(harnPath);
    sourceArtifacts.push({
      path: args['source-harnessability'],
      ...(harnRunId ? { run_id: harnRunId } : {}),
    });
  }

  // Intra-plugin: session-receipt aggregates slice receipts.
  if (args['source-artifacts-glob']) {
    const slicePaths = expandSourceArtifactsGlob(args['source-artifacts-glob'], process.cwd());
    for (const sp of slicePaths) {
      const runId = tryReadEnvelopeRunId(sp);
      const rel = path.relative(process.cwd(), sp);
      sourceArtifacts.push({
        path: rel.length > 0 ? rel : sp,
        ...(runId ? { run_id: runId } : {}),
      });
    }
  }

  let wrapped;
  try {
    wrapped = env.wrapEnvelope({
      artifactKind,
      payload,
      parentRunId,
      sessionId: args['session-id'] || undefined,
      sourceArtifacts,
    });
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(2);
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch (err) {
      process.stderr.write(`error: cannot mkdir ${outDir}: ${err.message}\n`);
      process.exit(2);
    }
  }

  try {
    fs.writeFileSync(outputPath, JSON.stringify(wrapped, null, 2) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`error: cannot write ${outputPath}: ${err.message}\n`);
    process.exit(2);
  }

  process.stdout.write(
    `wrapped: ${outputPath} (run_id=${wrapped.envelope.run_id}, artifact_kind=${wrapped.envelope.artifact_kind})\n`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { expandSourceArtifactsGlob, tryReadEnvelopeRunId };
