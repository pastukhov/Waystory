import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {safeLogLine} from '../server/diagnostics.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const placePattern=/^(osm:(node|way|relation):[1-9]\d*|wd:Q[1-9]\d*|wiki:[a-z-]+:[1-9]\d*)$/;
const MAX_LINES=5000,MAX_BYTES=16*1024*1024;
export function logOptions(env,now=Date.now()){
 if(!env.LOKI_URL||!env.LOKI_SELECTOR)throw Error('Set LOKI_URL and LOKI_SELECTOR in repository Actions settings.');
 let url;try{url=new URL(env.LOKI_URL)}catch{throw Error('Invalid LOKI_URL');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('LOKI_URL must be an HTTP(S) base URL without credentials, query or fragment.');
 // Configuration supplies a stream selector, never a free-form LogQL pipeline.
 const selector=env.LOKI_SELECTOR.trim();
 if(selector.length>1000||!/^\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*(?:=|=~)\s*"(?:[^"\\\r\n]|\\["\\])*"(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*\s*(?:=|=~)\s*"(?:[^"\\\r\n]|\\["\\])*")*\s*\}$/.test(selector))throw Error('LOKI_SELECTOR must contain only label matchers for Waystory.');
 const hours=Number(env.LOG_HOURS||6);if(![1,6,24,72].includes(hours))throw Error('LOG_HOURS must be 1, 6, 24 or 72.');
 const endText=env.LOG_END||'';
 if(endText&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(endText))throw Error('LOG_END must use YYYY-MM-DDTHH:mm:ssZ (UTC).');
 const end=endText?Date.parse(endText):now;
 if(endText&&Number.isFinite(end)&&new Date(end).toISOString().replace('.000Z','Z')!==endText)throw Error('LOG_END must be a valid UTC date.');
 if(!Number.isFinite(end)||end>now+300000||end-hours*3600000<now-30*86400000)throw Error('Requested window must be within the last 30 days.');
 const requestId=env.LOG_REQUEST_ID||'',placeId=env.LOG_PLACE_ID||'';
 if(requestId&&!uuid.test(requestId))throw Error('Invalid request ID.');if(placeId&&!placePattern.test(placeId))throw Error('Invalid place ID.');
 const headers={Accept:'application/json'},token=env.LOKI_BEARER_TOKEN||'',username=env.LOKI_USERNAME||'',password=env.LOKI_PASSWORD||'',tenant=env.LOKI_TENANT_ID||'';
 if([token,username,password,tenant].some(x=>/[\r\n\x00]/.test(x)))throw Error('Invalid Loki credential format.');
 if(token&&(username||password)||!!username!==!!password||username.includes(':'))throw Error('Configure either bearer token or username and password.');
 if(token)headers.Authorization='Bearer '+token;else if(username)headers.Authorization='Basic '+Buffer.from(username+':'+password).toString('base64');
 if(tenant)headers['X-Scope-OrgID']=tenant;
 url.pathname=url.pathname.replace(/\/$/,'')+'/loki/api/v1/query_range';
 return {url,selector,headers,start:end-hours*3600000,end,requestId,placeId};
}
async function readBounded(response){
 const reader=response.body?.getReader();if(!reader)throw Error('Loki returned an empty response.');let bytes=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES)throw Error('Loki response exceeded 16 MiB; use a shorter window.');chunks.push(Buffer.from(value));}}
 catch(error){if(error.message==='Loki response exceeded 16 MiB; use a shorter window.')throw error;throw Error('Could not read Loki response.');}
 finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Loki returned invalid JSON.');}
}
function safeLine(line){
 if(typeof line!=='string'||line.length>256*1024)return null;
 const direct=safeLogLine(line);if(direct)return direct;
 // Support Docker json-file shipping without a Promtail docker parsing stage.
 try{const wrapped=JSON.parse(line);return typeof wrapped.log==='string'?safeLogLine(wrapped.log):null}catch{return null;}
}
export async function collectLogs(options,{fetchFn=fetch,now=Date.now}={}){
 let rawLines=0,discarded=0,truncated=false,queries=0;
 async function query(filter=''){
  const url=new URL(options.url);url.search=new URLSearchParams({query:options.selector+' |= "waystory_"'+filter,start:String(BigInt(options.start)*1000000n),end:String(BigInt(options.end)*1000000n),direction:'backward',limit:String(MAX_LINES)}).toString();
  let response;try{response=await fetchFn(url,{headers:options.headers,redirect:'error',signal:AbortSignal.timeout(20000)})}catch{throw Error('Could not reach Loki within 20 seconds. Check runner connectivity and Loki settings.');}
  if(!response.ok)throw Error('Loki returned HTTP '+response.status+'. Check authorization and server availability.');
  const payload=await readBounded(response);if(payload.status!=='success'||payload.data?.resultType!=='streams'||!Array.isArray(payload.data.result))throw Error('Loki returned an unexpected result.');
  const entries=[];let count=0;
  for(const stream of payload.data.result)for(const pair of Array.isArray(stream.values)?stream.values:[]){
   count++;const [ns,line]=Array.isArray(pair)?pair:[];const entry=safeLine(line);
   if(!entry||typeof ns!=='string'||!/^\d{1,20}$/.test(ns)){discarded++;continue;}
   const ms=Number(BigInt(ns)/1000000n);if(ms<options.start||ms>options.end){discarded++;continue;}
   entries.push({...entry,timestamp:new Date(ms).toISOString(),timestampNs:ns});
  }
  queries++;rawLines+=count;truncated ||= count>=MAX_LINES;return entries;
 }
 let entries;
 if(options.requestId)entries=(await query(' |= '+JSON.stringify(options.requestId))).filter(e=>e.requestId===options.requestId);
 else if(options.placeId){
  const seeds=(await query(' |= '+JSON.stringify(options.placeId))).filter(e=>e.placeId===options.placeId).sort((a,b)=>b.timestampNs.length-a.timestampNs.length||b.timestampNs.localeCompare(a.timestampNs));
  const ids=[...new Set(seeds.map(e=>e.requestId))];if(ids.length>50)truncated=true;
  const selected=ids.slice(0,50);entries=selected.length?(await query(' |~ '+JSON.stringify(selected.join('|')))).filter(e=>selected.includes(e.requestId)):[];
 }else entries=await query();
 if(options.requestId&&options.placeId&&!entries.some(e=>e.placeId===options.placeId))entries=[];
 entries.sort((a,b)=>a.timestampNs.length-b.timestampNs.length||a.timestampNs.localeCompare(b.timestampNs));
 const unique=new Map(entries.map(e=>[JSON.stringify(e),e]));entries=[...unique.values()];
 const summary={generatedAt:new Date(now()).toISOString(),start:new Date(options.start).toISOString(),end:new Date(options.end).toISOString(),requestId:options.requestId||null,placeId:options.placeId||null,queries,rawLines,discarded,exported:entries.length,truncated,note:truncated?'Result capped; narrow the time window or select a request ID.':'Only recognized diagnostic events are exported. Empty results do not prove that no requests occurred.'};
 return {summary,entries};
}
export async function main(env=process.env){
 const options=logOptions(env);if(!env.LOG_OUTPUT_DIR)throw Error('LOG_OUTPUT_DIR is required.');
 const {summary,entries}=await collectLogs(options);await mkdir(env.LOG_OUTPUT_DIR,{recursive:true,mode:0o700});
 await writeFile(env.LOG_OUTPUT_DIR+'/summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
 await writeFile(env.LOG_OUTPUT_DIR+'/events.jsonl',entries.map(e=>JSON.stringify(e)).join('\n')+(entries.length?'\n':''),{mode:0o600});
 console.log(JSON.stringify(summary));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1});
