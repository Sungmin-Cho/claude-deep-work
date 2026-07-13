'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectCapability, buildRecommenderInput, validateRecommendation, formatAskOptions } =
  require('./recommender-runtime.js');

test('recommender transforms are pure bounded and exact-schema', () => {
  const capability = detectCapability({is_git:true,worktree_supported:false,team_env_set:true});
  const input = buildRecommenderInput({task_description:'한'.repeat(10_000),capability,
    recent_commits:[],top_level_dirs:[],current_defaults:{},git_status:'',ask_items:[]});
  assert.ok(Buffer.byteLength(input.task_description) <= 4096);
  const data = validateRecommendation(JSON.stringify({git:'current-branch',team_mode:'solo',
    tdd_mode:'strict',start_phase:'research',model_routing:'auto'}), capability);
  assert.deepEqual(Object.keys(data).sort(), ['git','model_routing','start_phase','tdd_mode','team_mode']);
  assert.throws(() => validateRecommendation(JSON.stringify({...data,extra:true}), capability),
    /recommendation-schema/);
  assert.equal(formatAskOptions({item:'git', recommendation:'worktree',default_value:'worktree',
    enum_values:['worktree','current-branch'],capability}).some((option) => option.value === 'worktree'),
    false);
});
