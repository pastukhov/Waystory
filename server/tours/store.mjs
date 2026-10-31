import {randomUUID,createHash} from 'node:crypto';
import {TOUR_LIMITS as LIMITS} from './config.mjs';
import {sourcePolicy} from '../sources/policies.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');
const capped=(value,max)=>Number.isSafeInteger(value)&&value>0?Math.min(value,max):max;
export function tourError(code,status=409) {
 const messages={busy:'Tour storage or generation is busy.',source_unavailable:'Sources must be loaded again and verified. Please prepare a new tour if they changed.',provider_timeout:'Tour preparation timed out.',provider_error:'Tour preparation failed.',invalid_request:'Invalid tour request.'};
 return Object.assign(new Error(messages[code]||'Tour preparation failed.'),{code,status,retryable:['busy','source_unavailable','provider_timeout','provider_error'].includes(code),diagnosticId:randomUUID()});
}
export function publicJobError(error) {
 const codes=['auth_required','budget_exhausted','source_unavailable','insufficient_evidence','verification_failed','provider_timeout','provider_error','busy'];
 const code=codes.includes(error?.code)?error.code:'provider_error';
 const safe=tourError(code);
 return {code,message:safe.message,retryable:typeof error?.retryable==='boolean'?error.retryable:safe.retryable,diagnosticId:safe.diagnosticId};
}
const timedOut=()=>publicJobError(tourError('provider_timeout'));
const emptyChapter=topicId=>({id:topicId,topicId,status:'planned',text:null,evidenceIds:[],claims:[],coveredFactKeys:[],estimatedSeconds:0,error:null});
const documents=snapshot=>Array.isArray(snapshot)?snapshot:snapshot?.documents||[];
const snapshotHash=snapshot=>createHash('sha256').update(JSON.stringify(documents(snapshot).map(d=>[d.id,d.revision,d.text,d.scope,d.language,d.license?.policyId]))).digest('hex');
function snapshotTTL(snapshot) {
 const values=documents(snapshot).filter(d=>d.text).map(d=>sourcePolicy(d.license?.policyId).ttlMs);
 if(values.some(n=>n===0))throw tourError('source_unavailable');
 return Math.min(LIMITS.ttlMs,...values.filter(n=>Number.isFinite(n)&&n>0));
}
function permissions(snapshot) {
 const policies=documents(snapshot).filter(d=>d.text).map(d=>sourcePolicy(d.license?.policyId));
 return {text:policies.every(p=>p.allowTextCache===true),output:policies.every(p=>p.allowOutputCache===undefined?p.allowTextCache===true:p.allowOutputCache===true)};
}
function snapshotMetadata(snapshot) {
 // Keep attribution and revision identifiers, never original text or evidence.
 return {documents:documents(snapshot).map(d=>Object.fromEntries(['id','provider','kind','title','url','revision','scope','language','license','fetchedAt','expiresAt'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]]))),statuses:copy(snapshot?.statuses||[]),links:copy(snapshot?.links||[])};
}

