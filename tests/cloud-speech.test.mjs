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
