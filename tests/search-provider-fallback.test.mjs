import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaceStore} from '../server/places/store.mjs';
import {createSearchProvider} from '../server/sources/search-provider.mjs';
import {createProviderBudget} from '../server/sources/budget.mjs';
import {extractEvidence} from '../server/sources/extract.mjs';
const context={names:['Turtle Tower'],locality:'Hanoi',countryCode:'VN'};
const env={TAVILY_API_KEY:'tavily-private',BRAVE_SEARCH_API_KEY:'brave-private',WEB_SEARCH_MAX_CALLS_PER_DAY:'10'};
const brave=()=>Response.json({web:{results:[{url:'https://example.org/tower',title:'Turtle Tower',description:'Tower in Hanoi'}]}});
for(const status of [401,403,429,500,503])test(`Brave fallback follows Tavily HTTP ${status} and preserves separate policy`,async()=>{
 const store=createPlaceStore({dbPath:':memory:'});const requests=[];
 try{const p=createSearchProvider({db:store.db,env,fetchFn:async(url,options)=>{requests.push({url,options});return url.includes('tavily')?new Response('private response',{status}):brave()}});
 const result=await p.searchCandidates(context);assert.equal(result.calls,2);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].provider,'brave');assert.notEqual(result.candidates[0].usagePolicyId,'web-search-reviewed');assert.equal(extractEvidence(result.candidates[0],{placeId:'test'}),null);assert.equal(result.outcomes[0].httpStatus,status);assert.deepEqual(result.outcomes.map(o=>o.engine),['tavily','brave']);assert.equal(requests[1].options.headers['X-Subscription-Token'],'brave-private');assert.equal(JSON.stringify(result).includes('private'),false);
 }finally{store.close()}
});
test('transport failure switches engines but empty success and HTTP 400 do not',async()=>{
 for(const scenario of ['network','empty','bad-query']){const store=createPlaceStore({dbPath:':memory:'});try{const p=createSearchProvider({db:store.db,env,fetchFn:async url=>{if(!url.includes('tavily'))return brave();if(scenario==='network')throw Error('network private');return scenario==='empty'?Response.json({results:[]}):new Response('',{status:400})}});const r=await p.searchCandidates(context);assert.equal(r.calls,scenario==='network'?2:1);assert.equal(r.candidates.length,scenario==='network'?1:0)}finally{store.close()}}
});
test('missing Brave credential is diagnosed without a fallback request',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});try{const p=createSearchProvider({db:store.db,env:{...env,BRAVE_SEARCH_API_KEY:''},fetchFn:async()=>new Response('',{status:403})});const r=await p.searchCandidates(context);assert.equal(r.calls,1);assert.ok(r.outcomes.some(o=>o.engine==='brave'&&o.reason==='not_configured'));assert.deepEqual(p.configuredEngines,['tavily']);}finally{store.close()}
});
test('Brave can operate alone and explicit order makes it primary',async()=>{
 for(const settings of [{TAVILY_API_KEY:''},{WEB_SEARCH_PROVIDER_ORDER:'brave,tavily'}]){const store=createPlaceStore({dbPath:':memory:'});try{const p=createSearchProvider({db:store.db,env:{...env,...settings},fetchFn:async url=>{assert.ok(url.includes('brave'));return brave()}});assert.equal(p.enabled,true);const r=await p.searchCandidates(context);assert.equal(r.candidates[0].provider,'brave');assert.equal(r.calls,1);}finally{store.close()}}
});
test('denied engine cools down and later recovers without spending repeated calls',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});let time=0,tavilyCalls=0;try{const p=createSearchProvider({db:store.db,env,now:()=>time,fetchFn:async url=>{if(url.includes('tavily')){tavilyCalls++;return new Response('',{status:403})}return brave()}});await p.searchCandidates(context);const second=await p.searchCandidates(context);assert.equal(tavilyCalls,1);assert.equal(second.calls,1);assert.ok(second.outcomes.some(o=>o.engine==='tavily'&&o.cooldown===true));time=16*60*1000;await p.searchCandidates(context);assert.equal(tavilyCalls,2);}finally{store.close()}
});
test('aggregate limit includes prior enrichment calls and cannot be bypassed by fallback',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});try{createProviderBudget({db:store.db,maxCalls:2}).reserveProviderCall({provider:'tavily'});const p=createSearchProvider({db:store.db,env:{...env,WEB_SEARCH_MAX_CALLS_PER_DAY:'2'},fetchFn:async()=>new Response('',{status:403})});const r=await p.searchCandidates(context);assert.equal(r.calls,1);assert.equal(r.candidates.length,0);assert.ok(r.outcomes.some(o=>o.engine==='brave'&&o.reason==='budget_exhausted'));}finally{store.close()}
});
test('per-engine limit allows fallback within aggregate cap',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});try{const p=createSearchProvider({db:store.db,env:{...env,TAVILY_MAX_CALLS_PER_DAY:'0'},fetchFn:async url=>{assert.ok(url.includes('brave'));return brave()}});const r=await p.searchCandidates(context);assert.equal(r.calls,1);assert.equal(r.candidates[0].provider,'brave');}finally{store.close()}
});
test('caller cancellation never starts fallback',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});const controller=new AbortController();let calls=0;try{const p=createSearchProvider({db:store.db,env,fetchFn:async()=>{calls++;controller.abort();throw controller.signal.reason}});await assert.rejects(p.searchCandidates(context,{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);}finally{store.close()}
});
test('provider timeout leaves time for backup and enforces total deadline even for a stalled fetch',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});const hold=setTimeout(()=>{},1000);try{const p=createSearchProvider({db:store.db,env:{...env,WEB_SEARCH_PROVIDER_TIMEOUT_MS:'20',WEB_SEARCH_TIMEOUT_MS:'80'},fetchFn:async url=>url.includes('tavily')?new Promise(()=>{}):brave()});const r=await p.searchCandidates(context);assert.equal(r.calls,2);assert.equal(r.outcomes[0].reason,'timeout');assert.equal(r.candidates[0].provider,'brave');}finally{clearTimeout(hold);store.close()}
});
test('combined deadline aborts the active request and never spends on a later engine',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});const hold=setTimeout(()=>{},1000);let upstreamSignal,calls=0;
 try{const p=createSearchProvider({db:store.db,env:{...env,WEB_SEARCH_PROVIDER_TIMEOUT_MS:'100',WEB_SEARCH_TIMEOUT_MS:'20'},fetchFn:async(_url,options)=>{calls++;upstreamSignal=options.signal;return new Promise(()=>{})}});const result=await p.searchCandidates(context);assert.equal(calls,1);assert.equal(result.calls,1);assert.equal(result.outcomes[0].reason,'timeout');assert.equal(upstreamSignal.aborted,true)}finally{clearTimeout(hold);store.close()}
});
test('both credentials absent disables discovery without spending budget',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});try{const p=createSearchProvider({db:store.db,env:{WEB_SEARCH_MAX_CALLS_PER_DAY:'10'},fetchFn:async()=>{assert.fail('must not call provider')}});assert.equal(p.enabled,false);assert.deepEqual(p.configuredEngines,[]);const result=await p.searchCandidates(context);assert.equal(result.calls,0);assert.equal(result.outcomes[0].reason,'not_configured')}finally{store.close()}
});
test('successful Tavily discovery does not spend on Brave and extraction counts toward total',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});try{const p=createSearchProvider({db:store.db,env:{...env,WEB_SEARCH_MAX_CALLS_PER_DAY:'2'},fetchFn:async url=>{assert.ok(url.includes('tavily'));return Response.json({results:[{url:'https://example.org/tower',title:'Turtle Tower',content:'Tower in Hanoi',raw_content:'Extracted tower history'}]})}});const first=await p.searchCandidates(context);assert.equal(first.calls,2);assert.equal(first.candidates[0].snippet,'Extracted tower history');const second=await p.searchCandidates(context);assert.equal(second.calls,0);assert.ok(second.outcomes.every(o=>o.reason==='budget_exhausted'));}finally{store.close()}
});
for(const cap of [0,1,2])test(`local call cap ${cap} stops before fallback reservation`,async()=>{
 const store=createPlaceStore({dbPath:':memory:'});let requests=0;try{const p=createSearchProvider({db:store.db,env,fetchFn:async()=>{requests++;return new Response('',{status:503})}});const r=await p.searchCandidates(context,{maxProviderCalls:cap,querySuffix:'architecture'});assert.equal(requests,Math.min(cap,2));assert.equal(r.calls,requests);const spent=store.db.prepare('SELECT COALESCE(SUM(calls),0) n FROM provider_budget').get().n;assert.equal(spent,requests);}finally{store.close()}
});
test('local ceiling includes extraction and suffix extends the server place query',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});const paths=[];try{const p=createSearchProvider({db:store.db,env,fetchFn:async(url,o)=>{paths.push(url);assert.equal(JSON.parse(o.body).query,'Turtle Tower Hanoi VN architecture');return Response.json({results:[{url:'https://example.org/tower',title:'Tower',content:'History'}]})}});const r=await p.searchCandidates(context,{maxProviderCalls:1,querySuffix:'architecture'});assert.equal(r.calls,1);assert.equal(paths.length,1);assert.ok(paths[0].endsWith('/search'));}finally{store.close()}
});
