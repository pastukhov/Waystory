import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createEpoch} from '../dist/core.mjs';
import {canReuseStory,STORY_VERSION} from '../dist/language.mjs';
const source=readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8');
const select=source.slice(source.indexOf('async function selectPlace('),source.indexOf('function showPlayer(){'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const materials={officialLinks:[{url:'https://museum.example/audio',title:'Museum audio',kind:'audio'}],searchLinks:[{url:'https://visitor.example/guide',title:'Visitor guide'}],discoveryStatus:{web:'unavailable',official:'ok'}};
function setup(overrides={}){
 const nodes=new Map(),calls=[],messages=[];const node=()=>({replaceChildren(){},classList:{remove(){}},close(){}});
 const ctx={state:{user:{name:'Pilot'},ai:true,multisource:true},AbortController,STORY_VERSION,LANGUAGE:'ru',canReuseStory,canListen:()=>false,placeEpoch:createEpoch(),answerEpoch:createEpoch(),answerController:undefined,placeController:undefined,narrator:{stop(){}},configReady:Promise.resolve(),loadAccount:async()=>{},$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},document:{body:{classList:{remove(){}}}},showArt(){},openDialog(){},t:x=>x,message:text=>messages.push(text),safeError:e=>e.message,renderStory(){},renderMaterials(){},resolvePlace:async p=>({...p,placeId:'resolved:'+p.id}),loadPlace:async p=>({...p,blocks:[]}),enrichPlace:async(id,signal,language)=>{calls.push({id,signal,language});return materials},aiRequest:async()=>{throw Error('AI rejected')},...overrides};
 runInNewContext(select+'\nthis.select=selectPlace;',ctx);return {ctx,calls,messages};
}
test('materials load after resolving identity while AI is still pending, and survive AI rejection',async()=>{
 const ai=deferred();let storyRenders=0;const {ctx,calls,messages}=setup({aiRequest:()=>ai.promise,renderStory(){storyRenders++}});const pending=ctx.select({id:'one',title:'Museum'});await tick();
 assert.equal(calls[0].id,'resolved:one');assert.equal(calls[0].language,'ru');assert.equal(ctx.state.selected.officialLinks[0].title,'Museum audio');assert.equal(ctx.state.selected.materialsLoading,false);
 assert.equal(storyRenders,0,'pending material fetch must not activate unfinished story controls or clamp depth');
 ai.reject(Error('AI rejected'));await pending;assert.equal(storyRenders,1);assert.equal(ctx.state.selected.searchLinks[0].title,'Visitor guide');assert.equal(ctx.state.selected.discoveryStatus.web,'unavailable');assert.ok(messages.includes('AI rejected'));
});
test('cached stories fetch links in the background without generating another story',async()=>{
 const enrich=deferred();let aiCalls=0;const {ctx}=setup({enrichPlace:()=>enrich.promise,aiRequest:async()=>{aiCalls++;throw Error('unexpected')}});
 await ctx.select({id:'one',placeId:'one',title:'Saved',aiGenerated:true,storyLanguage:'ru',storyVersion:STORY_VERSION,blocks:[{id:'a',depth:0,text:'Saved narration'}]});assert.equal(aiCalls,0);assert.equal(ctx.state.selected.materialsLoading,true);
 enrich.resolve(materials);await tick();assert.equal(ctx.state.selected.officialLinks.length,1);assert.equal(ctx.state.selected.blocks[0].text,'Saved narration');
});
test('late results cannot replace the newly selected place, even when transport ignores abort',async()=>{
 const first=deferred(),second=deferred(),calls=[];const {ctx}=setup({state:{user:{},ai:false,multisource:true},enrichPlace:(id,signal)=>{calls.push({id,signal});return id==='one'?first.promise:second.promise}});
 await ctx.select({id:'one',placeId:'one',title:'First'});await ctx.select({id:'two',placeId:'two',title:'Second'});assert.equal(calls[0].signal.aborted,true);
 second.resolve({...materials,officialLinks:[{url:'https://second.example',title:'Second'}]});await tick();first.resolve(materials);await tick();assert.equal(ctx.state.selected.title,'Second');assert.equal(ctx.state.selected.officialLinks[0].title,'Second');
});
test('enrichment transport failure does not discard a successful guide or its official links',async()=>{
 const enrich=deferred();const {ctx}=setup({enrichPlace:()=>enrich.promise,aiRequest:async()=>({...materials,language:'ru',storyVersion:STORY_VERSION,blocks:[{id:'a',depth:0,text:'Verified story'}]})});
 await ctx.select({id:'one',placeId:'one',title:'Museum'});enrich.reject(Error('offline'));await tick();assert.equal(ctx.state.selected.blocks[0].text,'Verified story');assert.equal(ctx.state.selected.officialLinks.length,1);assert.equal(ctx.state.selected.discoveryStatus.official,'unavailable');
});
test('unauthenticated selection never requests enrichment',async()=>{
 const {ctx,calls}=setup({state:{user:null,ai:false,multisource:true}});await ctx.select({id:'one',placeId:'one',title:'Museum'});assert.equal(calls.length,0);
});
