import {createProviderBudget} from './budget.mjs';
import {sourceReason} from './outcomes.mjs';
import {createSearchAdapters} from './search-adapters.mjs';
export function candidateUrl(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^([\d.]+|\[.*\])$/.test(u.hostname)||/\.(localhost|local|internal)$/.test(u.hostname))return null;u.hash='';return u.href}catch{return null}}
function integer(value,fallback,max){if(value===undefined||value==='')return fallback;if(!/^\d+$/.test(String(value)))throw Error('Invalid web search setting');const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed>max)throw Error('Invalid web search setting');return parsed}
function abortable(work,signal){signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))})}
function coordinatesFromMap(snippet){
 const locations=[];
 for(const token of snippet.match(/https?:\/\/[^\s<>"\)]+/g)||[]){try{const u=new URL(token);if(!/^(?:www\.)?(?:maps\.google\.com|google\.com|openstreetmap\.org)$/.test(u.hostname))continue;const m=/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(u.pathname)||/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u.href);if(m){const lat=Number(m[1]),lon=Number(m[2]);if(Math.abs(lat)<=90&&Math.abs(lon)<=180)locations.push({lat,lon})}}catch{}}
 return locations.length&&locations.every(c=>c.lat===locations[0].lat&&c.lon===locations[0].lon)?locations[0]:null;
}
export function createSearchProvider({db,env=process.env,fetchFn=fetch,now=Date.now}={}){
 const maxCalls=integer(env.WEB_SEARCH_MAX_CALLS_PER_DAY,0,10000),providerLimits={tavily:integer(env.TAVILY_MAX_CALLS_PER_DAY,maxCalls,10000),brave:integer(env.BRAVE_SEARCH_MAX_CALLS_PER_DAY,maxCalls,10000)};
 const budget=createProviderBudget({db,maxCalls,providerLimits,now}),adapters=createSearchAdapters({env,fetchFn}),cooldowns=new Map();
 const order=[...new Set((env.WEB_SEARCH_PROVIDER_ORDER||'tavily,brave').split(',').map(x=>x.trim()))];
 if(!order.length||order.some(id=>!Object.hasOwn(adapters,id)))throw Error('Invalid web search provider order');
 const timeoutMs=Math.max(1,integer(env.WEB_SEARCH_TIMEOUT_MS,15000,60000)),providerTimeoutMs=Math.max(1,integer(env.WEB_SEARCH_PROVIDER_TIMEOUT_MS,6000,30000));
 const configuredEngines=order.filter(id=>adapters[id].configured),enabled=configuredEngines.length>0&&maxCalls>0;
 return {enabled,configuredEngines,async searchCandidates(context,{signal,limit=8,querySuffix='',maxProviderCalls=Infinity}={}){
  signal?.throwIfAborted();
  if(!enabled)return {candidates:[],outcomes:[{provider:'global-web',status:'disabled',reason:'not_configured'}],calls:0};
  limit=Math.max(1,Math.min(8,Number.isFinite(limit)?Math.floor(limit):8));
  const candidates=[],outcomes=[];let calls=0;
  const callLimit=Number.isSafeInteger(maxProviderCalls)&&maxProviderCalls>=0?maxProviderCalls:maxProviderCalls===Infinity?Infinity:0;
  const deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  const query=[[...new Set(context.names||[])].slice(0,2).join(' / '),context.locality,context.countryCode,String(querySuffix).trim().slice(0,100)].filter(Boolean).join(' ');
  const outcome=(engine,status,reason,extra={})=>outcomes.push({provider:'global-web',engine,status,reason,...extra});
  const failure=(engine,error,start,partial=false)=>{
   const reason=[401,403].includes(error.httpStatus)?'access_denied':sourceReason(error);
   const extra={durationMs:Math.max(0,now()-start),documentCount:0,...(Number.isInteger(error.httpStatus)?{httpStatus:error.httpStatus}:{})};
   outcome(engine,partial?'partial':'unavailable',reason,extra);
   const retryable=!error.httpStatus||[401,403,429].includes(error.httpStatus)||error.httpStatus>=500;
   if(retryable)cooldowns.set(engine,{until:now()+([401,403].includes(error.httpStatus)?15*60*1000:60*1000),reason,...extra});
   return retryable;
  };
  const invoke=(work)=>{const attempt=AbortSignal.any([combined,AbortSignal.timeout(providerTimeoutMs)]);return abortable(()=>work(attempt),attempt)};
  for(const engine of order){
   signal?.throwIfAborted();if(combined.aborted){outcome(engine,'unavailable','timeout');break}
   const adapter=adapters[engine];
   if(!adapter.configured){outcome(engine,'disabled','not_configured');continue}
   const cooldown=cooldowns.get(engine);
   if(cooldown?.until>now()){outcome(engine,'unavailable',cooldown.reason,{cooldown:true,...(cooldown.httpStatus?{httpStatus:cooldown.httpStatus}:{})});continue}
   if(calls>=callLimit){outcome(engine,'budget-exhausted','budget_exhausted');break}
   if(!budget.reserveProviderCall({provider:engine})){outcome(engine,'budget-exhausted','budget_exhausted');continue}
   calls++;const start=now();
   try{
    const results=await invoke(attempt=>adapter.search(query,{signal:attempt,limit}));
    for(const r of results.slice(0,8)){const url=candidateUrl(r.url);if(!url||candidates.some(c=>c.url===url))continue;candidates.push({url,title:String(r.title||'').slice(0,300),snippet:String(r.snippet||'').slice(0,6000),provider:engine,usagePolicyId:adapter.usagePolicyId,identitySignals:{}});if(candidates.length>=limit)break}
    cooldowns.delete(engine);outcome(engine,candidates.length?'ok':'empty',candidates.length?null:'no_match',{durationMs:Math.max(0,now()-start),documentCount:candidates.length});
   }catch(error){signal?.throwIfAborted();if(!failure(engine,error,start)||combined.aborted)break;continue}
   if(candidates.length&&adapter.extract&&!combined.aborted){
    if(calls>=callLimit||!budget.reserveProviderCall({provider:engine}))outcome(engine,'budget-exhausted','budget_exhausted');
    else{calls++;const extractStart=now();try{
     const results=await invoke(attempt=>adapter.extract(candidates,{signal:attempt}));
     for(const result of results.slice(0,3)){const candidate=candidates.find(c=>c.url===candidateUrl(result.url));if(!candidate||typeof result.raw_content!=='string')continue;candidate.snippet=result.raw_content.slice(0,6000);const coordinates=coordinatesFromMap(candidate.snippet);if(coordinates)candidate.identitySignals.coordinates=coordinates}
    }catch(error){signal?.throwIfAborted();failure(engine,error,extractStart,true)}}
   }
   // An empty successful response is a valid answer, not a fallback trigger.
   break;
  }
  return {candidates:candidates.slice(0,limit),outcomes,calls};
 }};
}
