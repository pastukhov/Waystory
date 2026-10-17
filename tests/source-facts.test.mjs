import test from 'node:test';import assert from 'node:assert/strict';import * as facts from '../server/sources/facts.mjs';
test('grounding rejects missing blocks, invented quotations and unapproved citations',()=>{const story={blocks:[{text:'Built in 1900.',sourceIds:['a']}]},docs=[{id:'a',text:'Built in 1900.'}];assert.equal(facts.validateSupport(story,docs,{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1900.'}]}),true);for(const review of [{supported:true,items:[]},{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1800.'}]},{supported:false,items:[]}])assert.equal(facts.validateSupport(story,docs,review),false)});

test('support diagnostics distinguish model rejection from missing exact evidence',()=>{
 const story={blocks:[{text:'Built in 1900.',sourceIds:['a']}]},docs=[{id:'a',text:'Built in 1900.'}];
 assert.equal(facts.supportDetails(story,docs,{supported:false,items:[],issues:[{index:0,reason:'contradiction'}]}).reason,'model_rejected');
 const missing=facts.supportDetails(story,docs,{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1800.'}]});assert.equal(missing.reason,'missing_evidence');assert.deepEqual(missing.blockIndexes,[0]);
 assert.equal(facts.supportDetails(story,docs,{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1900.'}]}).reason,'supported');
});
