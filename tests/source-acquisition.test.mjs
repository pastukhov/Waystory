import test from 'node:test';import assert from 'node:assert/strict';import * as acquisition from '../server/sources/acquire.mjs';
const place={id:'osm:node:1',refs:[],names:{original:'Love Alanya'},category:'viewpoint'};
const bundle={place,documents:[],statuses:[],fingerprint:'empty'};
test('empty open evidence automatically searches and shares concurrent work',async()=>{let calls=0;const acquire=acquisition.createAcquisition({collect:async()=>bundle,search:{enabled:true,searchCandidates:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {candidates:[],outcomes:[{provider:'global-web',status:'empty',reason:'no_match'}]}}}});const [a,b]=await Promise.all([acquire(place),acquire(place)]);assert.equal(calls,1);assert.equal(a.outcome,'no_material');assert.equal(b.outcome,'no_material');await acquire(place);assert.equal(calls,1);await acquire(place,{refresh:true});assert.equal(calls,2)});
test('missing credentials are distinct from temporary failures',async()=>{const acquire=acquisition.createAcquisition({collect:async()=>bundle,search:{enabled:false}});assert.equal((await acquire(place)).outcome,'not_configured')});
test('source failure returns classified outcome rather than an unhandled server error',async()=>{const acquire=acquisition.createAcquisition({collect:async()=>{throw new DOMException('deadline','TimeoutError')}});assert.equal((await acquire(place)).outcome,'temporarily_unavailable')});
test('caller cancellation does not duplicate or cancel another caller shared work',async()=>{let calls=0,finish;const acquire=acquisition.createAcquisition({collect:()=>{calls++;return new Promise(r=>finish=r)}});const controller=new AbortController(),a=acquire(place,{signal:controller.signal}),b=acquire(place);controller.abort();await assert.rejects(a,{name:'AbortError'});finish(bundle);await b;assert.equal(calls,1)});
import {registerSourcePolicy} from '../server/sources/policies.mjs';
test('permitted positive evidence is reused without paying again',async()=>{registerSourcePolicy('test-global-cache',{allowModelInput:true,allowTextCache:true,allowGeneratedAudio:true,ttlMs:60000});let calls=0;const identity={id:'osm:node:1',provider:'osm',title:'Love Alanya',scope:'place',website:'https://example.org/place',text:'',license:{policyId:'osm-odbl'}};const acquire=acquisition.createAcquisition({collect:async()=>({...bundle,documents:[identity]}),search:{enabled:true,searchCandidates:async()=>{calls++;return {candidates:[{url:'https://example.org/place',title:'Love Alanya',snippet:'A documented viewpoint history.',usagePolicyId:'test-global-cache'}],outcomes:[]}}}});assert.equal((await acquire(place)).outcome,'ready');assert.equal((await acquire(place)).outcome,'ready');assert.equal(calls,1)});
import {createPlaceStore} from '../server/places/store.mjs';
test('permitted historical evidence survives process restart and upstream outage within policy TTL',async()=>{const store=createPlaceStore({dbPath:':memory:'});let time=0,calls=0;const doc={id:'wikipedia:en:1',provider:'wikipedia',title:'Tower',scope:'place',kind:'history',text:'Built long ago.',license:{policyId:'wikimedia-cc-by-sa'}};try{const first=acquisition.createAcquisition({db:store.db,now:()=>time,collect:async()=>({...bundle,documents:[doc]})});await first(place);const restarted=acquisition.createAcquisition({db:store.db,now:()=>time,collect:async()=>{calls++;throw Error('upstream down')}});assert.equal((await restarted(place)).outcome,'ready');assert.equal(calls,0);time=7*3600000;const stale=await restarted(place);assert.equal(stale.outcome,'limited');assert.equal(stale.bundle.documents[0].stale,true)}finally{store.close()}});
test('official guides are discovered even when Wikipedia already supplies the story',async()=>{
 let searches=0,visits=0;const doc={id:'wiki',provider:'wikipedia',title:'Museum',scope:'place',kind:'history',text:'Museum history.',license:{policyId:'wikimedia-cc-by-sa'}};
 const acquire=acquisition.createAcquisition({collect:async()=>({...bundle,documents:[doc]}),officialDiscovery:async()=>{visits++;return {links:[{url:'https://museum.example/guide',title:'Guide',kind:'guide'}],statuses:[{provider:'official-web',status:'ok'}]}},search:{enabled:true,searchCandidates:async()=>{searches++;throw Error('Should not bill')}}});
 const value=await acquire(place);assert.equal(value.officialLinks.length,1);assert.equal(value.discoveryStatus.web,'not_needed');assert.equal(value.bundle.documents[0].text,'Museum history.');await acquire(place);assert.equal(visits,1);assert.equal(searches,0);
});
test('blocked search keeps available story and exposes incomplete discovery',async()=>{
 const doc={id:'wiki',provider:'wikipedia',title:'Museum',scope:'place',text:'Museum history.',license:{policyId:'wikimedia-cc-by-sa'}};
 const acquire=acquisition.createAcquisition({collect:async()=>({...bundle,documents:[doc]}),officialDiscovery:async()=>({links:[],statuses:[]}),search:{enabled:true,searchCandidates:async()=>({candidates:[],outcomes:[{provider:'global-web',status:'unavailable',reason:'access_denied',httpStatus:403}]})}});
 const value=await acquire(place);assert.equal(value.outcome,'limited');assert.equal(value.discoveryStatus.web,'unavailable');assert.equal(value.bundle.documents[0].text,'Museum history.');
});
test('successful fallback clears failure status but incomplete extraction remains visible',async()=>{
 const doc={id:'wiki',provider:'wikipedia',title:'Museum',scope:'place',text:'Museum history.',license:{policyId:'wikimedia-cc-by-sa'}};
 for(const [outcomes,expected] of [
  [[{status:'unavailable'},{status:'ok'}],'ok'],
  [[{status:'ok'},{status:'partial'}],'unavailable'],
  [[{status:'ok'},{status:'budget-exhausted',reason:'budget_exhausted'}],'budget_exhausted']]){
  const acquire=acquisition.createAcquisition({collect:async()=>({...bundle,documents:[doc]}),officialDiscovery:async()=>({links:[],statuses:[]}),search:{enabled:true,searchCandidates:async()=>({candidates:[],outcomes:outcomes.map(s=>({provider:'global-web',...s}))})}});
  assert.equal((await acquire(place)).discoveryStatus.web,expected);
 }
});
