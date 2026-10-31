import test from 'node:test';
import assert from 'node:assert/strict';
import {createToursClient} from '../dist/tours-client.mjs';

test('client sends server-only inputs, JSON, session credentials and no-store reads',async()=>{
 const calls=[],client=createToursClient({fetchFn:async(url,options)=>{calls.push([url,options]);return Response.json({id:'tour'})}});
 await client.start({placeId:'wiki:ru:173387',language:'ru'});await client.get('tour');await client.prepareChapter('tour','overview');await client.retryChapter('tour','history');await client.saveProgress('tour',{chapterId:'overview',chunkIndex:0,offsetSeconds:0,completedChapterIds:[]});
 assert.deepEqual(calls.map(([url,o])=>[url,o.method]),[['/api/tours','POST'],['/api/tours/tour','GET'],['/api/tours/tour/chapters/overview','POST'],['/api/tours/tour/chapters/history/retry','POST'],['/api/tours/tour/progress','PUT']]);
 assert.deepEqual(JSON.parse(calls[0][1].body),{placeId:'wiki:ru:173387',language:'ru'});
 assert.equal(calls[1][1].cache,'no-store');assert.ok(calls.every(([,o])=>o.credentials==='same-origin'));
 assert.equal(calls[2][1].body,'{}');
});
test('known PublicError and HTTP status survive; unknown backend HTML becomes a fixed safe message',async()=>{
 const error={code:'auth_required',message:'Sign in again.',retryable:false,diagnosticId:'diag'};
 await assert.rejects(createToursClient({fetchFn:async()=>Response.json({error},{status:401})}).get('id'),e=>e.status===401&&e.code==='auth_required'&&e.retryable===false&&e.diagnosticId==='diag'&&e.publicError.message===error.message);
 await assert.rejects(createToursClient({fetchFn:async()=>new Response('<img src=x onerror=alert(1)>',{status:502})}).get('id'),e=>e.status===502&&!e.message.includes('<'));
 await assert.rejects(createToursClient({fetchFn:async()=>Response.json({error:'<script>bad</script>'},{status:503})}).get('id'),e=>e.status===503&&!e.message.includes('<'));
});
test('waitFor polls until predicate and stops at cancellation even if late fetch ignores signal',async()=>{
 let calls=0;const client=createToursClient({pollMs:1,fetchFn:async()=>Response.json({status:++calls===1?'planning':'ready'})});
 assert.equal((await client.waitFor('id',t=>t.status==='ready')).status,'ready');assert.equal(calls,2);
 let release,started;const start=new Promise(resolve=>{started=resolve}),controller=new AbortController();
 const late=createToursClient({pollMs:1,fetchFn:()=>{started();return new Promise(resolve=>{release=()=>resolve(Response.json({status:'ready'}))})}});
 let predicates=0;const pending=late.waitFor('old',()=>{predicates++;return true},{signal:controller.signal});await start;controller.abort();
 await assert.rejects(pending,{name:'AbortError'});release();await new Promise(resolve=>setImmediate(resolve));assert.equal(predicates,0);
});
test('cancellation during polling delay prevents additional reads; errors stop polling',async()=>{
 const controller=new AbortController();let calls=0;
 const client=createToursClient({pollMs:1000,fetchFn:async()=>{calls++;return Response.json({status:'planning'})}});
 const pending=client.waitFor('id',()=>{controller.abort();return false},{signal:controller.signal});await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
 const denied=createToursClient({pollMs:1,fetchFn:async()=>Response.json({error:{code:'auth_required',message:'Sign in.',retryable:false,diagnosticId:'diag'}},{status:401})});await assert.rejects(denied.waitFor('id',()=>false),{status:401,code:'auth_required'});
});
