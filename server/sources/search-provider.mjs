import {createProviderBudget} from './budget.mjs';
import {sourceReason} from './outcomes.mjs';
export function candidateUrl(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^([\d.]+|\[.*\])$/.test(u.hostname)||/\.(localhost|local|internal)$/.test(u.hostname))return null;u.hash='';return u.href}catch{return null}}
async function boundedJson(response){if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(Error('Search unavailable'),{httpStatus:response.status,reason:response.status===429?'rate_limited':'upstream_error'})};const reader=response.body?.getReader();if(!reader)throw Error('Empty response');const chunks=[];let bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024)throw Error('Response too large');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}return JSON.parse(Buffer.concat(chunks).toString())}
export function createSearchProvider({db,env=process.env,fetchFn=fetch}={}){
 const maxCalls=Number(env.WEB_SEARCH_MAX_CALLS_PER_DAY||0),budget=createProviderBudget({db,maxCalls});
 const enabled=!!env.TAVILY_API_KEY?.trim()&&maxCalls>0;
 return {enabled,async searchCandidates(context,{signal,limit=8}={}){
  if(!enabled)return {candidates:[],outcomes:[{provider:'global-web',status:'disabled',reason:'not_configured'}],calls:0};
  const candidates=[],outcomes=[];let calls=0;
  const deadline=AbortSignal.timeout(15000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  for(const name of [[...new Set(context.names)].slice(0,2).join(' / ')]){
   combined.throwIfAborted();if(!budget.reserveProviderCall({provider:'tavily'})){outcomes.push({provider:'global-web',status:'budget-exhausted',reason:'budget_exhausted'});break}calls++;const start=Date.now();
   try{const response=await fetchFn('https://api.tavily.com/search',{method:'POST',redirect:'error',signal:combined,headers:{Authorization:'Bearer '+env.TAVILY_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query:[name,context.locality,context.countryCode].filter(Boolean).join(' '),search_depth:'basic',max_results:Math.min(8,limit),include_answer:false,include_raw_content:false})});const data=await boundedJson(response);
    for(const r of (data.results||[]).slice(0,8)){const url=candidateUrl(r.url);if(!url||candidates.some(c=>c.url===url))continue;candidates.push({url,title:String(r.title||'').slice(0,300),snippet:String(r.content||'').slice(0,6000),provider:'tavily',usagePolicyId:'web-search-reviewed',identitySignals:{}});if(candidates.length>=limit)break}
    outcomes.push({provider:'global-web',status:candidates.length?'ok':'empty',reason:candidates.length?null:'no_match',durationMs:Date.now()-start,documentCount:candidates.length});
   }catch(error){outcomes.push({provider:'global-web',status:'unavailable',reason:sourceReason(error),...(Number.isInteger(error.httpStatus)?{httpStatus:error.httpStatus}:{}),durationMs:Date.now()-start,documentCount:0})}
   if(candidates.length>=limit)break;
  }
  if(candidates.length&&calls<2&&!combined.aborted){
   if(!budget.reserveProviderCall({provider:'tavily'}))outcomes.push({provider:'global-web',status:'budget-exhausted',reason:'budget_exhausted'});
   else{calls++;try{
    const response=await fetchFn('https://api.tavily.com/extract',{method:'POST',redirect:'error',signal:combined,headers:{Authorization:'Bearer '+env.TAVILY_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({urls:candidates.slice(0,3).map(c=>c.url),extract_depth:'basic',format:'markdown'})});
    const extracted=await boundedJson(response);
    for(const result of (extracted.results||[]).slice(0,3)){
     const candidate=candidates.find(c=>c.url===candidateUrl(result.url));if(!candidate||typeof result.raw_content!=='string')continue;
     candidate.snippet=result.raw_content.slice(0,6000);
     // Accept only coordinates embedded in an actual map link from the page,
     // not a model's inferred location or the coordinates sent in the query.
     const locations=[];for(const token of candidate.snippet.match(/https?:\/\/[^\s<>"\)]+/g)||[]){try{const u=new URL(token);if(!/^(?:www\.)?(?:maps\.google\.com|google\.com|openstreetmap\.org)$/.test(u.hostname))continue;const m=/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(u.pathname)||/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u.href);if(m){const lat=Number(m[1]),lon=Number(m[2]);if(Math.abs(lat)<=90&&Math.abs(lon)<=180)locations.push({lat,lon})}}catch{}}
     if(locations.length&&locations.every(c=>c.lat===locations[0].lat&&c.lon===locations[0].lon))candidate.identitySignals.coordinates=locations[0];
    }
   }catch(error){outcomes.push({provider:'global-web',status:'partial',reason:sourceReason(error),...(Number.isInteger(error.httpStatus)?{httpStatus:error.httpStatus}:{})})}}
  }
  return {candidates:candidates.slice(0,limit),outcomes,calls};
 }};
}
