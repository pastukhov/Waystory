import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPlaces,nearbyPlaces,loadPlace} from '../dist/wiki.mjs';
test('text search uses the requested English edition and preserves its source',async()=>{
 const old=globalThis.fetch;let host;
 globalThis.fetch=async url=>{host=new URL(url).hostname;return Response.json({query:{pages:{1:{pageid:1,title:host==='en.wikipedia.org'?'Red Tower':'Красная башня'}}}})};
 try{const places=await searchPlaces('Red Tower',undefined,'en');assert.equal(host,'en.wikipedia.org');assert.equal(places[0].title,'Red Tower');assert.equal(places[0].lang,'en');assert.equal(places[0].source,'https://en.wikipedia.org/?curid=1')}finally{globalThis.fetch=old}
});
test('nearby prefers English duplicates while retaining other language coverage',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async url=>{const lang=new URL(url).hostname.split('.')[0];return Response.json({query:{pages:{1:{pageid:1,title:lang==='en'?'Red Tower':'Красная башня',pageprops:{wikibase_item:'Q1'}},...(lang==='tr'?{2:{pageid:2,title:'Kale',pageprops:{wikibase_item:'Q2'}}}:{})}}})};
 try{const result=await nearbyPlaces(36.55,32,undefined,'en');assert.equal(result.places.length,2);assert.equal(result.places[0].title,'Red Tower');assert.equal(result.places[0].lang,'en');assert.match(result.places[0].source,/en.wikipedia/);assert.equal(result.places[1].lang,'tr');assert.equal(result.radius,1500);assert.equal(result.partial,false)}finally{globalThis.fetch=old}
});
test('nearby expands search and preserves language when Russian coverage is empty',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async url=>{const u=new URL(url);return Response.json(u.hostname==='tr.wikipedia.org'&&Number(u.searchParams.get('ggsradius'))>=5000?{query:{pages:{1:{pageid:1,title:'Kızıl Kule',coordinates:[{lat:36.54,lon:32}],pageprops:{wikibase_item:'Q1'}}}}}:{query:{pages:{}}})};
 try{const r=await nearbyPlaces(36.55,32);assert.equal(r.radius,5000);assert.equal(r.places.length,1);assert.equal(r.places[0].lang,'tr');assert.match(r.places[0].source,/tr.wikipedia/)}finally{globalThis.fetch=old}
});
test('network failures are not reported as an empty successful search',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('offline')};try{await assert.rejects(nearbyPlaces(36.55,32),/недоступ|соединение/i)}finally{globalThis.fetch=old}});
test('article text is loaded from its original language edition',async()=>{const old=globalThis.fetch;let host;globalThis.fetch=async url=>{host=new URL(url).hostname;return Response.json({query:{pages:{1:{extract:'A historic tower.'}}}})};try{await loadPlace({id:'wiki-en-1',pageid:1,lang:'en'});assert.equal(host,'en.wikipedia.org')}finally{globalThis.fetch=old}});
test('search works in Android browsers without AbortSignal.any or timeout',async()=>{const old=globalThis.fetch,any=AbortSignal.any,timeout=AbortSignal.timeout;let called=false;AbortSignal.any=undefined;AbortSignal.timeout=undefined;globalThis.fetch=async()=>{called=true;return Response.json({query:{pages:{1:{pageid:1,title:'Tower'}}}})};try{const r=await nearbyPlaces(36.55,32);assert.ok(r.places.length);assert.equal(called,true)}finally{globalThis.fetch=old;AbortSignal.any=any;AbortSignal.timeout=timeout}});
test('nearby deduplicates translated articles using Wikidata ID',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({query:{pages:{1:{pageid:1,title:'Tower',pageprops:{wikibase_item:'Q1'}}}}});try{const r=await nearbyPlaces(36.55,32);assert.equal(r.places.length,1);assert.equal(r.places[0].lang,'ru')}finally{globalThis.fetch=old}});
test('opening a searched place retrieves coordinates and retains the source title',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({query:{pages:{1:{pageid:1,title:'Hacımehmetli, Alanya',extract:'A village in Turkey.',coordinates:[{lat:36.57,lon:31.98}]}}}});try{const p=await loadPlace({id:'wiki-en-1',pageid:1,title:'Перевод',lang:'en'});assert.deepEqual(p.coords,[36.57,31.98]);assert.equal(p.originalTitle,'Hacımehmetli, Alanya')}finally{globalThis.fetch=old}});

test('Vietnamese fallback never requests the same page id from Russian Wikipedia',async()=>{const old=globalThis.fetch;let host;globalThis.fetch=async url=>{host=new URL(url).hostname;return Response.json({query:{pages:{42:{pageid:42,title:'Tháp Rùa',extract:'Một ngôi tháp.'}}}})};try{await loadPlace({id:'wiki:vi:42',pageid:42,lang:'vi'});assert.equal(host,'vi.wikipedia.org')}finally{globalThis.fetch=old}});

test('foreign fallback uses an explicit Russian ref and its own page ID',async()=>{
 const old=globalThis.fetch;const requests=[];globalThis.fetch=async url=>{const u=new URL(url);requests.push(u);return Response.json({query:{pages:{231936:{pageid:231936,title:'Белорусский вокзал',extract:'Вокзал открыт в 1870 году.',fullurl:'https://ru.wikipedia.org/wiki/Белорусский_вокзал'}}}})};
 try{const result=await loadPlace({id:'wiki:en:8392086',placeId:'wiki:en:8392086',lang:'en',pageid:8392086,refs:[{provider:'wikipedia',language:'en',pageId:8392086},{provider:'wikipedia',language:'ru',pageId:231936}]},undefined,'ru');assert.equal(requests[0].hostname,'ru.wikipedia.org');assert.equal(requests[0].searchParams.get('pageids'),'231936');assert.equal(result.lang,'ru');assert.equal(result.pageid,231936);assert.equal(result.placeId,'wiki:en:8392086');}finally{globalThis.fetch=old}
});

test('unavailable preferred edition preserves cached foreign text and its language',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline')};
 const place={id:'old',lang:'en',pageid:1,blocks:[{text:'Saved original text'}],refs:[{provider:'wikipedia',language:'ru',pageId:2}]};
 try{assert.equal(await loadPlace(place,undefined,'ru'),place)}finally{globalThis.fetch=old}
});
test('preferred edition cancellation cannot fall back to another request',async()=>{
 const old=globalThis.fetch,controller=new AbortController();let calls=0;globalThis.fetch=async()=>{calls++;controller.abort();throw new DOMException('Aborted','AbortError')};
 try{await assert.rejects(loadPlace({lang:'en',pageid:1,refs:[{provider:'wikipedia',language:'ru',pageId:2}]},controller.signal,'ru'),e=>e.name==='AbortError');assert.equal(calls,1)}finally{globalThis.fetch=old}
});
