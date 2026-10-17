import {selectedProvider,routerModel} from './ai-provider.mjs';
import {observe} from './request-context.mjs';
import {providerFailure} from './diagnostics.mjs';
import {createHash} from 'node:crypto';
import {GuideError} from './guide.mjs';
import {normalizeSpeechText} from '../dist/speech-text.mjs';
export function createSpeech({env=process.env,fetchFn=fetch,now=Date.now}={}){
 const provider=selectedProvider(env,'speech'),router=provider==='routerai';
 const key=router?env.ROUTERAI_API_KEY?.trim():env.YANDEX_TTS_API_KEY||env.YANDEX_API_KEY;
 const model=router?routerModel(env,'ROUTERAI_TTS_MODEL','x-ai/grok-voice-tts-1.0'):null;
 const enabled=Boolean(key)&&(router?env.ROUTERAI_TTS_ENABLED:env.YANDEX_TTS_ENABLED)!=='false';
 const voices=router?{ru:env.ROUTERAI_TTS_VOICE_RU||env.ROUTERAI_TTS_VOICE||'eve',en:env.ROUTERAI_TTS_VOICE_EN||env.ROUTERAI_TTS_VOICE||'eve'}:{ru:env.YANDEX_TTS_VOICE_RU||env.YANDEX_TTS_VOICE||'filipp',en:env.YANDEX_TTS_VOICE_EN||'john'};
 const limit=Number(env.TTS_REQUESTS_PER_HOUR||120);
 if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('Invalid TTS_REQUESTS_PER_HOUR');
 const cache=new Map();let bytes=0,active=0,start=now(),calls=0;
 return {enabled,provider,async run(payload,signal){
  if(!enabled)throw new GuideError(503,'Облачная озвучка не подключена.');
  if(typeof payload?.text!=='string'||!payload.text.trim()||payload.text.length>1600)throw new GuideError(400,'Недопустимая длина фрагмента для озвучки.');
  const text=normalizeSpeechText(payload.text);
  if(!text)throw new GuideError(400,'Недопустимая длина фрагмента для озвучки.');
  const language=payload.language??'ru';
  if(!['ru','en'].includes(language))throw new GuideError(400,'Unsupported speech language.');
  const voice=voices[language],lang=language==='en'?'en-US':'ru-RU';
  const body=router?JSON.stringify({model,input:text,voice,response_format:'mp3'}):new URLSearchParams({text,voice,lang,format:'mp3',speed:'1.0'}).toString();
  if(Buffer.byteLength(body)>15000)throw new GuideError(400,'Фрагмент слишком длинный для озвучки.');
  const id=createHash('sha256').update(language+'|'+body).digest('hex'),cached=cache.get(id);
  if(cached&&now()-cached.time<86400000){observe('cache',{cache:'speech',result:'hit'});return cached.audio;}
  observe('cache',{cache:'speech',result:'miss'});
  if(cached){bytes-=cached.audio.length;cache.delete(id)}
  if(now()-start>=3600000){start=now();calls=0}
  if((env.AUTHENTICATED_REQUESTS_UNLIMITED==='false'&&calls>=limit)||active>=2)throw new GuideError(429,'Озвучка временно занята или достигнут часовой лимит. Попробуйте позже.');
  signal?.throwIfAborted();calls++;active++;
  const started=Date.now();let providerStatus=null,succeeded=false,deadline=null;
  try{
   observe('tts',{characters:[...text].length});
   deadline=AbortSignal.timeout(30000);const requestSignal=AbortSignal.any([deadline,...(signal?[signal]:[])]);
   const response=await fetchFn(router?'https://routerai.ru/api/v1/audio/speech':'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',{method:'POST',redirect:'error',headers:router?{Authorization:'Bearer '+key,'Content-Type':'application/json'}:{Authorization:'Api-Key '+key,'Content-Type':'application/x-www-form-urlencoded','x-data-logging-enabled':'false'},body,signal:requestSignal});
   providerStatus=response.status;
   if(response.status===401||response.status===403)throw new GuideError(503,router?'Нет доступа к сервису озвучки RouterAI.':'Нет доступа к SpeechKit. Проверьте роль ai.speechkit-tts.user и разрешение API-ключа на синтез речи.');
   if(response.status===402)throw new GuideError(503,'Недостаточно средств у провайдера озвучки.');
   if(response.status===429)throw new GuideError(429,router?'Достигнут лимит сервиса озвучки. Попробуйте позже.':'SpeechKit: достигнут лимит сервиса Yandex. Попробуйте позже.');
   if(response.status>=500)throw new GuideError(502,'Сервис озвучки вернул внутреннюю ошибку. Попробуйте позже.');
   if(!response.ok)throw new GuideError(502,'Сервис озвучки временно недоступен. Попробуйте позже.');
   const chunks=[];let size=0;
   for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw new GuideError(502,'Слишком большой ответ озвучки.');chunks.push(Buffer.from(chunk))}
   const audio=Buffer.concat(chunks);
   if(audio.length<3||!(audio.subarray(0,3).toString()==='ID3'||(audio[0]===255&&(audio[1]&224)===224)))throw new GuideError(502,'Сервис озвучки вернул некорректное аудио.');
   while(cache.size&&(bytes+audio.length>32*1024*1024||cache.size>=100)){const oldest=cache.keys().next().value;bytes-=cache.get(oldest).audio.length;cache.delete(oldest)}
   cache.set(id,{audio,time:now()});bytes+=audio.length;succeeded=true;return audio;
  }catch(e){if(e instanceof GuideError)throw e;throw new GuideError(signal?.aborted?499:502,signal?.aborted?'Озвучка отменена.':'Не удалось получить озвучку. Попробуйте позже.')}finally{active--;observe('stage',{stage:'speech',outcome:succeeded?'success':signal?.aborted?'cancelled':deadline?.aborted?'timeout':'error',durationMs:Date.now()-started});if(!succeeded&&!signal?.aborted)providerFailure('speech',providerStatus,Date.now()-started)}
 }};
}

