import {DatabaseSync} from 'node:sqlite';
import {createPlaceStore} from '../places/store.mjs';
import {createPlaces} from '../places/service.mjs';
import {createSourceHttp} from '../sources/http.mjs';
import {createWikipediaProvider} from '../sources/wikipedia.mjs';
import {createWikidataProvider} from '../sources/wikidata.mjs';
import {createWikivoyageProvider} from '../sources/wikivoyage.mjs';
import {createOsmProvider} from '../sources/osm.mjs';
import {createSearchProvider} from '../sources/search-provider.mjs';
import {configureSearchPolicy} from '../sources/search-policy.mjs';
import {sourcePolicy} from '../sources/policies.mjs';
import {createObservability} from '../observability.mjs';
import {createAuth} from '../auth.mjs';
import {createSpeech} from '../tts.mjs';
import {createTourStore,tourError} from './store.mjs';
import {createTourJobs} from './jobs.mjs';
import {createTourResearch} from './research.mjs';
import {createTours,createTourModel,createTourCollector} from './service.mjs';
import {runTourProbe} from './probe.mjs';

// No arguments, URLs, prompts, model choices or credentials from workflow inputs.
export async function runKuskovoTourProbe({env=process.env,report=()=>{}}={}){
 const started=Date.now(),placeStore=createPlaceStore({dbPath:env.SOURCE_DB_PATH||'data/sources.sqlite'}),auth=createAuth({env});let jobs;
 try{
  // Use an existing allowlisted owner only for normal quota accounting. This
  // diagnostic invokes the service directly; it creates no session or cookies.
  const authDb=new DatabaseSync(env.AUTH_DB_PATH||'data/waystory.sqlite',{readOnly:true});let owner;
  try{const allowed=new Set((env.GOOGLE_ALLOWED_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()));const users=authDb.prepare('SELECT id,email FROM users').all().filter(u=>allowed.has(u.email.toLowerCase()));if(users.length!==1)throw tourError('auth_required',401);owner=users[0].id}finally{authDb.close()}
  const observer=createObservability({env,write:line=>{const entry=JSON.parse(line);if(entry.event==='waystory_tour_job')report(entry)}});
  let modelCalls=0,planCalls=0,chapterCalls=0,inputTokens=0,outputTokens=0,usageMissing=0;const stageCalls={};
  const record=observer.record;observer.record=(event,fields)=>{if(event==='usage'){const u=fields.usage;if(Number.isSafeInteger(u?.prompt_tokens)&&Number.isSafeInteger(u?.completion_tokens)){inputTokens+=u.prompt_tokens;outputTokens+=u.completion_tokens}else usageMissing++}record(event,fields)};
  const fetchModel=observer.wrapFetch(async(url,options)=>{
   if(!String(url).endsWith('/audio/speech')&&!String(url).includes('tts:synthesize')){
    const schema=JSON.parse(options.body).response_format?.json_schema?.name;
    if(schema==='tour_plan'){if(planCalls>=1)throw tourError('budget_exhausted');planCalls++}
    else{if(chapterCalls>=20)throw tourError('budget_exhausted');chapterCalls++}
    if(modelCalls>=21)throw tourError('budget_exhausted');modelCalls++;stageCalls[schema]=(stageCalls[schema]||0)+1;
   }
   return fetch(url,options);
  });
  const endpoint=env.OSM_OVERPASS_ENDPOINT||'https://overpass-api.de/api/interpreter',request=createSourceHttp({fetchFn:observer.wrapFetch(),osmEndpoint:endpoint}),wikidata=createWikidataProvider({request});
  const places=createPlaces({store:placeStore,providers:[createWikipediaProvider({request}),createOsmProvider({request,endpoint}),wikidata,createWikivoyageProvider({request,wikidata})]});
  const policyReady=!!env.GLOBAL_WEB_USE_POLICY_JSON&&configureSearchPolicy(JSON.parse(env.GLOBAL_WEB_USE_POLICY_JSON));
  report({probe:'tour-policy',configured:policyReady,searchSnapshotTTLPositive:sourcePolicy('web-search-reviewed').ttlMs>0});
  const search=createSearchProvider({db:placeStore.db,env:policyReady?env:{...env,TAVILY_API_KEY:''},fetchFn:observer.wrapFetch()});
  const store=createTourStore({db:placeStore.db});jobs=createTourJobs({store});const model=createTourModel({env,fetchFn:fetchModel});
  let researchStats;
  const researchAdapter=createTourResearch({collect:createTourCollector({collect:(p,o)=>places.collect(p,o),request}),search:env.GLOBAL_SOURCE_DISCOVERY_ENABLED==='true'?search:null});
  const service=createTours({store,jobs,research:async(...args)=>{const snapshot=await researchAdapter(...args);researchStats={...snapshot.stats,documents:snapshot.documents.length,sourceLanguages:[...new Set(snapshot.documents.filter(d=>d.text).map(d=>d.language).filter(l=>/^[a-z]{2,3}(?:-[a-z]{2,12})?$/.test(l)))],characters:snapshot.documents.reduce((n,d)=>n+(d.text?.length||0),0),persistable:snapshot.documents.every(d=>!d.text||sourcePolicy(d.license?.policyId).ttlMs>0),statuses:snapshot.statuses.map(s=>({provider:['wikipedia','wikidata','wikivoyage','osm','research','official-web','brave','tavily'].includes(s.provider)?s.provider:'other',status:['ok','empty','unavailable','partial','disabled','skipped','not_configured'].includes(s.status)?s.status:'other',reason:['timeout','upstream_error','policy_restricted','no_match','budget_exhausted','daily_limit','request_limit','unsafe_url','offsite_redirect','response_too_large'].includes(s.reason)?s.reason:null}))};report({probe:'tour-research',...researchStats});return snapshot},complete:model.complete,review:model.review,resolvePlace:async id=>placeStore.getById(id),consume:id=>auth.consume({id},'ai')});
  const speech=createSpeech({env,fetchFn:observer.wrapFetch()});
  let passed=false;
  try{passed=await observer.run(async()=>{
   const resolved=await places.resolve({provider:'wikipedia',language:'ru',pageId:173387},{language:'ru'});if(resolved.place.id!=='wiki:ru:173387')throw tourError('source_unavailable');
   return runTourProbe({service,jobs,ownerId:owner,placeId:resolved.place.id,speech:async value=>{auth.consume({id:owner},'tts');return speech.run(value)},report});
  });return passed}finally{report({probe:'tour-usage',passed,modelCalls,planCalls,chapterCalls,stageCalls,inputTokens,outputTokens,usageMissing,searchCalls:researchStats?.searchCalls??null,pageCalls:researchStats?.pageCalls??null,durationMs:Date.now()-started})}
 }catch(error){report({probe:'tour-error',code:['auth_required','budget_exhausted','provider_timeout','provider_error','source_unavailable'].includes(error?.code)?error.code:'provider_error',status:Number.isInteger(error?.status)?error.status:null});return false}
 finally{await jobs?.shutdown();auth.close();placeStore.close()}
}
