import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createApp} from '../server/index.mjs';
import {createToursClient} from '../dist/tours-client.mjs';
import {createEpoch} from '../dist/core.mjs';
import {canReuseStory,STORY_VERSION} from '../dist/language.mjs';

const source=readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8');
const select=source.slice(source.indexOf('async function selectPlace('),source.indexOf('function showPlayer(){'));
const config=source.slice(source.indexOf('async function config(){'),source.indexOf('const configReady=config();'));
const account=source.slice(source.indexOf('async function loadAccount(){'),source.indexOf("$('account-open').onclick="));
const openTour=source.slice(source.indexOf('async function openTour('),source.indexOf("window.addEventListener('pagehide',()=>tourPlayer.stop());"));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}};

async function setup(t){
 let signedIn=false;
 const app=createApp({env:{ROUTERAI_API_KEY:'fixture'},sourceDbPath:':memory:',tours:{start:async()=>({status:200,tourId:'459fdcd9-e879-4ea2-9a17-65116befea37',tour:{id:'459fdcd9-e879-4ea2-9a17-65116befea37',status:'ready',sources:[],topics:[],chapters:[]}})},auth:{enabled:true,origin:'https://ws.test',session:()=>signedIn?{id:'owner',name:'Owner'}:null,consume(){},usage:()=>null},logWriter:()=>{}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>app.close(resolve)));
 const nodes=new Map(),calls=[],messages=[];
 const node=()=>({replaceChildren(){},classList:{remove(){}},close(){},querySelector(){return this}});
 let holdConfig=null,failConfig=false,omitTours=false;
 const ctx={state:{user:null,tours:false,ai:false,multisource:false},AbortController,setTimeout,clearTimeout,STORY_VERSION,LANGUAGE:'ru',canReuseStory,canListen:()=>false,placeEpoch:createEpoch(),answerEpoch:createEpoch(),placeController:undefined,answerController:undefined,tourMode:false,tourPlayback:false,tourLoading:null,tourFailure:false,discoveryToken:0,
  tourPlayer:{clear(){},open(){}},drawTour(){},readTourCursor:()=>null,renderSources(){},tourError:e=>messages.push(e.message),narrator:{stop(){}},$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},document:{querySelector:id=>ctx.$(id),body:{classList:{remove(){}}}},renderAccount(data){ctx.state.user=data.user;},
  fetch:async(path,options)=>{calls.push(path);if(path==='/api/config'){if(holdConfig)await holdConfig.promise;if(failConfig)throw Error('offline')}const response=await fetch('http://127.0.0.1:'+app.address().port+path,{...options,headers:{...options?.headers,Origin:'https://ws.test'}});if(path==='/api/config'&&omitTours){const data=await response.json();delete data.tours;return Response.json(data)}return response},
  showArt(){},openDialog(){},t:x=>x,message:text=>messages.push(text),safeError:e=>e.message,renderStory(){},renderMaterials(){},translateDiscovery(){},translateLibrary(){},resolvePlace:async p=>({...p,placeId:'wiki:ru:173387502'}),loadPlace:async p=>({...p,blocks:[]}),enrichPlace:async()=>{calls.push('legacy-enrich');return {}},aiRequest:async()=>{calls.push('legacy-guide');throw Error('legacy guide')},
 };
 ctx.toursClient=createToursClient({fetchFn:(...args)=>ctx.fetch(...args)});
 runInNewContext(account+'\n'+config+'\n'+openTour+'\n'+select+'\nthis.config=config;this.select=selectPlace;',ctx);
 let opened=Promise.resolve();const runTour=ctx.openTour;ctx.openTour=(...args)=>{calls.push('tour');return opened=runTour(...args)};
 ctx.configReady=ctx.config();
 return {ctx,calls,messages,nodes,base:'http://127.0.0.1:'+app.address().port,settle:()=>opened,signIn(){signedIn=true},signOut(){signedIn=false},hold(){holdConfig=deferred();return holdConfig},fail(value){failConfig=value},omitTours(){omitTours=true}};
}
const place={id:'wiki-ru-173387502',placeId:'wiki:ru:173387502',title:'Кусково',blocks:[]};
test('real server capability response activates tours on fresh authenticated selection',async t=>{
 const f=await setup(t);f.signIn();await f.ctx.configReady;await f.ctx.select(place);await f.settle();
 assert.ok(f.calls.includes('/api/tours'));assert.equal(f.ctx.state.tours,true);assert.ok(f.calls.includes('tour'));assert.equal(f.calls.includes('legacy-guide'),false);
});
test('selection refreshes an anonymous bootstrap after the account becomes authenticated',async t=>{
 const f=await setup(t);await f.ctx.configReady;assert.equal(f.ctx.state.tours,false);f.signIn();await f.ctx.select(place);await f.settle();
 assert.ok(f.calls.includes('/api/tours'));assert.equal(f.ctx.state.tours,true);assert.ok(f.calls.includes('tour'));assert.equal(f.calls.includes('legacy-guide'),false);assert.equal(f.calls.includes('legacy-enrich'),false);
});
test('selection retries a failed bootstrap against the real server config',async t=>{
 const f=await setup(t);f.fail(true);await f.ctx.configReady;f.fail(false);f.signIn();await f.ctx.select(place);await f.settle();
 assert.ok(f.calls.includes('/api/tours'));assert.equal(f.ctx.state.tours,true);assert.ok(f.calls.includes('tour'));assert.equal(f.calls.includes('legacy-guide'),false);
});
test('selection waits for slow refreshed capabilities before choosing its narration path',async t=>{
 const f=await setup(t);await f.ctx.configReady;f.signIn();const gate=f.hold(),pending=f.ctx.select(place);await tick();await tick();
 assert.equal(f.calls.includes('tour'),false);assert.equal(f.calls.includes('legacy-guide'),false);gate.resolve();await pending;await f.settle();
 assert.ok(f.calls.includes('/api/tours'));assert.equal(f.ctx.state.tours,true);assert.ok(f.calls.includes('tour'));assert.equal(f.calls.includes('legacy-guide'),false);
});
test('HTML and mutable JavaScript require revalidation on reload',async t=>{
 const f=await setup(t);await f.ctx.configReady;
 for(const path of ['/','/app.mjs','/tours-client.mjs']){
  const response=await fetch(f.base+path);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')||'',/no-cache|no-store/);
 }
});

