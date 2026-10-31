import test from 'node:test';import assert from 'node:assert/strict';import * as facts from '../server/sources/facts.mjs';
test('grounding rejects missing blocks, invented quotations and unapproved citations',()=>{const story={blocks:[{text:'Built in 1900.',sourceIds:['a']}]},docs=[{id:'a',text:'Built in 1900.'}];assert.equal(facts.validateSupport(story,docs,{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1900.'}]}),true);for(const review of [{supported:true,items:[]},{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1800.'}]},{supported:false,items:[]}])assert.equal(facts.validateSupport(story,docs,review),false)});

test('support diagnostics distinguish model rejection from missing exact evidence',()=>{
 const story={blocks:[{text:'Built in 1900.',sourceIds:['a']}]},docs=[{id:'a',text:'Built in 1900.'}];
 assert.equal(facts.supportDetails(story,docs,{supported:false,items:[],issues:[{index:0,reason:'contradiction'}]}).reason,'model_rejected');
 const missing=facts.supportDetails(story,docs,{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1800.'}]});assert.equal(missing.reason,'missing_evidence');assert.deepEqual(missing.blockIndexes,[0]);
 assert.equal(facts.supportDetails(story,docs,{supported:true,items:[{index:0,sourceId:'a',quote:'Built in 1900.'}]}).reason,'supported');
});
test('missing evidence exposes only diagnostic categories',()=>{
 const story={blocks:[{text:'Built in 1900.',sourceIds:['a']}]},docs=[{id:'a',text:'Built in 1900.'}];
 for(const [item,reason] of [[null,'missing_item'],[{index:0,sourceId:'other',quote:'secret quotation'},'unknown_source'],[{index:0,sourceId:'b',quote:'secret quotation'},'uncited_source'],[{index:0,sourceId:'a',quote:'tiny'},'short_quote'],[{index:0,sourceId:'a',quote:'secret quotation'},'quote_not_found']]){
  const result=facts.supportDetails(story,[...docs,{id:'b',text:'Other text'}],{supported:true,items:item?[item]:[]});assert.deepEqual(result.evidenceFailures,[{index:0,reason}]);assert.ok(!JSON.stringify(result).includes('secret'));
 }
});
test('incomplete reviews report safe finish reason and token counts',async()=>{
 let detail;await facts.reviewGroundingOutcome({text:'test',sourceIds:['a']},[],{fetchFn:async()=>Response.json({choices:[{finish_reason:'length'}],usage:{prompt_tokens:10,completion_tokens:1800,total_tokens:1810,secret:'private'}}),headers:{},model:'test',onDetails:x=>detail=x});assert.equal(detail.finishReason,'length');assert.deepEqual(detail.tokenCounts,{prompt:10,completion:1800,total:1810});assert.ok(!JSON.stringify(detail).includes('private'));
});
