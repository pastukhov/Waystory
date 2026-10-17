import test from 'node:test';
import assert from 'node:assert/strict';
import {logOptions,collectLogs} from '../scripts/loki-logs.mjs';
const now=Date.parse('2026-10-17T12:00:00Z'),env={LOKI_URL:'http://loki.internal:3100',LOKI_SELECTOR:'{container="waystory-waystory-1"}'};
const id='12345678-1234-1234-1234-123456789abc',other='22222222-1234-1234-1234-123456789abc';
const event={event:'waystory_request',requestId:id,route:'/api/guide',method:'POST',status:502,durationMs:123};
const ns=String(BigInt(now-1000)*1000000n);
const payload=lines=>({status:'success',data:{resultType:'streams',result:[{stream:{secret:'label-secret'},values:lines.map(line=>[ns,typeof line==='string'?line:JSON.stringify(line)])}]}});
test('constructs an internal read-only Loki query and supports exclusive authentication',async()=>{
 const options=logOptions({...env,LOG_HOURS:'1',LOG_REQUEST_ID:id,LOKI_USERNAME:'reader',LOKI_PASSWORD:'secret',LOKI_TENANT_ID:'waystory'},now);
 const result=await collectLogs(options,{now:()=>now,fetchFn:async(url,init)=>{
  assert.equal(url.origin,'http://loki.internal:3100');assert.equal(url.pathname,'/loki/api/v1/query_range');assert.equal(init.redirect,'error');
  assert.equal(url.searchParams.get('query'),env.LOKI_SELECTOR+' |= "waystory_" |= "'+id+'"');assert.equal(init.headers.Authorization,'Basic '+Buffer.from('reader:secret').toString('base64'));assert.equal(init.headers['X-Scope-OrgID'],'waystory');
  return Response.json(payload([event]));
 }});assert.equal(result.entries.length,1);assert.equal(result.summary.start,'2026-10-17T11:00:00.000Z');assert.equal(result.summary.truncated,false);
});
test('rejects unconfigured, injected or excessive queries before network access',()=>{
 for(const override of [{LOKI_URL:''},{LOKI_SELECTOR:'{app="waystory"} | json'},{LOKI_URL:'http://user:secret@host/'},{LOKI_URL:'file:///etc/passwd'},{LOG_HOURS:'999'},{LOG_REQUEST_ID:'" | json'},{LOG_PLACE_ID:'other'},{LOG_END:'yesterday'},{LOG_END:'2026-01-01T00:00:00Z'},{LOG_END:'2027-01-01T00:00:00Z'},{LOKI_BEARER_TOKEN:'secret',LOKI_USERNAME:'user',LOKI_PASSWORD:'pass'},{LOKI_USERNAME:'user'},{LOKI_TENANT_ID:'a\nb'}])assert.throws(()=>logOptions({...env,...override},now),JSON.stringify(override));
});
test('exports only reconstructed events, including nested Docker records, never raw text or labels',async()=>{
 const result=await collectLogs(logOptions(env,now),{fetchFn:async()=>Response.json(payload([{...event,token:'SECRET',body:'PRIVATE'},JSON.stringify({log:JSON.stringify({...event,requestId:other})}),'{"event":"unknown","password":"SECRET"}','not-json']))});
 assert.equal(result.entries.length,2);assert.equal(result.summary.discarded,2);assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE|label-secret/);assert.equal(result.entries[0].timestamp,'2026-10-17T11:59:59.000Z');
});
test('place filter follows request IDs to provider and review events',async()=>{
 let calls=0;const placeId='wiki:ru:3682050';
 const result=await collectLogs(logOptions({...env,LOG_PLACE_ID:placeId},now),{fetchFn:async(url)=>{
  calls++;if(calls===1){assert.match(url.searchParams.get('query'),/3682050/);return Response.json(payload([{event:'waystory_story_context',requestId:id,placeId,model:'openai/gpt-4.1-mini'}]));}
  assert.match(url.searchParams.get('query'),new RegExp(id));return Response.json(payload([event,{event:'waystory_review_detail',requestId:id,reason:'model_rejected',blockIndexes:[2],modelReasons:['contradiction'],attempt:2,model:'openai/gpt-4.1-mini'},{...event,requestId:other}]));
 }});assert.equal(calls,2);assert.equal(result.entries.length,2);assert.equal(result.entries[1].reason,'model_rejected');
});
test('no place matches yields an explicitly empty result without broadening search',async()=>{
 let calls=0;const result=await collectLogs(logOptions({...env,LOG_PLACE_ID:'wiki:ru:1'},now),{fetchFn:async()=>{calls++;return Response.json(payload([]));}});
 assert.equal(calls,1);assert.equal(result.summary.exported,0);assert.match(result.summary.note,/do not prove/);
});
test('bounded query reports truncation even if most raw rows cannot be exported',async()=>{
 const result=await collectLogs(logOptions(env,now),{fetchFn:async()=>Response.json(payload(Array(5000).fill('unknown')))});assert.equal(result.summary.truncated,true);assert.equal(result.summary.rawLines,5000);
});
test('Loki transport and response errors never expose server bodies or credentials',async()=>{
 for(const fetchFn of [async()=>new Response('SECRET upstream',{status:401}),async()=>{throw Error('SECRET url')},async()=>new Response('SECRET invalid json'),async()=>Response.json({status:'error',error:'SECRET'})]){
  await assert.rejects(collectLogs(logOptions(env,now),{fetchFn}),error=>!error.message.includes('SECRET')&&/Loki/.test(error.message));
 }
});
test('oversized Loki responses are cancelled before parsing',async()=>{
 let cancelled=false;const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16*1024*1024+1));},cancel(){cancelled=true}}));
 await assert.rejects(collectLogs(logOptions(env,now),{fetchFn:async()=>response}),/16 MiB/);assert.equal(cancelled,true);
});

test('CLI reads a local Loki-compatible HTTP endpoint and writes only sanitized artifacts',async()=>{
 const {createServer}=await import('node:http'),{once}=await import('node:events'),{mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const directory=await mkdtemp(tmpdir()+'/waystory-loki-test-');let requested=false;
 const server=createServer((req,res)=>{requested=true;assert.equal(req.headers.authorization,'Bearer CLI-SECRET');assert.ok(req.url.startsWith('/loki/api/v1/query_range?'));res.setHeader('Content-Type','application/json');const body=payload([{...event,body:'PRIVATE'}]);body.data.result[0].values[0][0]=String(BigInt(new URL(req.url,'http://localhost').searchParams.get('end'))-1000000000n);res.end(JSON.stringify(body));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const result=await promisify(execFile)(process.execPath,['scripts/loki-logs.mjs'],{env:{...process.env,...env,LOKI_URL:'http://127.0.0.1:'+server.address().port,LOKI_BEARER_TOKEN:'CLI-SECRET',LOKI_USERNAME:'',LOKI_PASSWORD:'',LOKI_TENANT_ID:'',LOG_OUTPUT_DIR:directory,LOG_HOURS:'1',LOG_END:'',LOG_PLACE_ID:'',LOG_REQUEST_ID:''}});
  assert.equal(requested,true);const summary=JSON.parse(await readFile(directory+'/summary.json','utf8')),events=await readFile(directory+'/events.jsonl','utf8');assert.equal(summary.exported,1);assert.equal(JSON.parse(events).requestId,id);assert.doesNotMatch(result.stdout+result.stderr+events,/CLI-SECRET|PRIVATE|label-secret/);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
