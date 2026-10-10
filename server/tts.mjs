import {createHash} from 'node:crypto';
import {GuideError} from './guide.mjs';
export function createSpeech({env=process.env,fetchFn=fetch,now=Date.now}={}){
 const key=env.YANDEX_TTS_API_KEY||env.YANDEX_API_KEY;
 const enabled=Boolean(key)&&env.YANDEX_TTS_ENABLED!=='false';
 const voices={ru:env.YANDEX_TTS_VOICE_RU||env.YANDEX_TTS_VOICE||'filipp',en:env.YANDEX_TTS_VOICE_EN||'john'};
 const limit=Number(env.TTS_REQUESTS_PER_HOUR||120);
 if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('Invalid TTS_REQUESTS_PER_HOUR');
 const cache=new Map();let bytes=0,active=0,start=now(),calls=0;
 return {enabled,async run(payload,signal){
  if(!enabled)throw new GuideError(503,'Облачная озвучка не подключена.');
  if(typeof payload?.text!=='string'||!payload.text.trim()||payload.text.length>1600)throw new GuideError(400,'Недопустимая длина фрагмента для озвучки.');
  const language=payload.language??'ru';
  if(!['ru','en'].includes(language))throw new GuideError(400,'Unsupported speech language.');
  const voice=voices[language],lang=language==='en'?'en-US':'ru-RU';
  const body=new URLSearchParams({text:payload.text,voice,lang,format:'mp3',speed:'1.0'}).toString();
  if(Buffer.byteLength(body)>15000)throw new GuideError(400,'Фрагмент слишком длинный для озвучки.');
  const id=createHash('sha256').update(body).digest('hex'),cached=cache.get(id);
  if(cached&&now()-cached.time<86400000)return cached.audio;
  if(cached){bytes-=cached.audio.length;cache.delete(id)}
  if(now()-start>=3600000){start=now();calls=0}
  if(calls>=limit||active>=2)throw new GuideError(429,'Озвучка временно занята или достигнут часовой лимит. Попробуйте позже.');
  signal?.throwIfAborted();calls++;active++;
  try{
   const response=await fetchFn('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',{method:'POST',headers:{Authorization:'Api-Key '+key,'Content-Type':'application/x-www-form-urlencoded','x-data-logging-enabled':'false'},body,signal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])});
   if(response.status===401||response.status===403)throw new GuideError(503,'Нет доступа к SpeechKit. Проверьте роль ai.speechkit-tts.user и разрешение API-ключа на синтез речи.');
   if(!response.ok)throw new GuideError(502,'SpeechKit временно недоступен. Попробуйте позже.');
   const chunks=[];let size=0;
   for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw new GuideError(502,'Слишком большой ответ озвучки.');chunks.push(Buffer.from(chunk))}
   const audio=Buffer.concat(chunks);
   if(audio.length<3||!(audio.subarray(0,3).toString()==='ID3'||(audio[0]===255&&(audio[1]&224)===224)))throw new GuideError(502,'SpeechKit вернул некорректное аудио.');
   while(cache.size&&(bytes+audio.length>32*1024*1024||cache.size>=100)){const oldest=cache.keys().next().value;bytes-=cache.get(oldest).audio.length;cache.delete(oldest)}
   cache.set(id,{audio,time:now()});bytes+=audio.length;return audio;
  }catch(e){if(e instanceof GuideError)throw e;throw new GuideError(signal?.aborted?499:502,signal?.aborted?'Озвучка отменена.':'Не удалось получить озвучку. Попробуйте позже.')}finally{active--}
 }};
}
