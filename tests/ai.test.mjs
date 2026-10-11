import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApp as createProtectedApp} from '../server/index.mjs';
const createApp=options=>createProtectedApp({...options,auth:{enabled:true,session:()=>({id:'test'}),consume(){}}});

const env={YANDEX_API_KEY:'test-key-never-expose',YANDEX_FOLDER_ID:'test-folder'};
const place={title:'Казанский собор',source:'https://ru.wikipedia.org/wiki/Казанский_собор',text:'Казанский собор построен в 1801–1811 годах. Архитектор — Андрей Воронихин.'};
const story={title:'Казанский собор',blocks:[{title:'Главное',depth:0,text:'Перед вами Казанский собор.'},{title:'История',depth:1,text:'Его построили в 1801–1811 годах.'},{title:'Архитектор',depth:2,text:'Проект собора создал русский архитектор Андрей Воронихин.'}]};
function provider(value=story){return async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}),{status:200})}
function request(app,url,body,headers={},method=body===undefined?'GET':'POST'){
 return new Promise((resolve,reject)=>{
  const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);
  Object.assign(req,{url,method,headers:{host:'localhost','content-type':'application/json',...headers}});
  const outgoing=new Map();let status=200;
  const res={setHeader:(k,v)=>outgoing.set(k.toLowerCase(),v),writeHead:(s,h)=>{status=s;Object.entries(h).forEach(([k,v])=>outgoing.set(k.toLowerCase(),v))},end:body=>resolve({status,headers:outgoing,text:String(body||''),json:()=>JSON.parse(body)})};
  Promise.resolve(app.listeners('request')[0](req,res)).catch(reject);
 });
}
test('configured API reports AI and photo capabilities without exposing settings',async()=>{
 const app=createApp({env,fetchFn:provider()});const r=await request(app,'/api/config');
 assert.equal(r.json().ai,true);assert.equal(r.json().vision,true);assert.equal(r.text.includes(env.YANDEX_API_KEY),false);
});
test('story calls Yandex with selected model, validates blocks and reuses cache',async()=>{
 let calls=0;const app=createApp({env,fetchFn:async(url,options)=>{
  calls++;assert.equal(url,'https://ai.api.cloud.yandex.net/v1/chat/completions');
  assert.equal(options.headers.Authorization,'Api-Key '+env.YANDEX_API_KEY);
  assert.equal(options.headers['OpenAI-Project'],env.YANDEX_FOLDER_ID);
  const body=JSON.parse(options.body);assert.equal(body.model,'gpt://test-folder/aliceai-llm');
  assert.equal(body.response_format.type,'json_schema');assert.match(JSON.stringify(body.messages),/1801/);
  return provider()(url,options);
 }});
 const payload={action:'story',place};const first=await request(app,'/api/guide',payload);
 assert.equal(first.status,200);assert.deepEqual(first.json().blocks.map(b=>b.depth),[0,1,2]);
 assert.equal(new Set(first.json().blocks.map(b=>b.id)).size,3);
 assert.deepEqual((await request(app,'/api/guide',payload)).json(),first.json());assert.equal(calls,1);
});
test('questions use independent model and include heard context',async()=>{
 const app=createApp({env:{...env,YANDEX_QUESTION_MODEL:'yandexgpt-5.1'},fetchFn:async(url,o)=>{
  const b=JSON.parse(o.body);assert.equal(b.model,'gpt://test-folder/yandexgpt-5.1');
  assert.match(JSON.stringify(b.messages),/уже услышал/);return provider({text:'Архитектор — Андрей Воронихин.'})()
 }});
 const r=await request(app,'/api/guide',{action:'question',place,question:'Кто архитектор?',heard:['Я уже услышал о датах строительства.']});
 assert.equal(r.status,200);assert.match(r.json().text,/Воронихин/);
});
test('unknown actions, invalid JSON and untrusted remote image URLs are rejected before billing',async()=>{
 let calls=0;const app=createApp({env,fetchFn:async()=>{calls++;return provider()()}});
 for(const body of ['{',{action:'unknown'},{action:'identify',image:'https://example.test/a.jpg'},{action:'question',place,question:''}])assert.equal((await request(app,'/api/guide',body)).status,400);
 assert.equal(calls,0);
});
test('upstream errors and malformed output never reveal provider responses or API key',async()=>{
 for(const fetchFn of [async()=>new Response(env.YANDEX_API_KEY,{status:401}),provider({blocks:[{title:'bad',depth:9,text:'bad'}]}),async()=>{throw new Error(env.YANDEX_API_KEY)}]){
  const r=await request(createApp({env,fetchFn}),'/api/guide',{action:'story',place});assert.equal(r.status,502);assert.equal(r.text.includes(env.YANDEX_API_KEY),false);
 }
});
test('global call budget stops fresh paid requests but cached stories remain usable',async()=>{
 const app=createApp({env:{...env,AI_REQUESTS_PER_HOUR:'1'},fetchFn:provider()});
 assert.equal((await request(app,'/api/guide',{action:'story',place})).status,200);
 assert.equal((await request(app,'/api/guide',{action:'question',place,question:'Кто архитектор?'})).status,429);
 assert.equal((await request(app,'/api/guide',{action:'story',place})).status,200);
});
test('guide methods, cross-origin requests and declared oversized bodies are rejected',async()=>{
 const app=createApp({env,fetchFn:provider()});
 assert.equal((await request(app,'/api/guide',undefined)).status,405);
 assert.equal((await request(app,'/api/guide',{action:'story',place},{origin:'https://evil.test'})).status,403);
 assert.equal((await request(app,'/api/guide',{action:'story',place},{'content-length':'99999999'})).status,413);
});
test('photo recognition uses image model and preserves an uncertain identification',async()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAA+klEQVR4nO3RQQ0AIAzAwMlBCUrwrwEZe/SSCmhyc+7TYrN+EA8AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2n3l14MNZgWhqwAAAABJRU5ErkJggg==';
 const app=createApp({env,fetchFn:async(url,o)=>{
  const body=JSON.parse(o.body);assert.equal(body.model,'gpt://test-folder/qwen3.6-35b-a3b');assert.ok(body.messages[1].content.some(c=>c.image_url?.url===image));
  return provider({text:'Недостаточно деталей. Покажите фасад целиком.',query:''})();
 }});
 const r=await request(app,'/api/guide',{action:'identify',image,context:'Петербург'});assert.equal(r.status,200);assert.equal(r.json().query,'');
});
test('streamed oversized JSON is rejected without calling provider',async()=>{
 let called=false;const app=createApp({env,fetchFn:async()=>{called=true;return provider()()}});
 assert.equal((await request(app,'/api/guide','x'.repeat(7*1024*1024+1))).status,413);assert.equal(called,false);
});
test('truncated generation is rejected instead of caching a partial story',async()=>{
 const app=createApp({env,fetchFn:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:JSON.stringify(story)}}]}))});
 assert.equal((await request(app,'/api/guide',{action:'story',place})).status,502);
});
test('client cancellation is passed to Yandex without leaking internal errors',async()=>{
 const {createGuide}=await import('../server/guide.mjs');const controller=new AbortController();
 const guide=createGuide({env,fetchFn:async(url,{signal})=>new Promise((resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});controller.abort();
 })});
 await assert.rejects(guide.run({action:'story',place},controller.signal),{status:499});
});
test('story language is explicit, localized title returned and cache separates languages',async()=>{
 let calls=0;const app=createApp({env,fetchFn:async(url,o)=>{calls++;const b=JSON.parse(o.body);assert.match(b.messages[0].content,/English|русск/);return provider({...story,title:calls===1?'Казанский собор':'Kazan Cathedral'})()}});
 const ru=await request(app,'/api/guide',{action:'story',place,language:'ru'});const en=await request(app,'/api/guide',{action:'story',place,language:'en'});
 assert.equal(calls,2);assert.equal(ru.json().title,'Казанский собор');assert.equal(en.json().language,'en');assert.equal(en.json().storyVersion,2);
});
test('short sources can return only the essential story instead of inventing detail',async()=>{
 const app=createApp({env,fetchFn:provider({title:'Казанский собор',blocks:[story.blocks[0]]})});const r=await request(app,'/api/guide',{action:'story',place});assert.equal(r.status,200);assert.equal(r.json().blocks.length,1);assert.equal(r.json().detailLimited,true);
});
test('near-identical length tiers and out-of-order story sections are rejected',async()=>{
 for(const blocks of [[{title:'A',depth:0,text:'First '.repeat(50)},{title:'B',depth:1,text:'Extra word.'},{title:'C',depth:2,text:'Another word.'}],[story.blocks[1],story.blocks[0],story.blocks[2]]]){
 const app=createApp({env,fetchFn:provider({title:'Test',blocks})});assert.equal((await request(app,'/api/guide',{action:'story',place})).status,502)}
});
test('batch translation returns only requested IDs and localized text',async()=>{const app=createApp({env,fetchFn:provider({places:[{id:'wiki-en-1',title:'Красная башня',subtitle:'Башня в Аланье'}]})});const r=await request(app,'/api/guide',{action:'translatePlaces',language:'ru',places:[{id:'wiki-en-1',title:'Red Tower',subtitle:'Tower in Alanya'}]});assert.equal(r.status,200);assert.equal(r.json().places[0].title,'Красная башня')});
test('unsupported language cannot silently generate or bill in another language',async()=>{let calls=0;const app=createApp({env,fetchFn:async()=>{calls++;return provider()()}});assert.equal((await request(app,'/api/guide',{action:'story',place,language:'tr'})).status,400);assert.equal(calls,0)});