test('a failed refresh cannot reuse stale legacy capabilities after account recovery',async t=>{
 const f=await setup(t);await f.ctx.configReady;f.signIn();f.ctx.state.ai=true;f.ctx.state.tours=false;f.fail(true);await f.ctx.select(place);
 assert.equal(f.calls.includes('legacy-guide'),false);assert.equal(f.calls.includes('legacy-enrich'),false);assert.equal(f.calls.includes('tour'),false);assert.ok(f.messages.some(text=>/Не удалось загрузить экскурсию/.test(text)));
});
test('a live AI config missing the tour capability cannot silently choose the legacy guide',async t=>{
 const f=await setup(t);await f.ctx.configReady;f.signIn();f.omitTours();await f.ctx.select(place);
 assert.equal(f.calls.includes('legacy-guide'),false);assert.ok(f.messages.some(text=>/Не удалось загрузить экскурсию/.test(text)));
});

test('an expired session blocks selection even when bootstrap advertised tours',async t=>{
 const f=await setup(t);f.signIn();await f.ctx.configReady;assert.equal(f.ctx.state.tours,true);f.signOut();await f.ctx.select(place);
 assert.equal(f.ctx.state.user,null);assert.equal(f.calls.includes('/api/tours'),false);assert.equal(f.calls.includes('legacy-guide'),false);
});
test('a later selection wins when both wait for slow capability responses',async t=>{
 const f=await setup(t);await f.ctx.configReady;f.signIn();const gate=f.hold();
 const first=f.ctx.select({...place,title:'First'}),second=f.ctx.select({...place,title:'Second'});await tick();gate.resolve();await Promise.all([first,second]);await f.settle();
 assert.equal(f.ctx.state.selected.title,'Second');assert.equal(f.calls.filter(path=>path==='/api/tours').length,1);assert.equal(f.calls.includes('legacy-guide'),false);
});
