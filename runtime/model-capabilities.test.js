'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('./model-capabilities.js');
test('provider metadata for declared Claude aliases has a tier without inventing observed identity',()=>{
 assert.equal(api.resolveModelCapability({runtime:'claude',model:'claude-opus-4-6'}).nominal_tier,'deep');
 assert.equal(api.resolveModelCapability({runtime:'codex',model:'claude-opus-4-6'}).status,'foreign');
 assert.equal(api.matchesModelIdentity({runtime:'claude',requested:'opus',observed:'claude-opus-4-6'}),true);
 assert.equal(api.matchesModelIdentity({runtime:'claude',requested:'opus',observed:'claude-sonnet-4-6'}),false);
 assert.equal(api.matchesModelIdentity({runtime:'codex',requested:'gpt-6-astra',observed:null}),false);
});
