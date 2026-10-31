import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {tourError} from '../server/tours/store.mjs';
import {createPlaceStore} from '../server/places/store.mjs';
import {licenseFor} from '../server/sources/policies.mjs';
import {createAuth} from '../server/auth.mjs';
import {request as httpRequest} from 'node:http';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import * as serverModule from '../server/index.mjs';

const origin='https://ws.test',id='459fdcd9-e879-4ea2-9a17-65116befea37',topic='a'.repeat(64);
const headers={cookie:'owner',origin,'content-type':'application/json'};
async function fixture(t,{tours,auth,env={}}={}){
 const calls=[];
 const tour={id,status:'ready',topics:[],chapters:[{id:'overview',topicId:'overview',status:'ready',text:'Museum.'}]};
 const service=tours||{start:async(owner,body)=>{calls.push(['start',owner,body]);return {status:202,tourId:id,tour:{...tour,status:'planning'}}},get:(owner,asked)=>{calls.push(['get',owner,asked]);return owner==='owner'&&asked===id?tour:null},chapter:async(...args)=>{calls.push(['chapter',...args]);return {status:202,chapter:{...tour.chapters[0],status:'generating'}}},progress:(...args)=>{calls.push(['progress',...args]);return args[2]}};
 const app=createApp({env:{ROUTERAI_API_KEY:'fixture',...env},sourceDbPath:':memory:',auth:auth||{enabled:true,origin,session:c=>c?{id:c}:null,consume:()=>assert.fail('routes/poll must not consume quota')},tours:service,logWriter:()=>{}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve())));
 const request=async(path,method='GET',body,extra={})=>{
  const response=await fetch('http://127.0.0.1:'+app.address().port+path,{method,headers:{...headers,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  return {status:response.status,headers:response.headers,body:await response.json()};
 };
 return {app,request,calls,tour};
}
test('tour auth and Origin checks precede service access; config availability follows session',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/api/config','GET',undefined,{cookie:''})).body.tours,false);
 assert.equal((await f.request('/api/config')).body.tours,true);
 for(const path of ['/api/tours','/api/tours/'+id,'/api/tours/'+id+'/chapters/overview','/api/tours/'+id+'/progress']){
  const result=await f.request(path,'GET',undefined,{cookie:''});assert.equal(result.status,401);assert.equal(result.body.error.code,'auth_required');
 }
 for(const [path,method] of [['/api/tours','POST'],['/api/tours/'+id+'/chapters/overview','POST'],['/api/tours/'+id+'/progress','PUT']])assert.equal((await f.request(path,method,{}, {origin:'https://evil.test'})).status,403);
 assert.equal(f.calls.length,0);
});
test('malformed routes and JSON fail before work reservation; unsupported methods return 405',async t=>{
 const f=await fixture(t);
 for(const body of [null,[],{}, {placeId:'https://evil.test',language:'ru'},{placeId:'wiki:ru:1',language:'fr'},{placeId:'wiki:ru:1',language:'ru',url:'https://evil.test'}])assert.equal((await f.request('/api/tours','POST',body)).status,400);
 assert.equal((await f.request('/api/tours','POST','{')).status,400);
 assert.equal((await f.request('/api/tours/not-an-id')).status,400);
 assert.equal((await f.request('/api/tours/'+id+'/chapters/arbitrary','POST',{})).status,400);
 assert.equal((await f.request('/api/tours/'+id+'/chapters/'+topic,'POST',{text:'injected'})).status,400);
 assert.equal((await f.request('/api/tours/'+id+'/progress','PUT',{chapterId:'overview',chunkIndex:-1,offsetSeconds:0,completedChapterIds:[]})).status,400);
 assert.equal((await f.request('/api/tours/'+id+'/progress','PUT',{chapterId:['overview'],chunkIndex:0,offsetSeconds:0,completedChapterIds:[]})).status,400);
 const large=await new Promise(resolve=>{const req=httpRequest({host:'127.0.0.1',port:f.app.address().port,path:'/api/tours',method:'POST',headers:{...headers,'content-length':8*1024*1024}},res=>{res.resume();resolve(res.statusCode)});req.end('{}')});assert.equal(large,413);
 for(const [path,method] of [['/api/tours','GET'],['/api/tours/'+id,'DELETE'],['/api/tours/'+id+'/chapters/overview','GET'],['/api/tours/'+id+'/progress','POST']])assert.equal((await f.request(path,method,method==='GET'?undefined:{})).status,405);
 assert.equal(f.calls.length,0);
});
test('routes expose accepted, owner-scoped read, chapter, retry, and progress contracts without quota consumption',async t=>{
 const f=await fixture(t);
 assert.deepEqual((await f.request('/api/tours','POST',{placeId:'wiki:ru:173387',language:'ru'})).body,{tourId:id,status:'planning'});
 const get=await f.request('/api/tours/'+id);assert.equal(get.status,200);assert.equal(get.headers.get('cache-control'),'no-store');assert.deepEqual(get.body,f.tour);
 assert.equal((await f.request('/api/tours/'+id,'GET',undefined,{cookie:'other'})).status,404);
 assert.equal((await f.request('/api/tours/'+id+'/chapters/overview','POST',{})).status,202);
 await f.request('/api/tours/'+id+'/chapters/'+topic+'/retry','POST',{});
 assert.deepEqual(f.calls.at(-1),['chapter','owner',id,topic,{retry:true}]);
 const progress={chapterId:'overview',chunkIndex:2,offsetSeconds:1.5,completedChapterIds:[]};
 assert.deepEqual((await f.request('/api/tours/'+id+'/progress','PUT',progress)).body,progress);
});
test('cached plan/chapter return 200; terminal retry, busy and unavailable have safe PublicErrors',async t=>{
 const f=await fixture(t,{tours:{start:async()=>({status:200,tourId:id,tour:{id,status:'ready'}}),get:()=>null,chapter:async(owner,id,topic,{retry})=>{if(retry)throw tourError('invalid_request',409);if(topic==='overview')return {status:200,chapter:{id:'overview',status:'ready'}};throw tourError('busy',429)}}});
 const cached=await f.request('/api/tours','POST',{placeId:'wd:Q1',language:'en'});assert.equal(cached.status,200);assert.equal(cached.body.tourId,id);
 assert.equal((await f.request('/api/tours/'+id+'/chapters/overview','POST',{})).status,200);
 assert.equal((await f.request('/api/tours/'+id+'/chapters/overview/retry','POST',{})).status,409);
 const busy=await f.request('/api/tours/'+id+'/chapters/'+topic,'POST',{});assert.equal(busy.status,429);assert.equal(busy.body.error.code,'busy');assert.equal(busy.headers.get('retry-after'),'60');
 const unavailable=await fixture(t,{env:{ROUTERAI_API_KEY:''},tours:null});assert.equal((await unavailable.request('/api/config')).body.tours,false);assert.equal((await unavailable.request('/api/tours','POST',{placeId:'wd:Q1',language:'ru'})).status,503);
});

async function liveFixture(t,{holdPlan=false,limit=30,repair=false,policy='wikimedia-cc-by-sa'}={}){
 const placeStore=createPlaceStore({dbPath:':memory:'});
 const place=placeStore.upsert({id:'wiki:ru:173387',refs:[{provider:'wikipedia',language:'ru',pageId:173387}],names:{original:'Кусково'},sourceIds:['wikipedia:ru:173387']});
 const text='Дворец построен в XVIII веке. PRIVATE_SOURCE_ONLY '+('Парк находится рядом с дворцом. '.repeat(300));
 const doc={id:'wikipedia:ru:173387',provider:'wikipedia',title:'Кусково',url:'https://ru.wikipedia.org/?curid=173387',scope:'place',language:'ru',revision:'1',text,license:licenseFor(policy,'Contributors')};
 const env={AUTHENTICATED_REQUESTS_UNLIMITED:'false',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_ALLOWED_EMAILS:'owner@example.com',APP_ORIGIN:origin,ROUTERAI_API_KEY:'fixture',AI_USER_REQUESTS_PER_DAY:String(limit),AI_REQUESTS_PER_DAY:String(limit)};
 const auth=createAuth({env,dbPath:':memory:',fetchFn:async url=>Response.json(url.includes('/token')?{access_token:'fixture'}:{sub:'owner',email:'owner@example.com',email_verified:true})});
 const flow=auth.start(),state=new URL(flow.location).searchParams.get('state');
 const signed=await auth.callback(new URL(origin+'/auth/google/callback?state='+state+'&code=fixture'),flow.cookie.split(';')[0]),cookie=signed.cookie.split(';')[0];
 const calls=[],profiles=[],sourceCalls=[],logs=[];let release;
 const gate=new Promise(resolve=>{release=resolve});let reviewCalls=0;
 const app=createApp({env,placeStore,auth,sourceProviders:[{id:'wikipedia',documents:async(p,o)=>{profiles.push(o.profile);return {status:'ok',documents:[doc]}}}],sourceFetchFn:async url=>{sourceCalls.push(url);return Response.json({parse:{wikitext:{'*':''}}})},fetchFn:async(url,options)=>{
  const body=JSON.parse(options.body),name=body.response_format.json_schema.name,payload=JSON.parse(body.messages[1].content);calls.push({name,body});
  let result,finish='stop';
  if(name==='tour_plan'){
   if(holdPlan)await gate;
   result={topics:[{title:'История',summary:'История дворца.',evidenceIds:[payload.spans[0].id],status:'available',reason:null}]};
  }else if(name==='tour_chapter'){
   const text='Дворец построен в XVIII веке.',ids=[payload.spans[0].id];result={language:'ru',text,evidenceIds:ids,claims:[{text,evidenceIds:ids}]};
  }else{reviewCalls++;result={supported:true,issues:[]};if(repair&&reviewCalls===1)finish='length'}
  return Response.json({choices:[{finish_reason:finish,message:{content:JSON.stringify(result)}}]});
 },logWriter:line=>logs.push(line)});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(()=>{release();if(!app.listening)return;return new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve()))});
 const request=async(path,method='GET',body)=>{const r=await fetch('http://127.0.0.1:'+app.address().port+path,{method,headers:{...headers,cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}};
 const wait=async(id,predicate)=>{for(let i=0;i<200;i++){const r=await request('/api/tours/'+id);if(predicate(r.body))return r.body;await new Promise(resolve=>setTimeout(resolve,2))}assert.fail('tour did not settle')};
 return {app,request,wait,calls,auth,place,profiles,sourceCalls,logs,release,cookie,usage:()=>auth.usage({id:'owner'})};
}
test('real composition reserves duplicate once, researches full corpus with official identity, charges every model call and hides source bodies',async t=>{
 const f=await liveFixture(t,{holdPlan:true,repair:true});
 const start=await f.request('/api/tours','POST',{placeId:f.place.id,language:'ru'});assert.equal(start.status,202);
 await f.wait(start.body.tourId,tour=>tour.status==='planning'&&f.calls.length===1);
 const duplicate=await f.request('/api/tours','POST',{placeId:f.place.id,language:'ru'});assert.deepEqual(duplicate,start);assert.equal(f.calls.length,1);
 f.release();const tour=await f.wait(start.body.tourId,tour=>tour.chapters[0]?.status==='ready');
 assert.deepEqual(f.profiles,['tour']);assert.ok(f.sourceCalls.some(url=>new URL(url).searchParams.get('action')==='parse'));
 assert.ok(JSON.stringify(f.calls[0].body).includes('PRIVATE_SOURCE_ONLY'));assert.ok(JSON.parse(f.calls[0].body.messages[1].content).spans.reduce((n,s)=>n+s.text.length,0)>6000);
 assert.deepEqual(f.calls.map(c=>c.name),['tour_plan','tour_chapter','chapter_grounding','chapter_grounding']);assert.equal(f.usage().ai.used,4);
 await f.request('/api/tours/'+tour.id);await f.request('/api/tours/'+tour.id+'/chapters/overview','POST',{});await f.request('/api/tours','POST',{placeId:f.place.id,language:'ru'});assert.equal(f.usage().ai.used,4);
 for(let i=0;i<26;i++)f.auth.consume({id:'other'},'ai');assert.throws(()=>f.auth.consume({id:'other'},'ai'),{status:429},'global quota is shared across users');
 assert.doesNotMatch(JSON.stringify(tour),/PRIVATE_SOURCE_ONLY|ownerId|job_token|lease_until|snapshot|documents/);assert.doesNotMatch(f.logs.join('\n'),/PRIVATE_SOURCE_ONLY|owner@example.com|Bearer fixture/);
 const topic=tour.topics[0].id;assert.equal((await f.request('/api/tours/'+tour.id+'/chapters/overview/retry','POST',{})).status,409);
 const badProgress={chapterId:'overview',chunkIndex:0,offsetSeconds:0,completedChapterIds:[topic,'b'.repeat(64)]};assert.equal((await f.request('/api/tours/'+tour.id+'/progress','PUT',badProgress)).status,400);
});
test('real quota exhaustion persists accepted job failure without paid retries; polling remains readable',async t=>{
 const f=await liveFixture(t,{limit:1});const start=await f.request('/api/tours','POST',{placeId:f.place.id,language:'ru'});
 const tour=await f.wait(start.body.tourId,tour=>tour.chapters[0]?.status==='failed');assert.equal(tour.chapters[0].error.code,'budget_exhausted');assert.equal(f.calls.length,1);assert.equal(f.usage().ai.used,1);
 assert.equal((await f.request('/api/tours/'+tour.id)).status,200);assert.equal((await f.request('/api/tours/'+tour.id+'/chapters/overview/retry','POST',{})).status,409);
});
test('restricted source policy prevents paid model calls in the composed service',async t=>{
 const f=await liveFixture(t,{policy:'unknown'});const start=await f.request('/api/tours','POST',{placeId:f.place.id,language:'ru'});
 const tour=await f.wait(start.body.tourId,tour=>tour.chapters[0]?.status==='insufficient');assert.equal(tour.topics.length,0);assert.equal(f.calls.length,0);assert.equal(f.usage().ai.used,0);
});
test('server close awaits tour shutdown before closing auth and source database',async()=>{
 const order=[];let release;const gate=new Promise(resolve=>{release=resolve});
 const placeStore=createPlaceStore({dbPath:':memory:'}),closeDb=placeStore.close;placeStore.close=()=>{order.push('db');closeDb()};
 const app=createApp({env:{},auth:{session:()=>null,close:()=>order.push('auth')},placeStore,tourJobs:{shutdown:async()=>{order.push('shutdown');await gate;order.push('drained')}},logWriter:()=>{}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const closed=new Promise((resolve,reject)=>app.close(error=>{order.push('callback');error?reject(error):resolve()}));
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(order,['shutdown']);release();await closed;assert.deepEqual(order,['shutdown','drained','auth','db','callback']);
});
test('shutdown signals close once, force lingering HTTP connections, and remove signal listeners',async()=>{
 assert.equal(typeof serverModule.closeOnSignals,'function');
 const processTarget=new EventEmitter(),events=[];let finish;
 serverModule.closeOnSignals({close:callback=>{events.push('close');finish=callback},closeAllConnections:()=>events.push('force')},{processTarget,timeoutMs:5});
 processTarget.emit('SIGTERM');processTarget.emit('SIGINT');assert.deepEqual(events,['close']);
 await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(events,['close','force']);finish();assert.equal(processTarget.listenerCount('SIGTERM'),0);assert.equal(processTarget.listenerCount('SIGINT'),0);
});
test('SIGTERM in a Node process runs job shutdown before normal exit',async()=>{
 assert.equal(typeof serverModule.closeOnSignals,'function');
 const url=new URL('../server/index.mjs',import.meta.url).href;
 const code=`import {createApp,closeOnSignals} from ${JSON.stringify(url)}; const server=createApp({env:{},logWriter:()=>{},tourJobs:{shutdown:async()=>console.log('jobs drained')}}); closeOnSignals(server); server.listen(0,'127.0.0.1',()=>console.log('ready'));`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let output='';
 try{
  const ready=new Promise(resolve=>child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('ready'))resolve()}));
  await ready;const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.kill('SIGTERM');assert.deepEqual(await exit,{code:0,signal:null});assert.match(output,/jobs drained/);
 }finally{child.kill('SIGKILL')}
});
test('shutdown rejects a preexisting partial POST before reservation or paid work',async t=>{
 const f=await liveFixture(t),body=JSON.stringify({placeId:f.place.id,language:'ru'});
 const received=new Promise(resolve=>f.app.once('request',resolve));
 let closed;const response=new Promise((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:f.app.address().port,path:'/api/tours',method:'POST',headers:{...headers,cookie:f.cookie,'content-length':Buffer.byteLength(body)}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode))});
  req.once('error',reject);req.write(body.slice(0,2));received.then(()=>{closed=new Promise(resolve=>f.app.close(resolve));req.end(body.slice(2))});
 });
 assert.equal(await response,503);await closed;assert.equal(f.calls.length,0);
});

test('playback telemetry validates owner, Origin, enums, attempt deduplication and rate without AI quota',async t=>{
 const f=await fixture(t),path='/api/tours/'+id+'/playback-events',body={chapterId:'overview',attemptId:'459fdcd9-e879-4ea2-9a17-65116befea38',type:'first_audio',durationMs:123};
 assert.equal((await f.request(path,'POST',body,{cookie:''})).status,401);
 assert.equal((await f.request(path,'POST',body,{origin:'https://evil.test'})).status,403);
 assert.equal((await f.request(path,'POST',body,{cookie:'other'})).status,404);
 for(const change of [{type:'arbitrary'},{durationMs:-1},{durationMs:120001},{durationMs:'1'},{code:'secret'},{attemptId:'private'},{chapterId:topic},{text:'secret'}])assert.equal((await f.request(path,'POST',{...body,...change})).status,400);
 assert.equal((await f.request(path,'POST',body)).status,200);
 assert.equal((await f.request(path,'POST',body)).body.recorded,false);
 for(let i=0;i<28;i++)assert.equal((await f.request(path,'POST',{...body,type:'playback_error',code:'provider_error'})).status,200);
 assert.equal((await f.request(path,'POST',body)).status,429);
});
