import {speechTextHash,speechChunkCount,SPEECH_CHUNKING_VERSION} from './speech.mjs';

// A selection owns all pending work. Audio completion, not preparation, advances it.
export function createTourPlayer({client,narrator,saveProgress=(id,value)=>client.saveProgress(id,value),onChange=()=>{},onAuthRequired=()=>{},onError=()=>{},onBackup=()=>{},onChapterComplete=()=>{},now=Date.now}={}){
 let tour=null,selected=null,cursor=null,continuous=false,epoch=0,controller=null,preview=null,authPending=false,authNotified=false,playing=false,lastSaved=0,disposed=false;
 let attempt=null,transitionAt=null;
 function playback(type,extra={}){if(!attempt||!selected||!client.playbackEvent)return;try{Promise.resolve(client.playbackEvent(tour.id,{chapterId:selected.id,attemptId:attempt.id,type,...extra})).catch(()=>{})}catch{}}
 let completed=new Set(),saveQueue=Promise.resolve();
 const prior={onComplete:narrator.onComplete,onProgress:narrator.onProgress,onState:narrator.onState,onAuthRequired:narrator.onAuthRequired,onError:narrator.onError};
 const snapshot=()=>({tour,selected,continuous,cursor,state:playing?narrator.state:'idle',completedChapterIds:[...completed]});
 const change=()=>{if(!disposed)onChange(snapshot())};
 const chapter=topicId=>tour?.chapters.find(c=>c.topicId===topicId);
 const nextTopic=()=>{const ids=['overview',...tour.topics.map(t=>t.id)],index=ids.indexOf(selected?.topicId);return ids.slice(index+1).find(id=>!completed.has(chapter(id)?.id)&&chapter(id)?.status!=='insufficient')};
 function save(){if(!tour||!cursor||disposed)return;const backup={tourId:tour.id,...cursor};onBackup(backup);const value={chapterId:cursor.chapterId,chunkIndex:cursor.chunkIndex,offsetSeconds:cursor.offsetSeconds,completedChapterIds:[...completed]};lastSaved=now();const id=tour.id,token=epoch;saveQueue=saveQueue.then(()=>saveProgress(id,value)).catch(error=>{if(error.status===401&&token===epoch&&!authNotified){authPending=true;if(!playing||narrator.state==='paused')requireAuth()}})}
 function requireAuth(){if(authNotified)return;authNotified=true;authPending=false;continuous=false;playing=false;controller?.abort();preview=null;onAuthRequired();change()}
 function mergeChapter(value){const index=tour.chapters.findIndex(c=>c.topicId===value.topicId);if(index>=0)tour.chapters[index]=value;else tour.chapters.push(value);return value}
 async function prepare(topicId,signal,token,{retry=false}={}){
  let value=chapter(topicId);if(value?.status==='ready'||value?.status==='insufficient'||value?.status==='failed'&&!retry)return value;
  if(retry||value?.status==='planned'){value=await (retry?client.retryChapter:client.prepareChapter)(tour.id,topicId,{signal});if(token!==epoch||signal.aborted)return;mergeChapter(value);change()}
  if(value?.status==='generating'||value?.status==='planned'){
   const updated=await client.waitFor(tour.id,t=>!['planned','generating'].includes(t.chapters.find(c=>c.topicId===topicId)?.status),{signal});if(token!==epoch||signal.aborted)return;tour=updated;value=chapter(topicId);change();
  }return value;
 }
 function prefetch(token){if(!continuous||preview||authPending)return;const id=nextTopic();if(!id)return;const signal=controller.signal;preview={topicId:id,promise:prepare(id,signal,token).then(value=>({value}),error=>({error}))};preview.promise.then(result=>{if(token!==epoch||signal.aborted)return;if(result.error?.status===401)authPending=true;if(result.value?.status==='ready'&&continuous)narrator.prepareNext?.({id:result.value.id,text:result.value.text});change()})}
 async function play(topicId,{retry=false,fromCursor=false,advance=false}={}){
  if(!tour||disposed)return;save();epoch++;controller?.abort();controller=new AbortController();preview=null;authPending=false;authNotified=false;const token=epoch,signal=controller.signal;playing=false;if(!advance)narrator.stop();selected=chapter(topicId)||null;change();
  try{const value=await prepare(topicId,signal,token,{retry});if(token!==epoch||signal.aborted||!value)return;selected=value;change();if(value.status!=='ready')return;
   const textHash=speechTextHash(value.text),valid=fromCursor&&cursor?.chapterId===value.id&&cursor.textHash===textHash&&cursor.chunkingVersion===SPEECH_CHUNKING_VERSION;
   cursor={chapterId:value.id,chunkIndex:valid?cursor.chunkIndex:0,offsetSeconds:valid?cursor.offsetSeconds:0,textHash,chunkingVersion:SPEECH_CHUNKING_VERSION};
   attempt={id:globalThis.crypto.randomUUID(),first:false,gap:false,paused:false,pausedAt:null,started:now(),loading:null,boundary:advance?transitionAt:null};narrator.language=tour.language;playing=true;narrator.play([{id:value.id,title:tour.topics.find(t=>t.id===topicId)?.title||'overview',text:value.text}],{...cursor,blockId:value.id});change();prefetch(token);
  }catch(error){if(token!==epoch||signal.aborted)return;if(error.status===401)requireAuth();else{onError(error);change()}}
 }
 narrator.onProgress=value=>{if(!playing||value.blockId!==selected?.id){prior.onProgress?.(value);return}cursor={chapterId:selected.id,chunkIndex:value.chunkIndex,offsetSeconds:value.offsetSeconds,textHash:speechTextHash(selected.text),chunkingVersion:SPEECH_CHUNKING_VERSION};onBackup({tourId:tour.id,...cursor});if(now()-lastSaved>=5000)save()};
 narrator.onComplete=block=>{if(!playing||block.id!==selected?.id){prior.onComplete?.(block);return}completed.add(block.id);onChapterComplete({tourId:tour.id,chapterId:block.id});cursor={...cursor,chunkIndex:0,offsetSeconds:0};save();transitionAt=now();const token=epoch;playing=false;change();if(authPending){requireAuth();return}if(continuous){const id=nextTopic();if(id)queueMicrotask(()=>{if(token===epoch&&continuous)play(id,{advance:true})})}};
 narrator.onState=value=>{if(playing&&attempt){if(['loading','playing'].includes(value)&&attempt.pausedAt!==null){attempt.started+=Math.max(0,now()-attempt.pausedAt);attempt.pausedAt=null}if(value==='loading'&&!attempt.paused&&attempt.loading===null)attempt.loading=now();if(value==='paused'){attempt.loading=null;attempt.boundary=null;attempt.paused=true;attempt.pausedAt??=now();}if(value==='playing'){if(!attempt.first){attempt.first=true;playback('first_audio',{durationMs:Math.min(120000,Math.max(0,now()-attempt.started))});if(attempt.boundary!==null){attempt.gap=true;playback('gap',{durationMs:Math.min(120000,Math.max(0,now()-attempt.boundary))})}}else if(!attempt.paused&&!attempt.gap&&attempt.loading!==null){attempt.gap=true;playback('gap',{durationMs:Math.min(120000,Math.max(0,now()-attempt.loading))})}attempt.loading=null;attempt.paused=false}}prior.onState?.(value);change()};
 narrator.onAuthRequired=()=>{if(playing){playback('playback_error',{code:'auth_required'});save();requireAuth()}else prior.onAuthRequired?.()};
 narrator.onError=error=>{if(playing){playback('playback_error',{code:['auth_required','provider_timeout','provider_error'].includes(error?.code)?error.code:'audio_error'});save();onError(error)}else prior.onError?.(error)};
 const api={
  open(value,backup){
   api.stop();tour=structuredClone(value);completed=new Set((value.progress?.completedChapterIds||[]).filter(id=>tour.chapters.some(c=>c.id===id&&c.status==='ready')));
   const valid=position=>{const c=tour.chapters.find(c=>c.id===position?.chapterId&&c.status==='ready');return c&&Number.isSafeInteger(position.chunkIndex)&&position.chunkIndex>=0&&Number.isFinite(position.offsetSeconds)&&position.offsetSeconds>=0&&position.offsetSeconds<=3600};
   const local=backup?.tourId===value.id&&valid(backup)&&typeof backup.textHash==='string'&&/^[a-f0-9]{16}$/.test(backup.textHash)?backup:null;
   const position=local|| (valid(value.progress)?value.progress:null);
   cursor=null;
   if(position){
    const c=tour.chapters.find(c=>c.id===position.chapterId),textHash=speechTextHash(c.text);
    // Server progress belongs to an immutable ready chapter in this authorized GET.
    const sameText=!local||local.textHash===textHash&&local.chunkingVersion===SPEECH_CHUNKING_VERSION;
    const usable=sameText&&position.chunkIndex<speechChunkCount(c.text);
    cursor={chapterId:c.id,chunkIndex:usable?position.chunkIndex:0,offsetSeconds:usable?position.offsetSeconds:0,textHash,chunkingVersion:SPEECH_CHUNKING_VERSION};
   }
   selected=cursor?tour.chapters.find(c=>c.id===cursor.chapterId)||null:null;change()
  },
  play,
  pause(){if(playing)narrator.pause();save();change()},
  resume(){if(playing&&narrator.state==='paused'){narrator.resume();change();return}const id=selected?.topicId||'overview';return play(id,{fromCursor:true})},
  stop(){save();epoch++;controller?.abort();controller=null;preview=null;continuous=false;playing=false;narrator.stop();change()},
  clear(){api.stop();tour=null;selected=null;cursor=null;completed.clear();change()},
  setContinuous(value){continuous=!!value;if(!continuous)narrator.clearPreparedNext?.();if(!continuous&&preview){epoch++;controller?.abort();controller=new AbortController();preview=null}if(continuous&&playing)prefetch(epoch);change()},
  save,
  getState:snapshot,
  dispose(){api.stop();disposed=true;for(const [key,value] of Object.entries(prior))narrator[key]=value;tour=null;selected=null;cursor=null}
 };return api;
}
