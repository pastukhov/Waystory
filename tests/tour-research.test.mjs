import test from 'node:test';
import assert from 'node:assert/strict';
import {createTourResearch} from '../server/tours/research.mjs';
import {createCollector,sourceBundle} from '../server/sources/collect.mjs';
import {createSourceCache} from '../server/sources/cache.mjs';
import {createWikipediaProvider} from '../server/sources/wikipedia.mjs';
import {createPlaceStore} from '../server/places/store.mjs';
import {createSearchProvider} from '../server/sources/search-provider.mjs';
import {createOfficialDiscovery,createOfficialPageLoader} from '../server/sources/official-discovery.mjs';
import {licenseFor,registerSourcePolicy} from '../server/sources/policies.mjs';
const place={id:'wiki:ru:173387',refs:[{provider:'wikipedia',language:'ru',pageId:173387}],names:{original:'Кусково'},category:'museum',coordinates:{lat:55.736,lon:37.808,kind:'point'}};
const doc=(id,text='Кусково — музей в Москве. История дворца и парка.',extra={})=>({id,provider:'wikipedia',url:'https://ru.wikipedia.org/?curid=173387',title:'Кусково',language:'ru',kind:'history',scope:'place',revision:'1',text,license:licenseFor('wikimedia-cc-by-sa','contributors'),...extra});
const identity=doc('identity','',{provider:'wikidata',url:'https://www.wikidata.org/wiki/Q1',kind:'identity',website:'https://museum.example/',context:{locality:'Москва',countryCode:'RU'},license:licenseFor('wikidata-cc0','')});
const collectDocs=documents=>async()=>({documents,statuses:[]});
registerSourcePolicy('tour-fixture',{allowModelInput:true,allowTextCache:true,ttlMs:604800000});
test('tour profile reaches Wikipedia before truncation and uses a separate collector cache',async()=>{
 const store=createPlaceStore({dbPath:':memory:'});const sizes=[];
 try{const wiki=createWikipediaProvider({request:async url=>{const raw=new URL(url).searchParams.get('exchars');sizes.push(raw);const size=raw===null?25000:Number(raw);return {query:{pages:{173387:{pageid:173387,title:'Кусково',extract:'Ж'.repeat(size),revisions:[{revid:1}]}}}}}});
 const collect=createCollector({providers:[wiki],cache:createSourceCache({db:store.db})});
 assert.equal((await collect(place)).documents[0].text.length,6000);
 assert.equal((await collect(place,{profile:'tour'})).documents[0].text.length,20000);
 assert.equal((await collect(place)).documents[0].text.length,6000);assert.deepEqual(sizes,['6000',null]);
 }finally{store.close()}
});
test('tour corpus honors 24 documents, 20000 per document and 180000 total without changing legacy',()=>{
 const docs=Array.from({length:30},(_,i)=>doc('d'+i,'a'.repeat(25000),{url:'https://museum.example/'+i}));
 const tour=sourceBundle(place,docs,[],{profile:'tour'}),legacy=sourceBundle(place,docs,[]);
 assert.equal(tour.documents.length,24);assert.equal(tour.documents[0].text.length,20000);assert.equal(tour.documents.reduce((n,d)=>n+d.text.length,0),180000);
 assert.equal(legacy.documents.length,6);assert.equal(legacy.documents[0].text.length,6000);assert.equal(legacy.documents.reduce((n,d)=>n+d.text.length,0),18000);
});
test('sufficient saved corpus needs zero search or page requests and retains foreign evidence',async()=>{
 const docs=[doc('history','Histoire de Кусково. '.repeat(400),{language:'fr'}),doc('palace','Кусково дворец. '.repeat(400),{url:'https://museum.example/palace'}),doc('park','Кусково парк. '.repeat(400),{url:'https://museum.example/park'})];
 const research=createTourResearch({collect:collectDocs(docs),search:()=>assert.fail('search not needed'),loadPage:()=>assert.fail('load not needed')});
 const a=await research(place,{language:'ru'}),b=await research(place,{language:'ru'});
 assert.equal(a.documents.length,3);assert.ok(a.spans.some(s=>s.language==='fr'));assert.equal(a.fingerprint,b.fingerprint);
});
test('official museum and palace/park pages precede thematic search; wrong object and duplicate text are excluded',async()=>{
 const loaded=[];const pages={
 'https://museum.example/':{document:doc('museum','Кусково музей Москва. '.repeat(100),{url:'https://museum.example/'}),links:[{url:'https://museum.example/palace'},{url:'https://museum.example/park'},{url:'https://museum.example/wrong'},{url:'https://museum.example/duplicate'}]},
 'https://museum.example/palace':{document:doc('palace','Кусково дворец Москва. '.repeat(300),{url:'https://museum.example/palace'})},
 'https://museum.example/park':{document:doc('park','Кусково парк Москва. '.repeat(300),{url:'https://museum.example/park'})},
 'https://museum.example/wrong':{document:doc('wrong','Кусково музей в другом городе.',{url:'https://museum.example/wrong',identitySignals:{coordinates:{lat:59,lon:30}}})},
 'https://museum.example/duplicate':{document:doc('duplicate','Кусково дворец Москва. '.repeat(300),{url:'https://museum.example/duplicate'})}};
 const r=await createTourResearch({collect:collectDocs([identity,doc('wiki')]),search:()=>assert.fail('enough official evidence'),loadPage:async(url,options)=>{loaded.push(url);options.onRequest();return pages[url]}})(place,{});
 assert.deepEqual(loaded,['https://museum.example/','https://museum.example/palace','https://museum.example/park']);assert.equal(r.documents.filter(d=>d.text).length,4);assert.ok(!r.documents.some(d=>d.id==='wrong'));
});
test('poor corpus stays poor; server themes and all fallback/extraction calls share four-call ceiling',async()=>{
 let calls=0;const suffixes=[];
 const store=createPlaceStore({dbPath:':memory:'});try{
 const provider=createSearchProvider({db:store.db,env:{TAVILY_API_KEY:'fixture',BRAVE_SEARCH_API_KEY:'fixture',WEB_SEARCH_MAX_CALLS_PER_DAY:'20'},fetchFn:async(url,o)=>{calls++;if(url.includes('tavily')){suffixes.push(JSON.parse(o.body).query);return new Response('',{status:503})}return Response.json({web:{results:[]}})}});
 const r=await createTourResearch({collect:collectDocs([doc('poor','Кусково.')]),search:provider})(place,{});
 assert.equal(calls,4);assert.equal(r.documents.length,1);assert.equal(r.spans.length,1);assert.ok(suffixes[0].endsWith('history'));
 }finally{store.close()}
});
test('unknown source policy yields link metadata and no model text even when page claims permissive license',async()=>{
 const r=await createTourResearch({collect:collectDocs([identity]),loadPage:async(url,o)=>{o.onRequest();return {document:doc('unknown','Кусково Москва музей.',{url,license:licenseFor('unknown','owner')})}}})(place,{budget:{maxSearchCalls:0}});
 assert.equal(r.spans.length,0);assert.ok(r.documents.every(d=>!d.text));assert.ok(r.links.some(l=>l.url==='https://museum.example/'));
});
test('page ceiling counts redirects and per-domain request budget; traversal stops at depth one',async()=>{
 let requests=0;const loaded=[];
 const r=await createTourResearch({collect:collectDocs([identity]),loadPage:async(url,o)=>{loaded.push(url);o.onRequest();requests++;return {links:Array.from({length:20},(_,i)=>({url:'https://museum.example/'+i}))}}})(place,{budget:{maxSearchCalls:0}});
 assert.equal(requests,4);assert.equal(loaded.length,4);assert.equal(r.spans.length,0);
});
test('research cancellation and deadline bound stalled trusted transports',async()=>{
 const ac=new AbortController();ac.abort();await assert.rejects(createTourResearch({collect:collectDocs([])})(place,{signal:ac.signal}),{name:'AbortError'});
 const r=await createTourResearch({collect:()=>new Promise(()=>{})})(place,{budget:{timeoutMs:15}});assert.equal(r.statuses[0].reason,'timeout');
});
test('safe page loader defaults unknown sites to metadata only, preserving original paragraphs',async()=>{
 const load=createOfficialPageLoader({request:async url=>({url,html:'<title>Кусково</title><p>Кусково музей.</p><p>Дворец.</p><a href="/park">Парк</a>'})});
 const page=await load('https://museum.example/');assert.equal(page.document.text,'');assert.equal(page.links[0].url,'https://museum.example/park');
});
test('Kuskovo real visitor page exposes official izi audio links within four requests',async()=>{
 const pages={'https://kuskovo.ru/':'<a href="/our-events/exhibitions/">Выставки</a><a href="/posetitelyam/independent_visit/">Самостоятельное посещение</a>',
 'https://kuskovo.ru/posetitelyam/independent_visit/':'При самостоятельном посещении <a href="https://izi.travel/ru/search/кусково%20музей">аудиогидом</a><a href="https://izi.travel/ru/e190-arhitekturno-parkovyy-ansambl-usadby-kuskovo-s-tiflokommentariyami/ru">аудиогид с тифлокомментариями</a>'};const seen=[];
 const r=await createOfficialDiscovery({request:async url=>{seen.push(url);return {url,html:pages[url]||''}}})({documents:[{...identity,website:'https://kuskovo.ru/'}]});
 assert.equal(seen[1],'https://kuskovo.ru/posetitelyam/independent_visit/');assert.ok(r.links.some(l=>l.url.startsWith('https://izi.travel/ru/e190-')));assert.ok(seen.every(u=>u.startsWith('https://kuskovo.ru/')));
});
test('same-name wrong object and repeated canonical URL/text never become extra evidence',async()=>{
 const museum=doc('museum','Кусково Москва музей.',{url:'https://museum.example/'});const text='Кусково дворец Москва.';
 const pages={'https://museum.example/':{document:museum,links:[{url:'https://museum.example/wrong'},{url:'https://museum.example/palace'},{url:'https://museum.example/duplicate'}]},'https://museum.example/wrong':{document:doc('wrong','Кусково музей',{url:'https://museum.example/wrong',identitySignals:{coordinates:{lat:59,lon:30}}})},'https://museum.example/palace':{document:doc('palace',text,{url:'https://museum.example/palace'})},'https://museum.example/duplicate':{document:doc('duplicate',text,{url:'https://museum.example/duplicate'})}};
 const r=await createTourResearch({collect:collectDocs([identity]),loadPage:async(url,o)=>{o.onRequest();return pages[url]}})(place,{budget:{maxSearchCalls:0}});
 assert.deepEqual(r.documents.filter(d=>d.text).map(d=>d.id),['museum','palace']);
});
test('global 12-page ceiling includes redirects across domains; depth-two links are ignored',async()=>{
 const identities=Array.from({length:5},(_,i)=>({...identity,id:'i'+i,url:'https://www.wikidata.org/wiki/Q'+i,website:`https://museum${i}.example/`}));let connections=0;const loaded=[];
 await createTourResearch({collect:collectDocs(identities),loadPage:async(url,o)=>{loaded.push(url);o.onRequest();o.onRequest();connections+=2;return {links:[{url:new URL('/child',url).href},{url:new URL('/another',url).href}]}}})(place,{budget:{maxSearchCalls:0}});
 assert.equal(connections,12);assert.ok(loaded.every(url=>!url.includes('grandchild')));
});
test('safe loader rejects literal private IP before invoking transport',async()=>{
 await assert.rejects(createOfficialPageLoader({request:()=>assert.fail('unsafe connection')})('https://127.0.0.1/'),/prohibited/);
});
test('safe loader enforces body cap and timeout even with a stalled injected request',async()=>{
 await assert.rejects(createOfficialPageLoader({request:async()=>({html:'x'.repeat(512*1024+1)})})('https://museum.example/'),/response_too_large/);
 const hold=setTimeout(()=>{},1000);try{await assert.rejects(createOfficialPageLoader({request:()=>new Promise(()=>{})})('https://museum.example/',{signal:AbortSignal.timeout(10)}),{name:'TimeoutError'})}finally{clearTimeout(hold)}
});
test('explicitly approved domain keeps extracted original paragraphs with original language',async()=>{
 const load=createOfficialPageLoader({domains:[{host:'museum.example',enabled:true,rightsVerified:true,allowModelInput:true,allowTextCache:true,licenseId:'CC-BY-SA-4.0',outputLicense:'CC-BY-SA-4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',permissionUrl:'https://museum.example/permission',attribution:'Museum',policyId:'tour-fixture'}],request:async url=>({url,html:'<html lang="fr"><title>Кусково</title><p>Premier paragraphe.</p><p>Deuxième paragraphe.</p></html>'})});
 const p=await load('https://museum.example/');assert.equal(p.document.language,'fr');assert.match(p.document.text,/Premier paragraphe\.\n\nDeuxième paragraphe\./);
});
test('synthetic official endorsement exposes supplied Kuskovo palace QR URL as audio metadata only',async()=>{
 const url='https://www.izi.travel/ru/6e02-muzey-usadba-kuskovo-dvorec/ru';
 const r=await createOfficialDiscovery({request:async u=>({url:u,html:`<a href="${url}">Бесплатный аудиогид во дворец</a>`})})({documents:[{...identity,website:'https://kuskovo.ru/'}]});
 assert.ok(r.links.some(l=>l.url===url&&l.kind==='audio'));assert.equal(r.documents,undefined);
});
test('depth-one traversal never loads grandchild pages when budget remains',async()=>{
 const seen=[];
 await createTourResearch({collect:collectDocs([identity]),loadPage:async(url,o)=>{seen.push(url);o.onRequest();return {links:[{url:url.endsWith('/child')?'https://museum.example/grandchild':'https://museum.example/child'}]}}})(place,{budget:{maxSearchCalls:0}});
 assert.deepEqual(seen,['https://museum.example/','https://museum.example/child']);
});
test('research with unconfigured or daily-exhausted search never makes an HTTP request',async()=>{
 for(const env of [{WEB_SEARCH_MAX_CALLS_PER_DAY:'10'},{TAVILY_API_KEY:'fixture',WEB_SEARCH_MAX_CALLS_PER_DAY:'0'}]){
 const store=createPlaceStore({dbPath:':memory:'});try{const search=createSearchProvider({db:store.db,env,fetchFn:()=>assert.fail('no paid request')});const r=await createTourResearch({collect:collectDocs([doc('poor','Кусково.')]),search})(place,{});assert.equal(r.spans.length,1);assert.ok(r.statuses.some(s=>s.reason==='not_configured'));}finally{store.close()}
 }
});
test('verified thematic search loads matching allowed material and rejects wrong-location namesakes before loading',async()=>{
 let searches=0;const seen=[];
 const r=await createTourResearch({collect:collectDocs([identity]),search:async()=>{searches++;return {calls:4,outcomes:[],candidates:[{url:'https://other.example/wrong',title:'Кусково музей Москва',snippet:'Кусково музей Москва',identitySignals:{coordinates:{lat:59,lon:30}}},{url:'https://other.example/right',title:'Кусково музей Москва',snippet:'Кусково музей Москва',identitySignals:{coordinates:{lat:55.736,lon:37.808}}}]}},loadPage:async(url,o)=>{seen.push(url);o.onRequest();return url.includes('other.example')?{document:doc('searched','Кусково музей Москва. История дворца.',{url})}:{links:[]}}})(place,{});
 assert.equal(searches,1);assert.deepEqual(seen,['https://museum.example/','https://other.example/right']);assert.ok(r.documents.some(d=>d.id==='searched'));
});
