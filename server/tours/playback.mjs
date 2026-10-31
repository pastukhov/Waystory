import {observe} from '../request-context.mjs';
import {tourError} from './store.mjs';
import {playbackCodes} from '../observability.mjs';
// Process-local, expiring and bounded. Dedupe is per chapter/play attempt/minute.
export function createPlaybackEvents({now=Date.now}={}){
 const users=new Map(),seen=new Map();
 return (owner,tour,body)=>{
  const invalid=()=>{throw tourError('invalid_request',400)};
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['chapterId','attemptId','type','durationMs','code'].includes(k)))invalid();
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.attemptId||'')||!['first_audio','gap','playback_error'].includes(body.type)||!tour.chapters.some(c=>c.id===body.chapterId&&c.status==='ready'))invalid();
  if(body.durationMs!==undefined&&(!Number.isFinite(body.durationMs)||body.durationMs<0||body.durationMs>120000)||body.code!==undefined&&!playbackCodes.includes(body.code))invalid();
  if(body.type==='playback_error'?!playbackCodes.includes(body.code):body.durationMs===undefined||body.code!==undefined)invalid();
  const time=now();for(const [id,bucket] of users)if(time-bucket.start>=60000)users.delete(id);
  let bucket=users.get(owner);if(!bucket){if(users.size>=1000)throw tourError('busy',429);bucket={start:time,count:0};users.set(owner,bucket)}
  if(bucket.count>=30)throw tourError('busy',429);bucket.count++;
  const key=JSON.stringify([tour.id,body.chapterId,body.attemptId,body.type]);
  for(const [id,expires] of seen)if(expires<=time)seen.delete(id);
  if(body.type!=='playback_error'&&seen.has(key))return {recorded:false};
  if(body.type!=='playback_error'){if(seen.size>=10000)throw tourError('busy',429);seen.set(key,Math.min(tour.expiresAt||time+7*86400000,time+7*86400000));}observe('tour_playback',body);return {recorded:true};
 };
}
