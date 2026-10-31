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
 assert.equal(generator.chapterOutputReason({...chapter(),claims:[{text,evidenceIds:['invented']}]},'ru',[span],topic),'invalid_evidence');
 assert.equal(generator.chapterOutputReason({...chapter(),claims:[{text,evidenceIds:[span.id],extra:true}]},'ru',[span],topic),'invalid_claim');
 for(const [change,reason] of [[{extra:'PRIVATE'},'invalid_schema'],[{language:'en'},'language_mismatch'],[{text:''},'text_bounds'],[{text:'English only'},'wrong_script'],[{evidenceIds:['unknown']},'invalid_evidence'],[{claims:[]},'invalid_claim'],[{claims:[{text:'Другая фраза.',evidenceIds:[span.id]}]},'claim_not_verbatim'],[{text:text+' '+span.id},'internal_id_leak']])assert.equal(generator.chapterOutputReason({...chapter(),...change},'ru',[span],topic),reason);
});
test('generation output diagnostics correlate attempts and redact all prose and unknown fields',()=>{
 const logs=[],observer=createObservability({env:{},write:line=>logs.push(JSON.parse(line))});
 observer.record('tour_generation_detail',{tourId:'459fdcd9-e879-4ea2-9a17-65116befea37',chapterId:'overview',stage:'generate',outcome:'rejected',attempt:2,reason:'claim_not_verbatim',text:'PRIVATE_MODEL_OUTPUT',claims:['PRIVATE_CLAIM']});
 assert.equal(logs.length,1);assert.equal(logs[0].reason,'claim_not_verbatim');assert.equal(logs[0].attempt,2);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE/);assert.deepEqual(safeTelemetryEntry({...logs[0],email:'PRIVATE'}),logs[0]);
});
test('two invalid own-claim copies remain rejected and emit attempt reasons before review',async()=>{
 const details=[];let calls=0;
 const result=await generator.generateChapter({place:{id:'wiki:ru:1'},language:'ru',topic,spans:[span]},{complete:async()=>{calls++;return {...chapter(),claims:[{text:'Другая фраза.',evidenceIds:[span.id]}]}},review:()=>assert.fail('invalid output must not reach review'),onDetails:value=>details.push(value)});
 assert.equal(result.status,'failed');assert.equal(result.error.code,'verification_failed');assert.equal(calls,2);assert.deepEqual(details,[{reason:'claim_not_verbatim',attempt:1},{reason:'claim_not_verbatim',attempt:2}]);
});
