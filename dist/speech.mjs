import {normalizeSpeechText} from './speech-text.mjs';
export const SPEECH_CHUNKING_VERSION=2;
// Hash the exact immutable text, including changes removed by speech normalization.
export function speechTextHash(text){let hash=14695981039346656037n;for(const character of String(text)){hash^=BigInt(character.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n)}return hash.toString(16).padStart(16,'0')}
export function speechChunkCount(text,language='ru'){return speechParts([{id:'cursor',text}],language).length}
function speechParts(blocks,language){const parts=[];for(const block of blocks){let text=normalizeSpeechText(block.text,language),chunkIndex=0;const textHash=speechTextHash(block.text);while(text.length>1000){let end=text.lastIndexOf(' ',1000);if(end<500)end=1000;parts.push({block,text:text.slice(0,end),last:false,chunkIndex:chunkIndex++,textHash});text=text.slice(end).trimStart()}if(text)parts.push({block,text,last:true,chunkIndex,textHash})}return parts}
// At most two 4 MiB blobs: the playing fragment and one lookahead fragment.
async function speechBlob(response,signal){const max=4*1024*1024,reader=response.body?.getReader();if(!reader){const blob=await response.blob();if(blob.size>max)throw Error('Audio exceeds memory limit');return blob}let size=0;const chunks=[];try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('Audio exceeds memory limit');chunks.push(value)}return new Blob(chunks,{type:response.headers.get('content-type')||'audio/mpeg'})}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}}

export class Narrator {
  constructor({synth=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,onComplete=()=>{},onBlock=()=>{},onState=()=>{},onError=()=>{}}={}) {
    Object.assign(this,{synth,Utterance,onComplete,onBlock,onState,onError});this.language='ru';this.epoch=0;this.state='idle';this.rate=1;this.queue=[];
  }
  setState(state){this.state=state;this.onState(state)}
  stop(){this.epoch++;this.synth?.cancel();this.queue=[];this.setState('idle')}
  play(blocks){
    this.stop();this.queue=blocks.filter(block=>normalizeSpeechText(block.text,this.language));
    if(!this.queue.length){this.setState('finished');return}
    if(!this.synth||!this.Utterance){this.onError('Озвучка недоступна в этом браузере. Вы можете читать текст рассказа.');return}
    const token=this.epoch;
    const next=()=>{
      if(token!==this.epoch)return;
      const block=this.queue.shift();if(!block){this.setState('finished');return}
      const u=new this.Utterance(normalizeSpeechText(block.text,this.language));u.lang=this.language==='en'?'en-US':'ru-RU';u.rate=this.rate;
      const voice=this.synth.getVoices().find(v=>v.lang.toLowerCase().startsWith(this.language));if(voice)u.voice=voice;
      this.current=block;this.utterance=u;this.onBlock(block);this.setState('playing');
      u.onend=()=>{if(token!==this.epoch)return;this.onComplete(block);next()};
      u.onerror=e=>{if(token!==this.epoch||e.error==='canceled'||e.error==='interrupted')return;this.epoch++;this.setState('idle');this.onError('Не удалось включить голос. Попробуйте ещё раз или читайте текст.')};
      this.synth.speak(u);
    };next();
  }
  pause(){if(this.state==='playing'){this.synth.pause();this.setState('paused')}}
  resume(){if(this.state==='paused'){this.synth.resume();this.setState('playing')}}
}

