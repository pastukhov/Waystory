import test from 'node:test';
import assert from 'node:assert/strict';
import * as facts from '../server/sources/facts.mjs';
const evidence=[{id:'a',sourceId:'wiki:en:1',revision:'1',start:0,end:25,text:'The museum opened in 1900.',scope:'place',language:'en'}];
const chapter={text:'Музей открылся в 1900 году.',claims:[{text:'Музей открылся в 1900 году.',evidenceIds:['a']}]};
const response=(review,finish='stop')=>Response.json({choices:[{finish_reason:finish,message:{content:typeof review==='string'?review:JSON.stringify(review)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}});
const supported={supported:true,issues:[]};
const opts=fetchFn=>({fetchFn,headers:{Authorization:'Bearer fixture'},model:'fixture',endpoint:'https://fixture.invalid/review'});

test('translated fact is reviewed against original spans and the entire chapter',async()=>{
 let payload;const result=await facts.reviewChapter(chapter,evidence,opts(async(url,options)=>{assert.equal(url,'https://fixture.invalid/review');payload=JSON.parse(options.body);return response(supported)}));
 assert.deepEqual(result,{outcome:'supported',issues:[]});assert.equal(payload.max_tokens,3000);
 const data=JSON.parse(payload.messages[1].content);assert.deepEqual(data.chapter,chapter);assert.deepEqual(data.spans,evidence);
 assert.match(payload.messages[0].content,/every factual assertion/i);assert.match(payload.messages[0].content,/unlisted|omitted/i);assert.match(payload.messages[0].content,/original language/i);assert.match(payload.messages[0].content,/untrusted/i);
});
test('invented evidence IDs reject before calling the model',async()=>{
 const result=await facts.reviewChapter({...chapter,claims:[{...chapter.claims[0],evidenceIds:['invented']}]},evidence,opts(async()=>{assert.fail('must not call model')}));
 assert.deepEqual(result,{outcome:'rejected',issues:[{claimIndex:0,reason:'unknown_evidence'}]});
});
test('claim text must occur verbatim and each claim needs evidence',async()=>{
 for(const [claim,reason] of [[{text:'Omitted fact',evidenceIds:['a']},'invalid_claim'],[{text:chapter.text,evidenceIds:[]},'missing_evidence']]){
  assert.deepEqual(await facts.reviewChapter({...chapter,claims:[claim]},evidence,opts(async()=>assert.fail('must not call model'))),{outcome:'rejected',issues:[{claimIndex:0,reason}]});
 }
});
const semanticCases=[
 {label:'existing but irrelevant span',reason:'unsupported_claim',text:'The museum opened in 1900.',spans:[{...evidence[0],text:'The museum has a garden.'}],instruction:/irrelevant span/i},
 {label:'district history assigned to landmark',reason:'regional_context',text:'The museum was founded in 1700.',spans:[{...evidence[0],scope:'area',text:'The district was founded in 1700.'}],instruction:/regional context/i},
 {label:'another object',reason:'wrong_object',text:'The museum opened in 1900.',spans:[{...evidence[0],text:'The library opened in 1900.'}],instruction:/wrong-object/i},
 {label:'contradicting source editions',reason:'contradiction',text:'The museum opened in 1900.',spans:[...evidence,{...evidence[0],id:'b',language:'fr',text:'Le musée a ouvert en 1800.'}],instruction:/all supplied spans for contradictions/i},
 {label:'fact omitted from claims',reason:'uncovered_claim',text:chapter.text+' It has ten towers.',spans:evidence,instruction:/omitted or unlisted/i}
];
for(const {label,reason,text,spans,instruction} of semanticCases)test(`${label} is a semantic rejection without repair`,async()=>{
 const input={text,claims:[{text:reason==='uncovered_claim'?chapter.text:text,evidenceIds:['a']}]};
 let calls=0;const result=await facts.reviewChapter(input,spans,opts(async(_,options)=>{
  calls++;const payload=JSON.parse(options.body),data=JSON.parse(payload.messages[1].content);
  assert.deepEqual(data.chapter,input);assert.deepEqual(data.spans,spans);assert.match(payload.messages[0].content,instruction);
  return response({supported:false,issues:[{claimIndex:reason==='uncovered_claim'?null:0,reason}]});
 }));
 assert.deepEqual(result,{outcome:'rejected',issues:[{claimIndex:reason==='uncovered_claim'?null:0,reason}]});assert.equal(calls,1);
});
for(const [label,first] of [['invalid JSON','{'],['truncated response',supported],['invalid schema',{supported:true}]])test(`${label} permits exactly one technical repair`,async()=>{
 let calls=0;const requests=[];const result=await facts.reviewChapter(chapter,evidence,opts(async(_,o)=>{requests.push(JSON.parse(o.body));return ++calls===1?response(first,label==='truncated response'?'length':'stop'):response(supported)}));
 assert.equal(result.outcome,'supported');assert.equal(calls,2);assert.ok(requests[1].max_tokens<requests[0].max_tokens);assert.deepEqual(JSON.parse(requests[1].messages[1].content),JSON.parse(requests[0].messages[1].content));
});
test('repeated length finish reasons remain technical errors after one repair',async()=>{
 let calls=0;assert.deepEqual(await facts.reviewChapter(chapter,evidence,opts(async()=>{calls++;return response(supported,'length')})),{outcome:'error',issues:[{claimIndex:null,reason:'incomplete_response'}]});assert.equal(calls,2);
});
test('service call budget is consumed before each call and can prevent repair',async()=>{
 let fetches=0,charges=0;const result=await facts.reviewChapter(chapter,evidence,{...opts(async()=>{fetches++;return response('{')}),consumeCall:()=>++charges<=1});
 assert.deepEqual(result,{outcome:'error',issues:[{claimIndex:null,reason:'budget_exhausted'}]});assert.equal(fetches,1);assert.equal(charges,2);
});
test('expired deadline prevents the initial call and repair uses only remaining time',async()=>{
 let now=1000,calls=0;const options={...opts(async()=>{calls++;now=2000;return response('{')}),now:()=>now,deadline:1500};
 const result=await facts.reviewChapter(chapter,evidence,options);assert.deepEqual(result,{outcome:'error',issues:[{claimIndex:null,reason:'provider_timeout'}]});assert.equal(calls,1);
 assert.equal((await facts.reviewChapter(chapter,evidence,options)).outcome,'error');assert.equal(calls,1);
});
test('provider errors and transport failures never trigger repair or leak response text',async()=>{
 for(const fetchFn of [async()=>new Response('sensitive provider text',{status:500}),async()=>{throw Error('sensitive secret')}])assert.deepEqual(await facts.reviewChapter(chapter,evidence,opts(fetchFn)),{outcome:'error',issues:[{claimIndex:null,reason:'provider_error'}]});
});
test('invalid issue indexes or unallowlisted reasons cannot become semantic rejection',async()=>{
 for(const issue of [{claimIndex:3,reason:'contradiction'},{claimIndex:0,reason:'secret model text'}])assert.deepEqual(await facts.reviewChapter(chapter,evidence,opts(async()=>response({supported:false,issues:[issue]}))),{outcome:'error',issues:[{claimIndex:null,reason:'invalid_schema'}]});
});
test('chapter review checks semantic repetition against previous verified claims',async()=>{
 const input={...chapter,previousClaims:[{text:'Previously verified palace fact.',evidenceIds:['a']}]};
 const result=await facts.reviewChapter(input,evidence,opts(async(_,o)=>{const body=JSON.parse(o.body);assert.match(body.messages[0].content,/semantic repetition/i);assert.deepEqual(JSON.parse(body.messages[1].content).chapter.previousClaims,input.previousClaims);return response({supported:false,issues:[{claimIndex:0,reason:'duplicate_claim'}]})}));
 assert.equal(result.outcome,'rejected');assert.equal(result.issues[0].reason,'duplicate_claim');
});
