import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateChapter,coveredFactKey} from '../server/tours/generator.mjs';
import {createTours,createTourModel,createTourCollector} from '../server/tours/service.mjs';
import {createTourStore} from '../server/tours/store.mjs';
import {createTourJobs} from '../server/tours/jobs.mjs';
import {buildEvidenceSpans} from '../server/sources/spans.mjs';
import {licenseFor,registerSourcePolicy} from '../server/sources/policies.mjs';

const place={id:'wiki:ru:173387',names:{original:'Кусково'}};
const docs=['Кусково — музей. Дворец построен в XVIII веке.','Парк украшен прудами.','В музее хранится керамика.'].map((text,i)=>({id:'d'+i,revision:'1',text,scope:'place',language:'ru',title:'Кусково',url:'https://ru.wikipedia.org/?curid=173387',license:licenseFor('wikimedia-cc-by-sa','Wikipedia')}));
const spans=buildEvidenceSpans(docs);
const topic={id:'history',title:'История',evidenceIds:[spans[0].id]};
const answer=(text='Дворец построен в XVIII веке.',ids=[spans[0].id],language='ru')=>({language,text,evidenceIds:ids,claims:[{text,evidenceIds:ids}]});
const supported=async()=>({outcome:'supported',issues:[]});
test('chapter producer uses bounded compact refs and maps to unchanged canonical evidence before review',async()=>{
 const snapshot=JSON.stringify(spans),canonical=spans[0].id;
 assert.match(canonical,/^[a-f0-9]{64}$/);
 let reviews=0;
 const c=await generateChapter({place,language:'ru',topic,spans,previousChapters:[{status:'ready',claims:[{text:'Ранее подтверждено.',evidenceIds:[spans[2].id]}]}]}, {
  complete:async request=>{
   const payload=JSON.parse(request.messages[1].content),properties=request.schema.schema.properties;
   assert.deepEqual(payload.spans.map(s=>s.id),['e1']);
   assert.deepEqual(payload.topic.evidenceIds,['e1']);
   assert.deepEqual(properties.segments.items.properties.evidenceIds.items.enum,['e1']);
   for(const span of spans)assert.ok(!JSON.stringify(request).includes(span.id));
   assert.ok(!JSON.stringify(request).includes(topic.id));
   return wireAnswer('Дворец построен в XVIII веке.',['e1']);
  },review:async(value,evidence)=>{reviews++;assert.deepEqual(value.claims,answer().claims);assert.deepEqual(value.previousClaims,[{text:'Ранее подтверждено.',evidenceIds:[spans[2].id]}]);assert.deepEqual(evidence,[spans[0]]);return supported()}
 });
 assert.equal(c.status,'ready');assert.equal(reviews,1);assert.deepEqual(c.evidenceIds,[canonical]);assert.deepEqual(c.coveredFactKeys,[coveredFactKey(answer().claims[0])]);assert.equal(JSON.stringify(spans),snapshot);
});
test('compact evidence refs reject unknown, canonical injection, duplicate and spoken refs before review',async()=>{
 for(const bad of [wireAnswer('Факт.',['e2']),wireAnswer('Факт.',[spans[0].id]),wireAnswer('Факт.',['e1','e1']),wireAnswer('Факт.',[1]),{...wireAnswer('Факт.',['e1']),segments:[{text:'Факт.',evidenceIds:['e2']}]},wireAnswer('Факт.',['toString']),wireAnswer('Факт e1.',['e1'])]){
  let reviews=0;const c=await generateChapter({place,language:'ru',topic,spans},{complete:async()=>bad,review:async()=>{reviews++;return supported()}});assert.equal(reviews,0);assert.equal(c.status,'failed');
 }
});
const wireAnswer=(text='Дворец построен в XVIII веке.',ids=['e1'],language='ru')=>({language,segments:[{text,evidenceIds:ids}]});
test('chapter uses only topic spans and previous verified claims, and calculates duration',async()=>{
 const chapter=await generateChapter({place,language:'ru',topic,spans,previousChapters:[{status:'ready',text:'PRIVATE FULL CHAPTER',claims:[{text:'Ранее подтверждено.',evidenceIds:[spans[2].id]}]}]}, {complete:async request=>{const payload=JSON.parse(request.messages[1].content);assert.deepEqual(payload.spans.map(s=>s.id),['e1']);assert.ok(!JSON.stringify(request).includes('PRIVATE FULL CHAPTER'));return wireAnswer()},review:supported});
 assert.equal(chapter.status,'ready');assert.equal(chapter.estimatedSeconds,2);assert.deepEqual(chapter.coveredFactKeys,[coveredFactKey(answer().claims[0])]);
});
test('semantic contradiction regenerates once with issues, and repeated rejection fails only chapter',async()=>{
 let calls=0;const c=await generateChapter({place,language:'ru',topic,spans},{complete:async request=>{calls++;if(calls===2)assert.match(JSON.stringify(request),/contradiction/);return wireAnswer()},review:async()=>({outcome:'rejected',issues:[{claimIndex:0,reason:'contradiction'}]})});
 assert.equal(calls,2);assert.equal(c.status,'failed');assert.equal(c.error.code,'verification_failed');
});
test('exact duplicate claims require regeneration instead of repeat-filled audio',async()=>{
 let calls=0;const c=await generateChapter({place,language:'ru',topic,spans,previousChapters:[{status:'ready',claims:answer().claims,coveredFactKeys:[coveredFactKey(answer().claims[0])]}]},{complete:async()=>{calls++;return wireAnswer()},review:()=>assert.fail('duplicate before review')});
 assert.equal(calls,2);assert.equal(c.status,'insufficient');
});
test('reviewer rejects a semantic paraphrase and regeneration uses a different supported fact',async()=>{
 let generations=0,reviews=0;
 const c=await generateChapter({place,language:'ru',topic,spans,previousChapters:[{status:'ready',claims:answer().claims}]},{complete:async request=>{generations++;if(generations===2)assert.match(JSON.stringify(request),/duplicate_claim/);return wireAnswer(generations===1?'Дворец возведён в восемнадцатом столетии.':'Кусково — музей.')},review:async value=>{reviews++;assert.deepEqual(value.previousClaims,answer().claims);return reviews===1?{outcome:'rejected',issues:[{claimIndex:0,reason:'duplicate_claim'}]}:supported()}});
 assert.equal(c.status,'ready');assert.equal(generations,2);assert.equal(reviews,2);assert.equal(c.text,'Кусково — музей.');
});
test('invalid structured output, language, segment bounds and spoken service IDs never become ready',async()=>{
 for(const bad of [{...wireAnswer(),language:'en'},wireAnswer('English prose with a wrong declared language.'),wireAnswer('Ф'.repeat(6001)),wireAnswer('Факт',['unknown']),{language:'ru',segments:[]},{...wireAnswer(),extra:'unknown'},wireAnswer('Дворец '+spans[0].id)]){
 const c=await generateChapter({place,language:'ru',topic,spans},{complete:async()=>bad,review:()=>assert.fail('invalid before review')});assert.equal(c.status,'failed');
 }
});
test('foreign source is retained in original language while generated chapter is Russian',async()=>{
 const foreign=spans.map(s=>({...s,language:'fr',text:'Le palais date du XVIIIe siècle.'}));
 const c=await generateChapter({place,language:'ru',topic,spans:foreign},{complete:async request=>{assert.match(JSON.stringify(request),/Le palais/);return wireAnswer()},review:async(chapter,input)=>{assert.equal(input[0].language,'fr');return supported()}});assert.equal(c.status,'ready');
});
test('missing place evidence is insufficient without paid work; deadline abort stops work',async()=>{
 const c=await generateChapter({place,language:'ru',topic,spans:[]},{complete:()=>assert.fail()});assert.equal(c.status,'insufficient');assert.equal(c.error.code,'insufficient_evidence');
 const stopped=await generateChapter({place,language:'ru',topic,spans},{complete:()=>assert.fail(),signal:AbortSignal.abort()});assert.equal(stopped.error.code,'provider_timeout');
});
function fixture(overrides={}){
 const db=new DatabaseSync(':memory:'),store=createTourStore({db}),jobs=createTourJobs({store});let calls=0;
 const service=createTours({store,jobs,research:async()=>({documents:docs,spans,fingerprint:'fixture'}),resolvePlace:async()=>place,complete:async request=>{calls++;return request.schema.name==='tour_plan'?{topics:spans.map((s,i)=>({title:['История','Парк','Коллекции'][i],summary:'Тема экскурсии.',evidenceIds:[s.id],status:'available',reason:null}))}:wireAnswer()},review:supported,consume:async()=>{},...overrides});
 return {db,store,jobs,service,calls:()=>calls,async close(){await jobs.shutdown();db.close()}};
}
test('service exposes plan before overview; only overview starts automatically after plan releases slot',async()=>{
 let finish;const hold=new Promise(resolve=>{finish=resolve});const f=fixture({complete:async request=>request.schema.name==='tour_plan'?{topics:spans.map((s,i)=>({title:['История','Парк','Коллекции'][i],summary:'Тема экскурсии.',evidenceIds:[s.id],status:'available',reason:null}))}:hold});
 try {const start=await f.service.start('owner',{placeId:place.id,language:'ru'});await f.jobs.drain();await new Promise(resolve=>setImmediate(resolve));const tour=f.service.get('owner',start.tourId);assert.equal(tour.status,'ready');assert.equal(tour.topics.length,3);assert.equal(tour.chapters.length,4);assert.equal(tour.chapters[0].topicId,'overview');assert.equal(tour.chapters[0].status,'generating');assert.ok(tour.chapters.slice(1).every(c=>c.status==='planned'));assert.equal(f.service.get('other',start.tourId),null);finish(wireAnswer());await f.jobs.drain();const cached=await f.service.chapter('owner',start.tourId,'overview');assert.equal(cached.status,200);
 }finally{finish(wireAnswer());await f.close()}
});
test('ready chapter and existing plan cache hits cost zero model calls',async()=>{
 const f=fixture();try{const start=await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();await new Promise(resolve=>setImmediate(resolve));await f.jobs.drain();const n=f.calls();assert.equal((await f.service.chapter('a',start.tourId,'overview')).status,200);assert.equal((await f.service.start('a',{placeId:place.id,language:'ru'})).status,200);assert.equal(f.calls(),n)}finally{await f.close()}
});
test('model adapter verifies finish reason and stops auth failures without retries',async()=>{
 for(const status of [401,403,429]){
 let calls=0;const model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async()=>{calls++;return new Response('',{status})}});
 const c=await generateChapter({place,language:'ru',topic,spans},{complete:model.complete,review:model.review});assert.equal(calls,1);assert.equal(c.error.code,status===429?'budget_exhausted':'auth_required');
 }
 const model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async()=>Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(wireAnswer())}}]})});await assert.rejects(model.complete({messages:[],schema:{name:'chapter',schema:{}},maxTokens:4500}),{code:'provider_error'});
});
test('service owns a shared five-call budget including technical reviewer repair and regeneration',async()=>{
 let posts=0,charges=0;const responses=[{topics:[{title:'История',summary:'История дворца.',evidenceIds:[spans[0].id],status:'available',reason:null}]},wireAnswer(),null,{supported:false,issues:[{claimIndex:0,reason:'contradiction'}]},wireAnswer(),{supported:true,issues:[]}];
 const model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async()=>{posts++;const next=responses.shift();return Response.json({choices:[{finish_reason:next===null?'length':'stop',message:{content:JSON.stringify(next)}}]})}});
 const f=fixture({...model,consume:async()=>{charges++}});try{await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();await new Promise(resolve=>setImmediate(resolve));await f.jobs.drain();assert.equal(posts,6);assert.equal(charges,6);const tour=f.store.findActive('a',place.id,'ru');assert.equal(tour.chapters[0].status,'ready')}finally{await f.close()}
});
test('zero-TTL policy fails planning before any model call',async()=>{
 registerSourcePolicy('tour-no-retention',{allowModelInput:true,allowTextCache:false,ttlMs:0});const blocked=docs.map(d=>({...d,license:licenseFor('tour-no-retention','')}));const f=fixture({research:async()=>({documents:blocked,spans,fingerprint:'blocked'})});try{const start=await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();assert.equal(f.calls(),0);assert.equal(f.service.get('a',start.tourId).error.code,'source_unavailable')}finally{await f.close()}
});
test('Kuskovo prepares overview and three distinct verified themes sequentially',async()=>{
 const outputs=['Кусково — музей.','Дворец построен в XVIII веке.','Парк украшен прудами.','В музее хранится керамика.'];let charges=0;
 const f=fixture({consume:async()=>{charges++},complete:async request=>{
  if(request.schema.name==='tour_plan')return {topics:spans.map((s,i)=>({title:['История','Парк','Коллекции'][i],summary:'Тема экскурсии.',evidenceIds:[s.id],status:'available',reason:null}))};
  const payload=JSON.parse(request.messages[1].content),index=payload.topic.id==='overview'?0:spans.findIndex(s=>s.text===payload.spans[0].text)+1;
  return wireAnswer(outputs[index],payload.topic.evidenceIds.slice(0,1));
 }});
 try{const start=await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();await new Promise(resolve=>setImmediate(resolve));await f.jobs.drain();let tour=f.service.get('a',start.tourId);for(const t of tour.topics){await f.service.chapter('a',tour.id,t.id);await f.jobs.drain()}tour=f.service.get('a',tour.id);assert.ok(tour.chapters.every(c=>c.status==='ready'));assert.equal(new Set(tour.chapters.map(c=>c.text)).size,4);assert.equal(charges,5)}finally{await f.close()}
});
test('second technical repair is denied at shared call five before another upstream POST',async()=>{
 let posts=0,charges=0;const results=[{topics:[]},wireAnswer(),null,{supported:false,issues:[{claimIndex:0,reason:'contradiction'}]},wireAnswer(),null];
 const model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async()=>{posts++;const r=results.shift();return Response.json({choices:[{finish_reason:r===null?'length':'stop',message:{content:JSON.stringify(r)}}]})}});
 const f=fixture({...model,consume:async()=>{charges++}});try{const start=await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();await new Promise(resolve=>setImmediate(resolve));await f.jobs.drain();assert.equal(posts,6);assert.equal(charges,6);assert.equal(f.service.get('a',start.tourId).chapters[0].error.code,'budget_exhausted')}finally{await f.close()}
});
test('review upstream authorization errors retain auth_required and never regenerate',async()=>{
 for(const status of [401,403]){let posts=0;const model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async()=>{posts++;return posts===1?Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(wireAnswer())}}]}):new Response('',{status})}});const c=await generateChapter({place,language:'ru',topic,spans},{complete:model.complete,review:model.review});assert.equal(posts,2);assert.equal(c.error.code,'auth_required');}
});
test('quota denial prevents paid POST and deadline exhaustion prevents review',async()=>{
 let posts=0;const f=fixture({consume:async()=>false,complete:()=>{posts++;assert.fail('denied quota')}});try{const start=await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();assert.equal(posts,0);assert.equal(f.service.get('a',start.tourId).error.code,'budget_exhausted')}finally{await f.close()}
 let tick=1;const c=await generateChapter({place,language:'ru',topic,spans},{now:()=>tick,deadline:10,complete:async()=>{tick=11;return wireAnswer()},review:()=>assert.fail('deadline exhausted')});assert.equal(c.error.code,'provider_timeout');
});
test('busy start does not leave a reusable planning tour without a job',async()=>{
 let finish;const f=fixture({research:()=>new Promise(resolve=>{finish=()=>resolve({documents:docs,spans,fingerprint:'fixture'})})});
 try{await f.service.start('a',{placeId:place.id,language:'ru'});await Promise.resolve();await assert.rejects(f.service.start('a',{placeId:'wd:Q1',language:'ru'}),{status:404});
 // A second distinct resolved place is rejected by the user job cap.
 const second=createTours({store:f.store,jobs:f.jobs,research:async()=>({documents:docs,spans,fingerprint:'fixture'}),resolvePlace:async id=>({...place,id}),complete:()=>assert.fail(),review:supported,consume:async()=>{}});
 await assert.rejects(second.start('a',{placeId:'wd:Q2',language:'ru'}),{code:'busy'});assert.equal(f.store.findActive('a','wd:Q2','ru'),null);
 }finally{finish?.();await f.close()}
});
test('snapshot loss across restart with changed sources refuses old evidence before model calls',async()=>{
 registerSourcePolicy('tour-volatile-snapshot',{allowModelInput:true,allowTextCache:false,allowOutputCache:true,ttlMs:604800000});const documents=docs.map(d=>({...d,license:licenseFor('tour-volatile-snapshot','owner')}));
 const f=fixture({research:async()=>({documents,spans:buildEvidenceSpans(documents),fingerprint:'original'})});try{const start=await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();await new Promise(resolve=>setImmediate(resolve));await f.jobs.drain();const store=createTourStore({db:f.db}),jobs=createTourJobs({store});let calls=0;const service=createTours({store,jobs,resolvePlace:async()=>place,research:async()=>({documents,spans,fingerprint:'changed'}),complete:()=>{calls++;assert.fail()},review:supported,consume:async()=>{}});const tour=service.get('a',start.tourId);await service.chapter('a',tour.id,tour.topics[0].id);await jobs.drain();assert.equal(calls,0);assert.equal(service.get('a',tour.id).chapters[1].error.code,'source_unavailable');const fresh=await service.start('a',{placeId:place.id,language:'ru'});assert.equal(fresh.status,202);assert.notEqual(fresh.tourId,tour.id);await jobs.shutdown()}finally{await f.close()}
});
test('unusable volatile topics allow a fresh explicitly requested tour after restart',async()=>{
 registerSourcePolicy('tour-volatile-output',{allowModelInput:true,allowTextCache:false,allowOutputCache:false,ttlMs:604800000});const documents=docs.map(d=>({...d,license:licenseFor('tour-volatile-output','owner')}));const f=fixture({research:async()=>({documents,spans,fingerprint:'original'})});
 try{const initial=await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();await new Promise(resolve=>setImmediate(resolve));await f.jobs.drain();const store=createTourStore({db:f.db}),jobs=createTourJobs({store});let calls=0;const service=createTours({store,jobs,resolvePlace:async()=>place,research:async()=>({documents,spans,fingerprint:'original'}),complete:async()=>{calls++;return {topics:[]}},review:supported,consume:async()=>{}});const next=await service.start('a',{placeId:place.id,language:'ru'});assert.notEqual(next.tourId,initial.tourId);assert.equal(next.status,202);assert.equal(store.get('a',initial.tourId).status,'failed');await jobs.shutdown();assert.equal(calls,0)}finally{await f.close()}
});
test('reservation rejected by byte cap leaves no orphan cached planning record',async()=>{
 const db=new DatabaseSync(':memory:'),store=createTourStore({db,maxStorageBytes:500}),jobs=createTourJobs({store});const service=createTours({store,jobs,resolvePlace:async()=>place,research:()=>assert.fail(),complete:()=>assert.fail(),consume:async()=>{}});
 try{for(let i=0;i<2;i++){await assert.rejects(service.start('a',{placeId:place.id,language:'ru'}),{code:'busy'});assert.equal(store.findActive('a',place.id,'ru'),null);assert.equal(store.stats().tours,0)}}finally{await jobs.shutdown();db.close()}
});
test('source invalidation stays within an exactly full logical byte cap',()=>{
 const db=new DatabaseSync(':memory:');try{const store=createTourStore({db});const tour=store.create('a',{placeId:place.id,language:'ru',status:'ready'});const cap=store.stats().bytes;const capped=createTourStore({db,maxStorageBytes:cap});capped.invalidate('a',tour.id);assert.ok(capped.stats().bytes<=cap);assert.equal(capped.get('a',tour.id).status,'failed')}finally{db.close()}
});
test('scheduled overview is safe after shutdown closes the database',async()=>{
 const f=fixture();await f.service.start('a',{placeId:place.id,language:'ru'});await f.jobs.drain();await f.close();await new Promise(resolve=>setImmediate(resolve));
});
test('tour collector enriches wiki-only place with official identity and preserves tour profile',async()=>{
 const wikiPlace={...place,refs:[{provider:'wikipedia',language:'ru',pageId:173387}]};let requests=0;
 const collect=createTourCollector({collect:async(p,o)=>{assert.equal(o.profile,'tour');return {place:p,documents:[{...docs[0],id:'wikipedia:ru:173387'}]}},request:async()=>{requests++;return {parse:{wikitext:{'*':'{{Официальный сайт|https://kuskovo.ru/}}'}}}}});
 const bundle=await collect(wikiPlace,{profile:'tour'});assert.equal(requests,1);assert.equal(bundle.documents[0].website,'https://kuskovo.ru/');assert.equal(bundle.documents[0].officialWebsite,true);
});

