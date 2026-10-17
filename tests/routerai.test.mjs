import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuide} from '../server/guide.mjs';
import {createSpeech} from '../server/tts.mjs';
import {createObservability} from '../server/observability.mjs';
import {guideFixture} from './fixtures/guide.mjs';
const env={ROUTERAI_API_KEY:'router-test-secret',YANDEX_API_KEY:'legacy-secret',YANDEX_FOLDER_ID:'legacy-folder'};
const answer=data=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]});
test('RouterAI handles story and grounding through the same authenticated provider',async()=>{
 const requests=[];
 const guide=createGuide({env,collectSources:async()=>{const b=await guideFixture.collectSources();b.documents.push({...b.documents[0],id:'second'});return b},fetchFn:async(url,o)=>{requests.push({url,...o,body:JSON.parse(o.body)});return requests.length===1?answer({title:'Собор',blocks:[{title:'История',depth:0,text:'Казанский собор построен в 1801–1811 годах.',sourceIds:['fixture']}]}):answer({supported:true,items:[{index:0,sourceId:'fixture',quote:'Казанский собор построен в 1801–1811 годах.'}]})}});
 const result=await guide.run({action:'story',placeId:'wiki:ru:1'});assert.equal(result.blocks.length,1);assert.equal(requests.length,2);
 for(const r of requests){assert.equal(r.url,'https://routerai.ru/api/v1/chat/completions');assert.equal(r.headers.Authorization,'Bearer router-test-secret');assert.equal(r.headers['OpenAI-Project'],undefined);assert.equal(r.body.model,'openai/gpt-4.1-mini');assert.equal(r.body.response_format.type,'json_schema')}
});
test('RouterAI photo recognition preserves image input and configurable model',async()=>{
 let request;const guide=createGuide({env:{...env,ROUTERAI_VISION_MODEL:'openai/gpt-4.1-mini'},fetchFn:async(url,o)=>{request={url,body:JSON.parse(o.body)};return answer({text:'Нет достопримечательности',query:''})}});
 await guide.run({action:'identify',image:'data:image/png;base64,iVBORw0KGgo=',context:''});assert.equal(request.url,'https://routerai.ru/api/v1/chat/completions');assert.ok(JSON.stringify(request.body.messages).includes('data:image/png;base64,iVBORw0KGgo='));
});
test('RouterAI speech sends normalized text and caches valid MP3',async()=>{
 let calls=0;const speech=createSpeech({env,fetchFn:async(url,o)=>{calls++;assert.equal(url,'https://routerai.ru/api/v1/audio/speech');assert.equal(o.redirect,'error');assert.equal(o.headers.Authorization,'Bearer router-test-secret');const b=JSON.parse(o.body);assert.equal(b.model,'x-ai/grok-voice-tts-1.0');assert.equal(b.voice,'eve');assert.equal(b.response_format,'mp3');assert.ok(!b.input.includes('wikipedia:'));return new Response('ID3audio')}});
 for(let i=0;i<2;i++)assert.equal((await speech.run({text:'История храма. Источник: wikipedia:ru:123.',language:'ru'})).toString(),'ID3audio');assert.equal(calls,1);
});
test('RouterAI errors never fall back to Yandex or cache invalid audio',async()=>{
 for(const status of [401,402,429,503]){let calls=0;const speech=createSpeech({env,fetchFn:async()=>{calls++;return new Response('private',{status})}});await assert.rejects(speech.run({text:'Привет'}),e=>!e.message.includes('private')&&!e.message.includes('Yandex')&&!e.message.includes('SpeechKit'));assert.equal(calls,1)}
 let calls=0;const speech=createSpeech({env,fetchFn:async()=>{calls++;return new Response('not audio')}});for(let i=0;i<2;i++)await assert.rejects(speech.run({text:'Привет'}));assert.equal(calls,2);
});
test('RouterAI chat and speech have distinct bounded provider metrics',async()=>{
 const obs=createObservability({env:{},write:()=>{}});for(const path of ['chat/completions','audio/speech'])await obs.wrapFetch(async()=>new Response('',{status:403}))('https://routerai.ru/api/v1/'+path,{body:JSON.stringify({response_format:{json_schema:{name:'waystory_story'}}})});
 assert.match(obs.render(),/provider="routerai_ai"/);assert.match(obs.render(),/provider="routerai_tts"/);
});
test('explicit RouterAI configuration without key disables both services',()=>{
 assert.equal(createGuide({env:{AI_PROVIDER:'routerai',YANDEX_API_KEY:'legacy',YANDEX_FOLDER_ID:'folder'}}).enabled,false);
 assert.equal(createSpeech({env:{TTS_PROVIDER:'routerai',YANDEX_API_KEY:'legacy'}}).enabled,false);
});
