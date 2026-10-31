import test from 'node:test';
import assert from 'node:assert/strict';
import * as generator from '../server/tours/generator.mjs';
import {createObservability,safeTelemetryEntry} from '../server/observability.mjs';

const span={id:'1'.repeat(64),sourceId:'source:1',scope:'place',text:'Музей открыт.'},topic={id:'overview',evidenceIds:[span.id]},text='Музей открыт.';
const chapter=()=>({language:'ru',text,evidenceIds:[span.id],claims:[{text,evidenceIds:[span.id]}]});
test('chapter validation reports only precise enum reasons without changing acceptance',()=>{
 assert.equal(typeof generator.chapterOutputReason,'function');
 assert.equal(generator.chapterOutputReason(chapter(),'ru',[span],topic),null);
 const second={...span,id:'2'.repeat(64)};assert.equal(generator.chapterOutputReason({...chapter(),evidenceIds:[span.id,second.id]},'ru',[span,second],topic),'unused_evidence');
 assert.equal(generator.chapterOutputReason({...chapter(),claims:[{text,evidenceIds:[second.id]}]},'ru',[span,second],topic),'invalid_evidence');
 assert.equal(generator.chapterOutputReason({...chapter(),claims:[{text,evidenceIds:[span.id,span.id]}]},'ru',[span,second],topic),'invalid_evidence');
 assert.equal(generator.chapterOutputReason({...chapter(),claims:[{text,evidenceIds:['invented']}]},'ru',[span],topic),'invalid_evidence');
 assert.equal(generator.chapterOutputReason({...chapter(),claims:[{text,evidenceIds:[span.id],extra:true}]},'ru',[span],topic),'invalid_claim');
 for(const [change,reason] of [[{extra:'PRIVATE'},'invalid_schema'],[{language:'en'},'language_mismatch'],[{text:''},'text_bounds'],[{text:'English only'},'wrong_script'],[{evidenceIds:['unknown']},'invalid_evidence'],[{claims:[]},'invalid_claim'],[{claims:[{text:'Другая фраза.',evidenceIds:[span.id]}]},'claim_not_verbatim'],[{text:text+' '+span.id},'internal_id_leak']])assert.equal(generator.chapterOutputReason({...chapter(),...change},'ru',[span],topic),reason);
});
test('generation output diagnostics correlate attempts and redact all prose and unknown fields',()=>{
 const logs=[],observer=createObservability({env:{},write:line=>logs.push(JSON.parse(line))});
 observer.record('tour_generation_detail',{tourId:'459fdcd9-e879-4ea2-9a17-65116befea37',chapterId:'overview',stage:'generate',outcome:'rejected',attempt:2,reason:'claim_not_verbatim',text:'PRIVATE_MODEL_OUTPUT',claims:['PRIVATE_CLAIM']});
 assert.equal(logs.length,1);assert.equal(logs[0].reason,'claim_not_verbatim');assert.equal(logs[0].attempt,2);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE/);assert.deepEqual(safeTelemetryEntry({...logs[0],email:'PRIVATE'}),logs[0]);
});
test('legacy duplicate prose output is rejected before review with schema diagnostics',async()=>{
 const details=[];let calls=0,reviews=0;
 const result=await generator.generateChapter({place:{id:'wiki:ru:1'},language:'ru',topic,spans:[span]},{complete:async()=>{calls++;return {...chapter(),evidenceIds:['e1'],claims:[{text:'Другая фраза.',evidenceIds:['e1']}]}},review:async()=>{reviews++;return {outcome:'supported',issues:[]}},onDetails:value=>details.push(value)});
 assert.equal(result.status,'failed');assert.equal(result.error.code,'verification_failed');assert.equal(calls,2);assert.equal(reviews,0);assert.deepEqual(details,[{reason:'invalid_schema',attempt:1},{reason:'invalid_schema',attempt:2}]);
});
test('invalid segment references report only allowlisted evidence subtypes',async()=>{
 for(const [ids,evidenceIssue] of [[['unknown'],'claim_unknown'],[['e1','e1'],'claim_duplicate'],[[],'claim_shape'],[[1],'claim_unknown']]){
  const details=[];await generator.generateChapter({place:{id:'wiki:ru:1'},language:'ru',topic,spans:[span]},{complete:async()=>({language:'ru',segments:[{text,evidenceIds:ids}]}),review:()=>assert.fail(),onDetails:value=>details.push(value)});
  assert.deepEqual(details,[{reason:'invalid_evidence',attempt:1,evidenceIssue},{reason:'invalid_evidence',attempt:2,evidenceIssue}]);
 }
 const entry={event:'waystory_tour_generation_detail',requestId:'459fdcd9-e879-4ea2-9a17-65116befea37',stage:'generate',outcome:'rejected',reason:'invalid_evidence',evidenceIssue:'claim_unknown'};
 assert.equal(safeTelemetryEntry(entry).evidenceIssue,'claim_unknown');
 assert.ok(!('evidenceIssue' in safeTelemetryEntry({...entry,evidenceIssue:'PRIVATE'})));
});
