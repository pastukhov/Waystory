import test from 'node:test';
import assert from 'node:assert/strict';
import {runTourFixtures} from '../scripts/tour-fixtures.mjs';
import {runTourProbe} from '../server/tours/probe.mjs';
test('tour fixtures run station, poor and foreign source cases without network or paid models',async()=>{
 const reports=[];assert.equal(await runTourFixtures({report:r=>reports.push(r)}),true);assert.deepEqual(reports.filter(r=>r.probe==='tour-fixture').map(r=>r.name),['station','poor','foreign','wrong_object']);assert.doesNotMatch(JSON.stringify(reports),/PRIVATE_SOURCE|PRIVATE_CHAPTER/);
});
test('probe rejects a ready plan with fewer than three themes, without TTS or quota retries',async()=>{
 const events=[];let speech=0;
 assert.equal(await runTourProbe({service:{start:async()=>({tourId:'tour'}),get:()=>({status:'ready',topics:[]})},jobs:{drain:async()=>{}},ownerId:'owner',placeId:'wiki:ru:173387',speech:async()=>speech++,report:r=>events.push(r)}),false);assert.equal(speech,0);assert.equal(events.at(-1).reason,'insufficient_topics');
});

test('paid acceptance exercises fresh service generation while preserving an existing ready owner tour',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),{createTourStore}=await import('../server/tours/store.mjs'),{createTourJobs}=await import('../server/tours/jobs.mjs'),{createTours}=await import('../server/tours/service.mjs'),{licenseFor}=await import('../server/sources/policies.mjs');
 const db=new DatabaseSync(':memory:'),store=createTourStore({db}),jobs=createTourJobs({store}),place={id:'wiki:ru:1',names:{original:'Музей'}};let calls=0,researchCalls=0,quotas=0;
 const text='В здании находится музей.',document={id:'wikipedia:ru:1',provider:'wikipedia',title:'Музей',url:'https://ru.wikipedia.org/?curid=1',text,scope:'place',language:'ru',revision:'fixture',license:licenseFor('wikimedia-cc-by-sa','Contributors')};
 const service=createTours({store,jobs,resolvePlace:async()=>place,research:async()=>{researchCalls++;return {documents:[document],fingerprint:'fixture',statuses:[]}},complete:async request=>{calls++;if(request.schema.name==='tour_plan')return {topics:[]};const span=JSON.parse(request.messages[1].content).spans[0];return {language:'ru',segments:[{text,evidenceIds:[span.id]}]}},review:async(value,spans,options)=>{await options.consumeCall();calls++;return {outcome:'supported',issues:[]}},consume:()=>quotas++});
 try{
  const options={service,jobs,ownerId:'owner',placeId:place.id,requiredThemes:0};assert.equal(await runTourProbe(options),true);const original=store.findActive('owner',place.id,'ru');assert.equal(calls,3);
  assert.equal(await runTourProbe(options),true);assert.equal(researchCalls,2);assert.equal(calls,6);assert.equal(quotas,6);assert.equal(store.stats().tours,2);assert.equal(service.get('owner',original.id).chapters[0].status,'ready');
 }finally{await jobs.shutdown();db.close()}
});
test('probe and browser submit the same first speech chunk in both languages',async()=>{const {CloudNarrator}=await import('../dist/speech.mjs');for(const language of ['ru','en']){const text='В XX веке еще строили. '.repeat(65),chapter={id:'overview',topicId:'overview',status:'ready',text},bodies=[],n=new CloudNarrator({audio:{play:async()=>{},pause(){},removeAttribute(){},load(){}},fetchFn:async(url,o)=>{bodies.push(JSON.parse(o.body));return new Response('audio')}});n.cloud=true;n.language=language;n.play([chapter]);await new Promise(r=>setImmediate(r));let calls=0,probeBody;assert.equal(await runTourProbe({service:{start:async()=>({tourId:'tour'}),get:()=>({status:'ready',topics:[],chapters:[chapter],sources:[{url:'https://example.org',license:{}}],language})},jobs:{drain:async()=>{}},ownerId:'owner',placeId:'wd:Q1',language,requiredThemes:0,speech:async body=>{calls++;probeBody=body;return Buffer.from('ID3audio')}}),true);assert.equal(calls,1);assert.deepEqual(probeBody,bodies[0]);n.stop()}});
