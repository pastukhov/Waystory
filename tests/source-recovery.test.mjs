import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaces} from '../server/places/service.mjs';
import {createPlaceStore} from '../server/places/store.mjs';
import {createOsmProvider} from '../server/sources/osm.mjs';
import {createWikipediaProvider} from '../server/sources/wikipedia.mjs';
import {createCollector} from '../server/sources/collect.mjs';
import {createSourceCache} from '../server/sources/cache.mjs';

for(const transient of [false,true])test(`selected place recovers explicit article after ${transient?'hydration failure':'discovery cap'} and persists it`,async()=>{
 const elements=Array.from({length:13},(_,i)=>({type:'node',id:i+1,lat:36,lon:32+i*.00001,tags:{name:`Tower ${i+1}`,historic:'monument',wikipedia:`en:Tower ${i+1}`}}));
 let fail=transient,titleCalls=0;
 const osm=createOsmProvider({request:async(_,o)=>{const q=new URLSearchParams(o.body).get('data'),m=/node\((\d+)\)/.exec(q);return {elements:m?elements.filter(e=>e.id===+m[1]):elements}}});
 const wiki=createWikipediaProvider({request:async url=>{const p=new URL(url).searchParams;if(p.has('generator'))return {query:{pages:{}}};const title=p.get('titles');if(title){titleCalls++;if(fail)throw Error('temporary failure')}const id=Number(title?.split(' ')[1]||p.get('pageids'));return {query:{pages:{[id]:{pageid:id,title:`Tower ${id}`,extract:'Built in 1226.'}}}}}});
 const store=createPlaceStore({dbPath:':memory:'});try{
  const places=createPlaces({store,providers:[wiki,osm]});await places.nearby({lat:36,lon:32,language:'en',radius:1500});assert.equal(titleCalls,12);fail=false;
  const id=transient?'osm:node:1':'osm:node:13';
  for(let attempt=0;attempt<2;attempt++){
   const b=await places.collect(store.getById(id),{language:'en'});assert.equal(b.documents.filter(d=>d.text).length,1);
   assert.ok(store.getById(id).refs.some(r=>r.provider==='wikipedia'));
  }
 }finally{store.close()}
});

test('Wikipedia retains successful editions, retries partial cache, and distinguishes all-failure from empty',async()=>{
 let fail=true;
 const wiki=createWikipediaProvider({request:async url=>{if(fail&&new URL(url).hostname==='ru.wikipedia.org')throw Error('unavailable');return {query:{pages:{1:{pageid:1,title:'Tower',extract:'Built in 1226.'}}}}}});
 const place={id:'wiki:en:1',refs:[{provider:'wikipedia',language:'en',pageId:1},{provider:'wikipedia',language:'ru',pageId:2}],names:{original:'Tower'}};
 const store=createPlaceStore({dbPath:':memory:'});try{
  const collect=createCollector({providers:[wiki],cache:createSourceCache({db:store.db})});
  const partial=await collect(place);assert.equal(partial.documents.length,1);assert.equal(partial.statuses[0].status,'partial');
  fail=false;const recovered=await collect(place);assert.equal(recovered.documents.length,2);assert.equal(recovered.statuses[0].status,'ok');
  const down=createWikipediaProvider({request:async()=>{throw Error('down')}});assert.equal((await createCollector({providers:[down]})(place)).statuses[0].status,'unavailable');
  const empty=createWikipediaProvider({request:async()=>({query:{pages:{}}})});assert.equal((await createCollector({providers:[empty]})(place)).statuses[0].status,'empty');
 }finally{store.close()}
});

