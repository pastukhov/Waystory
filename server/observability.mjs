import {randomUUID,timingSafeEqual} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {requestId,withRequestContext} from './request-context.mjs';

const providers=['wikipedia','wikivoyage','wikidata','osm','tavily','yandex_ai','yandex_tts'];
const operations=['api','search','extract','story','question','identify','translatePlaces','review','speech','other'];
const stages=['discovery','acquisition','generation','review','speech'];
const outcomes=['success','error','timeout','cancelled','rejected','ready','limited','context_only','no_material','temporarily_unavailable','not_configured','budget_exhausted','policy_restricted','empty','partial'];
const caches=['discovery','sources','acquisition','generation','speech'];
const routes=['/api/config','/api/session','/api/guide','/api/speech','/api/places/nearby','/api/places/search','/api/places/resolve','/api/places/enrich','/auth/google','/auth/google/callback','/auth/logout'];
const buckets=[0.05,0.1,0.25,0.5,1,2,5,10,20,30,60,90];
const pick=(value,allowed,fallback='other')=>allowed.includes(value)?value:fallback;
const number=(value,max=1e12)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.min(value,max):0;
const status=value=>Number.isInteger(value)&&value>=100&&value<=599?String(value):'none';
const quote=value=>String(value).replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll('"','\\"');
const labelsText=labels=>Object.keys(labels).length?'{'+Object.entries(labels).map(([k,v])=>`${k}="${quote(v)}"`).join(',')+'}':'';
export const metricDefinitions={
 http_requests_total:['counter','HTTP responses and disconnected requests',['route','method','status']],
 http_request_duration_seconds:['histogram','HTTP request lifetime including response body',['route','method']],
 http_in_flight:['gauge','Current non-metrics HTTP requests',[]],
 provider_requests_total:['counter','Provider HTTP attempts; success means HTTP 2xx, not accepted content',['provider','operation','status','outcome']],
 provider_request_duration_seconds:['histogram','Provider HTTP time to response headers, not body completion',['provider','operation']],
 provider_last_success_timestamp_seconds:['gauge','Last observed HTTP 2xx since process start; zero means none',['provider']],
 provider_last_status_code:['gauge','Last HTTP status since process start; zero means none or network failure',['provider']],
 provider_configured:['gauge','Application provider configuration, not health',['provider']],
 stage_operations_total:['counter','Completed domain operations',['stage','outcome']],
 stage_duration_seconds:['histogram','Domain operation lifetime including body validation',['stage']],
 discovery_results:['histogram','Number of places returned per uncached discovery operation',['operation']],
 cache_requests_total:['counter','Cache lookups or shared in-flight work',['cache','result']],
 source_candidates_total:['counter','Candidate identity matching decisions',['decision']],
 source_documents_total:['counter','Accepted source documents for global discovery',[]],
 ai_tokens_total:['counter','Provider-reported token usage; missing usage is not inferred',['operation','kind']],
 ai_usage_missing_total:['counter','AI responses without complete token usage',['operation']],
 tts_characters_requested_total:['counter','Unicode code points sent for synthesis; not a billing statement',[]],
 tavily_daily_calls_limit:['gauge','Configured UTC daily Tavily call limit, not credits',[]],
 tavily_daily_calls_remaining:['gauge','Remaining persisted UTC daily call reservations, not account balance',[]],
 tavily_budget_available:['gauge','Whether persisted budget could be read at this scrape',[]],
 process_start_time_seconds:['gauge','Process start time',[]],
 process_uptime_seconds:['gauge','Process uptime',[]],
 process_resident_memory_bytes:['gauge','Process resident memory',[]],
 process_heap_used_bytes:['gauge','Used V8 heap',[]],
 process_cpu_seconds_total:['counter','Process CPU seconds',[]],
 build_info:['gauge','Deployed image or revision',['revision']]
};
function providerCall(url,options){
 try{
  const u=new URL(url),host=u.hostname;
  if(host.endsWith('.wikipedia.org'))return ['wikipedia','api'];
  if(host.endsWith('.wikivoyage.org'))return ['wikivoyage','api'];
  if(host==='www.wikidata.org')return ['wikidata','api'];
  if(host==='api.tavily.com')return ['tavily',pick(u.pathname.slice(1),['search','extract'])];
  if(host==='tts.api.cloud.yandex.net')return ['yandex_tts','speech'];
  if(host==='ai.api.cloud.yandex.net'){
   let schema;try{schema=JSON.parse(options?.body||'{}').response_format?.json_schema?.name}catch{}
   return ['yandex_ai',schema==='grounding'?'review':pick(schema?.replace(/^waystory_/,''),operations)];
  }
  return ['osm','api']; // This wrapper is supplied only to the allowlisted source transport.
 }catch{return ['osm','api']}
}
export function createObservability({env=process.env,write=line=>console.log(line),now=Date.now,budgetSnapshot}={}){
 const token=env.METRICS_TOKEN||'';
 if(token&&!/^[A-Za-z0-9_-]{32,512}$/.test(token))throw Error('Invalid METRICS_TOKEN; use 32-512 URL-safe characters');
 const series=new Map(Object.keys(metricDefinitions).map(name=>[name,new Map()]));
 function update(name,labels,value,mode='add'){
  const definition=metricDefinitions[name];if(!definition)return;
  const ordered=Object.fromEntries(definition[2].map(k=>[k,labels[k]]));const key=JSON.stringify(ordered),map=series.get(name);
  const entry=map.get(key)||{labels:ordered,value:0,count:0,sum:0,buckets:buckets.map(()=>0)};
  if(definition[0]==='histogram'){entry.count++;entry.sum+=value;for(let i=0;i<buckets.length;i++)if(value<=buckets[i])entry.buckets[i]++}
  else entry.value=mode==='set'?value:entry.value+value;
  map.set(key,entry);
 }
 function log(event,fields){try{write(JSON.stringify({event:'waystory_'+event,requestId:requestId()||randomUUID(),...fields}))}catch{}}
 function record(event,f={}){
  if(event==='provider'){
   const provider=pick(f.provider,providers,'osm'),operation=pick(f.operation,operations),code=status(f.status),outcome=pick(f.outcome,['success','error','timeout','cancelled'],'error'),duration=number(f.durationMs)/1000;
   update('provider_requests_total',{provider,operation,status:code,outcome},1);update('provider_request_duration_seconds',{provider,operation},duration);
   update('provider_last_status_code',{provider},code==='none'?0:Number(code),'set');
   if(outcome==='success')update('provider_last_success_timestamp_seconds',{provider},now()/1000,'set');
   log('provider',{provider,operation,status:code==='none'?null:Number(code),outcome,durationMs:Math.round(duration*1000)});
  }else if(event==='stage'){
   if(!stages.includes(f.stage))return;
   const outcome=pick(f.outcome,outcomes,'error'),duration=number(f.durationMs)/1000;
   update('stage_operations_total',{stage:f.stage,outcome},1);update('stage_duration_seconds',{stage:f.stage},duration);
   log('stage',{stage:f.stage,outcome,durationMs:Math.round(duration*1000),...(/^[a-f0-9-]{36}$/.test(f.diagnosticId||'')?{diagnosticId:f.diagnosticId}:{})});
  }else if(event==='cache'){
   if(caches.includes(f.cache))update('cache_requests_total',{cache:f.cache,result:pick(f.result,['hit','miss','shared'],'miss')},1);
  }else if(event==='discovery'){
   update('discovery_results',{operation:pick(f.operation,['nearby','search'])},number(f.count,100));
  }else if(event==='candidate'){
   update('source_candidates_total',{decision:pick(f.decision,['verified','ambiguous','rejected'],'rejected')},1);
  }else if(event==='documents')update('source_documents_total',{},number(f.count,6));
  else if(event==='usage'){
   const operation=pick(f.operation,operations),usage=f.usage;
   if(Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0&&Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0){
    update('ai_tokens_total',{operation,kind:'input'},number(usage.prompt_tokens));update('ai_tokens_total',{operation,kind:'output'},number(usage.completion_tokens));
   }else update('ai_usage_missing_total',{operation},1);
  }else if(event==='tts')update('tts_characters_requested_total',{},number(f.characters,1600));
  else if(event==='configured'&&providers.includes(f.provider))update('provider_configured',{provider:f.provider},f.enabled===true?1:0,'set');
 }
 for(const provider of providers){update('provider_last_success_timestamp_seconds',{provider},0,'set');update('provider_last_status_code',{provider},0,'set');update('provider_configured',{provider},0,'set')}
 update('http_in_flight',{},0,'set');
 const revision=/^[a-zA-Z0-9:._-]{1,100}$/.test(env.WAYSTORY_REVISION||'')?env.WAYSTORY_REVISION:'unknown';update('build_info',{revision},1,'set');
 const observer={record,
  run:work=>withRequestContext({observer,requestId:randomUUID()},work),
  authorize(header){if(!token)return 'disabled';const provided=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'';return Buffer.byteLength(provided)===Buffer.byteLength(token)&&timingSafeEqual(Buffer.from(provided),Buffer.from(token))?'allowed':'denied'},
  request(req,res,handler){
   return observer.run(()=>{
    res.setHeader('X-Request-ID',requestId());let path;try{path=new URL(req.url,'http://localhost').pathname}catch{path='unknown'}
    if(path==='/metrics')return handler();
    const route=routes.includes(path)?path:path==='/'||/^\/[a-zA-Z0-9_-]+\.(mjs|css|svg|html)$/.test(path)?'static':'unknown',method=pick(req.method,['GET','HEAD','POST','OPTIONS'],'OTHER'),started=performance.now();
    update('http_in_flight',{},1);let finished=false;const id=requestId();
    const finish=aborted=>{if(finished)return;finished=true;const code=aborted?'499':status(res.statusCode),seconds=(performance.now()-started)/1000;update('http_in_flight',{},-1);update('http_requests_total',{route,method,status:code},1);update('http_request_duration_seconds',{route,method},seconds);try{write(JSON.stringify({event:'waystory_request',requestId:id,route,method,status:Number(code)||500,durationMs:Math.round(seconds*1000)}))}catch{}};
    res.once?.('finish',()=>finish(false));res.once?.('close',()=>finish(!res.writableFinished));
    return handler();
   });
  },
  wrapFetch(fn=fetch){return async(url,options)=>{
   const [provider,operation]=providerCall(url,options),started=performance.now();
   try{const response=await fn(url,options);record('provider',{provider,operation,status:response.status,outcome:response.ok?'success':'error',durationMs:performance.now()-started});return response}
   catch(error){const reason=options?.signal?.reason?.name||error.name;record('provider',{provider,operation,outcome:reason==='TimeoutError'?'timeout':reason==='AbortError'?'cancelled':'error',durationMs:performance.now()-started});throw error}
  }},
  render(){
   const memory=process.memoryUsage(),cpu=process.cpuUsage();
   for(const [name,value] of Object.entries({process_start_time_seconds:(Date.now()/1000)-process.uptime(),process_uptime_seconds:process.uptime(),process_resident_memory_bytes:memory.rss,process_heap_used_bytes:memory.heapUsed,process_cpu_seconds_total:(cpu.user+cpu.system)/1e6}))update(name,{},value,'set');
   let budget;try{budget=budgetSnapshot?.()}catch{}
   const available=budget&&Number.isSafeInteger(budget.limit)&&budget.limit>=0&&Number.isSafeInteger(budget.remaining)&&budget.remaining>=0&&budget.remaining<=budget.limit;
   update('tavily_budget_available',{},available?1:0,'set');
   for(const name of ['tavily_daily_calls_limit','tavily_daily_calls_remaining'])series.get(name).clear();
   if(available){update('tavily_daily_calls_limit',{},budget.limit,'set');update('tavily_daily_calls_remaining',{},budget.remaining,'set')}
   const lines=[];for(const [short,[type,help]] of Object.entries(metricDefinitions)){const name='waystory_'+short;lines.push(`# HELP ${name} ${help}`,`# TYPE ${name} ${type}`);for(const entry of series.get(short).values()){
    if(type==='histogram'){for(let i=0;i<buckets.length;i++)lines.push(`${name}_bucket${labelsText({...entry.labels,le:buckets[i]})} ${entry.buckets[i]}`);lines.push(`${name}_bucket${labelsText({...entry.labels,le:'+Inf'})} ${entry.count}`,`${name}_sum${labelsText(entry.labels)} ${entry.sum}`,`${name}_count${labelsText(entry.labels)} ${entry.count}`)}
    else lines.push(`${name}${labelsText(entry.labels)} ${entry.value}`);
   }}return lines.join('\n')+'\n';
  }
 };
 return observer;
}

// Also used when Operations filters Docker logs. Reconstruct, never forward input.
export function safeTelemetryEntry(p){
 if(!/^[a-f0-9-]{36}$/.test(p?.requestId||''))return null;
 const base={event:p.event,requestId:p.requestId};
 if(p.event==='waystory_provider'&&providers.includes(p.provider)&&operations.includes(p.operation)&&['success','error','timeout','cancelled'].includes(p.outcome))return {...base,provider:p.provider,operation:p.operation,status:status(p.status)==='none'?null:p.status,outcome:p.outcome,durationMs:number(p.durationMs)};
 if(p.event==='waystory_stage'&&stages.includes(p.stage)&&outcomes.includes(p.outcome))return {...base,stage:p.stage,outcome:p.outcome,durationMs:number(p.durationMs),...(/^[a-f0-9-]{36}$/.test(p.diagnosticId||'')?{diagnosticId:p.diagnosticId}:{})};
 if(p.event==='waystory_request'&&[...routes,'static','unknown'].includes(p.route)&&['GET','HEAD','POST','OPTIONS','OTHER'].includes(p.method))return {...base,route:p.route,method:p.method,status:status(p.status)==='none'?500:p.status,durationMs:number(p.durationMs)};
 return null;
}
