export class Narrator {
  constructor({synth=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,onComplete=()=>{},onBlock=()=>{},onState=()=>{},onError=()=>{}}={}) {
    Object.assign(this,{synth,Utterance,onComplete,onBlock,onState,onError});this.language='ru';this.epoch=0;this.state='idle';this.rate=1;this.queue=[];
  }
  setState(state){this.state=state;this.onState(state)}
  stop(){this.epoch++;this.synth?.cancel();this.queue=[];this.setState('idle')}
  play(blocks){
    this.stop();this.queue=[...blocks];
    if(!this.queue.length){this.setState('finished');return}
    if(!this.synth||!this.Utterance){this.onError('Озвучка недоступна в этом браузере. Вы можете читать текст рассказа.');return}
    const token=this.epoch;
    const next=()=>{
      if(token!==this.epoch)return;
      const block=this.queue.shift();if(!block){this.setState('finished');return}
      const u=new this.Utterance(block.text);u.lang=this.language==='en'?'en-US':'ru-RU';u.rate=this.rate;
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
 constructor(options={}){super(options);this.audio=options.audio||new Audio();this.fetchFn=options.fetchFn||globalThis.fetch.bind(globalThis);this.cloud=false;this.ready=false}
 get rate(){return this._rate||1}
 set rate(value){this._rate=value;if(this.audio)this.audio.playbackRate=value}
 release(){if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null}}
 stop(){super.stop();this.controller?.abort();if(this.audio){this.audio.onended=null;this.audio.onerror=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load()}this.ready=false;this.release()}
 play(blocks){
  if(!this.cloud)return super.play(blocks);
  this.stop();const token=this.epoch;this.controller=new AbortController();const signal=this.controller.signal;
  const parts=[];
  for(const block of blocks){let text=block.text;while(text.length>1000){let end=text.lastIndexOf(' ',1000);if(end<500)end=1000;parts.push({block,text:text.slice(0,end),last:false});text=text.slice(end).trimStart()}if(text)parts.push({block,text,last:true})}
  const next=async()=>{
   if(token!==this.epoch)return;
   const part=parts.shift();if(!part){this.ready=false;this.release();this.setState('finished');return}
   this.ready=false;this.current=part.block;this.onBlock(part.block);this.setState('loading');
   try{
    const r=await this.fetchFn('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:part.text,language:this.language}),signal});
    if(!r.ok){const data=await r.json().catch(()=>({}));throw new Error(data.error||'Не удалось получить озвучку.')}
    const blob=await r.blob();if(token!==this.epoch)return;
    this.release();this.objectUrl=URL.createObjectURL(blob);this.audio.src=this.objectUrl;this.audio.playbackRate=this.rate;this.ready=true;
    let ended=false;
    this.audio.onended=()=>{if(token!==this.epoch||ended)return;ended=true;if(part.last)this.onComplete(part.block);next()};
    this.audio.onerror=()=>{if(token!==this.epoch)return;this.stop();this.onError('Не удалось воспроизвести аудио. Попробуйте ещё раз.')};
    if(this.state!=='paused')this.startAudio(token);
   }catch(e){if(token!==this.epoch)return;this.stop();this.onError(e.message||'Не удалось загрузить голос. Проверьте соединение.')}
  };next();
 }
 async startAudio(token){
  this.setState('playing');
  try{await this.audio.play()}catch(e){if(token!==this.epoch)return;if(e.name==='NotAllowedError'){this.setState('paused');this.onError('Браузер просит ещё одно нажатие: нажмите «Продолжить», чтобы включить звук.')}else{this.stop();this.onError('Не удалось включить звук. Попробуйте ещё раз.')}}
 }
 pause(){if(!this.cloud)return super.pause();if(['playing','loading'].includes(this.state)){this.audio.pause();this.setState('paused')}}
 resume(){if(!this.cloud)return super.resume();if(this.state==='paused'){if(this.ready)this.startAudio(this.epoch);else this.setState('loading')}}
}
