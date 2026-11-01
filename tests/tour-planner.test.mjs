import test from 'node:test';
import assert from 'node:assert/strict';
import {planTour} from '../server/tours/planner.mjs';

const spans=[{id:'palace',scope:'place',text:'Кусково: дворец XVIII века.',language:'ru'},{id:'park',scope:'place',text:'Кусково: парк с прудами.',language:'ru'},{id:'area',scope:'area',text:'Москва.',language:'ru'}];
const topic=(title,evidenceIds=['palace'])=>({title,summary:'Подтверждённая тема.',evidenceIds,status:'available',reason:null});
test('planner keeps only grounded place topics, caps six and assigns stable server IDs',async()=>{
 const complete=async request=>{const payload=JSON.parse(request.messages[1].content),ref=id=>payload.spans.find(s=>s.text===spans.find(original=>original.id===id)?.text)?.id||id;return {topics:[topic('История'),topic(' История '),topic('Район',['area']),topic('Выдумка',['invented']),...Array.from({length:8},(_,i)=>topic('Тема '+i))].map(t=>({...t,evidenceIds:t.evidenceIds.map(ref)}))}};
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
test('planner compact wire refs map back before stable canonical topic identity and diagnostics',async()=>{
 const long=spans.map((s,i)=>({...s,id:String(i+1).repeat(64)})),before=JSON.stringify(long),details=[];let request;
 const result=await planTour({place:{id:'wiki:ru:173387'},language:'ru',spans:long},{onDetails:d=>details.push(d),complete:async r=>{request=r;return {topics:[topic('История',['e1','e1']),topic('Чужая ссылка',['e99']),{...topic('Ограниченная тема',['e2']),status:'limited',reason:'Материалов немного.'}]}}});
 assert.equal(result.length,2);assert.deepEqual(result[0].evidenceIds,[long[0].id]);assert.deepEqual(result[1].evidenceIds,[long[1].id]);
 const {factHash,normalizeFact}=await import('../server/tours/planner.mjs');assert.equal(result[0].id,factHash([normalizeFact('История'),[long[0].id]]));
 const payload=JSON.parse(request.messages[1].content);assert.deepEqual(payload.spans.map(s=>s.id),['e1','e2','e3']);
 assert.deepEqual(request.schema.schema.properties.topics.items.properties.evidenceIds.items.enum,['e1','e2','e3']);
 for(const s of long)assert.ok(!JSON.stringify(request).includes(s.id));assert.equal(JSON.stringify(long),before);
 assert.deepEqual(details,[{candidates:3,admitted:2,available:1,limited:1,rejected:1,rejections:{unknown_reference:1}}]);
});
test('planner diagnostics distinguish rejected candidates from meaningful limited themes without inflating availability',async()=>{
 const details=[],rows=[null,topic(''),{...topic('Длинная'),summary:'x'.repeat(301)},{...topic('Статус'),status:'invented'},{...topic('Причина'),status:'limited'},topic('Без ссылок',[]),topic('Не локальная',['palace']),topic('Район',['e3']),topic('История',['e1']),topic('История',['e1']),{...topic('Краткая',['e2']),status:'limited',reason:'Материалов немного.'},...Array.from({length:8},(_,i)=>topic('Тема '+i,['e1']))];
 const result=await planTour({language:'ru',spans},{complete:async()=>({topics:rows}),onDetails:d=>details.push(d)});
 assert.equal(result.length,6);assert.equal(result.filter(t=>t.status==='limited').length,1);
 assert.deepEqual(details,[{candidates:19,admitted:6,available:5,limited:1,rejected:13,rejections:{malformed_topic:1,invalid_title:1,invalid_summary:1,invalid_status:1,invalid_reason:1,missing_evidence:1,unknown_reference:1,missing_place:1,duplicate_topic:1,topic_cap:4}}]);
});
test('planner JSON adapter returns compact refs while persisting only equivalent canonical topic IDs',async()=>{
 const {createTourModel}=await import('../server/tours/service.mjs'),{factHash,normalizeFact}=await import('../server/tours/planner.mjs');let calls=0;
 const long=spans.map((s,i)=>({...s,id:String(i+1).repeat(64)}));
 const model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.max_tokens,2500);assert.deepEqual(body.response_format.json_schema.schema.properties.topics.items.properties.evidenceIds.items.enum,['e1','e2','e3']);
  assert.ok(!JSON.stringify(body).includes(long[0].id));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({topics:[topic('История',['e2','e1','e1']),topic('Инъекция',[long[0].id])]})}}]});
 }});
 const result=await planTour({language:'ru',spans:long},{complete:model.complete});assert.equal(calls,1);assert.equal(result.length,1);assert.deepEqual(result[0].evidenceIds,[long[0].id,long[1].id]);assert.equal(result[0].id,factHash([normalizeFact('История'),[long[0].id,long[1].id]]));
});
test('Russian topic prose requests ё while English instructions remain unchanged',async()=>{for(const language of ['ru','en'])await planTour({language,spans},{complete:async request=>{assert.equal(request.messages[0].content.includes('write ё'),language==='ru');return {topics:[]}}})});
