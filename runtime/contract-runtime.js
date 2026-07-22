'use strict';

const crypto = require('node:crypto');

const REQUIRED_HEADINGS = Object.freeze([
  '# Executable Spec:',
  '## Scope',
  '## Non-goals',
  '## Contract',
  '## Requirement Notes',
  '## Failure and Recovery Notes',
  '## Decisions and Trade-offs',
  '## Open Questions',
  '## Spec Gate Result',
]);
const RISK_CLASSES = new Set(['low', 'medium', 'high', 'critical']);
const REVIEW_POLICIES = new Set(['deterministic', 'single', 'dual']);
const ID_PATTERNS = Object.freeze({
  spec: /^SPEC-[A-Z0-9][A-Z0-9-]{2,63}$/,
  requirement: /^REQ-\d{3}$/,
  invariant: /^INV-\d{3}$/,
  failure: /^FM-\d{3}$/,
  negative: /^NEG-\d{3}$/,
  gate: /^GATE-[a-z][a-z0-9-]{2,63}$/,
  slice: /^SLICE-\d{3,}$/,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function byteSort(values) {
  return [...values].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of byteSort(Object.keys(value))) out[key] = canonicalize(value[key]);
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function issue(code, path, message = code) {
  return { code, path, message };
}

function fail(code, path, message = code) {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  throw error;
}

function exactKeys(value, expected, path, errors) {
  if (!isObject(value)) {
    errors.push(issue('contract-wrong-type', path, `${path} must be an object`));
    return false;
  }
  const actual = byteSort(Object.keys(value));
  const wanted = byteSort(expected);
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    errors.push(issue('contract-exact-keys', path, `${path} has unknown or missing fields`));
    return false;
  }
  return true;
}

function uniqueIds(items, pattern, path, errors) {
  if (!Array.isArray(items)) {
    errors.push(issue('contract-wrong-type', path, `${path} must be an array`));
    return [];
  }
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const id = item && item.id;
    if (typeof id !== 'string' || !pattern.test(id)) {
      errors.push(issue('contract-id-grammar', `${path}[${index}].id`, `invalid ID ${String(id)}`));
    } else if (seen.has(id)) {
      errors.push(issue('contract-duplicate-id', `${path}[${index}].id`, `duplicate ID ${id}`));
    } else seen.add(id);
  }
  return byteSort(seen);
}

function validateString(value, path, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(issue('contract-required-string', path, `${path} must be non-empty`));
    return false;
  }
  return true;
}

function validateIdArray(value, pattern, path, errors, known = null) {
  if (!Array.isArray(value)) {
    errors.push(issue('contract-wrong-type', path, `${path} must be an array`));
    return [];
  }
  const seen = new Set();
  for (const [index, id] of value.entries()) {
    if (typeof id !== 'string' || !pattern.test(id)) {
      errors.push(issue('contract-id-grammar', `${path}[${index}]`, `invalid reference ${String(id)}`));
    } else if (seen.has(id)) {
      errors.push(issue('contract-duplicate-reference', `${path}[${index}]`, `duplicate reference ${id}`));
    } else if (known && !known.has(id)) {
      errors.push(issue('contract-dangling-reference', `${path}[${index}]`, `dangling reference ${id}`));
    }
    seen.add(id);
  }
  return byteSort(seen);
}

function specContractDigest(contract) {
  if (!isObject(contract)) fail('contract-wrong-type', 'contract');
  const forbidden = Object.keys(contract).filter((key) => /(?:^|_)sha256$|digest/i.test(key));
  if (forbidden.length) fail('contract-embedded-digest', forbidden[0], 'embedded digest fields are forbidden');
  return digest(contract);
}

function buildSpecIndex(contract) {
  return {
    requirements: new Set((contract.requirements || []).map((row) => row.id)),
    invariants: new Set((contract.invariants || []).map((row) => row.id)),
    failureModes: new Set((contract.failure_matrix || []).map((row) => row.id)),
    negativeTests: new Set((contract.negative_tests || []).map((row) => row.id)),
  };
}

function coverageShape(total, covered, uncoveredIds, notApplicableReason) {
  if (total === 0) {
    return { total: 0, covered: 0, uncovered_ids: [], ratio: null,
      not_applicable_reason: notApplicableReason || 'no applicable contract rows' };
  }
  return { total, covered, uncovered_ids: byteSort(uncoveredIds), ratio: covered / total };
}

