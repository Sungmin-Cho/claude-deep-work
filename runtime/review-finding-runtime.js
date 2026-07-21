'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REVIEW_POINTS = Object.freeze(['research', 'plan', 'slice-SLICE-NNN', 'cross-slice', 'final']);
const SEVERITIES = new Set(['blocker', 'major', 'minor', 'info']);
const REVIEW_ROLES = new Set(['structural', 'semantic', 'executability']);
const CHANNELS = new Set(['subagent', 'codex-cli', 'gemini-cli', 'deep-review']);
const STATUSES = new Set(['open', 'accepted', 'rejected', 'fixed', 'deferred']);
const UNRESOLVED_STATUSES = new Set(['open', 'accepted', 'deferred']);

const SEVERITY_MAP = Object.freeze({
  'review-gate-adversarial': Object.freeze({ critical: 'blocker', major: 'major', minor: 'minor', info: 'info' }),
  'phase-review-gate-opus': Object.freeze({ high: 'blocker', medium: 'major', low: 'minor', info: 'info' }),
  'binary-disagreement': Object.freeze({ disagreement: 'major', '비동의': 'major' }),
  'slice-stage2': Object.freeze({ critical: 'blocker', major: 'major', medium: 'major', minor: 'minor', low: 'minor', info: 'info' }),
  'structural-score': Object.freeze({}),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isReviewPoint(point) {
  return point === 'research' || point === 'plan' || point === 'cross-slice' || point === 'final'
    || /^slice-SLICE-\d{3}$/.test(point);
}

function normalizeSeverity(sourceScheme, value) {
  const mapping = SEVERITY_MAP[sourceScheme];
  if (!mapping) return null;
  return mapping[String(value).toLowerCase()] || null;
}

function blockerQualificationMissing(finding) {
  const missing = [];
  if (!(typeof finding.violated_contract === 'string' && finding.violated_contract.trim())) missing.push('violated_contract');
  if (!(typeof finding.location === 'string' && finding.location.trim())) missing.push('location');
  if (!(typeof finding.failure_scenario === 'string' && finding.failure_scenario.trim())) missing.push('failure_scenario');
  if (!(typeof finding.verification === 'string' && finding.verification.trim())) missing.push('verification');
  if (!(Number.isFinite(finding.confidence) && finding.confidence > 0 && finding.confidence <= 1)) missing.push('confidence');
  return missing;
}

function validateFinding(finding) {
  if (!isPlainObject(finding)) return false;
  if (!/^REV-(?:STRUCTURAL|SEMANTIC|EXECUTABILITY)-\d{3}$/i.test(finding.id || '')) return false;
  if (!SEVERITIES.has(finding.severity)) return false;
  if (!(Number.isFinite(finding.confidence) && finding.confidence >= 0 && finding.confidence <= 1)) return false;
  if (!REVIEW_ROLES.has(finding.review_role) || !CHANNELS.has(finding.channel)) return false;
  if (typeof finding.model !== 'string' || !finding.model) return false;
  if (!(finding.effort === null || typeof finding.effort === 'string')) return false;
  if (typeof finding.artifact !== 'string' || !finding.artifact) return false;
  if (typeof finding.location !== 'string' || !finding.location) return false;
  if (!(finding.violated_contract === null || typeof finding.violated_contract === 'string')) return false;
  if (!Array.isArray(finding.evidence) || finding.evidence.some((item) => typeof item !== 'string')) return false;
  if (!(finding.failure_scenario === null || typeof finding.failure_scenario === 'string')) return false;
  if (!(finding.verification === null || typeof finding.verification === 'string')) return false;
  if (!STATUSES.has(finding.status)) return false;
  if (!(finding.disposition_reason === null || typeof finding.disposition_reason === 'string')) return false;
  if (!Number.isInteger(finding.round) || finding.round < 1 || typeof finding.blind !== 'boolean') return false;
  if (finding.demoted !== undefined) {
    if (!isPlainObject(finding.demoted) || finding.demoted.from !== 'blocker'
      || finding.demoted.to !== 'major' || typeof finding.demoted.reason !== 'string') return false;
  }
  return true;
}

function normalizeFinding(raw, { sourceScheme } = {}) {
  if (!isPlainObject(raw)) return null;
  const severity = normalizeSeverity(sourceScheme, raw.severity);
  if (!severity) return null;
  const finding = {
    id: raw.id,
    severity,
    confidence: raw.confidence,
    review_role: raw.review_role,
    channel: raw.channel,
    model: raw.model,
    effort: raw.effort ?? null,
    artifact: raw.artifact,
    location: raw.location,
    violated_contract: raw.violated_contract ?? raw.quality_contract ?? null,
    evidence: raw.evidence,
    failure_scenario: raw.failure_scenario ?? null,
    verification: raw.verification ?? null,
    status: raw.status,
    disposition_reason: raw.disposition_reason ?? null,
    round: raw.round,
    blind: raw.blind,
  };
  if (finding.severity === 'blocker') {
    const missing = blockerQualificationMissing(finding);
    if (missing.length) {
      finding.severity = 'major';
      finding.demoted = { from: 'blocker', to: 'major',
        reason: `blocker-qualification-missing:${missing.join(',')}` };
    }
  }
  return validateFinding(finding) ? finding : null;
}

function structuralKey(finding) {
  return JSON.stringify([finding.artifact, finding.location, finding.violated_contract]);
}

function compareCanonical(a, b) {
  return JSON.stringify(a).localeCompare(JSON.stringify(b), 'en');
}

function dedupeFindings(findings) {
  if (!Array.isArray(findings)) return [];
  const groups = new Map();
  for (const finding of findings.filter(isPlainObject)) {
    const key = structuralKey(finding);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, members]) => {
    const ordered = members.slice().sort(compareCanonical);
    const merged = { ...ordered[0] };
    merged.evidence = [...new Set(ordered.flatMap((finding) => Array.isArray(finding.evidence) ? finding.evidence : []))]
      .sort((a, b) => a.localeCompare(b, 'en'));
    return merged;
  });
}