test('JSON provider wire compact refs reach whole chapter review as canonical hashes',async()=>{
 const bodies=[],model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async(_url,options)=>{
  const body=JSON.parse(options.body);bodies.push(body);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(body.response_format.json_schema.name==='tour_chapter'?wireAnswer('Дворец построен в XVIII веке.',['e1']):{supported:true,issues:[]})}}]});
 }});
 const c=await generateChapter({place,language:'ru',topic,spans},{complete:model.complete,review:model.review});
 assert.equal(c.status,'ready');assert.equal(bodies.length,2);
 assert.deepEqual(bodies[0].response_format.json_schema.schema.properties.segments.items.properties.evidenceIds.items.enum,['e1']);
 const reviewed=JSON.parse(bodies[1].messages[1].content);
 assert.deepEqual(reviewed.chapter.claims,answer().claims);assert.deepEqual(reviewed.spans,[spans[0]]);assert.equal(reviewed.chapter.text,c.text);
 assert.match(bodies[1].messages[0].content,/entire chapter/);
});

test('local refs are scoped to selected spans and ordinary Type1 and E1 prose remains valid',async()=>{
 for(const text of ['The Type1 museum is open.','The E1 route reaches the museum.']){
 const c=await generateChapter({place,language:'en',topic:{...topic,evidenceIds:[spans[1].id]},spans},{complete:async()=>wireAnswer(text,['e1'],'en'),review:supported});
 assert.equal(c.status,'ready');assert.deepEqual(c.evidenceIds,[spans[1].id]);
 }
});
