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
