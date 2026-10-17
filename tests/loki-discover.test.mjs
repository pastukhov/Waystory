import test from 'node:test';import assert from 'node:assert/strict';
import {discoverStreams} from '../scripts/loki-discover.mjs';
import {connectionEnvironment} from '../scripts/loki-logs.mjs';
const env={LOKI_DISCOVERY_URL:'http://192.168.11.2:3100',LOG_HOURS:'24'},now=Date.parse('2026-10-17T12:00:00Z');
const event=JSON.stringify({event:'waystory_request',requestId:'12345678-1234-1234-1234-123456789abc',route:'/api/guide',method:'POST',status:502,durationMs:1});
const response=data=>Response.json({status:'success',data});
test('discovery identifies a stable label only from recognized Waystory events',async()=>{
 const calls=[];const result=await discoverStreams(env,{now,fetchFn:async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');if(url.pathname.endsWith('/labels'))return response(['job','container','secret']);return response({resultType:'streams',result:[{stream:{job:'docker',container:'/waystory-waystory-1',secret:'PRIVATE'},values:[['1',event]]},{stream:{container:'waystory-impostor'},values:[['1','waystory_ SECRET']]}]});}});
 assert.equal(calls.length,2);assert.deepEqual(result.probedLabels,['job']);assert.equal(result.candidates[0].selector,'{container="/waystory-waystory-1"}');assert.equal(result.candidates[0].stable,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|impostor/);
});
test('a dynamic filename is explicitly flagged as unstable',async()=>{
 const result=await discoverStreams(env,{now,fetchFn:async url=>url.pathname.endsWith('/labels')?response(['filename']):response({resultType:'streams',result:[{stream:{filename:'/var/log/docker/abc-json.log'},values:[['1',event]]}]})});assert.equal(result.candidates[0].stable,false);
});
test('empty discovery is bounded and reports uncertainty',async()=>{
 let count=0;const result=await discoverStreams(env,{now,fetchFn:async url=>{count++;return url.pathname.endsWith('/labels')?response(Array.from({length:20},(_,i)=>'label'+i)):response({resultType:'streams',result:[]});}});assert.equal(count,7);assert.equal(result.truncated,true);assert.deepEqual(result.candidates,[]);assert.match(result.note,/does not prove/);
});
test('an input URL cannot redirect stored credentials away from the configured host',()=>{
 for(const key of ['LOKI_BEARER_TOKEN','LOKI_USERNAME','LOKI_PASSWORD','LOKI_TENANT_ID'])assert.throws(()=>connectionEnvironment({...env,[key]:'private'}),/trusted/);
 assert.equal(connectionEnvironment({...env,LOKI_URL:'https://configured.internal',LOKI_BEARER_TOKEN:'private'}).LOKI_URL,'https://configured.internal');
});
test('discovery errors never expose upstream response bodies',async()=>{
 await assert.rejects(discoverStreams(env,{now,fetchFn:async()=>new Response('SECRET',{status:401})}),e=>e.message.includes('401')&&!e.message.includes('SECRET'));
});
