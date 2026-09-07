'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {conclusionsFor}=require('../runtime/outcome-review-runtime.js');
const context={slice:{contract:{requirements:['REQ-001'],invariants:[],failure_modes:[]}}};
const checks=[{record:{oracle_id:'ORACLE-001',prepared:{oracle:{requirement_ids:['REQ-001'],invariant_ids:[],failure_mode_ids:[],check:{kind:'program'}}}}}];
const conclusion={id:'REQ-001',oracle_ids:['ORACLE-001'],control_ids:['ORACLE-001'],conclusion:'satisfied',control_relevance:'relevant'};
function observation(response={verdict:'PASS'},conclusions=[conclusion]){return[{observation:{response,conclusions}}];}
test('program outcome semantic FAIL and unresolved blockers cannot become satisfied receipt conclusions',()=>{
 for(const response of [{verdict:'FAIL'},{verdict:'PASS',unresolved_blockers:['B1']},{verdict:'PASS',findings:[{severity:'high',status:'open'}]},{verdict:'PASS',findings:[{severity:'low',status:'open',blocking:true}]},{verdict:'PASS',findings:'none'},{verdict:'PASS',unresolved_blockers:'none'}])assert.throws(()=>conclusionsFor(context,checks,observation(response)),/global-review-/);
});
test('program outcome reviewer requires exact IDs and retains nonblocking low advisories',()=>{
 for(const conclusions of [[],[conclusion,{...conclusion,id:'REQ-999'}],[conclusion,conclusion]])assert.throws(()=>conclusionsFor(context,checks,observation({verdict:'PASS'},conclusions)),/global-review-goal-conclusion/);
 assert.equal(conclusionsFor(context,checks,observation({verdict:'PASS',findings:[{id:'A1',severity:'low',status:'open'}]}))[0].conclusion,'satisfied');
});