import {createWikidataProvider} from '../server/sources/wikidata.mjs';
import {createSourceHttp} from '../server/sources/http.mjs';
test('selected Wikidata sitelinks recover beyond discovery cap through real HTTP adapters',async()=>{
 const request=createSourceHttp({fetchFn:async(url,options)=>{
  const u=new URL(url);if(u.hostname==='overpass-api.de'){const match=/node\((\d+)\)/.exec(new URLSearchParams(options.body).get('data'));return Response.json({elements:Array.from({length:13},(_,i)=>({type:'node',id:i+1,lat:36,lon:32,tags:{name:'Place '+(i+1),wikidata:'Q'+(i+1)}})).filter(e=>!match||e.id===+match[1])})}
  if(u.hostname==='www.wikidata.org')return Response.json({entities:Object.fromEntries(u.searchParams.get('ids').split('|').map(id=>[id,{id,labels:{en:{value:'Place '+id.slice(1)}},sitelinks:{enwiki:{title:'Place '+id.slice(1)}}}]))});
  if(u.searchParams.has('generator'))return Response.json({query:{pages:{}}});
  const id=Number(u.searchParams.get('titles')?.split(' ')[1]||u.searchParams.get('pageids'));return Response.json({query:{pages:{[id]:{pageid:id,title:'Place '+id,extract:'Documented history.',pageprops:{wikibase_item:'Q'+id}}}}});
 }});
 const store=createPlaceStore({dbPath:':memory:'});try{
  const service=createPlaces({store,providers:[createWikipediaProvider({request}),createOsmProvider({request}),createWikidataProvider({request})]});
  await service.nearby({lat:36,lon:32,radius:1500,language:'en'});const before=store.getById('osm:node:13');assert.ok(!before.refs.some(r=>r.provider==='wikipedia'));
  const bundle=await service.collect(before,{language:'en'});assert.equal(bundle.documents.filter(d=>d.text).length,1);assert.ok(store.getById(before.id).refs.some(r=>r.provider==='wikipedia'&&r.pageId===13));
 }finally{store.close()}
});
test('partial Wikipedia discovery remains visibly partial and is not cached as healthy',async()=>{
 let failed=true,calls=0;
 const wiki=createWikipediaProvider({request:async url=>{calls++;if(failed&&new URL(url).hostname==='ru.wikipedia.org')throw Error('temporary');return {query:{pages:{1:{pageid:1,title:'Tower'}}}}}});
 const store=createPlaceStore({dbPath:':memory:'});try{
  const service=createPlaces({store,providers:[wiki]});const input={lat:36,lon:32,radius:1500,language:'en'};
  const partial=await service.nearby(input);assert.equal(partial.statuses[0].status,'partial');assert.equal(partial.places.length,2);
  failed=false;const healthy=await service.nearby(input);assert.equal(healthy.statuses[0].status,'ok');assert.equal(healthy.places.length,3);const before=calls;
  await service.nearby(input);assert.equal(calls,before);
 }finally{store.close()}
});

test('linked cached evidence survives identity refresh failure without forced pre-collection resolution',async()=>{
 let identityCalls=0,fail=false;
 const store=createPlaceStore({dbPath:':memory:'});
 const wiki=createWikipediaProvider({request:async()=>({query:{pages:{1:{pageid:1,title:'Tower',extract:'Usable history.'}}}})});
 const osm=createOsmProvider({request:async()=>{identityCalls++;if(fail)throw new DOMException('Identity timeout','TimeoutError');return {elements:[{type:'node',id:1,tags:{name:'Tower',wikipedia:'en:Tower'}}]}}});
 try{
  const place=store.upsert({id:'osm:node:1',refs:[{provider:'osm',kind:'node',id:1},{provider:'wikipedia',language:'en',pageId:1}],names:{original:'Tower'},sourceIds:['osm:node:1'],coordinates:null});
  const service=createPlaces({store,providers:[wiki,osm]});assert.equal((await service.collect(place)).documents.filter(d=>d.text).length,1);const before=identityCalls;fail=true;
  const cached=await service.collect(place);assert.equal(cached.documents.filter(d=>d.text).length,1);assert.equal(identityCalls,before,'healthy cached identity must not be forced upstream');
 }finally{store.close()}
});

