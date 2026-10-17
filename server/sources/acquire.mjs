import {observe,requestId} from '../request-context.mjs';
import {sourcePolicy,POLICY_VERSION} from './policies.mjs';
import {GuideError} from '../guide.mjs';
import {randomUUID} from 'node:crypto';
import {sourceBundle} from './collect.mjs';
import {modelDocuments} from './evidence.mjs';
import {buildPlaceContext} from './place-context.mjs';
import {matchCandidate} from './match.mjs';
import {extractEvidence} from './extract.mjs';
function wait(promise,signal){if(!signal)return promise;signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))})}
export function evidenceOutcome(bundle){const docs=modelDocuments(bundle);if(docs.length)return docs.every(d=>d.scope==='area')?'context_only':bundle.statuses.some(s=>s.status==='unavailable'||s.status==='partial')?'limited':'ready';const reasons=bundle.statuses.map(s=>s.reason);if(reasons.includes('budget_exhausted'))return 'budget_exhausted';if(bundle.statuses.some(s=>s.status==='unavailable'&&!['osm','wikidata'].includes(s.provider)))return 'temporarily_unavailable';if(reasons.includes('policy_restricted'))return 'policy_restricted';if(reasons.includes('not_configured'))return 'not_configured';return 'no_material'}
export function createAcquisition({collect,search,officialDiscovery,officialIdentity,db,now=Date.now,report=()=>{}}={}){
 const flight=new Map(),cache=new Map();let minute=now(),calls=0,active=0;
 db?.exec('CREATE TABLE IF NOT EXISTS acquisition_cache(cache_key TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL,retain_until INTEGER NOT NULL)');
 const permitted=value=>value?.bundle?.documents.every(d=>sourcePolicy(d.license?.policyId).allowTextCache);
 return async function acquireEvidence(place,{language='ru',signal,refresh=false}={}){
  const requested=now();const finish=value=>{observe('stage',{stage:'acquisition',outcome:value.outcome,durationMs:now()-requested,diagnosticId:value.diagnosticId});return value};
  signal?.throwIfAborted();const key=JSON.stringify([place.id,place.refs,language,3,POLICY_VERSION,!!search?.enabled,!!officialDiscovery]);let hit=cache.get(key);
  if(!hit&&db){const row=db.prepare('SELECT * FROM acquisition_cache WHERE cache_key=? AND retain_until>?').get(key,now());if(row){const value=JSON.parse(row.data);if(permitted(value))hit={value,expires:row.expires,retainUntil:row.retain_until}}}
  if(!refresh&&hit&&hit.expires>now()&&(!modelDocuments(hit.value.bundle).length||permitted(hit.value))){observe('cache',{cache:'acquisition',result:'hit'});return finish(structuredClone(hit.value));}
  observe('cache',{cache:'acquisition',result:flight.has(key)?'shared':'miss'});
  if(!flight.has(key)){
   if(now()-minute>=60000){minute=now();calls=0}if(calls>=60||active>=4)throw new GuideError(429,'Поиск сейчас занят. Повторите через минуту.');calls++;active++;
   const work=(async()=>{const diagnosticId=randomUUID(),started=now(),deadline=AbortSignal.timeout(20000);
    let bundle;try{bundle=await wait(collect(place,{language,signal:deadline,includeWeb:true,collectionTimeoutMs:3000,hydrationTimeoutMs:1000}),deadline)}catch(error){bundle=sourceBundle(place,[],[{provider:'collection',status:'unavailable',reason:['TimeoutError','AbortError'].includes(error.name)?'timeout':'upstream_error'}])}
    let officialLinks=[],searchLinks=[],officialStatus='empty';
    if(officialDiscovery){
     try{
      if(officialIdentity)bundle=await wait(officialIdentity(bundle,{signal:deadline}),deadline);
      const found=await wait(officialDiscovery(bundle,{signal:deadline,language}),deadline);
      officialLinks=found.links||[];officialStatus=found.statuses?.some(s=>s.status==='unavailable')?'unavailable':officialLinks.length?'ok':'empty';
      bundle={...bundle,statuses:[...bundle.statuses,...(found.statuses||[])]};
     }catch{officialStatus='unavailable';bundle={...bundle,statuses:[...bundle.statuses,{provider:'official-web',status:'unavailable',reason:'upstream_error'}]}}
    }
    const usefulOfficial=officialLinks.some(link=>['guide','audio','exhibition'].includes(link.kind));
    let webStatus='not_needed';
    if(!modelDocuments(bundle).some(d=>d.scope==='place')||!usefulOfficial&&!!officialDiscovery){
     const statuses=[...bundle.statuses];
     if(!search?.enabled){webStatus='not_configured';statuses.push({provider:'global-web',status:'disabled',reason:'not_configured'});}
     else try{const context=buildPlaceContext(bundle.place,bundle.documents);const result=await wait(search.searchCandidates(context,{signal:deadline}),deadline);statuses.push(...result.outcomes);const lastSuccess=result.outcomes.findLastIndex(s=>['ok','empty'].includes(s.status));const laterFailures=result.outcomes.slice(lastSuccess+1).filter(s=>['partial','unavailable','budget-exhausted'].includes(s.status));webStatus=lastSuccess>=0&&!laterFailures.length?'ok':laterFailures.some(s=>s.reason==='budget_exhausted')?'budget_exhausted':'unavailable';const documents=[];let restricted=false;
      for(const candidate of result.candidates){const match=matchCandidate(context,candidate);observe('candidate',{decision:match.decision});if(match.decision!=='verified')continue;searchLinks.push({url:candidate.url,title:candidate.title||candidate.url});const doc=extractEvidence(candidate,{placeId:place.id,now});if(doc)documents.push(doc);else restricted=true;if(documents.length===3)break}
      observe('documents',{count:documents.length});
      if(restricted&&!documents.length)statuses.push({provider:'global-web',status:'empty',reason:'policy_restricted'});
      bundle=sourceBundle(bundle.place,[...bundle.documents,...documents],statuses);
     }catch(error){webStatus='unavailable';statuses.push({provider:'global-web',status:'unavailable',reason:['TimeoutError','AbortError'].includes(error.name)?'timeout':'upstream_error'})}
     bundle={...bundle,statuses};
    }
    const discoveryStatus={web:webStatus,official:officialStatus};
    bundle={...bundle,officialLinks,searchLinks,discoveryStatus};
    let outcome=evidenceOutcome(bundle);
    if(outcome==='temporarily_unavailable'&&hit?.retainUntil>now()&&permitted(hit.value)){const historical=modelDocuments(hit.value.bundle).filter(d=>d.kind==='history').map(d=>({...d,stale:true}));if(historical.length){bundle={...sourceBundle(place,[...bundle.documents,...historical],bundle.statuses),officialLinks,searchLinks,discoveryStatus};outcome='limited'}}
    const value={bundle,outcome,diagnosticId,officialLinks,searchLinks,discoveryStatus};
    const texts=modelDocuments(bundle),cacheable=bundle.documents.every(d=>sourcePolicy(d.license?.policyId).allowTextCache);
    const baseTtl=texts.length?(cacheable?Math.min(...bundle.documents.map(d=>sourcePolicy(d.license?.policyId).ttlMs||0),21600000):0):(outcome==='temporarily_unavailable'?30000:900000);
    const ttl=officialDiscovery&&['unavailable','budget_exhausted'].includes(webStatus)?Math.min(baseTtl,30000):baseTtl;
    const retainUntil=now()+(texts.length&&cacheable?Math.min(...bundle.documents.map(d=>sourcePolicy(d.license?.policyId).ttlMs||0)):ttl);
    if(ttl>0&&!bundle.documents.some(d=>d.stale)){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{expires:now()+ttl,retainUntil,value});if(db&&texts.length){db.prepare('INSERT OR REPLACE INTO acquisition_cache VALUES(?,?,?,?)').run(key,JSON.stringify(value),now()+ttl,retainUntil);db.prepare('DELETE FROM acquisition_cache WHERE retain_until<=?').run(now());db.exec('DELETE FROM acquisition_cache WHERE cache_key IN (SELECT cache_key FROM acquisition_cache ORDER BY expires DESC LIMIT -1 OFFSET 100)')}}
    report({event:'waystory_sources',requestId:requestId()||diagnosticId,placeId:place.id,outcome,durationMs:now()-started,statuses:bundle.statuses});return value;
   })().finally(()=>{active--;flight.delete(key)});flight.set(key,work);
  }
  return wait(flight.get(key),signal).then(finish);
 };
}