function computeRequirementCoverage(contract, context = {}) {
  const rows = Array.isArray(contract.requirements) ? contract.requirements : [];
  const contractCovered = rows.filter((row) => typeof row.acceptance === 'string' && row.acceptance.trim()
    && ((row.negative_test_ids || []).length || (row.evidence_gate_ids || []).length));
  const contractUncovered = rows.filter((row) => !contractCovered.includes(row)).map((row) => row.id);
  let execution = null;
  if (Array.isArray(context.slices)) {
    const covered = new Set();
    for (const slice of context.slices) {
      if ((slice.evidence_required || []).length) {
        for (const id of slice.requirements || []) covered.add(id);
      }
    }
    const uncovered = rows.map((row) => row.id).filter((id) => !covered.has(id));
    execution = coverageShape(rows.length, rows.length - uncovered.length, uncovered);
  }
  return {
    contract: coverageShape(rows.length, contractCovered.length, contractUncovered),
    execution,
  };
}

function computeFailureMatrixCoverage(contract, context = {}) {
  const rows = Array.isArray(contract.failure_matrix) ? contract.failure_matrix : [];
  const complete = (row) => ['trigger', 'expected_behavior', 'detection', 'recovery', 'rollback']
    .every((key) => typeof row[key] === 'string' && row[key].trim())
    && (row.negative_test_ids || []).length > 0 && (row.evidence_gate_ids || []).length > 0;
  const contractCovered = rows.filter(complete);
  const contractUncovered = rows.filter((row) => !complete(row)).map((row) => row.id);
  let execution = null;
  if (Array.isArray(context.slices)) {
    const covered = new Set();
    for (const slice of context.slices) {
      if ((slice.negative_tests || []).length && (slice.evidence_required || []).length) {
        for (const id of slice.failure_modes || []) covered.add(id);
      }
    }
    const uncovered = rows.map((row) => row.id).filter((id) => !covered.has(id));
    execution = coverageShape(rows.length, rows.length - uncovered.length, uncovered,
      'risk class has no failure matrix obligation');
  }
  return {
    contract: coverageShape(rows.length, contractCovered.length, contractUncovered,
      'risk class has no failure matrix obligation'),
    execution,
  };
}

