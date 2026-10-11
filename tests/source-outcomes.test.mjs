import test from 'node:test';import assert from 'node:assert/strict';
import {createCollector} from '../server/sources/collect.mjs';
import {createSourceHttp} from '../server/sources/http.mjs';
const place={id:'osm:node:1',refs:[]};
test('collector distinguishes empty, rate limits and timeouts without leaking errors',async()=>{
 const collect=createCollector({providers:[{id:'osm',documents:async()=>({documents:[],status:'empty'})},{id:'wikipedia',documents:async()=>{throw Object.assign(Error('secret'),{name:'TimeoutError'})}}]});
 const result=await collect(place);assert.equal(result.statuses[0].reason,'no_match');assert.equal(result.statuses[1].reason,'timeout');assert.equal(result.statuses[1].documentCount,0);assert.ok(result.statuses[1].durationMs>=0);assert.ok(!JSON.stringify(result).includes('secret'));
 const request=createSourceHttp({fetchFn:async()=>new Response('',{status:429})});await assert.rejects(request('https://en.wikipedia.org/w/api.php'),e=>e.reason==='rate_limited');
});
test('bounded collection retains completed evidence while a slow provider times out',async()=>{const collect=createCollector({providers:[{id:'wikipedia',documents:async()=>({status:'ok',documents:[{id:'wikipedia:en:1',title:'Tower',scope:'place',text:'A tower.',license:{policyId:'wikimedia-cc-by-sa'}}]})},{id:'osm',documents:()=>new Promise(()=>{})}]});const hold=setInterval(()=>{},100);try{const result=await Promise.race([collect(place,{collectionTimeoutMs:20}),new Promise((_,reject)=>setTimeout(()=>reject(Error('collection exceeded deadline')),100))]);assert.equal(result.documents.length,1);assert.equal(result.statuses.find(s=>s.provider==='osm').reason,'timeout')}finally{clearInterval(hold)}});
