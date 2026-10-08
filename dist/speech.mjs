export class Narrator {
  constructor({synth=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,onComplete=()=>{},onBlock=()=>{},onState=()=>{},onError=()=>{}}={}) {
    Object.assign(this,{synth,Utterance,onComplete,onBlock,onState,onError});this.epoch=0;this.state='idle';this.rate=1;this.queue=[];
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
      const u=new this.Utterance(block.text);u.lang='ru-RU';u.rate=this.rate;
      const voice=this.synth.getVoices().find(v=>v.lang.toLowerCase().startsWith('ru'));if(voice)u.voice=voice;
      this.current=block;this.utterance=u;this.onBlock(block);this.setState('playing');
      u.onend=()=>{if(token!==this.epoch)return;this.onComplete(block);next()};
      u.onerror=e=>{if(token!==this.epoch||e.error==='canceled'||e.error==='interrupted')return;this.epoch++;this.setState('idle');this.onError('Не удалось включить голос. Попробуйте ещё раз или читайте текст.')};
      this.synth.speak(u);
    };next();
  }
  pause(){if(this.state==='playing'){this.synth.pause();this.setState('paused')}}
  resume(){if(this.state==='paused'){this.synth.resume();this.setState('playing')}}
}
