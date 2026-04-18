const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const loopSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'loop-state.json'), 'utf8'));
const llmSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'llm-output.json'), 'utf8'));

// 최소한의 구조 검증 (ajv가 없으므로 규약 확인만)
describe('loop-state.json schema', () => {
  it('has required root fields', () => {
    assert.ok(loopSchema.required.includes('session_id'));
    assert.ok(loopSchema.required.includes('loop_round'));
    assert.ok(loopSchema.required.includes('max_rounds'));
    assert.ok(loopSchema.required.includes('executed'));
    assert.ok(loopSchema.required.includes('terminated_by'));
  });

  it('terminated_by oneOf: null or string enum of 5 terminal reasons', () => {
    // O6 fix: oneOf 패턴 검증
    const oneOf = loopSchema.properties.terminated_by.oneOf;
    assert.ok(Array.isArray(oneOf));
    assert.equal(oneOf.length, 2);
    assert.ok(oneOf.some(o => o.type === 'null'));
    const stringBranch = oneOf.find(o => o.type === 'string');
    assert.ok(stringBranch);
    assert.deepEqual(new Set(stringBranch.enum), new Set(['user-finish', 'max-rounds', 'no-more-recommendations', 'interrupted', 'error']));
  });

  it('executed[].outcome enum is closed set', () => {
    const enumList = loopSchema.properties.executed.items.properties.outcome.enum;
    assert.deepEqual(new Set(enumList), new Set(['completed', 'failed', 'skipped']));
  });
});

describe('llm-output.json schema', () => {
  it('has required root fields', () => {
    assert.ok(llmSchema.required.includes('session_summary'));
    assert.ok(llmSchema.required.includes('recommendations'));
    assert.ok(llmSchema.required.includes('finish_recommended'));
  });

  it('recommendations array: maxItems 3, each has rank 1-3', () => {
    assert.equal(llmSchema.properties.recommendations.maxItems, 3);
    const itemProps = llmSchema.properties.recommendations.items.properties;
    assert.equal(itemProps.rank.minimum, 1);
    assert.equal(itemProps.rank.maximum, 3);
  });

  it('recommendations[].requires_rerun is boolean', () => {
    const itemProps = llmSchema.properties.recommendations.items.properties;
    assert.equal(itemProps.requires_rerun.type, 'boolean');
  });
});
