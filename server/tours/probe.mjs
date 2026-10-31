import {normalizeSpeechText} from '../../dist/speech-text.mjs';
// Fixed orchestration shared by the real Operations probe and offline fixtures.
// Never returns source/chapter prose, prompts, credentials or owner identifiers.
export async function runTourProbe({service,jobs,ownerId,placeId,language='ru',speech,requiredThemes=3,report=()=>{},now=Date.now}={}){
 const start=now(),result=await service.start(ownerId,{placeId,language},{fresh:true});
 const settle=async()=>{await jobs.drain();await new Promise(resolve=>setImmediate(resolve));await jobs.drain();return service.get(ownerId,result.tourId)};
 let tour=await settle();
 const fail=(reason,details={})=>{report({probe:'tour-result',passed:false,reason,...details,revision:process.env.WAYSTORY_REVISION||'unknown',durationMs:now()-start});return false};
 if(tour?.status!=='ready')return fail(tour?.error?.code||'plan_failed');
 const selected=tour.topics.filter(t=>t.status==='available').slice(0,requiredThemes);
 if(selected.length<requiredThemes)return fail('insufficient_topics',{topics:tour.topics.length,available:tour.topics.filter(t=>t.status==='available').length,limited:tour.topics.filter(t=>t.status==='limited').length});
 const chapters=[];
 for(const topicId of ['overview',...selected.map(t=>t.id)]){
  let chapter=tour.chapters.find(c=>c.topicId===topicId);
  if(chapter.status==='planned'){await service.chapter(ownerId,tour.id,topicId);tour=await settle();chapter=tour.chapters.find(c=>c.topicId===topicId)}
  report({probe:'tour-chapter',chapterId:topicId,status:chapter.status,reason:chapter.error?.code||null,words:chapter.text?.trim().split(/\s+/u).length||0,evidence:chapter.evidenceIds?.length||0,claims:chapter.claims?.length||0,estimatedSeconds:chapter.estimatedSeconds||0});
  if(chapter.status!=='ready')return fail(chapter.error?.code||'chapter_not_ready');
  chapters.push(chapter);
 }
 const keys=chapters.flatMap(c=>c.coveredFactKeys||[]);
 if(new Set(keys).size!==keys.length||new Set(chapters.map(c=>c.text.toLowerCase().replace(/\s+/g,' ').trim())).size!==chapters.length)return fail('duplicate_claim');
 if(!tour.sources?.length||tour.sources.some(s=>!s.url||!s.license))return fail('missing_attribution');
 if(speech){
  // Same first-fragment boundary as CloudNarrator, with no second TTS request.
  let text=normalizeSpeechText(chapters[0].text);if(text.length>1000){let end=text.lastIndexOf(' ',1000);if(end<500)end=1000;text=text.slice(0,end)}
  const started=now(),audio=await speech({language,text});report({probe:'tour-speech',bytes:audio.length,durationMs:now()-started});
 }
 report({probe:'tour-result',passed:true,revision:process.env.WAYSTORY_REVISION||'unknown',chapters:chapters.length,themes:selected.length,sources:tour.sources.length,language:tour.language,words:chapters.reduce((n,c)=>n+c.text.trim().split(/\s+/u).length,0),durationMs:now()-start});return true;
}
