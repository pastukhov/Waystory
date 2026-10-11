// Executed via stdin inside the existing container. Never prints environment values.
const mode=process.argv[2]||'diagnose',env=process.env;
const secrets=Object.entries(env).filter(([k,v])=>/KEY|SECRET|TOKEN|PASSWORD|COOKIE|FOLDER|EMAIL|CLIENT_ID/.test(k)&&v?.length>3).map(([,v])=>v).sort((a,b)=>b.length-a.length);
const clean=value=>secrets.reduce((s,v)=>s.replaceAll(v,'[redacted]'),String(value)).slice(0,1200);
const report=data=>console.log(JSON.stringify(data));
async function errorBody(response){
 const reader=response.body?.getReader();if(!reader)return '';
 let text='',bytes=0;try{while(bytes<8192){const {done,value}=await reader.read();if(done)break;bytes+=value.length;text+=Buffer.from(value).toString('utf8')}}finally{await reader.cancel().catch(()=>{})}
 return clean(text);
}
async function probe(name,url,options){
 const start=Date.now();try{const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});const result={probe:name,status:r.status,durationMs:Date.now()-start};
 if(!r.ok){result.error=await errorBody(r);process.exitCode=1}else await r.body?.cancel();report(result);
 }catch(e){report({probe:name,error:e.name==='TimeoutError'?'timeout':'network_error',durationMs:Date.now()-start});process.exitCode=1}
}
if(mode==='diagnose'){
 const base='http://127.0.0.1:5173';
 try{
  const r=await fetch(base+'/api/session',{signal:AbortSignal.timeout(5000)}),s=await r.json();report({probe:'session',status:r.status,googleConfigured:s.enabled===true,anonymous:s.user===null});if(!r.ok||s.user!==null)process.exitCode=1;
  for(const path of ['/api/guide','/api/speech']){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});report({probe:path,status:r.status,anonymousDenied:r.status===(s.enabled?401:503)});if(r.status!==(s.enabled?401:503))process.exitCode=1;await r.body?.cancel()}
 }catch{report({probe:'application',error:'unreachable'});process.exitCode=1}
}else if(mode==='speech-test'){
 const {createSpeech}=await import(new URL('./server/tts.mjs','file://'+process.cwd()+'/'));
 for(const [language,text] of [['ru','Проверка голоса.'],['en','Voice test.']]){
  const start=Date.now(),name='speech-'+language;
  const speech=createSpeech({env,fetchFn:async(...args)=>{
   const response=await fetch(...args);
   if(!response.ok)report({probe:name+'-upstream',status:response.status,error:await errorBody(response.clone())});
   return response;
  }});
  try{const audio=await speech.run({language,text});report({probe:name,valid:true,bytes:audio.length,durationMs:Date.now()-start})}
  catch(error){report({probe:name,valid:false,status:error.status||null,error:clean(error.message),durationMs:Date.now()-start});process.exitCode=1}
 }
}else if(mode==='speech-format-test'){
 const key=env.YANDEX_TTS_API_KEY||env.YANDEX_API_KEY;
 if(!key){report({probe:'speech',error:'not_configured'});process.exitCode=1}else{
  for(const [format,voice] of [['oggopus','filipp'],['mp3','marina']])await probe('speech-ru-'+format+'-'+voice,'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',{method:'POST',headers:{Authorization:'Api-Key '+key,'Content-Type':'application/x-www-form-urlencoded','x-data-logging-enabled':'false'},body:new URLSearchParams({text:'Проверка голоса.',voice,lang:'ru-RU',format,speed:'1.0'}).toString()});
 }
}else if(mode==='ai-test'){
 const key=env.YANDEX_API_KEY,folder=env.YANDEX_FOLDER_ID;
 if(!key||!folder){report({probe:'ai',error:'not_configured'});process.exitCode=1}else{
  const model=env.YANDEX_QUESTION_MODEL||'aliceai-llm-flash';
  await probe('ai','https://ai.api.cloud.yandex.net/v1/chat/completions',{method:'POST',headers:{Authorization:'Api-Key '+key,'OpenAI-Project':folder,'Content-Type':'application/json','x-data-logging-enabled':'false'},body:JSON.stringify({model:model.startsWith('gpt://')?model:`gpt://${folder}/${model}`,messages:[{role:'user',content:'Reply with OK.'}],max_tokens:32,stream:false})});
  const {createGuide}=await import(new URL('./server/guide.mjs','file://'+process.cwd()+'/'));
  const start=Date.now();
  const fixedSource={id:'ops-aunesis',provider:'wikipedia',url:'https://en.wikipedia.org/wiki/Aunesis',title:'Aunesis',language:'en',kind:'history',scope:'place',placeIds:['wiki:en:1'],retrievedAt:null,publishedAt:null,updatedAt:null,revision:'fixed-diagnostic',text:'Aunesis was a coastal town of ancient Pamphylia or of Cilicia, inhabited during Roman times. It was the port of Hamaxia. Its site is located below Hamaxia, in Turkey.',license:{id:'CC-BY-SA-4.0',url:'https://creativecommons.org/licenses/by-sa/4.0/',policyId:'wikimedia-cc-by-sa',attribution:'English Wikipedia contributors, fixed diagnostic excerpt'}};
  const guide=createGuide({env,collectSources:async()=>({place:{id:'wiki:en:1',refs:[{provider:'wikipedia',language:'en',pageId:1}],names:{original:'Aunesis'}},documents:[fixedSource],statuses:[],fingerprint:'fixed-diagnostic-v3'}),fetchFn:async(...args)=>{
   const response=await fetch(...args);
   if(!response.ok)report({probe:'ai-story-upstream',status:response.status,error:await errorBody(response.clone())});
   return response;
  }});
  try{
   const story=await guide.run({action:'story',language:'ru',placeId:'wiki:en:1',place:{title:'Aunesis',source:'https://en.wikipedia.org/wiki/Aunesis',text:'Aunesis was a coastal town of ancient Pamphylia or of Cilicia, inhabited during Roman times. It was the port of Hamaxia. Its site is located below Hamaxia, in Turkey.'}});
   report({probe:'ai-story',valid:true,language:story.language,blocks:story.blocks.length,durationMs:Date.now()-start});
  }catch(error){report({probe:'ai-story',valid:false,status:error.status||null,error:clean(error.message),durationMs:Date.now()-start});process.exitCode=1}
 }
}else{report({error:'unsupported_operation'});process.exitCode=1}
