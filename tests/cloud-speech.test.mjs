import test from 'node:test';
import assert from 'node:assert/strict';
import * as speech from '../dist/speech.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function setup(fetchFn){const heard=[],errors=[];const audio={play:async()=>{},pause(){},removeAttribute(){},load(){}};const n=new speech.CloudNarrator({audio,fetchFn,onComplete:b=>heard.push(b.id),onError:e=>errors.push(e)});n.cloud=true;return {n,audio,heard,errors}}
test('cancelled download cannot start audio or mark a fragment heard',async()=>{assert.equal(typeof speech.CloudNarrator,'function');let finish;const {n,audio,heard}=setup(()=>new Promise(r=>finish=r));n.play([{id:'a',text:'A'}]);n.stop();finish(new Response('audio'));await tick();assert.equal(audio.src,undefined);assert.deepEqual(heard,[])});
test('pause while downloading holds audio until resume; end advances once',async()=>{assert.equal(typeof speech.CloudNarrator,'function');let finish,plays=0;const {n,audio,heard}=setup(()=>new Promise(r=>finish=r));audio.play=async()=>{plays++};n.play([{id:'a',text:'A'}]);n.pause();finish(new Response('audio'));await tick();assert.equal(plays,0);n.resume();await tick();assert.equal(plays,1);audio.onended();assert.deepEqual(heard,['a']);assert.equal(n.state,'finished')});
test('long answers are split and complete only after the final audio part',async()=>{assert.equal(typeof speech.CloudNarrator,'function');const {n,audio,heard}=setup(async()=>new Response('audio'));n.play([{id:'a',text:'Я '.repeat(1100)}]);await tick();audio.onended();await tick();assert.deepEqual(heard,[]);audio.onended();await tick();assert.deepEqual(heard,[]);audio.onended();assert.deepEqual(heard,['a'])});
test('native browser fetch receives the global receiver, not the narrator',async()=>{
 const original=globalThis.fetch;const errors=[];let receiver;
 globalThis.fetch=async function(){receiver=this;if(this!==globalThis)throw new TypeError('Illegal invocation');return new Response('audio')};
 try{
  const audio={play:async()=>{},pause(){},removeAttribute(){},load(){}};
  const n=new speech.CloudNarrator({audio,onError:e=>errors.push(e)});n.cloud=true;n.play([{id:'a',text:'Тест'}]);await tick();
  assert.equal(receiver,globalThis);assert.deepEqual(errors,[]);assert.equal(n.state,'playing');n.stop();
 }finally{globalThis.fetch=original}
});
test('cloud speech sends the chosen language with every text fragment',async()=>{let body;const {n}=setup(async(url,o)=>{body=JSON.parse(o.body);return new Response('audio')});n.language='en';n.play([{id:'a',text:'Hello'}]);await tick();assert.equal(body.language,'en');n.stop()});
test('a thousands separator near a chunk boundary cannot split the number',async()=>{
 const bodies=[];const {n,audio}=setup(async(url,o)=>{bodies.push(JSON.parse(o.body).text);return new Response('audio')});
 n.play([{id:'a',text:'a '.repeat(498)+'2 144 человека.'}]);await tick();audio.onended();await tick();
 assert.match(bodies.join(' '),/2144 человека/);assert.equal(bodies.some(s=>s.endsWith('2')),false);n.stop();
});
function device(n){const spoken=[];let pauses=0,resumes=0;n.synth={cancel(){},getVoices:()=>[{lang:'ru-RU',localService:true}],speak:u=>spoken.push(u),pause:()=>pauses++,resume:()=>resumes++};n.Utterance=class{constructor(text){this.text=text}};return {spoken,get pauses(){return pauses},get resumes(){return resumes}}}
test('provider failure switches to device voice and retains language, speed and completion',async()=>{
 let calls=0;const {n,heard,errors}=setup(async()=>{calls++;return Response.json({error:'unavailable'},{status:502})});const d=device(n);n.language='en';n.rate=1.2;
 n.play([{id:'a',text:'Hello'},{id:'b',text:'World'}]);await tick();assert.equal(d.spoken[0]?.text,'Hello');assert.equal(d.spoken[0].lang,'en-US');assert.equal(d.spoken[0].rate,1.2);assert.match(errors[0],/голос устройства/);
 n.pause();assert.equal(d.pauses,1);n.resume();assert.equal(d.resumes,1);d.spoken[0].onend();d.spoken[1].onend();assert.deepEqual(heard,['a','b']);n.play([{id:'c',text:'Again'}]);assert.equal(calls,1);n.stop();
});
test('fallback resumes only unfinished parts and does not mark a partial block heard',async()=>{
 let calls=0;const {n,audio,heard}=setup(async()=>++calls===1?new Response('audio'):Response.json({error:'unavailable'},{status:502}));const d=device(n);
 n.play([{id:'a',text:'a '.repeat(700)},{id:'b',text:'Next'}]);await tick();audio.onended();await tick();assert.ok(d.spoken[0].text.length<500);assert.deepEqual(heard,[]);d.spoken[0].onend();assert.deepEqual(heard,['a']);d.spoken[1].onend();assert.deepEqual(heard,['a','b']);
});
test('fallback waits when paused; stop cancels pending local narration',async()=>{
 let finish;const {n}=setup(()=>new Promise(r=>finish=r));const d=device(n);n.play([{id:'a',text:'Hello'}]);n.pause();finish(Response.json({error:'down'},{status:502}));await tick();assert.equal(d.spoken.length,0);assert.equal(n.state,'paused');n.resume();assert.equal(d.spoken.length,1);n.stop();d.spoken[0].onend();assert.equal(n.state,'idle');
});
test('auth and quota errors do not activate device fallback',async()=>{for(const status of [401,403,429]){const {n}=setup(async()=>Response.json({error:'denied'},{status}));const d=device(n);n.play([{id:'a',text:'Hello'}]);await tick();assert.equal(d.spoken.length,0)}});

test('cloud requests omit technical citations from saved stories',async()=>{const bodies=[];const {n}=setup(async(url,o)=>{bodies.push(JSON.parse(o.body).text);return new Response('audio')});n.play([{id:'citation',text:'Источник: wikipedia:ru:8922043.'},{id:'story',text:'История башни. Источник: wikipedia:en:47620877.'}]);await tick();assert.deepEqual(bodies,['История башни.']);n.stop()});
