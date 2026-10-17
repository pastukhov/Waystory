import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {connectionEnvironment,logOptions,readBounded,safeLine} from './loki-logs.mjs';
const labelPattern=/^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/;
const preferred=['job','service_name','container','container_name','app','filename'];
const stable=['container','container_name','service_name','app','service','compose_service','compose_project','project','container_label_com_docker_compose_service','job'];
const incidental=['filename','container_id'];
const safeValue=value=>typeof value==='string'&&value.length>0&&value.length<=300&&!/[\x00-\x1f\x7f]/.test(value);
export async function discoverStreams(env,{fetchFn=fetch,now=Date.now()}={}){
 const options=logOptions({...connectionEnvironment(env),LOKI_SELECTOR:'{job="discovery"}'},now);
 const base=new URL(options.url),endpoint=base.pathname.replace(/\/query_range$/,'');
 let queries=0,truncated=false;
 async function query(path,params){
  const url=new URL(base);url.pathname=endpoint+path;url.search=new URLSearchParams({start:String(BigInt(options.start)*1000000n),end:String(BigInt(options.end)*1000000n),...params}).toString();
  let response;try{response=await fetchFn(url,{headers:options.headers,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('Could not reach Loki. Check runner connectivity and the supplied address.');}
  queries++;if(!response.ok)throw Error('Loki returned HTTP '+response.status+'. Check authorization and server availability.');
  const data=await readBounded(response);if(data.status!=='success')throw Error('Loki returned an unsuccessful result.');return data.data;
 }
 const data=await query('/labels',{});if(!Array.isArray(data))throw Error('Unexpected Loki label response.');
 const labelNames=[...new Set(data.filter(x=>typeof x==='string'&&labelPattern.test(x)))].sort();
 if(labelNames.length>100)truncated=true;
 const probes=[...preferred.filter(x=>labelNames.includes(x)),...labelNames.filter(x=>!preferred.includes(x))].slice(0,6);
 const candidates=new Map(),probedLabels=[];let recognized=0;
 for(const label of probes){
  probedLabels.push(label);
  const result=await query('/query_range',{query:'{'+label+'=~".+"} |= "waystory_"',direction:'backward',limit:'100'});
  if(result?.resultType!=='streams'||!Array.isArray(result.result))throw Error('Unexpected Loki stream response.');
  let rawCount=0;
  for(const stream of result.result){
   const values=Array.isArray(stream?.values)?stream.values:[];rawCount+=values.length;
   const valid=values.filter(pair=>Array.isArray(pair)&&safeLine(pair[1]));if(!valid.length)continue;
   recognized+=valid.length;
   const labels=stream.stream||{};
   const specific=stable.filter(key=>safeValue(labels[key])&&/waystory/i.test(labels[key]));
   const keys=specific.length?specific:incidental.filter(key=>safeValue(labels[key]));
   for(const key of keys){const selector='{'+key+'='+JSON.stringify(labels[key])+'}';candidates.set(selector,{selector,stable:specific.length>0,verifiedEvents:valid.length});}
  }
  if(rawCount>=100)truncated=true;
  if(candidates.size)break;
 }
 return {start:new Date(options.start).toISOString(),end:new Date(options.end).toISOString(),labelNames:labelNames.slice(0,100),probedLabels,queries,recognizedEvents:recognized,truncated:truncated||candidates.size>20||(!candidates.size&&labelNames.length>probedLabels.length),candidates:[...candidates.values()].slice(0,20),note:candidates.size?'Candidates were found in streams containing recognized Waystory events. Verify an export; selectors based on filename/container_id change after container recreation.':'No specific Waystory selector found in the bounded scan. Check Promtail shipping, time range and stream labels; this does not prove that Loki has no Waystory logs.'};
}
export async function main(env=process.env){
 if(!env.LOG_OUTPUT_DIR)throw Error('LOG_OUTPUT_DIR is required.');
 const report=await discoverStreams(env);await mkdir(env.LOG_OUTPUT_DIR,{recursive:true,mode:0o700});await writeFile(env.LOG_OUTPUT_DIR+'/discovery.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1});
