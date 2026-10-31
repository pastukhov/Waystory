import {createHash} from 'node:crypto';
import {TOUR_LIMITS as LIMITS} from './config.mjs';
import {sourceBundle} from '../sources/collect.mjs';
import {buildEvidenceSpans} from '../sources/spans.mjs';
import {sourcePolicy} from '../sources/policies.mjs';
import {buildPlaceContext} from '../sources/place-context.mjs';
import {matchCandidate} from '../sources/match.mjs';
import {createOfficialPageLoader,validateOfficialUrl} from '../sources/official-discovery.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const site=value=>new URL(value).hostname.replace(/^www\./,'');
function canonical(value){const url=validateOfficialUrl(value);url.hostname=url.hostname.replace(/^www\./,'');url.searchParams.sort();return url.href}
function wait(work,signal){signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))})}
const lower=(n,max)=>Number.isSafeInteger(n)&&n>=0?Math.min(n,max):max;
// Enough distinct saved material to plan themes without paying for more search.
const sufficient=docs=>{const texts=docs.filter(d=>d.scope==='place'&&d.kind!=='identity'&&d.text);return texts.length>=3&&texts.reduce((n,d)=>n+d.text.length,0)>=12000};
export function createTourResearch({collect,search,loadPage=createOfficialPageLoader(),now=Date.now}={}) {
 return async function research(place,{language='ru',signal,budget={}}={}) {
  signal?.throwIfAborted();
  const controller=new AbortController(),timeoutMs=lower(budget.timeoutMs,LIMITS.researchTimeoutMs),deadline=now()+timeoutMs;
  const timer=setTimeout(()=>controller.abort(Object.assign(Error('Research timeout'),{name:'TimeoutError'})),Math.max(1,timeoutMs));
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let documents=[],statuses=[],context;const links=new Map(),urls=new Set(),hashes=new Set(),queue=[],seen=new Set(),domainCalls=new Map();
  let searchCalls=0,pageCalls=0;
  const maxSearch=lower(budget.maxSearchCalls,LIMITS.maxSearchCalls),maxPages=lower(budget.maxPages,LIMITS.maxPages),maxDomain=lower(budget.maxPagesPerDomain,LIMITS.maxPagesPerDomain);
  const live=()=>{combined.throwIfAborted();if(now()>=deadline)throw Object.assign(Error('Research timeout'),{name:'TimeoutError'})};
  const add=doc=>{
   if(!doc||!['place','area'].includes(doc.scope)||typeof doc.id!=='string'||typeof doc.title!=='string')return;
   let key;try{key=canonical(doc.url)}catch{return}
   const text=sourcePolicy(doc.license?.policyId).allowModelInput?String(doc.text||''):'';
   const digest=text?hash(text):null;if(urls.has(key)||digest&&hashes.has(digest))return;
   urls.add(key);if(digest)hashes.add(digest);documents.push({...doc,text});
  };
  const link=item=>{try{const key=canonical(item.url);if(!links.has(key))links.set(key,{url:validateOfficialUrl(item.url).href,title:String(item.title||'').slice(0,300),kind:item.kind||'page'})}catch{}};
  const enqueue=(url,depth,root,verified=false,identitySignals={})=>{try{url=validateOfficialUrl(url).href;if(!seen.has(canonical(url))&&!queue.some(q=>canonical(q.url)===canonical(url)))queue.push({url,depth,root,verified,identitySignals})}catch{}};
  const drain=async()=>{
   while(queue.length&&pageCalls<maxPages&&!sufficient(documents)){
    live();const item=queue.shift(),host=site(item.url),key=canonical(item.url);if(seen.has(key)||(domainCalls.get(host)||0)>=maxDomain)continue;seen.add(key);
    let spent=0;
    const consume=()=>{live();if(pageCalls>=maxPages||(domainCalls.get(host)||0)>=maxDomain)throw Object.assign(Error('Page limit'),{reason:'request_limit'});spent++;pageCalls++;domainCalls.set(host,(domainCalls.get(host)||0)+1)};
    try{
     const page=await wait(()=>loadPage(item.url,{signal:combined,onRequest:consume,language}),combined);
     // Injected loaders are trusted transports. Production counts every redirect.
     if(!spent)consume();
     const doc=page.document,final=validateOfficialUrl(doc?.url||page.url||item.url).href;
     if(site(final)!==host)throw Object.assign(Error('Redirect changed site'),{reason:'offsite_redirect'});
     const candidate={url:final,title:doc?.title||page.candidate?.title||'',snippet:page.candidate?.snippet||doc?.text||'',identitySignals:{...item.identitySignals,...doc?.identitySignals}};
     const matchContext=item.verified?{...context,identityLinks:[...context.identityLinks,final]}:context;
     const decision=matchCandidate(matchContext,candidate);
     // Unknown-rights pages may still supply official link metadata, but their
     // text is never admitted to evidence or snapshots.
     if(doc&&decision.decision==='verified')add({...doc,placeIds:[place.id]});
     else if(doc?.text)statuses.push({provider:'official-web',status:'empty',reason:'no_match'});
     if(!doc?.text||!sourcePolicy(doc.license?.policyId).allowModelInput)statuses.push({provider:'official-web',status:'empty',reason:'policy_restricted'});
     if(item.verified||decision.decision==='verified'){
      link({url:final,title:doc?.title});
      for(const found of page.links||[]){link(found);if(item.depth<LIMITS.maxDepth&&site(found.url)===site(item.root))enqueue(found.url,item.depth+1,item.root,true)}
     }
    }catch(error){signal?.throwIfAborted();if(combined.aborted||now()>=deadline)throw error;statuses.push({provider:'official-web',status:'unavailable',reason:['unsafe_url','response_too_large','offsite_redirect','request_limit'].includes(error.reason)?error.reason:'upstream_error'})}
   }
  };
  try{
   const initial=await wait(()=>collect(place,{language,signal:combined,profile:'tour',collectionTimeoutMs:timeoutMs}),combined);
   statuses.push(...initial.statuses||[]);for(const doc of initial.documents||[])add(doc);
   context=buildPlaceContext(place,initial.documents||[]);
   if(!sufficient(documents)){
    for(const doc of initial.documents||[]){if((['osm','wikidata'].includes(doc.provider)&&doc.kind==='identity'||doc.provider==='wikipedia'&&doc.officialWebsite===true)&&doc.website)enqueue(doc.website,0,doc.website,true)}
    await drain();
   }
   const searchFn=typeof search==='function'?search:search?.searchCandidates?.bind(search);
   for(const theme of ['history','architecture','collections','visitor-guide']){
    if(sufficient(documents)||searchCalls>=maxSearch||!searchFn)break;live();
    const result=await wait(()=>searchFn(context,{signal:combined,querySuffix:theme,maxProviderCalls:maxSearch-searchCalls}),combined);
    searchCalls+=result.calls||0;statuses.push(...result.outcomes||[]);
    for(const candidate of result.candidates||[]){if(matchCandidate(context,candidate).decision!=='verified')continue;link(candidate);enqueue(candidate.url,0,candidate.url,false,candidate.identitySignals)}
    await drain();
    if(!result.calls)break;
   }
  }catch(error){signal?.throwIfAborted();statuses.push({provider:'research',status:'unavailable',reason:combined.aborted||error.name==='TimeoutError'||now()>=deadline?'timeout':'upstream_error'})}
  finally{clearTimeout(timer)}
  const bundle=sourceBundle(place,documents,statuses,{profile:'tour'});
  return {stats:{searchCalls,pageCalls},documents:bundle.documents,spans:buildEvidenceSpans(bundle.documents),statuses:bundle.statuses,fingerprint:bundle.fingerprint,links:[...links.values()]};
 };
}
