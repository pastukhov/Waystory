import test from 'node:test';
import assert from 'node:assert/strict';
import {createObservability,safeTelemetryEntry} from '../server/observability.mjs';
import {runTourProbe} from '../server/tours/probe.mjs';
test('planner admission diagnostics retain bounded enum counts and discard all prose',()=>{
 const logs=[],observer=createObservability({env:{},write:line=>logs.push(JSON.parse(line))});
 observer.record('tour_plan_detail',{tourId:'459fdcd9-e879-4ea2-9a17-65116befea37',candidates:4,admitted:2,available:1,limited:1,rejected:2,rejections:{unknown_reference:1,invalid_summary:1,PRIVATE_REASON:100},text:'PRIVATE_MODEL_OUTPUT',topics:['PRIVATE_TITLE']});
 assert.equal(logs.length,1);assert.equal(logs[0].event,'waystory_tour_plan_detail');assert.equal(logs[0].available,1);assert.equal(logs[0].limited,1);
 assert.deepEqual(logs[0].rejections,{invalid_summary:1,unknown_reference:1});assert.doesNotMatch(JSON.stringify(logs),/PRIVATE/);assert.deepEqual(safeTelemetryEntry({...logs[0],sourceText:'PRIVATE'}),logs[0]);
});
test('probe explains insufficient topics with admitted availability counts without printing topics',async()=>{
 const reports=[],topics=[{status:'available',title:'PRIVATE'},{status:'available'},{status:'limited'},{status:'limited'}];
 const passed=await runTourProbe({service:{start:async()=>({tourId:'t'}),get:()=>({status:'ready',topics})},jobs:{drain:async()=>{}},report:r=>reports.push(r)});
 assert.equal(passed,false);assert.deepEqual(Object.fromEntries(['topics','available','limited'].map(k=>[k,reports.at(-1)[k]])),{topics:4,available:2,limited:2});assert.doesNotMatch(JSON.stringify(reports),/PRIVATE/);
});
