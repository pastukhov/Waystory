import {tourStage} from './telemetry.mjs';
import {aiProvider} from '../ai-provider.mjs';
import {reviewChapter} from '../sources/facts.mjs';
import {sourcePolicy} from '../sources/policies.mjs';
import {buildEvidenceSpans} from '../sources/spans.mjs';
import {citationMetadata} from '../sources/evidence.mjs';
import {addOfficialIdentity} from '../sources/official-identity.mjs';
import {observe} from '../request-context.mjs';
import {TOUR_LIMITS as LIMITS} from './config.mjs';
import {tourError,publicJobError} from './store.mjs';
import {planTour} from './planner.mjs';
import {generateChapter} from './generator.mjs';

function upstreamError(error){
 if(error?.code)return error;
 return tourError(error?.status===401||error?.status===403?'auth_required':error?.status===429?'budget_exhausted':error?.name==='TimeoutError'||error?.name==='AbortError'?'provider_timeout':'provider_error',error?.status||502);
}
export function createTourCollector({collect,request}){
 return async(place,options)=>addOfficialIdentity(await collect(place,options),{request,signal:options?.signal});
}
// Uses the same configured provider, credentials and models as the guide.
export function createTourModel({env=process.env,fetchFn=fetch}={}){
 const config=aiProvider(env);
 return {enabled:config.enabled,provider:config.provider,
  async complete({messages,schema,maxTokens,signal}){
   if(!config.enabled)throw tourError('provider_error',503);
   signal?.throwIfAborted();
   const detail=(reason,result,status)=>observe('tour_model_detail',{schema:schema?.name,reason,status,finishReason:result?.choices?.[0]?.finish_reason,tokenCounts:{prompt:result?.usage?.prompt_tokens,completion:result?.usage?.completion_tokens,total:result?.usage?.total_tokens}});
   let response;try{response=await fetchFn(config.endpoint,{method:'POST',redirect:'error',headers:config.headers,signal,body:JSON.stringify({model:config.models.story,temperature:0.3,stream:false,max_tokens:maxTokens,messages,response_format:{type:'json_schema',json_schema:{...schema,strict:true}}})})}catch(error){detail('provider_error');throw upstreamError(error)}
   if(!response.ok){detail('provider_error',null,response.status);throw upstreamError({status:response.status});}
   let result;try{result=await response.json()}catch(error){detail('invalid_json');throw upstreamError(error)}
   observe('usage',{operation:'story',usage:result?.usage});
   if(result?.choices?.[0]?.finish_reason!=='stop'){detail('incomplete_response',result);throw tourError('provider_error',502);}
   let parsed;try{parsed=JSON.parse(result.choices[0].message.content)}catch(error){detail('invalid_json',result);throw upstreamError(error)}
   detail('success',result);return parsed;
  },
  review:(chapter,spans,options)=>reviewChapter(chapter,spans,{fetchFn,headers:config.headers,model:config.reviewModel||config.models.story,endpoint:config.endpoint,...options})
 };
}
const blank=topicId=>({id:topicId,topicId,status:'planned',text:null,evidenceIds:[],claims:[],coveredFactKeys:[],estimatedSeconds:0,error:null});
function validateSnapshot(snapshot){
 if(!Array.isArray(snapshot?.documents))throw tourError('source_unavailable');
 for(const doc of snapshot.documents)if(doc.text){const p=sourcePolicy(doc.license?.policyId);if(!p.allowModelInput||p.ttlMs===0)throw tourError('source_unavailable');}
}
export function createTours({store,jobs,research,complete,review,resolvePlace,consume,now=Date.now}={}){
 const requireTour=(owner,id)=>{const tour=store.get(owner,id);if(!tour)throw tourError('invalid_request',404);return tour;};
 const quota=async owner=>{try{if(await consume(owner)===false)throw tourError('budget_exhausted',429)}catch(error){throw upstreamError(error)}};
 const getSnapshot=async(owner,tour,place,signal)=>{
  let snapshot;
  try{snapshot=store.getSnapshot(owner,tour.id,{fingerprint:tour.sourceFingerprint})}catch(error){if(error.code!=='source_unavailable')throw error;}
  if(!snapshot){
   try{const reloaded=await research(place,{language:tour.language,signal});validateSnapshot(reloaded);snapshot=store.getSnapshot(owner,tour.id,{snapshot:reloaded,fingerprint:reloaded.fingerprint});}
   catch(error){if(error.code==='source_unavailable')store.invalidate(owner,tour.id);throw error;}
  }
  validateSnapshot(snapshot);return snapshot;
 };
 const service={
  async start(ownerId,{placeId,language}={},{fresh=false}={}){
   if(!ownerId||typeof placeId!=='string'||!/^(wiki:[a-z]{2,3}(?:-[a-z]{2,12})?:[1-9]\d*|wd:Q[1-9]\d*|osm:(node|way|relation):[1-9]\d*)$/.test(placeId)||placeId.length>300||!['ru','en'].includes(language))throw tourError('invalid_request',400);
   let existing=fresh?null:store.findActive(ownerId,placeId,language);
   if(existing?.status==='ready'&&existing.volatile){
    try{if(existing.topics.some(t=>!t.title)||!store.getSnapshot(ownerId,existing.id,{fingerprint:existing.sourceFingerprint}))throw tourError('source_unavailable');}
    catch(error){if(error.code!=='source_unavailable')throw error;store.invalidate(ownerId,existing.id);existing=null;}
   }
   if(existing)return {status:existing.status==='ready'?200:202,tourId:existing.id,tour:existing};
   const place=await resolvePlace(placeId,{language});if(!place||place.id!==placeId)throw tourError('invalid_request',404);
   // Resolve may await: deduplicate again before reserving a plan job.
   const concurrent=fresh?null:store.findActive(ownerId,placeId,language);if(concurrent)return {status:concurrent.status==='ready'?200:202,tourId:concurrent.id,tour:concurrent};
   const tour=store.create(ownerId,{placeId,language});
   try{jobs.start({ownerId,tourId:tour.id,topicId:'plan',run:async({signal})=>{
    const fields={tourId:tour.id,chapterId:'plan'},snapshot=await tourStage('research',fields,async()=>{const value=await research(place,{language,signal});validateSnapshot(value);return value},{now});
    const spans=buildEvidenceSpans(snapshot.documents),topics=await tourStage('plan',fields,()=>planTour({place,language,spans},{signal,complete:async request=>{signal.throwIfAborted();await quota(ownerId);signal.throwIfAborted();return complete(request)}}),{now});
    // A macrotask runs only after jobs has persisted the plan and released its
    // slot. Busy leaves overview planned; an explicit POST can prepare it.
    setImmediate(()=>{try{if(store.get(ownerId,tour.id)?.status==='ready')service.chapter(ownerId,tour.id,'overview').catch(()=>{});}catch{ /* The service/database may have shut down after plan completion. */ }});
    return {topics,chapters:[blank('overview'),...topics.map(t=>blank(t.id))],snapshot,sourceFingerprint:snapshot.fingerprint,sources:citationMetadata(snapshot),officialLinks:snapshot.links||[],outputLicense:snapshot.documents.some(d=>sourcePolicy(d.license?.policyId).outputLicense==='CC-BY-SA-4.0')?'CC-BY-SA-4.0':null};
   }});}catch(error){
    // A rejected reservation must not masquerade as a reusable live plan.
    store.discardUnclaimed(ownerId,tour.id);
    throw error;
   }
   return {status:202,tourId:tour.id,tour:store.get(ownerId,tour.id)};
  },
  get(owner,id){const tour=store.get(owner,id);if(tour?.volatile&&tour.topics.some(t=>!t.title)){store.invalidate(owner,id);return {...tour,status:'failed',error:publicJobError(tourError('source_unavailable'))};}return tour;},
  async chapter(ownerId,id,topicId,{retry=false}={}){
   const tour=requireTour(ownerId,id),chapter=tour.chapters.find(c=>c.topicId===topicId);
   if(tour.status!=='ready'||!chapter)throw tourError('invalid_request',404);
   if(retry&&!(chapter.status==='failed'&&chapter.error?.retryable===true))throw tourError('invalid_request',409);
   if(!retry&&chapter.status==='ready')return {status:200,chapter};
   if(!retry&&['failed','insufficient'].includes(chapter.status))throw tourError('invalid_request',409);
   if(tour.volatile&&tour.topics.some(t=>!t.title))throw tourError('source_unavailable');
   const topic=topicId==='overview'?{id:'overview',title:tour.language==='ru'?'Обзор':'Overview',evidenceIds:[]}:tour.topics.find(t=>t.id===topicId);
   if(!topic)throw tourError('source_unavailable');
   const result=jobs.start({ownerId,tourId:id,topicId,retry,run:async({signal})=>{
    const deadline=now()+LIMITS.chapterTimeoutMs,place=await resolvePlace(tour.placeId,{language:tour.language,signal});if(!place||place.id!==tour.placeId)throw tourError('source_unavailable');
    const snapshot=await getSnapshot(ownerId,tour,place,signal),spans=buildEvidenceSpans(snapshot.documents);
    const selectedTopic=topicId==='overview'?{...topic,evidenceIds:spans.map(s=>s.id)}:topic;let calls=0;
    const consumeCall=async()=>{signal.throwIfAborted();if(now()>=deadline)throw tourError('provider_timeout');if(calls>=LIMITS.maxChapterCalls)throw tourError('budget_exhausted',429);calls++;await quota(ownerId);signal.throwIfAborted();if(now()>=deadline)throw tourError('provider_timeout');};
    return tourStage('generate',{tourId:id,chapterId:topicId},()=>generateChapter({place,language:tour.language,topic:selectedTopic,spans,previousChapters:store.get(ownerId,id).chapters.filter(c=>c.topicId!==topicId)},{signal,deadline,now,onDetails:detail=>observe('tour_generation_detail',{tourId:id,chapterId:topicId,stage:'generate',outcome:'rejected',...detail}),complete:async request=>{await consumeCall();return complete(request)},review:(value,evidence,options)=>tourStage('review',{tourId:id,chapterId:topicId},()=>review(value,evidence,{...options,consumeCall}),{now})}),{now});
   }});
   return {status:202,accepted:result.accepted,chapter:store.get(ownerId,id).chapters.find(c=>c.topicId===topicId)};
  },
  progress:(owner,id,value)=>{requireTour(owner,id);return store.saveProgress(owner,id,value);}
 };
 return service;
}