function verdictFromFindings(findings, reviewPlan = {}) {
  const canonical = dedupeFindings(findings);
  const openBlockers = canonical.filter((finding) => finding.severity === 'blocker'
    && UNRESOLVED_STATUSES.has(finding.status));
  const demoted = canonical.filter((finding) => finding.demoted);
  const blockerBlocks = reviewPlan?.gate?.blocker_blocks !== false;
  const verdict = blockerBlocks && openBlockers.length ? 'BLOCK' : 'PASS';
  const reasons = [];
  if (openBlockers.length) reasons.push(`${openBlockers.length} unresolved blocker finding(s)`);
  if (demoted.length) reasons.push(`${demoted.length} unqualified blocker finding(s) demoted`);
  return { verdict, open_blockers: openBlockers, demoted, reasons };
}

function findingsPath(workDir, point, round) {
  if (typeof workDir !== 'string' || !workDir) throw new Error('workDir is required');
  if (!isReviewPoint(point)) throw new Error(`invalid review point: ${point}`);
  if (!Number.isInteger(round) || round < 1) throw new Error(`invalid review round: ${round}`);
  return path.join(workDir, 'reviews', `${point}-round${round}-findings.json`);
}

function writeFindings({ workDir, point, round, findings }) {
  const target = findingsPath(workDir, point, round);
  const canonical = Array.isArray(findings) ? findings : [];
  if (canonical.some((finding) => !validateFinding(finding))) throw new Error('invalid finding payload');
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const payload = `${JSON.stringify({ schema_version: 1, point, round, findings: canonical }, null, 2)}\n`;
  try {
    fs.writeFileSync(temp, payload, { flag: 'wx' });
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return { path: target, source: 'canonical', findings: canonical };
}

function parseFindingFile(file, source) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const findings = Array.isArray(parsed) ? parsed : parsed?.findings;
    if (!Array.isArray(findings)) throw new Error('findings 배열 결측');
    return { findings, warnings: [], source, path: file };
  } catch (error) {
    return { findings: [], warnings: [`finding 파일 손상(fail-open): ${file}: ${error.message}`], source, path: file };
  }
}

function readFindings({ workDir, point, round, phase = null }) {
  const canonical = findingsPath(workDir, point, round);
  if (fs.existsSync(canonical)) return parseFindingFile(canonical, 'canonical');
  const legacy = [];
  if (typeof phase === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(phase)) {
    legacy.push(path.join(workDir, `${phase}-cross-review.json`));
  }
  legacy.push(path.join(workDir, 'adversarial-review.json'));
  const found = legacy.find((file) => fs.existsSync(file));
  if (found) return parseFindingFile(found, 'legacy');
  return { findings: [], warnings: [], source: 'canonical', path: canonical };
}

module.exports = {
  REVIEW_POINTS,
  SEVERITY_MAP,
  isReviewPoint,
  normalizeSeverity,
  normalizeFinding,
  validateFinding,
  dedupeFindings,
  verdictFromFindings,
  findingsPath,
  writeFindings,
  readFindings,
};