function validateSpecContract(contract, options = {}) {
  const errors = [];
  const expected = ['schema_version', 'spec_id', 'risk_class', 'requirements', 'invariants',
    'failure_matrix', 'negative_tests', 'compatibility', 'open_questions'];
  exactKeys(contract, expected, 'contract', errors);
  if (!isObject(contract)) return { pass: false, errors, warnings: [], index: null,
    requirementCoverage: { contract: coverageShape(0, 0, []), execution: null },
    failureMatrixCoverage: { contract: coverageShape(0, 0, []), execution: null } };
  if (contract.schema_version !== 1) errors.push(issue('contract-schema-version', 'schema_version'));
  if (!ID_PATTERNS.spec.test(contract.spec_id || '')) errors.push(issue('contract-id-grammar', 'spec_id'));
  const riskClass = options.riskClass || contract.risk_class;
  if (!RISK_CLASSES.has(contract.risk_class) || (options.riskClass && contract.risk_class !== riskClass)) {
    errors.push(issue('contract-risk-class', 'risk_class'));
  }
  const reqIds = new Set(uniqueIds(contract.requirements, ID_PATTERNS.requirement, 'requirements', errors));
  const invIds = new Set(uniqueIds(contract.invariants, ID_PATTERNS.invariant, 'invariants', errors));
  const fmIds = new Set(uniqueIds(contract.failure_matrix, ID_PATTERNS.failure, 'failure_matrix', errors));
  const negIds = new Set(uniqueIds(contract.negative_tests, ID_PATTERNS.negative, 'negative_tests', errors));

  for (const [i, row] of (contract.requirements || []).entries()) {
    exactKeys(row, ['id', 'statement', 'acceptance', 'priority', 'negative_test_ids', 'evidence_gate_ids'], `requirements[${i}]`, errors);
    validateString(row.statement, `requirements[${i}].statement`, errors);
    validateString(row.acceptance, `requirements[${i}].acceptance`, errors);
    if (!['must', 'should', 'may'].includes(row.priority)) errors.push(issue('contract-priority', `requirements[${i}].priority`));
    validateIdArray(row.negative_test_ids, ID_PATTERNS.negative, `requirements[${i}].negative_test_ids`, errors, negIds);
    validateIdArray(row.evidence_gate_ids, ID_PATTERNS.gate, `requirements[${i}].evidence_gate_ids`, errors);
  }
  for (const [i, row] of (contract.invariants || []).entries()) {
    exactKeys(row, ['id', 'statement', 'requirement_ids'], `invariants[${i}]`, errors);
    validateString(row.statement, `invariants[${i}].statement`, errors);
    validateIdArray(row.requirement_ids, ID_PATTERNS.requirement, `invariants[${i}].requirement_ids`, errors, reqIds);
  }
  for (const [i, row] of (contract.failure_matrix || []).entries()) {
    exactKeys(row, ['id', 'trigger', 'affected_requirement_ids', 'invariant_ids', 'expected_behavior',
      'detection', 'negative_test_ids', 'evidence_gate_ids', 'recovery', 'rollback'], `failure_matrix[${i}]`, errors);
    for (const key of ['trigger', 'expected_behavior', 'detection', 'recovery', 'rollback']) {
      validateString(row[key], `failure_matrix[${i}].${key}`, errors);
    }
    validateIdArray(row.affected_requirement_ids, ID_PATTERNS.requirement,
      `failure_matrix[${i}].affected_requirement_ids`, errors, reqIds);
    validateIdArray(row.invariant_ids, ID_PATTERNS.invariant, `failure_matrix[${i}].invariant_ids`, errors, invIds);
    validateIdArray(row.negative_test_ids, ID_PATTERNS.negative, `failure_matrix[${i}].negative_test_ids`, errors, negIds);
    validateIdArray(row.evidence_gate_ids, ID_PATTERNS.gate, `failure_matrix[${i}].evidence_gate_ids`, errors);
  }
  for (const [i, row] of (contract.negative_tests || []).entries()) {
    exactKeys(row, ['id', 'statement', 'requirement_ids', 'failure_mode_ids', 'expected_signal', 'gate_id'],
      `negative_tests[${i}]`, errors);
    validateString(row.statement, `negative_tests[${i}].statement`, errors);
    validateString(row.expected_signal, `negative_tests[${i}].expected_signal`, errors);
    validateIdArray(row.requirement_ids, ID_PATTERNS.requirement, `negative_tests[${i}].requirement_ids`, errors, reqIds);
    validateIdArray(row.failure_mode_ids, ID_PATTERNS.failure, `negative_tests[${i}].failure_mode_ids`, errors, fmIds);
    if (!ID_PATTERNS.gate.test(row.gate_id || '')) errors.push(issue('contract-id-grammar', `negative_tests[${i}].gate_id`));
  }
  if (!isObject(contract.compatibility)) errors.push(issue('contract-wrong-type', 'compatibility'));
  if (!Array.isArray(contract.open_questions)) errors.push(issue('contract-wrong-type', 'open_questions'));
  else if (contract.open_questions.some((q) => isObject(q) ? q.blocking !== false : /blocking|TBD|TODO/i.test(String(q)))) {
    errors.push(issue('contract-unresolved-marker', 'open_questions'));
  }

  const requirementCoverage = computeRequirementCoverage(contract, options);
  const failureMatrixCoverage = computeFailureMatrixCoverage(contract, options);
  if (['medium', 'high', 'critical'].includes(riskClass) && requirementCoverage.contract.ratio !== 1) {
    errors.push(issue('contract-requirement-coverage', 'requirements'));
  }
  if (['high', 'critical'].includes(riskClass)
      && (failureMatrixCoverage.contract.total === 0 || failureMatrixCoverage.contract.ratio !== 1)) {
    errors.push(issue('contract-failure-matrix-coverage', 'failure_matrix'));
  }
  if (Array.isArray(options.slices) && ['medium', 'high', 'critical'].includes(riskClass)
      && requirementCoverage.execution.ratio !== 1) {
    errors.push(issue('execution-requirement-coverage', 'slices'));
  }
  if (Array.isArray(options.slices) && ['high', 'critical'].includes(riskClass)
      && failureMatrixCoverage.execution.ratio !== 1) {
    errors.push(issue('execution-failure-matrix-coverage', 'slices'));
  }
  return { pass: errors.length === 0, errors, warnings: [], index: buildSpecIndex(contract),
    requirementCoverage, failureMatrixCoverage };
}