test('Wikidata identity recovered after discovery failure links its article to the original OSM place',async()=>{
 let fail=true;
 const osm=createOsmProvider({request:async()=>({elements:[{type:'node',id:1,tags:{name:'Tower',wikidata:'Q1'}}]})});
 const wd=createWikidataProvider({request:async()=>{if(fail)throw Error('temporary');return {entities:{Q1:{id:'Q1',labels:{en:{value:'Tower'}},sitelinks:{enwiki:{title:'Tower'}}}}}}});
 const wiki=createWikipediaProvider({request:async url=>new URL(url).searchParams.has('generator')?{query:{pages:{}}}:{query:{pages:{1:{pageid:1,title:'Tower',extract:'History without reverse pageprops.'}}}}});
 const store=createPlaceStore({dbPath:':memory:'});try{
  const service=createPlaces({store,providers:[wiki,osm,wd]});await service.nearby({lat:36,lon:32,radius:1500,language:'en'});fail=false;
  const bundle=await service.collect(store.getById('osm:node:1'));assert.ok(bundle.place.refs.some(r=>r.provider==='wikipedia'));assert.equal(store.getById('wiki:en:1').id,'osm:node:1');assert.equal(bundle.documents.filter(d=>d.text).length,1);
 }finally{store.close()}
});

test('missing-edition hydration timeout keeps a successful edition and caller cancellation still rejects',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});let timedOut=false,entered;const started=new Promise(resolve=>{entered=resolve});
 const wd=createWikidataProvider({request:async()=>({entities:{Q1:{id:'Q1',labels:{en:{value:'Tower'}},sitelinks:{ruwiki:{title:'Башня'}}}}})});
 const wiki=createWikipediaProvider({request:async(url,{signal})=>{
  if(new URL(url).hostname==='ru.wikipedia.org'){entered();return new Promise((resolve,reject)=>{const abort=()=>{timedOut=true;reject(signal.reason)};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})})}
  return {query:{pages:{1:{pageid:1,title:'Tower',extract:'Usable English history.'}}}};
 }});
 try{
  const place=store.upsert({id:'wd:Q1',refs:[{provider:'wikidata',id:'Q1'},{provider:'wikipedia',language:'en',pageId:1}],names:{original:'Tower'},sourceIds:['wd:Q1'],coordinates:null});
  const service=createPlaces({store,providers:[wiki,wd]});
  // Keep the event loop alive while AbortSignal.timeout (unref'ed) expires.
  const keepAlive=setInterval(()=>{},1000);let bundle;try{bundle=await service.collect(place)}finally{clearInterval(keepAlive)}
  assert.equal(timedOut,true);assert.equal(bundle.documents.filter(d=>d.text).length,1);assert.equal(bundle.statuses.find(s=>s.provider==='wikipedia').status,'partial');
  const controller=new AbortController();const pending=service.collect(place,{signal:controller.signal});await started;controller.abort();await assert.rejects(pending,{name:'AbortError'});
 }finally{store.close()}
});

test('an edition hitting the provider deadline does not discard an edition already received',async()=>{
 const controller=new AbortController();
 const wiki=createWikipediaProvider({request:async url=>{if(new URL(url).hostname==='ru.wikipedia.org'){controller.abort(new DOMException('Deadline','TimeoutError'));throw controller.signal.reason}return {query:{pages:{1:{pageid:1,title:'Tower',extract:'Successful edition.'}}}}}});
 const result=await wiki.documents({refs:[{provider:'wikipedia',language:'en',pageId:1},{provider:'wikipedia',language:'ru',pageId:2}]},{signal:controller.signal});assert.equal(result.documents.length,1);assert.equal(result.status,'partial');
});

for(const initialStatus of ['unavailable','partial'])test(`successful title recovery clears ${initialStatus} Wikipedia status`,async()=>{
 const store=createPlaceStore({dbPath:':memory:'});
 const osm=createOsmProvider({request:async()=>({elements:[{type:'node',id:1,tags:{name:'Tower',wikipedia:'en:Tower'}}]})});
 const wiki=createWikipediaProvider({request:async()=>({query:{pages:{1:{pageid:1,title:'Tower',extract:'Recovered history.'}}}})});
 wiki.documents=async()=>({documents:[],status:initialStatus});
 try{
  const place=store.upsert({id:'osm:node:1',refs:[{provider:'osm',kind:'node',id:1}],names:{original:'Tower'},sourceIds:['osm:node:1'],coordinates:null});
  const bundle=await createPlaces({store,providers:[wiki,osm]}).collect(place);
  assert.equal(bundle.documents.filter(d=>d.text).length,1);
  assert.equal(bundle.statuses.find(s=>s.provider==='wikipedia').status,'ok');
 }finally{store.close()}
});
