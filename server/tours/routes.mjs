import {publicJobError,tourError} from './store.mjs';

const tourId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const topicId=/^(?:overview|[a-f0-9]{64})$/;
const placeId=/^(?:wiki:[a-z]{2,3}(?:-[a-z]{2,12})?:[1-9]\d*|wd:Q[1-9]\d*|osm:(?:node|way|relation):[1-9]\d*)$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const invalid=()=>{throw tourError('invalid_request',400)};

// Only this namespace is handled here; the legacy guide/speech routes retain
// their existing authorization and accounting behavior.
export async function handleTourRoute(req,res,{auth,tours,settings={},readJson,json,playbackEvents}){
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{return false}
 if(pathname!=='/api/tours'&&!pathname.startsWith('/api/tours/'))return false;
 const send=(status,data)=>{json(status,data);return true};
 try{
  const user=auth.session(req.headers.cookie);
  if(!user?.id)throw tourError('auth_required',401);
  const match=/^\/api\/tours(?:\/([^/]+)(?:\/(chapters)\/([^/]+)(\/(retry))?|\/(progress|playback-events))?)?$/.exec(pathname);
  if(!match)throw tourError('invalid_request',404);
  const [,id,chapterPath,topic,,retry,progressPath]=match;
  const method=!id||chapterPath?'POST':progressPath==='playback-events'?'POST':progressPath?'PUT':'GET';
  if(req.method!==method){res.setHeader('Allow',method);throw tourError('invalid_request',405)}
  if(method!=='GET'&&(!auth.origin||req.headers.origin!==auth.origin))throw tourError('invalid_request',403);
  if(!tours||settings.available===false)throw tourError('provider_error',503);
  if(id&&!tourId.test(id)||topic&&!topicId.test(topic))invalid();
  if(method==='GET'){
   const tour=await tours.get(user.id,id);if(!tour)throw tourError('invalid_request',404);
   return send(200,tour);
  }
  const body=await readJson(req);
  if(!id){
   if(!only(body,['placeId','language'])||typeof body.placeId!=='string'||body.placeId.length>300||!placeId.test(body.placeId)||!['ru','en'].includes(body.language))invalid();
   const result=await tours.start(user.id,body);
   return send(result.status,result.status===200?{tourId:result.tourId,status:'ready',tour:result.tour}:{tourId:result.tourId,status:'planning'});
  }
  if(chapterPath){
   if(!only(body,[]) )invalid();
   const result=await tours.chapter(user.id,id,topic,{retry:!!retry});
   return send(result.status,result.chapter);
  }
  if(progressPath==='playback-events'){const tour=await tours.get(user.id,id);if(!tour)throw tourError('invalid_request',404);return send(200,playbackEvents(user.id,tour,body));}
  if(!only(body,['chapterId','chunkIndex','offsetSeconds','completedChapterIds','chunkingVersion'])||body.chunkingVersion!==undefined&&(!Number.isSafeInteger(body.chunkingVersion)||body.chunkingVersion<1)||typeof body.chapterId!=='string'||!topicId.test(body.chapterId)||!Number.isSafeInteger(body.chunkIndex)||body.chunkIndex<0||!Number.isFinite(body.offsetSeconds)||body.offsetSeconds<0||!Array.isArray(body.completedChapterIds)||body.completedChapterIds.length>7||new Set(body.completedChapterIds).size!==body.completedChapterIds.length||body.completedChapterIds.some(id=>typeof id!=='string'||!topicId.test(id)))invalid();
  return send(200,await tours.progress(user.id,id,body));
 }catch(error){
  const status=[400,401,403,404,405,409,413,415,429,503].includes(error?.status)?error.status:503;
  if(status===429)res.setHeader('Retry-After','60');
  return send(status,{error:publicJobError(error)});
 }
}
