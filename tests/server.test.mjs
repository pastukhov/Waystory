import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
// Exercise the real request handler without binding a network socket.
function request(url,options={}){return new Promise((resolve,reject)=>{
 const headers=new Map();let status=200;const server=createApp();
 const req={url,method:options.method||'GET',headers:{host:'localhost',...(options.headers||{})}};
 const res={setHeader:(k,v)=>headers.set(k.toLowerCase(),v),writeHead:(s,h)=>{status=s;for(const [k,v] of Object.entries(h))headers.set(k.toLowerCase(),v)},end:body=>resolve({status,headers,text:String(body||'')})};
 Promise.resolve(server.listeners('request')[0](req,res)).catch(reject);
})}
test('configuration honestly reports unavailable AI',async()=>{const r=await request('/api/config');assert.equal(r.status,200);assert.equal(JSON.parse(r.text).ai,false)});
test('AI requests without key cannot claim success',async()=>{const r=await request('/api/guide',{method:'POST'});assert.equal(r.status,503)});
test('cross origin writes are rejected',async()=>{const r=await request('/api/guide',{method:'POST',headers:{origin:'https://evil.test'}});assert.equal(r.status,403)});
test('source and environment are not served',async()=>{assert.equal((await request('/.env')).status,404);assert.equal((await request('/server/index.mjs')).status,404)});
test('index served with a CSP',async()=>{const r=await request('/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/default-src/);assert.match(r.text,/Waystory/)});
test('home invites a search without a preselected city',async()=>{const r=await request('/');assert.doesNotMatch(r.text,/Прогулка по Петербургу|A walk around Saint Petersburg|Back to examples/);assert.match(r.text,/data-i18n="Найдите своё место"/)});
