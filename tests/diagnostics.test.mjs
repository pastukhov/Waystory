import test from 'node:test';
import assert from 'node:assert/strict';
import {providerFailure,safeLogLine} from '../server/diagnostics.mjs';
test('provider errors expose only allowlisted metadata',()=>{let line;const id=providerFailure('speech',429,12.8,s=>line=s);assert.equal(JSON.parse(line).status,429);assert.equal(JSON.parse(line).durationMs,13);assert.equal(JSON.parse(line).requestId,id);const extra=JSON.stringify({...JSON.parse(line),token:'secret',text:'private story'});assert.equal(JSON.stringify(safeLogLine(extra)).includes('secret'),false);assert.equal(JSON.stringify(safeLogLine(extra)).includes('private'),false);assert.equal(safeLogLine('Authorization: Api-Key secret'),null);assert.equal(safeLogLine(JSON.stringify({...JSON.parse(line),requestId:'secret'})),null)});

test('source diagnostics retain reasons but omit unknown fields',()=>{const line=JSON.stringify({event:'waystory_sources',requestId:'11111111-1111-1111-1111-111111111111',placeId:'osm:node:1',outcome:'no_material',durationMs:10,statuses:[{provider:'osm',status:'unavailable',reason:'timeout',token:'secret'}],coordinates:'private'});const result=safeLogLine(line);assert.equal(result.outcome,'no_material');assert.equal(result.statuses[0].reason,'timeout');assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('private'))});
test('review export retains allowlisted failure details and excludes secrets',()=>{
 const result=safeLogLine(JSON.stringify({event:'waystory_review_detail',requestId:'11111111-1111-1111-1111-111111111111',reason:'incomplete_response',finishReason:'length',evidenceFailures:[{index:0,reason:'quote_not_found',quote:'private'},{index:1,reason:'secret'}],tokenCounts:{prompt:10,completion:1800,total:1810,secret:'private'},raw:'private'}));
 assert.equal(result.finishReason,'length');assert.deepEqual(result.evidenceFailures,[{index:0,reason:'quote_not_found'}]);assert.deepEqual(result.tokenCounts,{prompt:10,completion:1800,total:1810});assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('secret'));
});

test('tour correlation export reconstructs identifiers and enum reasons without source content',()=>{
 const input={event:'waystory_tour_job',requestId:'459fdcd9-e879-4ea2-9a17-65116befea37',tourId:'459fdcd9-e879-4ea2-9a17-65116befea38',chapterId:'overview',stage:'review',outcome:'rejected',reason:'wrong_object',durationMs:12,text:'PRIVATE_SOURCE',claims:['PRIVATE_CLAIM'],email:'owner@example.com',token:'PRIVATE_TOKEN'};
 const result=safeLogLine(JSON.stringify(input));assert.equal(result.reason,'wrong_object');assert.equal(result.tourId,input.tourId);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|owner@example/);
});
