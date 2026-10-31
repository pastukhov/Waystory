import test from 'node:test';
import assert from 'node:assert/strict';
import {planTour} from '../server/tours/planner.mjs';

const spans=[{id:'palace',scope:'place',text:'Кусково: дворец XVIII века.',language:'ru'},{id:'park',scope:'place',text:'Кусково: парк с прудами.',language:'ru'},{id:'area',scope:'area',text:'Москва.',language:'ru'}];
const topic=(title,evidenceIds=['palace'])=>({title,summary:'Подтверждённая тема.',evidenceIds,status:'available',reason:null});
test('planner keeps only grounded place topics, caps six and assigns stable server IDs',async()=>{
 const complete=async()=>({topics:[topic('История'),topic(' История '),topic('Район',['area']),topic('Выдумка',['invented']),...Array.from({length:8},(_,i)=>topic('Тема '+i))]});
 const a=await planTour({place:{id:'wiki:ru:173387'},language:'ru',spans},{complete});
 const b=await planTour({place:{id:'wiki:ru:173387'},language:'ru',spans:[...spans].reverse()},{complete});
 assert.equal(a.length,6);assert.equal(new Set(a.map(t=>t.id)).size,6);assert.deepEqual(a,b);
 assert.ok(a.every(t=>/^[a-f0-9]{64}$/.test(t.id)&&t.evidenceIds.includes('palace')));
});
test('empty or regional corpus yields no topics and no paid plan call',async()=>{
 for(const evidence of [[],[spans[2]]])assert.deepEqual(await planTour({language:'ru',spans:evidence},{complete:()=>assert.fail('empty corpus')}),[]);
});
test('poor material may yield only an overview without invented themes',async()=>{
 assert.deepEqual(await planTour({language:'en',spans:[spans[0]]},{complete:async()=>({topics:[]})}),[]);
});
test('planner rejects invalid language and aborted requests before model work',async()=>{
 await assert.rejects(planTour({language:'fr',spans},{complete:()=>assert.fail()}),{code:'invalid_request'});
 await assert.rejects(planTour({language:'ru',spans},{complete:()=>assert.fail(),signal:AbortSignal.abort()}),{name:'AbortError'});
});
