import {TOUR_LIMITS as LIMITS} from './config.mjs';
import {tourError} from './store.mjs';

export function createTourJobs({store,now=Date.now,maxActive=LIMITS.maxJobsPerProcess}={}) {
 maxActive=Number.isSafeInteger(maxActive)&&maxActive>0?Math.min(maxActive,LIMITS.maxJobsPerProcess):LIMITS.maxJobsPerProcess;
 const active=new Map();let closed=false;
 return {
  start({ownerId,tourId,topicId,run,retry=false}) {
   if(closed)throw tourError('provider_error',503);
   const tour=store.get(ownerId,tourId);
   if(!tour)throw Object.assign(tourError('invalid_request',404),{retryable:false});
   const chapter=topicId==='plan'?{status:tour.status==='planning'?'planned':tour.status}:tour.chapters.find(c=>c.topicId===topicId);
   if(!chapter)throw tourError('invalid_request',404);
   const key=JSON.stringify([tourId,topicId]);
   if(active.has(key)||!['planned','generating'].includes(chapter.status)&&!(retry&&chapter.status==='failed'&&chapter.error?.retryable===true))return {accepted:false};
   if(active.size>=maxActive||[...active.values()].some(job=>job.ownerId===ownerId))throw tourError('busy',429);
   if(typeof run!=='function')throw tourError('invalid_request',400);
   const jobToken=store.claimJob(ownerId,tourId,topicId,{retry});if(!jobToken)return {accepted:false};
   const controller=new AbortController(),deadline=now()+(topicId==='plan'?LIMITS.planTimeoutMs:LIMITS.chapterTimeoutMs);
   const job={ownerId,controller,jobToken,promise:null};active.set(key,job);
   const timeout=()=>controller.abort(tourError('provider_timeout'));
   const timer=setTimeout(timeout,Math.max(1,deadline-now()));timer.unref?.();
   const failSafely=error=>{try {store.failJob(jobToken,error);} catch { /* A storage outage is recovered by the lease on later reads. */ }};
   let onAbort;
   const aborted=new Promise((resolve,reject)=>{onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});});
   const work=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return run({signal:controller.signal,jobToken});});
   // Abort bounds the slot even when an upstream implementation ignores signal.
   // Promise.race also observes late upstream rejection; token fencing rejects
   // late completion without touching a subsequent job's slot.
   job.promise=Promise.race([work,aborted]).then(result=>{
    if(now()>=deadline&&!controller.signal.aborted)timeout();
    controller.signal.throwIfAborted();store.completeJob(jobToken,result);
   }).catch(error=>{failSafely(controller.signal.aborted?controller.signal.reason:error);}).finally(()=>{
    clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);
    if(active.get(key)===job)active.delete(key);
   });
   return {accepted:true};
  },
  drain:()=>Promise.allSettled([...active.values()].map(job=>job.promise)),
  shutdown() {
   closed=true;
   for(const job of active.values())job.controller.abort(tourError('provider_error',503));
   return Promise.allSettled([...active.values()].map(job=>job.promise));
  },
  get activeCount(){return active.size;}
 };
}
