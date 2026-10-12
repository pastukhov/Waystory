import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/index.mjs';
import {createObservability} from '../server/observability.mjs';
import {observe} from '../server/request-context.mjs';
const token='test-metrics-token-0123456789abcdef';
async function app(t,env={}){
 const logs=[];const server=createApp({env:{MULTISOURCE_ENABLED:'false',...env},logWriter:line=>logs.push(line),auth:{enabled:false,session:()=>null}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));return {base:`http://127.0.0.1:${server.address().port}`,logs};
}
test('metrics require a dedicated token, not cookies or query credentials',async t=>{
 const disabled=await app(t);assert.equal((await fetch(disabled.base+'/metrics')).status,404);
 const {base}=await app(t,{METRICS_TOKEN:token});
 for(const [path,headers] of [['/metrics',{}],['/metrics?token='+token,{}],['/metrics',{Cookie:'token='+token}],['/metrics',{Authorization:'Bearer wrong'}]])assert.equal((await fetch(base+path,{headers})).status,401);
 const response=await fetch(base+'/metrics',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/plain/);assert.match(await response.text(),/waystory_process_resident_memory_bytes/);
});
test('concurrent requests receive independent server-owned IDs and bounded HTTP labels',async t=>{
 const {base,logs}=await app(t,{METRICS_TOKEN:token});const responses=await Promise.all(['/api/config','/private-email@example.com?secret=hidden'].map(path=>fetch(base+path,{headers:{'X-Request-ID':'client-secret',Authorization:'secret'}})));
 const ids=responses.map(r=>r.headers.get('x-request-id'));assert.notEqual(ids[0],ids[1]);assert.ok(ids.every(id=>/^[a-f0-9-]{36}$/.test(id)));
 const response=await fetch(base+'/metrics',{headers:{Authorization:'Bearer '+token}});const metrics=await response.text();assert.match(metrics,/waystory_http_requests_total\{route="\/api\/config",method="GET",status="200"\} 1/);assert.match(metrics,/waystory_http_request_duration_seconds_bucket/);
 assert.ok(!metrics.includes('email'));assert.ok(!JSON.stringify(logs).includes('secret'));assert.ok(ids.every(id=>logs.some(line=>JSON.parse(line).requestId===id)));
});
test('provider rejection retains 403 without body or key, and no success is invented',async()=>{
 const lines=[];const obs=createObservability({env:{},write:line=>lines.push(line)});
 await obs.run(async()=>{const response=await obs.wrapFetch(async()=>new Response('private provider text',{status:403}))('https://api.tavily.com/search',{headers:{Authorization:'Bearer secret'}});assert.equal(response.status,403);observe('cache',{cache:'generation',result:'hit'});});
 const text=obs.render();assert.match(text,/waystory_provider_requests_total\{provider="tavily",operation="search",status="403",outcome="error"\} 1/);assert.match(text,/waystory_provider_last_success_timestamp_seconds\{provider="tavily"\} 0/);assert.match(text,/waystory_provider_last_status_code\{provider="tavily"\} 403/);assert.ok(!JSON.stringify(lines).includes('secret'));assert.ok(!text.includes('private'));
});
test('budget is sampled from persisted UTC state on every scrape, not incremented in memory',()=>{
 let remaining=10;const obs=createObservability({env:{},budgetSnapshot:()=>({limit:10,remaining})});assert.match(obs.render(),/waystory_tavily_daily_calls_remaining 10/);remaining=3;assert.match(obs.render(),/waystory_tavily_daily_calls_remaining 3/);remaining=10;assert.match(obs.render(),/waystory_tavily_daily_calls_remaining 10/);
});
import {createGuide} from '../server/guide.mjs';
import {guideFixture} from './fixtures/guide.mjs';
import {reviewGrounding} from '../server/sources/facts.mjs';
import {providerFailure,safeLogLine} from '../server/diagnostics.mjs';
test('generation cache avoids provider calls, tracks usage and stage completion',async()=>{
 const logs=[],obs=createObservability({env:{},write:line=>logs.push(line)});let calls=0;
 const guide=createGuide({env:{YANDEX_API_KEY:'secret',YANDEX_FOLDER_ID:'folder'},...guideFixture,fetchFn:obs.wrapFetch(async()=>{calls++;return Response.json({usage:{prompt_tokens:20,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'Собор',blocks:[{title:'История',depth:0,text:'Казанский собор построен в 1801–1811 годах.',sourceIds:['fixture']}]})}}]})})});
 await obs.run(async()=>{await guide.run({action:'story',placeId:'wiki:ru:1'});await guide.run({action:'story',placeId:'wiki:ru:1'})});
 assert.equal(calls,1);const metrics=obs.render();assert.match(metrics,/waystory_cache_requests_total\{cache="generation",result="hit"\} 1/);assert.match(metrics,/waystory_ai_tokens_total\{operation="story",kind="input"\} 20/);assert.match(metrics,/waystory_stage_operations_total\{stage="generation",outcome="success"\} 1/);
 assert.equal(new Set(logs.map(l=>JSON.parse(l).requestId)).size,1);
});
test('grounding rejection and missing usage remain distinct from HTTP success',async()=>{
 const obs=createObservability({env:{},write:()=>{}});
 const result=await obs.run(()=>reviewGrounding({blocks:[]},[],{headers:{},model:'test',fetchFn:obs.wrapFetch(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"supported":false,"items":[]}'}}]}))}));
 assert.equal(result,false);assert.match(obs.render(),/waystory_stage_operations_total\{stage="review",outcome="rejected"\} 1/);assert.match(obs.render(),/waystory_ai_usage_missing_total\{operation="review"\} 1/);
});
test('safe log filtering preserves provider HTTP status and correlates legacy errors',async()=>{
 const logs=[],obs=createObservability({env:{},write:line=>logs.push(line)});let legacy;
 await obs.run(async()=>{await obs.wrapFetch(async()=>new Response('',{status:403}))('https://api.tavily.com/search');providerFailure('ai',403,1,line=>legacy=line)});
 const provider=JSON.parse(logs[0]);assert.equal(JSON.parse(legacy).requestId,provider.requestId);const safe=safeLogLine(JSON.stringify({...provider,body:'private',token:'secret'}));assert.equal(safe.status,403);assert.ok(!JSON.stringify(safe).includes('private'));
});
test('review transport failure is technical error, not a factual rejection',async()=>{
 const obs=createObservability({env:{},write:()=>{}});await obs.run(()=>reviewGrounding({blocks:[]},[],{headers:{},model:'test',fetchFn:obs.wrapFetch(async()=>new Response('',{status:503}))}));assert.match(obs.render(),/waystory_stage_operations_total\{stage="review",outcome="error"\} 1/);
});
test('abort classification and arbitrary labels do not invent successful calls',async()=>{
 const obs=createObservability({env:{},write:()=>{}}),controller=new AbortController();controller.abort(new DOMException('private text','AbortError'));
 await assert.rejects(obs.run(()=>obs.wrapFetch(async()=>{throw controller.signal.reason})('https://api.tavily.com/search',{signal:controller.signal})));
 obs.record('cache',{cache:'email@example.com',result:'private'});obs.record('stage',{stage:'private',outcome:'secret'});
 assert.match(obs.render(),/provider="tavily",operation="search",status="none",outcome="cancelled"/);assert.ok(!obs.render().includes('private'));assert.ok(!obs.render().includes('email@'));
});
