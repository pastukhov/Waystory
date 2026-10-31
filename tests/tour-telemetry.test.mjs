import test from 'node:test';
import assert from 'node:assert/strict';
import {createObservability} from '../server/observability.mjs';
import {tourStage} from '../server/tours/telemetry.mjs';
import {createTourResearch} from '../server/tours/research.mjs';
import {createPlaybackEvents} from '../server/tours/playback.mjs';

test('returned research timeout and partial provider failure cannot be classified as success',async()=>{
 const logs=[],observer=createObservability({env:{},write:line=>logs.push(JSON.parse(line))});
 const research=createTourResearch({collect:async()=>{throw Object.assign(new Error('private'),{name:'TimeoutError'})}});
 await observer.run(()=>tourStage('research',{},()=>research({id:'wiki:ru:1'})));
 assert.equal(logs.at(-1).outcome,'timeout');
 await observer.run(()=>tourStage('research',{},async()=>({documents:[{text:'private'}],statuses:[{status:'partial'}]})));
 assert.equal(logs.at(-1).outcome,'limited');assert.doesNotMatch(JSON.stringify(logs),/private/);
});
test('playback deduplication survives a minute rate reset and expires with the tour',()=>{
 let time=0;const record=createPlaybackEvents({now:()=>time}),tour={id:'tour',expiresAt:120000,chapters:[{id:'overview',status:'ready'}]},body={chapterId:'overview',attemptId:'459fdcd9-e879-4ea2-9a17-65116befea38',type:'first_audio',durationMs:0};
 assert.deepEqual(record('owner',tour,body),{recorded:true});time=61000;assert.deepEqual(record('owner',tour,body),{recorded:false});
});

test('public job error keeps the safe diagnostic ID used by stage logs',async()=>{
 const {tourError,publicJobError}=await import('../server/tours/store.mjs'),error=tourError('provider_timeout');assert.equal(publicJobError(error).diagnosticId,error.diagnosticId);assert.match(publicJobError({code:'provider_error',diagnosticId:'SECRET'}).diagnosticId,/^[a-f0-9-]{36}$/);
});
