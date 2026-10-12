// Regenerate the importable Grafana dashboard without a live Grafana connection.
import {writeFileSync} from 'node:fs';
const ds={type:'prometheus',uid:'${datasource}'};
const filter='job=~"${job:regex}",instance=~"${instance:regex}"';
const metric=(name,extra='')=>`${name}{${filter}${extra?','+extra:''}}`;
const panels=[];let y=0,id=0,column=0;
function row(title){if(column){y+=7;column=0}panels.push({id:++id,type:'row',title,collapsed:false,gridPos:{x:0,y:y++,w:24,h:1},panels:[]})}
function panel(title,expr,{unit='short',type='timeseries',legend='{{instance}}',description='',instant=false}={}){
 panels.push({id:++id,title,type,datasource:ds,description,gridPos:{x:column*12,y,w:12,h:7},targets:[{refId:'A',expr,legendFormat:legend,instant,range:!instant}],fieldConfig:{defaults:{unit,noValue:'No observations',color:{mode:'palette-classic'},thresholds:{mode:'absolute',steps:[{color:'green',value:null}]}},overrides:[]},options:type==='stat'?{reduceOptions:{calcs:['lastNotNull'],fields:'',values:false},colorMode:'value',graphMode:'none'}:{legend:{displayMode:'table',placement:'bottom',calcs:['lastNotNull']},tooltip:{mode:'multi'}}});column=1-column;if(!column)y+=7;
}
row('Availability and release');
panel('Scrape availability',metric('up'),{type:'stat',description:'0 means scrape failed. No series means the job has not been connected or is outside the selected filters.'});
panel('Deployed revision',metric('waystory_build_info'),{type:'stat',legend:'{{instance}} · {{revision}}'});
panel('HTTP requests / second',`sum by (route) (rate(${metric('waystory_http_requests_total')}[$__rate_interval]))`,{unit:'reqps',legend:'{{route}}'});
panel('HTTP responses by status',`sum by (status) (increase(${metric('waystory_http_requests_total')}[$__range]))`,{type:'stat',legend:'{{status}}'});
panel('HTTP p95 lifetime',`histogram_quantile(0.95, sum by (le, route) (rate(${metric('waystory_http_request_duration_seconds_bucket')}[$__rate_interval])))`,{unit:'s',legend:'{{route}}'});
panel('In-flight HTTP requests',metric('waystory_http_in_flight'));
row('Providers — HTTP success does not prove useful content');
panel('Configured providers',metric('waystory_provider_configured'),{type:'stat',legend:'{{provider}} · {{instance}}',description:'Configuration only, never a health check.'});
panel('Provider HTTP attempts',`sum by (provider, status, outcome) (increase(${metric('waystory_provider_requests_total')}[$__range]))`,{type:'stat',legend:'{{provider}} {{status}} {{outcome}}'});
panel('Provider p95 time to headers',`histogram_quantile(0.95, sum by (le, provider) (rate(${metric('waystory_provider_request_duration_seconds_bucket')}[$__rate_interval])))`,{unit:'s',legend:'{{provider}}',description:'Response-header latency; complete body validation is measured by domain stages below.'});
panel('Last HTTP status',metric('waystory_provider_last_status_code'),{type:'stat',legend:'{{provider}} · {{instance}}',description:'0 = no HTTP status observed since restart or latest attempt was a network error.'});
panel('Seconds since last observed HTTP success',`(time() - ${metric('waystory_provider_last_success_timestamp_seconds')}) and (${metric('waystory_provider_last_success_timestamp_seconds')} > 0)`,{type:'stat',unit:'s',legend:'{{provider}} · {{instance}}'});
panel('No observed success since restart',`${metric('waystory_provider_last_success_timestamp_seconds')} == bool 0`,{type:'stat',legend:'{{provider}} · {{instance}}',description:'1 means no observed success. It does not mean a request has been attempted.'});
row('Discovery and source quality');
panel('Discovery result count p50',`histogram_quantile(0.5, sum by (le, operation) (rate(${metric('waystory_discovery_results_bucket')}[$__rate_interval])))`,{legend:'{{operation}}'});
panel('Source acquisition outcomes',`sum by (outcome) (increase(${metric('waystory_stage_operations_total','stage="acquisition"')}[$__range]))`,{type:'stat',legend:'{{outcome}}',description:'no_material is coverage, not an infrastructure failure. Includes cache hits.'});
panel('Identity matching decisions',`sum by (decision) (increase(${metric('waystory_source_candidates_total')}[$__range]))`,{legend:'{{decision}}'});
panel('Accepted web documents',`sum(increase(${metric('waystory_source_documents_total')}[$__range]))`,{type:'stat'});
row('AI generation, review and speech');
panel('Domain outcomes',`sum by (stage, outcome) (increase(${metric('waystory_stage_operations_total')}[$__range]))`,{legend:'{{stage}} {{outcome}}',description:'Review rejected means the grounding check rejected content. error means a technical/invalid-response failure.'});
panel('Domain p95 duration',`histogram_quantile(0.95, sum by (le, stage) (rate(${metric('waystory_stage_duration_seconds_bucket')}[$__rate_interval])))`,{unit:'s',legend:'{{stage}}',description:'TTS includes reading and validating complete audio. This is not browser time-to-play.'});
panel('Cache lookups',`sum by (cache, result) (increase(${metric('waystory_cache_requests_total')}[$__range]))`,{legend:'{{cache}} {{result}}'});
panel('Provider-reported AI tokens',`sum by (operation, kind) (increase(${metric('waystory_ai_tokens_total')}[$__range]))`,{legend:'{{operation}} {{kind}}'});
panel('AI responses missing usage',`sum by (operation) (increase(${metric('waystory_ai_usage_missing_total')}[$__range]))`,{type:'stat',legend:'{{operation}}',description:'Token totals exclude these responses. They must not be interpreted as free.'});
panel('TTS characters requested',`sum(increase(${metric('waystory_tts_characters_requested_total')}[$__range]))`,{type:'stat',description:'Requested code points, including failed requests; not billed usage.'});
row('Tavily daily reservations — not account credits');
panel('Budget readable',metric('waystory_tavily_budget_available'),{type:'stat'});
panel('Daily calls remaining',metric('waystory_tavily_daily_calls_remaining'),{type:'stat',description:'Persisted SQLite reservations for current UTC day. Resets at midnight UTC; survives application restarts.'});
panel('Daily call limit',metric('waystory_tavily_daily_calls_limit'),{type:'stat'});
row('Application process — host metrics require a separate exporter');
panel('Resident memory',metric('waystory_process_resident_memory_bytes'),{unit:'bytes'});
panel('V8 heap used',metric('waystory_process_heap_used_bytes'),{unit:'bytes'});
panel('CPU cores consumed',`rate(${metric('waystory_process_cpu_seconds_total')}[$__rate_interval])`,{unit:'short'});
panel('Process uptime',metric('waystory_process_uptime_seconds'),{type:'stat',unit:'s'});
const dashboard={uid:'waystory-overview',title:'Waystory Overview',tags:['waystory','victoriametrics'],timezone:'browser',schemaVersion:39,version:1,refresh:'30s',time:{from:'now-6h',to:'now'},editable:true,panels,templating:{list:[{name:'datasource',label:'VictoriaMetrics datasource',type:'datasource',query:'prometheus',refresh:1},{name:'job',type:'query',datasource:ds,query:'label_values(up, job)',refresh:1,current:{text:'waystory',value:'waystory'},multi:false,includeAll:false},{name:'instance',type:'query',datasource:ds,query:'label_values(up{job=~"${job:regex}"}, instance)',refresh:1,multi:true,includeAll:true,allValue:'.*',current:{text:'All',value:'$__all'}}]},annotations:{list:[]}};
writeFileSync(new URL('../monitoring/grafana-dashboard.json',import.meta.url),JSON.stringify(dashboard,null,2)+'\n');