function headingPositions(source) {
  return REQUIRED_HEADINGS.map((heading) => {
    const pattern = heading.endsWith(':')
      ? new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*.+$`, 'm')
      : new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    const match = String(source).match(pattern);
    return match ? match.index : -1;
  });
}

function parseSpecMarkdown(source, context = {}) {
  if (typeof source !== 'string') fail('spec-source-type', context.path || 'spec.md');
  const normalized = source.replace(/\r\n/g, '\n');
  const positions = headingPositions(normalized);
  if (positions.some((position) => position < 0) || positions.some((position, i) => i && position <= positions[i - 1])) {
    fail('spec-heading-order', context.path || 'spec.md', 'required spec headings are missing or out of order');
  }
  const fences = [...normalized.matchAll(/^```json spec-contract\s*\n([\s\S]*?)^```\s*$/gm)];
  if (fences.length !== 1) fail('spec-contract-fence-count', context.path || 'spec.md', 'exactly one spec-contract fence is required');
  let contract;
  try { contract = JSON.parse(fences[0][1]); }
  catch (error) { fail('spec-contract-json', context.path || 'spec.md', error.message); }
  return canonicalize(contract);
}

function parseList(raw, path) {
  const value = String(raw || '').trim().replace(/\s+#.*$/, '');
  if (!value.startsWith('[') || !value.endsWith(']')) fail('plan-list', path, `${path} must use bracket-list syntax`);
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => item.trim().replace(/^["'`]|["'`]$/g, '')).filter(Boolean);
}

function field(block, name) {
  const match = block.match(new RegExp(`^\\s*-\\s*${name}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function parseSteps(block) {
  const marker = block.match(/^\s*-\s*steps:\s*$/m);
  if (!marker) return [];
  const tail = block.slice(marker.index + marker[0].length);
  const steps = [];
  for (const match of tail.matchAll(/^\s{4,}(\d+)\.\s+(.+)$/gm)) steps.push(match[2].trim());
  return steps;
}

function parseInlineObject(raw, path) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  if (!raw.startsWith('{') || !raw.endsWith('}')) fail('plan-object', path);
  const body = raw.slice(1, -1);
  const out = {};
  for (const part of body.split(/,(?![^\[]*\])/)) {
    const index = part.indexOf(':');
    if (index < 1) fail('plan-object', path);
    const key = part.slice(0, index).trim().replace(/^["']|["']$/g, '');
    const value = part.slice(index + 1).trim();
    if (value.startsWith('[')) out[key] = parseList(value, `${path}.${key}`);
    else if (/^-?\d+$/.test(value)) out[key] = Number(value);
    else out[key] = value.replace(/^["']|["']$/g, '');
  }
  return out;
}

function validateSliceContract(slice, context = {}) {
  if (!isObject(slice)) fail('slice-contract-type', 'slice');
  if (!ID_PATTERNS.slice.test(slice.id || '')) fail('slice-contract-id', 'id');
  const arrays = ['files', 'depends_on', 'integration_touchpoints', 'requirements', 'invariants',
    'failure_modes', 'negative_tests', 'evidence_required', 'scope_expansion_trigger'];
  for (const key of arrays) {
    if (!Array.isArray(slice[key])) fail('slice-contract-field', key, `${key} must be an array`);
    const seen = new Set();
    for (const value of slice[key]) {
      if (seen.has(value)) fail('slice-contract-duplicate-reference', key, `duplicate ${value}`);
      seen.add(value);
    }
  }
  if (!context.legacy) {
    validateStringOrFail(slice.outcome, 'outcome');
    if (!slice.requirements.length) fail('slice-contract-field', 'requirements');
    if (!slice.integration_touchpoints.length || !slice.scope_expansion_trigger.length) fail('slice-contract-field', 'integration');
    if (!isObject(slice.risk) || !RISK_CLASSES.has(slice.risk.class)
        || !Number.isInteger(slice.risk.score) || slice.risk.score < 0 || slice.risk.score > 14
        || !Array.isArray(slice.risk.triggers)) fail('slice-contract-risk', 'risk');
    if (!isObject(slice.rollback) || typeof slice.rollback.method !== 'string'
        || !Array.isArray(slice.rollback.verification) || !slice.rollback.verification.length) {
      fail('slice-contract-rollback', 'rollback');
    }
    if (!REVIEW_POLICIES.has(slice.review_policy)) fail('slice-contract-review-policy', 'review_policy');
  }
  const index = context.specIndex;
  if (index) {
    for (const [key, known, pattern] of [
      ['requirements', index.requirements, ID_PATTERNS.requirement],
      ['invariants', index.invariants, ID_PATTERNS.invariant],
      ['failure_modes', index.failureModes, ID_PATTERNS.failure],
      ['negative_tests', index.negativeTests, ID_PATTERNS.negative],
    ]) {
      for (const value of slice[key]) {
        if (!pattern.test(value)) fail('slice-contract-id', key);
        if (!known.has(value)) fail('slice-contract-dangling-reference', key, `dangling ${value}`);
      }
    }
  }
  return canonicalize(slice);
}

function validateStringOrFail(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail('slice-contract-field', path);
}

function parsePlanContractMarkdown(source, context = {}) {
  if (typeof source !== 'string') fail('plan-source-type', context.path || 'plan.md');
  const normalized = source.replace(/\r\n/g, '\n');
  const checklistHeading = normalized.match(/^##\s+Slice\s+Checklist\s*$/m);
  if (!checklistHeading) return { binding: null, slices: [] };
  const checklistTail = normalized.slice(checklistHeading.index + checklistHeading[0].length);
  const nextHeading = checklistTail.match(/^##\s+/m);
  const checklistBody = nextHeading ? checklistTail.slice(0, nextHeading.index) : checklistTail;
  const bindingSection = normalized.match(/^##\s+Spec\s+Contract\s+Binding\s*$([\s\S]*?)(?=^##\s+)/m);
  let binding = null;
  if (bindingSection) {
    const fences = [...bindingSection[1].matchAll(/^```json\s*\n([\s\S]*?)^```\s*$/gm)];
    if (fences.length !== 1) fail('plan-binding-fence-count', context.path || 'plan.md');
    try { binding = JSON.parse(fences[0][1]); } catch (error) { fail('plan-binding-json', context.path || 'plan.md', error.message); }
    const expected = ['schema_version', 'mode', 'created_by_version', 'spec_contract', 'risk_profile_sha256'];
    if (!exactKeyBoolean(binding, expected) || binding.schema_version !== 1 || binding.mode !== 'strict-spec') {
      fail('plan-binding-schema', 'binding');
    }
  }
  const body = checklistBody;
  const re = /^-\s+\[[ x]\]\s+(SLICE-\d{3,}):\s*([^\n]*)$/gm;
  const entries = [];
  let match;
  while ((match = re.exec(body))) entries.push({ id: match[1], goal: match[2].trim(), start: match.index });
  const slices = entries.map((entry, index) => {
    const block = body.slice(entry.start, index + 1 < entries.length ? entries[index + 1].start : body.length);
    const legacy = !binding;
    const files = parseList(field(block, 'files') || '[]', `${entry.id}.files`);
    if (legacy) return { id: entry.id, files, size: field(block, 'size'), goal: entry.goal };
    const slice = {
      id: entry.id,
      goal: entry.goal,
      outcome: field(block, 'outcome'),
      files,
      depends_on: parseList(field(block, 'depends_on') || '[]', `${entry.id}.depends_on`),
      integration_touchpoints: parseList(field(block, 'integration_touchpoints') || '[]', `${entry.id}.integration_touchpoints`),
      requirements: parseList(field(block, 'requirements') || '[]', `${entry.id}.requirements`),
      invariants: parseList(field(block, 'invariants') || '[]', `${entry.id}.invariants`),
      failure_modes: parseList(field(block, 'failure_modes') || '[]', `${entry.id}.failure_modes`),
      risk: parseInlineObject(field(block, 'risk'), `${entry.id}.risk`),
      negative_tests: parseList(field(block, 'negative_tests') || '[]', `${entry.id}.negative_tests`),
      evidence_required: parseList(field(block, 'evidence_required') || '[]', `${entry.id}.evidence_required`),
      rollback: parseInlineObject(field(block, 'rollback'), `${entry.id}.rollback`),
      review_policy: field(block, 'review_policy'),
      scope_expansion_trigger: parseList(field(block, 'scope_expansion_trigger') || '[]', `${entry.id}.scope_expansion_trigger`),
      failing_test: field(block, 'failing_test'),
      verification_cmd: field(block, 'verification_cmd'),
      expected_output: field(block, 'expected_output'),
      code_sketch: field(block, 'code_sketch'),
      spec_checklist: parseList(field(block, 'spec_checklist') || '[]', `${entry.id}.spec_checklist`),
      contract: parseList(field(block, 'contract') || '[]', `${entry.id}.contract`),
      acceptance_threshold: field(block, 'acceptance_threshold'),
      size: field(block, 'size'),
      steps: parseSteps(block),
    };
    return validateSliceContract(slice, { specIndex: context.specIndex, legacy: false });
  });
  if (new Set(slices.map((slice) => slice.id)).size !== slices.length) fail('plan-duplicate-slice', 'slices');
  return canonicalize({ binding, slices });
}

function exactKeyBoolean(value, expected) {
  return isObject(value) && canonicalJson(byteSort(Object.keys(value))) === canonicalJson(byteSort(expected));
}

module.exports = {
  ID_PATTERNS,
  REQUIRED_HEADINGS,
  canonicalJson,
  parseSpecMarkdown,
  parsePlanContractMarkdown,
  validateSpecContract,
  validateSliceContract,
  computeRequirementCoverage,
  computeFailureMatrixCoverage,
  specContractDigest,
};