// Keep the same block-completion contract for cloud and device voices.
export class CloudNarrator extends Narrator {
 constructor(options={}){super(options);this.audio=options.audio||new Audio();this.fetchFn=options.fetchFn||globalThis.fetch.bind(globalThis);this.cloud=false;this.ready=false;this.onProgress=options.onProgress||(()=>{});this.onAuthRequired=options.onAuthRequired||(()=>this.onError('Чтобы продолжить озвучку, войдите снова.'))}
 get rate(){return this._rate||1}
 set rate(value){this._rate=value;if(this.audio)this.audio.playbackRate=value;if(this.local)this.local.rate=value}
 release(){if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null}}
 stop(){this.clearPreparedNext();this.remainingParts=0;this.prefetch=null;this.authPending=null;this.local?.stop();this.local=null;this.localPending=null;super.stop();this.controller?.abort();if(this.audio){this.audio.onended=null;this.audio.onerror=null;this.audio.ontimeupdate=null;this.audio.onloadedmetadata=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load()}this.ready=false;this.release()}
 startLocal(parts){
  this.localPending=null;
  this.local=new Narrator({synth:this.synth,Utterance:this.Utterance,onState:state=>this.setState(state),onBlock:part=>{this.current=part.block;this.onBlock(part.block);this.reportProgress(part,0)},onComplete:part=>{if(part.last)this.onComplete(part.block)},onError:this.onError});
  this.local.language=this.language;this.local.rate=this.rate;this.local.play(parts.map(part=>({...part,text:part.text})));
 }
 fallback(parts,reason,token){
  if(token!==this.epoch)return;
  if(!this.synth||!this.Utterance){this.stop();this.onError(reason);return}
  const paused=this.state==='paused';this.stop();this.deviceFallback=true;
  this.onError('Облачная озвучка недоступна. Используется голос устройства.');
  if(paused){this.localPending=parts;this.setState('paused')}else this.startLocal(parts);
 }
 async prepareAudio(part,signal,language=this.language){try{const r=await this.fetchFn('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:part.text,language}),signal});if(!r.ok){const data=await r.json().catch(()=>({}));throw Object.assign(new Error(data.error||'Не удалось получить озвучку.'),{status:r.status})}return {blob:await speechBlob(r,signal)}}catch(error){return {error}}}
 clearPreparedNext(){this.nextPrepared?.controller.abort();this.nextPrepared=null;this.nextBlock=null}
 prepareNext(block){if(!this.cloud||this.deviceFallback)return;this.clearPreparedNext();this.nextBlock=block;return this.queueNextAudio()}
 queueNextAudio(){if(!this.nextBlock||!this.ready||this.remainingParts||this.prefetch||this.nextPrepared)return;const part=speechParts([this.nextBlock],this.language)[0];if(!part)return;const controller=new AbortController();this.nextPrepared={part,language:this.language,controller,promise:this.prepareAudio(part,controller.signal)};return this.nextPrepared.promise}
 reportProgress(part,offsetSeconds){this.cursor={blockId:part.block.id,chunkIndex:part.chunkIndex,offsetSeconds:Number.isFinite(offsetSeconds)?Math.max(0,offsetSeconds):0,textHash:part.textHash,chunkingVersion:SPEECH_CHUNKING_VERSION};this.onProgress(this.cursor)}
 play(blocks,cursor){
  const saved=this.authPending,retained=saved?.language===this.language&&saved.parts.every(p=>blocks.some(b=>b.id===p.block.id&&b.text===p.block.text))?saved.parts:null;
  const nextPrepared=this.nextPrepared?.language===this.language&&blocks[0]?.id===this.nextPrepared.part.block.id&&blocks[0]?.text===this.nextPrepared.part.block.text?this.nextPrepared:null;
  if(nextPrepared)this.nextPrepared=null;
  this.stop();const token=this.epoch;this.controller=new AbortController();const signal=this.controller.signal;if(nextPrepared){const nextController=nextPrepared.controller;signal.addEventListener('abort',()=>nextController.abort(),{once:true})}
  const parts=speechParts(blocks,this.language);
  if(retained&&parts.length>=retained.length&&parts.slice(-retained.length).every((p,i)=>p.block.id===retained[i].block.id&&p.text===retained[i].text))parts.splice(0,parts.length,...retained);
  const resumeIndex=cursor?.chunkingVersion===SPEECH_CHUNKING_VERSION&&Number.isSafeInteger(cursor.chunkIndex)&&cursor.chunkIndex>=0&&Number.isFinite(cursor.offsetSeconds)&&cursor.offsetSeconds>=0?parts.findIndex(p=>p.block.id===cursor.blockId&&p.textHash===cursor.textHash&&p.chunkIndex===cursor.chunkIndex):-1;
  let offset=resumeIndex>=0?Math.max(0,Number(cursor.offsetSeconds)||0):0;if(resumeIndex>=0)parts.splice(0,resumeIndex);
  if(!this.cloud||this.deviceFallback){this.startLocal(parts);return}
  const language=this.language;
  const prepare=part=>this.prepareAudio(part,signal,language);
  this.prefetch=nextPrepared&&parts[0]?.chunkIndex===0?nextPrepared.promise:null;
  const next=async()=>{
   if(token!==this.epoch)return;
   const part=parts.shift();if(!part){this.ready=false;this.release();this.setState('finished');return}
   this.ready=false;this.remainingParts=parts.length;this.current=part.block;this.onBlock(part.block);this.setState('loading');
   try{
    const prepared=await (this.prefetch||prepare(part));if(token===this.epoch)this.prefetch=null;
    if(token!==this.epoch)return;
    if(prepared.error)throw prepared.error;
    const blob=prepared.blob;
    if(parts.length)this.prefetch=prepare(parts[0]);
    this.release();this.objectUrl=URL.createObjectURL(blob);this.audio.src=this.objectUrl;this.audio.playbackRate=this.rate;this.ready=true;
    const resumeOffset=offset;offset=0;this.reportProgress(part,resumeOffset);
    this.audio.onloadedmetadata=()=>{if(token!==this.epoch)return;const duration=Number(this.audio.duration);this.audio.currentTime=Number.isFinite(duration)?Math.min(resumeOffset,Math.max(0,duration-0.05)):resumeOffset};
    this.audio.ontimeupdate=()=>{if(token===this.epoch)this.reportProgress(part,this.audio.currentTime)};this.queueNextAudio();
    let ended=false;
    this.audio.onended=()=>{if(token!==this.epoch||ended)return;ended=true;if(part.last)this.onComplete(part.block);next()};
    this.audio.onerror=()=>{if(token!==this.epoch)return;this.fallback([part,...parts],'Не удалось воспроизвести аудио. Попробуйте ещё раз.',token)};
    if(this.state!=='paused')this.startAudio(token);
   }catch(e){if(token!==this.epoch)return;if(!e.status||e.status>=500){this.fallback([part,...parts],e.message||'Не удалось загрузить голос. Проверьте соединение.',token);return}if(e.status===401){const unfinished=[part,...parts];this.stop();this.authPending={language,parts:unfinished};this.onAuthRequired();return}this.stop();this.onError(e.message)}
  };next();
 }
 async startAudio(token){
  this.setState('loading');
  try{await this.audio.play();if(token!==this.epoch)return;if(this.state==='paused'){this.audio.pause();return}this.setState('playing')}catch(e){if(token!==this.epoch)return;if(e.name==='NotAllowedError'){this.setState('paused');this.onError('Браузер просит ещё одно нажатие: нажмите «Продолжить», чтобы включить звук.')}else{this.stop();this.onError('Не удалось включить звук. Попробуйте ещё раз.')}}
 }
 pause(){if(this.local)return this.local.pause();if(!this.cloud)return super.pause();if(['playing','loading'].includes(this.state)){this.audio.pause();this.setState('paused')}}
 resume(){if(this.localPending){this.startLocal(this.localPending);return}if(this.local)return this.local.resume();if(!this.cloud)return super.resume();if(this.state==='paused'){if(this.ready)this.startAudio(this.epoch);else this.setState('loading')}}
}

