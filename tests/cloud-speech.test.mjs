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
test('prepares only the next fragment during playback and reuses its audio',async()=>{
 const bodies=[];const {n,audio,heard}=setup(async(url,o)=>{bodies.push(JSON.parse(o.body).text);return new Response('audio')});
 n.play([{id:'a',text:'First'},{id:'b',text:'Second'},{id:'c',text:'Third'}]);await tick();
 assert.deepEqual(bodies,['First','Second']);assert.deepEqual(heard,[]);
 audio.onended();await tick();assert.deepEqual(bodies,['First','Second','Third']);assert.deepEqual(heard,['a']);n.stop();
});
test('stopping aborts lookahead and ignores a late prefetched response',async()=>{
 let finish,signal;let calls=0;const {n,audio,heard}=setup(async(url,o)=>{if(++calls===1)return new Response('audio');signal=o.signal;return new Promise(r=>finish=r)});
 n.play([{id:'a',text:'First'},{id:'b',text:'Second'}]);await tick();assert.equal(calls,2);const ended=audio.onended;n.stop();assert.equal(signal.aborted,true);finish(new Response('audio'));await tick();ended();assert.equal(n.state,'idle');assert.deepEqual(heard,[]);
});
test('401 calls auth handler after the playing fragment ends and can retry unfinished parts',async()=>{
 let calls=0,auth=0;const bodies=[];const {n,audio,heard,errors}=setup(async(url,o)=>{bodies.push(JSON.parse(o.body).text);return ++calls===2?Response.json({error:'secret backend detail'},{status:401}):new Response('audio')});const d=device(n);n.onAuthRequired=()=>auth++;
 const blocks=[{id:'a',text:'word '.repeat(250)}];n.play(blocks);await tick();assert.equal(auth,0);assert.equal(n.state,'playing');audio.onended();await tick();assert.equal(auth,1);assert.deepEqual(heard,[]);assert.equal(d.spoken.length,0);assert.deepEqual(errors,[]);
 n.play(blocks);await tick();assert.equal(bodies[2],bodies[1]);audio.onended();assert.deepEqual(heard,['a']);n.stop();
});
test('first fragment 401 requests auth; stopped late 401 is ignored',async()=>{
 for(const stopped of [false,true]){let finish,auth=0;const {n,errors}=setup(()=>new Promise(r=>finish=r));const d=device(n);n.onAuthRequired=()=>auth++;n.play([{id:'a',text:'Hello'}]);if(stopped)n.stop();finish(Response.json({error:'denied'},{status:401}));await tick();assert.equal(auth,stopped?0:1);assert.deepEqual(errors,[]);assert.equal(d.spoken.length,0);n.stop()}
});
test('auth retry survives completed blocks being removed from the queue',async()=>{
 let calls=0,auth=0;const texts=[];const {n,audio,heard}=setup(async(url,o)=>{texts.push(JSON.parse(o.body).text);return ++calls===3?Response.json({error:'denied'},{status:401}):new Response('audio')});n.onAuthRequired=()=>auth++;
 const a={id:'a',text:'First'},b={id:'b',text:'word '.repeat(250)};n.play([a,b]);await tick();audio.onended();await tick();audio.onended();await tick();assert.equal(auth,1);assert.deepEqual(heard,['a']);n.play([b]);await tick();assert.equal(texts[3],texts[2]);audio.onended();assert.deepEqual(heard,['a','b']);n.stop();
});
test('changed text after auth resets the unfinished cursor',async()=>{
 let calls=0;const texts=[];const {n,audio}=setup(async(url,o)=>{texts.push(JSON.parse(o.body).text);return ++calls===2?Response.json({error:'denied'},{status:401}):new Response('audio')});n.onAuthRequired=()=>{};n.play([{id:'a',text:'word '.repeat(250)}]);await tick();audio.onended();await tick();n.play([{id:'a',text:'Changed story.'}]);await tick();assert.equal(texts.at(-1),'Changed story.');n.stop();
});
test('resume uses matching text hash and reports current chunk seconds',async()=>{
 const {n,audio,heard}=setup(async()=>new Response('audio'));const progress=[];n.onProgress=p=>progress.push(p);const block={id:'a',text:'word '.repeat(450)};
 n.play([block],{blockId:'a',chunkIndex:1,offsetSeconds:7,textHash:speech.speechTextHash(block.text),chunkingVersion:1});await tick();audio.onloadedmetadata();assert.equal(audio.currentTime,7);audio.currentTime=11;audio.ontimeupdate();assert.equal(progress.at(-1).chunkIndex,1);assert.equal(progress.at(-1).offsetSeconds,11);assert.deepEqual(heard,[]);n.stop();
});
test('changed speech text resets a supplied resume cursor',async()=>{const bodies=[];const {n,audio}=setup(async(url,o)=>{bodies.push(JSON.parse(o.body).text);return new Response('audio')});n.play([{id:'a',text:'Changed.'}],{blockId:'a',chunkIndex:2,offsetSeconds:8,textHash:'old',chunkingVersion:1});await tick();audio.onloadedmetadata();assert.equal(audio.currentTime,0);assert.equal(bodies[0],'Changed.');n.stop()});
test('only current and next audio blobs are retained and stop revokes URLs',async()=>{const create=URL.createObjectURL,revoke=URL.revokeObjectURL,live=new Set();let calls=0;URL.createObjectURL=()=>{const id='blob:'+calls;live.add(id);return id};URL.revokeObjectURL=id=>live.delete(id);try{const {n,audio}=setup(async()=>{calls++;return new Response('audio')});n.play([{id:'a',text:'word '.repeat(1000)}]);await tick();assert.equal(calls,2);assert.equal(live.size,1);audio.onended();await tick();assert.equal(live.size,1);n.stop();assert.equal(live.size,0);assert.equal(n.prefetch,null)}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke}});
test('oversized audio is rejected before retaining a blob',async()=>{const {n,errors}=setup(async()=>new Response(new Uint8Array(4*1024*1024+1)));n.play([{id:'a',text:'First'}]);await tick();await tick();assert.equal(n.objectUrl,undefined);assert.equal(errors.length,1);n.stop()});
test('continuous chapter lookahead reuses first audio without exceeding two blobs',async()=>{const bodies=[];const {n,audio}=setup(async(url,o)=>{bodies.push(JSON.parse(o.body).text);return new Response('audio')});const first={id:'a',text:'First'},second={id:'b',text:'Second'};n.play([first]);await tick();await n.prepareNext(second);assert.deepEqual(bodies,['First','Second']);audio.onended();n.play([second]);await tick();assert.deepEqual(bodies,['First','Second']);assert.equal(n.state,'playing');n.stop()});
test('next chapter audio waits until the final fragment and can be canceled',async()=>{const bodies=[];const {n,audio}=setup(async(url,o)=>{bodies.push(JSON.parse(o.body).text);return new Response('audio')});n.play([{id:'a',text:'word '.repeat(450)}]);await tick();n.prepareNext({id:'b',text:'Future chapter'});await tick();assert.equal(bodies.length,2);audio.onended();await tick();assert.equal(bodies.length,3);assert.equal(bodies.at(-1),'word '.repeat(450).trim().slice(2000).trim());n.clearPreparedNext();audio.onended();await tick();assert.equal(bodies.includes('Future chapter'),false);n.stop()});

test('cloud playing state waits for confirmed audio start and ignores stopped or paused pending play',async()=>{
 let resolve;const {n,audio}=setup(async()=>new Response('audio'));const states=[];n.onState=state=>states.push(state);audio.play=()=>new Promise(r=>resolve=r);
 n.play([{id:'a',text:'Тест'}]);await tick();assert.equal(states.includes('playing'),false);resolve();await tick();assert.equal(n.state,'playing');
 n.play([{id:'b',text:'Тест'}]);await tick();n.pause();resolve();await tick();assert.equal(n.state,'paused');
 n.resume();n.stop();resolve();await tick();assert.equal(n.state,'idle');
});
test('denied audio play does not report playing state',async()=>{
 const {n,audio}=setup(async()=>new Response('audio'));const states=[];n.onState=state=>states.push(state);audio.play=async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'})};n.play([{id:'a',text:'Тест'}]);await tick();assert.equal(states.includes('playing'),false);assert.equal(n.state,'paused');n.stop();
});
