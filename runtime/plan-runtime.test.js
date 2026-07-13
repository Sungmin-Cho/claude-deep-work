'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlanScopeV1, canonicalizePlanScopeV1, deriveScopedWriteAuthority } =
  require('./plan-runtime.js');

const plan = {schema_version:1, slices:[{id:'SLICE-001', checked:false,
  scope_schema_version:1, files:['src/a.js','tests/a.test.js'], write_scope:{
    failing_test:['tests/a.test.js'], production:['src/a.js'],
    refactor:['src/a.js','tests/a.test.js'],
  }}]};

test('plan scope is byte-sorted, disjoint, complete, and digest-bound', () => {
  const checked = validatePlanScopeV1(plan);
  const canonical = canonicalizePlanScopeV1(checked);
  assert.deepEqual(canonical.slices[0].files, ['src/a.js','tests/a.test.js']);
  assert.match(canonical.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => validatePlanScopeV1({schema_version:1, slices:[{
    ...plan.slices[0], files:['src/A.js','src/a.js','tests/a.test.js'],
  }]}), /plan-scope/);
  assert.throws(() => validatePlanScopeV1({schema_version:1, slices:[{
    ...plan.slices[0], files:['CON','tests/a.test.js'], write_scope:{
      failing_test:['tests/a.test.js'], production:['CON'], refactor:[],
    },
  }]}), /portable-path-v1/);
});

test('inline authority is the intersection of class paths and slice union', () => {
  const authority = deriveScopedWriteAuthority({plan, sliceId:'SLICE-001',
    writeClass:'failing-test'});
  assert.deepEqual(authority.authorized_paths, ['tests/a.test.js']);
  assert.equal(authority.cluster_id, null);
  assert.match(authority.sha256, /^[0-9a-f]{64}$/);
});

test('delegation assignment is an exact partition of the locked plan', () => {
  const twoSlicePlan = {...plan, slices:[...plan.slices, {
    id:'SLICE-002', checked:false, scope_schema_version:1,
    files:['src/b.js','tests/b.test.js'], write_scope:{
      failing_test:['tests/b.test.js'], production:['src/b.js'], refactor:[],
    },
  }]};
  assert.throws(() => deriveScopedWriteAuthority({plan:twoSlicePlan,
    sliceId:'SLICE-001', writeClass:'production', clusterId:'C1',
    assignment:{schema_version:1, clusters:[{id:'C1',slices:['SLICE-001']}]},
  }), /delegation-scope-partition/);
  assert.throws(() => deriveScopedWriteAuthority({plan:twoSlicePlan,
    sliceId:'SLICE-001', writeClass:'production', clusterId:'C1',
    assignment:{schema_version:1, clusters:[{id:'C1',slices:['SLICE-002','SLICE-001']}]},
  }), /delegation-scope-order/);
});