export function createTourStore({db,now=Date.now,maxTours=LIMITS.maxTours,maxStorageBytes=LIMITS.maxStorageBytes}={}) {
 maxTours=capped(maxTours,LIMITS.maxTours);maxStorageBytes=capped(maxStorageBytes,LIMITS.maxStorageBytes);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS tours(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,place_id TEXT NOT NULL,language TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,snapshot TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tour_chapters(tour_id TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,topic_id TEXT NOT NULL,data TEXT NOT NULL,lease_until INTEGER,job_token TEXT,PRIMARY KEY(tour_id,topic_id));
 CREATE TABLE IF NOT EXISTS tour_progress(tour_id TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,data TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(tour_id,owner_id));
 CREATE INDEX IF NOT EXISTS tours_owner_place ON tours(owner_id,place_id,language);
 CREATE UNIQUE INDEX IF NOT EXISTS tour_job_tokens ON tour_chapters(job_token) WHERE job_token IS NOT NULL;`);
 let volatile=new Map();
 const rowFor=(owner,id)=>db.prepare('SELECT * FROM tours WHERE id=? AND owner_id=?').get(id,owner);
 const active=id=>!!db.prepare('SELECT 1 FROM tour_chapters WHERE tour_id=? AND lease_until>? AND job_token IS NOT NULL').get(id,now());
 function transaction(fn) {
  const previous=volatile;volatile=new Map(volatile);
  db.exec('BEGIN IMMEDIATE');
  try {const result=fn();db.exec('COMMIT');return result;} catch(error) {db.exec('ROLLBACK');volatile=previous;throw error;}
 }
 function remember(id,patch) {volatile.set(id,{...volatile.get(id),...patch});}
 function remove(id) {db.prepare('DELETE FROM tours WHERE id=?').run(id);volatile.delete(id);}
 function recover() {
  for(const row of db.prepare('SELECT * FROM tour_chapters WHERE job_token IS NOT NULL AND lease_until<=?').all(now())) {
   const data={...JSON.parse(row.data),status:'failed',error:timedOut()};delete data._failureReserve;
   db.prepare('UPDATE tour_chapters SET data=?,lease_until=NULL,job_token=NULL WHERE tour_id=? AND topic_id=?').run(JSON.stringify(data),row.tour_id,row.topic_id);
   if(row.topic_id==='plan') {const tour=db.prepare('SELECT data FROM tours WHERE id=?').get(row.tour_id);if(tour){const value={...JSON.parse(tour.data),status:'failed',error:data.error};db.prepare('UPDATE tours SET data=?,updated=? WHERE id=?').run(JSON.stringify(value),now(),row.tour_id);}}
  }
 }
 function cleanupRows() {
  recover();
  for(const row of db.prepare('SELECT id FROM tours WHERE expires<=? ORDER BY updated').all(now()))if(!active(row.id))remove(row.id);
 }
 function storageBytes() {
  let total=0;
  for(const row of db.prepare('SELECT data,snapshot FROM tours').all())total+=bytes(row.data)+(row.snapshot===null?0:bytes(row.snapshot));
  for(const table of ['tour_chapters','tour_progress'])for(const row of db.prepare(`SELECT data FROM ${table}`).all())total+=bytes(row.data);
  for(const value of volatile.values())total+=bytes(value);
  return total;
 }
 function capacity(protectedId) {
  while(db.prepare('SELECT COUNT(*) n FROM tours').get().n>maxTours||storageBytes()>maxStorageBytes) {
   const candidate=db.prepare('SELECT id FROM tours ORDER BY updated,created,id').all().find(r=>r.id!==protectedId&&!active(r.id));
   if(!candidate)throw tourError('busy',429);remove(candidate.id);
  }
 }
 function liveRow(owner,id) {
  const row=rowFor(owner,id);if(!row)return null;
  if(row.expires<=now()&&!active(id))return null;return row;
 }
 function prepareSnapshot(id,snapshot,data) {
  snapshotTTL(snapshot);const policy=permissions(snapshot);data.storage={textCache:policy.text,outputCache:policy.output,snapshotHash:snapshotHash(snapshot)};
  if(!policy.text)remember(id,{snapshot:copy(snapshot)});
  else if(volatile.get(id)?.snapshot)remember(id,{snapshot:undefined});
  return JSON.stringify(policy.text?snapshot:snapshotMetadata(snapshot));
 }
 function putChapters(id,chapters,outputCache) {
  const seen=new Set();
  for(const chapter of chapters) {
   const topicId=chapter.topicId||chapter.id;
   if(typeof topicId!=='string'||!topicId||topicId==='plan'||seen.has(topicId))throw Object.assign(tourError('invalid_request',400),{message:'Invalid or duplicate chapter.'});
   seen.add(topicId);
   const value={...emptyChapter(topicId),...chapter,id:chapter.id||topicId,topicId};
   const persistent=outputCache?value:{...emptyChapter(topicId),id:value.id,volatile:true};
   if(!outputCache&&value.status!=='planned')remember(id,{chapters:{...volatile.get(id)?.chapters,[topicId]:value}});
   db.prepare('INSERT INTO tour_chapters(tour_id,topic_id,data) VALUES(?,?,?)').run(id,topicId,JSON.stringify(persistent));
  }
 }
 function publicTour(row) {
  const data=JSON.parse(row.data),output={id:row.id,version:1,placeId:row.place_id,language:row.language,sourceFingerprint:row.fingerprint,status:data.status,topics:copy(volatile.get(row.id)?.topics||data.topics||[]),chapters:[],createdAt:row.created,updatedAt:row.updated,expiresAt:row.expires};
  for(const key of ['sources','officialLinks','searchLinks','outputLicense','error'])if(data[key]!==undefined)output[key]=copy(data[key]);
  for(const chapter of db.prepare("SELECT topic_id,data FROM tour_chapters WHERE tour_id=? AND topic_id<>'plan' ORDER BY rowid").all(row.id)) {
   const persisted=JSON.parse(chapter.data);delete persisted._failureReserve;const memory=volatile.get(row.id)?.chapters?.[chapter.topic_id];
   output.chapters.push(copy(memory?{...memory,volatile:true}:persisted));
  }
  if(data.storage?.textCache===false||data.storage?.outputCache===false)output.volatile=true;
  const progress=db.prepare('SELECT data FROM tour_progress WHERE tour_id=? AND owner_id=?').get(row.id,row.owner_id);if(progress)output.progress=JSON.parse(progress.data);
  return output;
 }
 function settle(token,result,error) {
  return transaction(()=>{
   const job=db.prepare('SELECT c.*,t.data AS tour_data,t.expires FROM tour_chapters c JOIN tours t ON t.id=c.tour_id WHERE c.job_token=? AND c.lease_until>?').get(token,now());
   if(!job)return false;
   const tour=JSON.parse(job.tour_data),previousChapter=JSON.parse(job.data);delete previousChapter._failureReserve;let data;
   if(job.topic_id==='plan') {
    if(error) {tour.status='failed';tour.error=publicJobError(error);data={status:'failed',error:tour.error};}
    else {
     tour.status='ready';tour.topics=copy(result.topics||[]);delete tour.error;
     for(const key of ['sources','officialLinks','searchLinks','outputLicense'])if(result[key]!==undefined)tour[key]=copy(result[key]);
     let snapshot;
     if(result.snapshot!==undefined)snapshot=prepareSnapshot(job.tour_id,result.snapshot,tour);
     const fingerprint=result.sourceFingerprint||result.fingerprint;
     if(fingerprint!==undefined)db.prepare('UPDATE tours SET fingerprint=? WHERE id=?').run(fingerprint,job.tour_id);
     if(snapshot!==undefined)db.prepare('UPDATE tours SET snapshot=?,expires=MIN(expires,?) WHERE id=?').run(snapshot,now()+snapshotTTL(result.snapshot),job.tour_id);
     if(tour.storage?.outputCache===false) {remember(job.tour_id,{topics:tour.topics});tour.topics=tour.topics.map(topic=>({...topic,title:'',summary:'',volatile:true}));}
     putChapters(job.tour_id,result.chapters||[],tour.storage?.outputCache!==false);
     data={status:'ready'};
    }
   } else {
    data=error?{...previousChapter,status:'failed',error:publicJobError(error)}:{...emptyChapter(job.topic_id),...copy(result),id:previousChapter.id||job.topic_id,topicId:job.topic_id};
    if(!['ready','failed','insufficient'].includes(data.status))throw tourError('invalid_request',400);
    if(tour.storage?.outputCache===false&&!error) {
     remember(job.tour_id,{chapters:{...volatile.get(job.tour_id)?.chapters,[job.topic_id]:data}});
     data={...emptyChapter(job.topic_id),id:data.id,volatile:true};
    }
   }
   db.prepare('UPDATE tour_chapters SET data=?,lease_until=NULL,job_token=NULL WHERE job_token=? AND lease_until>?').run(JSON.stringify(data),token,now());
   db.prepare('UPDATE tours SET data=?,updated=? WHERE id=?').run(JSON.stringify(tour),now(),job.tour_id);
   capacity(job.tour_id);return true;
  });
 }
 transaction(()=>{cleanupRows();capacity();});
 return {
  create(ownerId,input) {
   if(!ownerId||!input?.placeId||!['ru','en'].includes(input.language))throw tourError('invalid_request',400);
   return transaction(()=>{
    cleanupRows();const id=randomUUID(),created=now();
    const data={status:input.status||'planning',topics:copy(input.topics||[]),storage:{textCache:true,outputCache:true}};
    for(const key of ['sources','officialLinks','searchLinks','outputLicense'])if(input[key]!==undefined)data[key]=copy(input[key]);
    const snapshot=input.snapshot===undefined?null:prepareSnapshot(id,input.snapshot,data);
    if(data.storage.outputCache===false) {remember(id,{topics:data.topics});data.topics=data.topics.map(topic=>({...topic,title:'',summary:'',volatile:true}));}
    const expires=Math.min(created+snapshotTTL(input.snapshot),Number.isFinite(input.expiresAt)?input.expiresAt:Infinity);
    db.prepare('INSERT INTO tours VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,ownerId,input.placeId,input.language,input.sourceFingerprint||input.fingerprint||'',JSON.stringify(data),snapshot,created,created,expires);
    putChapters(id,input.chapters||[],data.storage.outputCache);
    capacity(id);return publicTour(rowFor(ownerId,id));
   });
  },
  get(ownerId,id) {transaction(()=>{recover();capacity();});const row=liveRow(ownerId,id);if(!row)return null;db.prepare('UPDATE tours SET updated=? WHERE id=?').run(now(),id);row.updated=now();return publicTour(row);},
  findActive(ownerId,placeId,language) {
   transaction(()=>{recover();capacity();});
   const rows=db.prepare('SELECT * FROM tours WHERE owner_id=? AND place_id=? AND language=? AND expires>? ORDER BY updated DESC').all(ownerId,placeId,language,now());
   const row=rows.find(r=>['planning','ready'].includes(JSON.parse(r.data).status));return row?this.get(ownerId,row.id):null;
  },
  claimJob(ownerId,tourId,topicId,{retry=false}={}) {
   return transaction(()=>{
    const tour=liveRow(ownerId,tourId);if(!tour)return null;
    let chapter=db.prepare('SELECT * FROM tour_chapters WHERE tour_id=? AND topic_id=?').get(tourId,topicId);
    if(topicId==='plan'&&!chapter&&JSON.parse(tour.data).status==='planning') {db.prepare('INSERT INTO tour_chapters(tour_id,topic_id,data) VALUES(?,?,?)').run(tourId,'plan',JSON.stringify({status:'planned'}));chapter=db.prepare('SELECT * FROM tour_chapters WHERE tour_id=? AND topic_id=?').get(tourId,topicId);}
    if(!chapter)return null;
    const data=JSON.parse(chapter.data),memory=volatile.get(tourId)?.chapters?.[topicId];
    if(memory&&memory.status!=='planned'&&!(retry&&memory.status==='failed'&&memory.error?.retryable===true))return null;
    if(data.status!=='planned'&&!(data.status==='generating'&&chapter.lease_until<=now())&&!(retry&&data.status==='failed'&&data.error?.retryable===true))return null;
    if(memory)remember(tourId,{chapters:{...volatile.get(tourId)?.chapters,[topicId]:undefined}});
    if(topicId==='plan'&&JSON.parse(tour.data).status!=='planning')return null;
    const token=randomUUID();data.status='generating';data.error=null;
    // Reserve real JSON bytes before accepting work. Even plan failure writes
    // two safe error copies (tour + sentinel); both fit in this reservation.
    data._failureReserve=' '.repeat(1024);
    db.prepare('UPDATE tour_chapters SET data=?,lease_until=?,job_token=? WHERE tour_id=? AND topic_id=?').run(JSON.stringify(data),now()+LIMITS.leaseMs,token,tourId,topicId);
    db.prepare('UPDATE tours SET updated=? WHERE id=?').run(now(),tourId);capacity(tourId);return token;
   });
  },
  completeJob:(token,result)=>settle(token,result),
  failJob:(token,error)=>settle(token,null,error),
  getSnapshot(ownerId,id,{snapshot,fingerprint}={}) {
   const row=liveRow(ownerId,id);if(!row)return null;
   const data=JSON.parse(row.data);
   if(fingerprint!==undefined&&fingerprint!==row.fingerprint)throw tourError('source_unavailable');
   if(snapshot!==undefined) {
    if(fingerprint!==row.fingerprint||data.storage?.snapshotHash&&snapshotHash(snapshot)!==data.storage.snapshotHash)throw tourError('source_unavailable');
    transaction(()=>{const encoded=prepareSnapshot(id,snapshot,data);db.prepare('UPDATE tours SET data=?,snapshot=? WHERE id=?').run(JSON.stringify(data),encoded,id);capacity(id);});
    return copy(snapshot);
   }
   if(data.storage?.textCache===false) {const value=volatile.get(id)?.snapshot;if(!value)throw tourError('source_unavailable');return copy(value);}
   return row.snapshot===null?null:JSON.parse(row.snapshot);
  },
  saveProgress(ownerId,tourId,progress) {
   if(!liveRow(ownerId,tourId))return null;
   const ids=new Set(db.prepare("SELECT data FROM tour_chapters WHERE tour_id=? AND topic_id<>'plan'").all(tourId).map(r=>JSON.parse(r.data).id));
   if(!progress||!ids.has(progress.chapterId)||!Number.isSafeInteger(progress.chunkIndex)||progress.chunkIndex<0||!Number.isFinite(progress.offsetSeconds)||progress.offsetSeconds<0||!Array.isArray(progress.completedChapterIds)||progress.completedChapterIds.length>7||new Set(progress.completedChapterIds).size!==progress.completedChapterIds.length||progress.completedChapterIds.some(id=>!ids.has(id)))throw tourError('invalid_request',400);
   const value={chapterId:progress.chapterId,chunkIndex:progress.chunkIndex,offsetSeconds:progress.offsetSeconds,completedChapterIds:progress.completedChapterIds};
   return transaction(()=>{db.prepare('INSERT INTO tour_progress VALUES(?,?,?,?) ON CONFLICT(tour_id,owner_id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(tourId,ownerId,JSON.stringify(value),now());db.prepare('UPDATE tours SET updated=? WHERE id=?').run(now(),tourId);capacity(tourId);return copy(value);});
  },
  cleanup:()=>transaction(()=>{cleanupRows();capacity();}),
  stats:()=>({tours:db.prepare('SELECT COUNT(*) n FROM tours').get().n,bytes:storageBytes()})
 };
}
