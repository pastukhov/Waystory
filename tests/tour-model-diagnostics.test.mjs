import test from 'node:test';
import assert from 'node:assert/strict';
import {createTourModel} from '../server/tours/service.mjs';
import {createObservability,safeTelemetryEntry} from '../server/observability.mjs';
const request={schema:{name:'tour_chapter',schema:{type:'object'}},maxTokens:4500,messages:[{role:'user',content:'PRIVATE_PROMPT'}]};
async function run(result){const logs=[];let calls=0;const observer=createObservability({env:{},write:line=>logs.push(JSON.parse(line))}),model=createTourModel({env:{ROUTERAI_API_KEY:'PRIVATE_KEY'},fetchFn:async()=>{calls++;return Response.json(result)}});await assert.rejects(observer.run(()=>model.complete(request)),{code:'provider_error'});assert.equal(calls,1);return logs.find(e=>e.event==='waystory_tour_model_detail')}
test('truncated generation logs safe finish and per-call tokens before rejecting without retry',async()=>{
 const event=await run({usage:{prompt_tokens:15000,completion_tokens:4500,total_tokens:19500},choices:[{finish_reason:'length',message:{content:'PRIVATE_RESPONSE'}}]});assert.ok(event);assert.equal(event.schema,'tour_chapter');assert.equal(event.reason,'incomplete_response');assert.equal(event.finishReason,'length');assert.deepEqual(event.tokenCounts,{prompt:15000,completion:4500,total:19500});assert.doesNotMatch(JSON.stringify(event),/PRIVATE/);
});
test('invalid JSON content is diagnosed separately from incomplete output without prose',async()=>{
 const event=await run({usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30},choices:[{finish_reason:'stop',message:{content:'PRIVATE_BAD_JSON'}}]});assert.ok(event);assert.equal(event.reason,'invalid_json');assert.equal(event.finishReason,'stop');assert.doesNotMatch(JSON.stringify(event),/PRIVATE/);
});
test('model diagnostic export rejects arbitrary values and unknown properties',()=>{
 const entry=safeTelemetryEntry({event:'waystory_tour_model_detail',requestId:'459fdcd9-e879-4ea2-9a17-65116befea37',schema:'PRIVATE_SCHEMA',reason:'incomplete_response',finishReason:'PRIVATE_FINISH',tokenCounts:{prompt:1,completion:-1,total:'PRIVATE',secret:'PRIVATE'},content:'PRIVATE_CONTENT'});assert.ok(entry);assert.equal(entry.schema,'unknown');assert.equal(entry.finishReason,'unknown');assert.deepEqual(entry.tokenCounts,{prompt:1});assert.doesNotMatch(JSON.stringify(entry),/PRIVATE/);
});
