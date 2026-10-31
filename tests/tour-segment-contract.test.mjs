import test from 'node:test';
import assert from 'node:assert/strict';
import {generateChapter,chapterOutputReason,coveredFactKey} from '../server/tours/generator.mjs';
import {createTourModel} from '../server/tours/service.mjs';
const spans=[{id:'1'.repeat(64),sourceId:'source:first',text:'Дворец построен в XVIII веке.',scope:'place',language:'ru'},{id:'2'.repeat(64),sourceId:'source:second',text:'Музей открылся позже.',scope:'place',language:'ru'}];
const topic={id:'3'.repeat(64),title:'История',evidenceIds:spans.map(s=>s.id)},place={id:'wiki:ru:173387'};
const wire={language:'ru',segments:[{text:'Дворец построен в XVIII веке.',evidenceIds:['e1']},{text:'Музей открылся позже.',evidenceIds:['e2','e1']}]};
test('ordered producer segments compose exact prose and canonical claims through the JSON adapter',async()=>{
 const requests=[],model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async(_url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(requests.length===1?wire:{supported:true,issues:[]})}}]});
 }});
 const result=await generateChapter({place,language:'ru',topic,spans},{complete:model.complete,review:model.review});
 assert.equal(result.status,'ready');assert.equal(requests.length,2);
 const schema=requests[0].response_format.json_schema.schema;
 assert.deepEqual(schema.required,['language','segments']);assert.deepEqual(schema.properties.segments.items.properties.evidenceIds.items.enum,['e1','e2']);
 assert.equal(schema.properties.segments.maxItems,100);
 assert.equal(result.text,wire.segments.map(s=>s.text).join('\n\n'));
 assert.deepEqual(result.claims,[{text:wire.segments[0].text,evidenceIds:[spans[0].id]},{text:wire.segments[1].text,evidenceIds:[spans[1].id,spans[0].id]}]);
 assert.deepEqual(result.evidenceIds,spans.map(s=>s.id));assert.deepEqual(result.coveredFactKeys,result.claims.map(coveredFactKey));
 assert.equal(chapterOutputReason({language:'ru',text:result.text,evidenceIds:result.evidenceIds,claims:result.claims},'ru',spans,topic),null);
 const reviewed=JSON.parse(requests[1].messages[1].content);
 assert.equal(reviewed.chapter.text,result.text);assert.deepEqual(reviewed.chapter.claims,result.claims);assert.deepEqual(reviewed.spans,spans);
 assert.match(requests[1].messages[0].content,/entire chapter/);
});
test('malformed segments and aggregate bounds fail closed without reviewing partial prose',async()=>{
 const segment=wire.segments[0];
 const invalid=[null,{...wire,extra:'hidden'}, {...wire,text:'hidden legacy prose'}, {...wire,segments:null},{...wire,segments:[]},{...wire,segments:Array.from({length:101},()=>segment)},
  ...[null,{...segment,extra:true},{...segment,text:''},{...segment,text:'  '},{...segment,text:42},{...segment,evidenceIds:[]},{...segment,evidenceIds:['e1','e1']},{...segment,evidenceIds:['e3']},{...segment,evidenceIds:[spans[0].id]},{...segment,evidenceIds:[1]}].map(s=>({language:'ru',segments:[s]})),
  {language:'ru',segments:[{text:'Ф'.repeat(3000),evidenceIds:['e1']},{text:'Ф'.repeat(3000),evidenceIds:['e2']}]}, {...wire,language:'en'}];
 for(const output of invalid){
  let reviews=0,calls=0;const c=await generateChapter({place,language:'ru',topic,spans},{complete:async()=>{calls++;return output},review:async()=>{reviews++;return {outcome:'supported',issues:[]}}});
  assert.equal(c.status,'failed');assert.equal(calls,2);assert.equal(reviews,0);assert.equal(c.text,null);assert.deepEqual(c.claims,[]);
 }
});
test('whole-text grounding rejects a contradiction inside an otherwise valid producer segment',async()=>{
 let generations=0,reviews=0;
 const text='Дворец построен в XVIII веке. Музей закрыт.';
 const model=createTourModel({env:{AI_PROVIDER:'routerai',ROUTERAI_API_KEY:'fixture'},fetchFn:async(_url,options)=>{
  const body=JSON.parse(options.body),payload=JSON.parse(body.messages[1].content);let result;
  if(body.response_format.json_schema.name==='tour_chapter'){generations++;result={language:'ru',segments:[{text,evidenceIds:['e1']}]};}
  else{reviews++;assert.equal(payload.chapter.text,text);assert.deepEqual(payload.chapter.claims,[{text,evidenceIds:[spans[0].id]}]);assert.match(body.messages[0].content,/facts omitted or unlisted in claims/);result={supported:false,issues:[{claimIndex:0,reason:'contradiction'}]};}
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
 }});
 const result=await generateChapter({place,language:'ru',topic,spans},{complete:model.complete,review:model.review});
 assert.equal(result.status,'failed');assert.equal(result.error.code,'verification_failed');assert.equal(generations,2);assert.equal(reviews,2);assert.equal(result.text,null);
});
