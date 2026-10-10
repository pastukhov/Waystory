import test from 'node:test';
import assert from 'node:assert/strict';
import {requestGuide} from '../dist/ai-client.mjs';

test('cancellation while reading a response remains AbortError',async()=>{
 const aborted=new DOMException('Aborted','AbortError');
 await assert.rejects(requestGuide({action:'story'},{fetchFn:async()=>({json:async()=>{throw aborted}})}),error=>error===aborted);
});
test('non-JSON proxy upload errors explain the image size limit',async()=>{
 await assert.rejects(requestGuide({action:'identify'},{fetchFn:async()=>new Response('nginx: body too large',{status:413})}),/Фото слишком большое/);
});
test('provider failure messages and successful data reach the caller',async()=>{
 await assert.rejects(requestGuide({action:'question'},{fetchFn:async()=>Response.json({error:'Лимит исчерпан'},{status:429})}),/Лимит исчерпан/);
 assert.deepEqual(await requestGuide({action:'question'},{fetchFn:async()=>Response.json({text:'Ответ'})}),{text:'Ответ'});
});
