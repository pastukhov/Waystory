const codes=new Set(['auth_required','budget_exhausted','source_unavailable','insufficient_evidence','verification_failed','provider_timeout','provider_error','busy']);
const fallback='Tour request failed. Please try again.';
function abortable(work,signal){
 signal?.throwIfAborted();
 if(!signal)return Promise.resolve().then(work);
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason||new DOMException('Aborted','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{signal.throwIfAborted();return work()}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
function responseError(status,data){
 const value=data?.error;
 const known=value&&codes.has(value.code)&&typeof value.message==='string'&&value.message.length<=500&&!/[<>]/.test(value.message)&&typeof value.retryable==='boolean'&&typeof value.diagnosticId==='string';
 const publicError=known?{code:value.code,message:value.message,retryable:value.retryable,diagnosticId:value.diagnosticId}:{code:status===401?'auth_required':'provider_error',message:fallback,retryable:status>=500,diagnosticId:null};
 return Object.assign(new Error(publicError.message),{status,...publicError,publicError});
}
export function createToursClient({fetchFn=fetch,pollMs=2000}={}){
 const part=value=>encodeURIComponent(value);
 const url=id=>'/api/tours/'+part(id);
 const request=(path,{method='GET',body,signal}={})=>abortable(async()=>{
  const response=await fetchFn(path,{method,credentials:'same-origin',cache:'no-store',signal,headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json()}catch{if(response.ok)throw responseError(response.status,null)}
  signal?.throwIfAborted();
  if(!response.ok)throw responseError(response.status,data);
  return data;
 },signal);
 const client={
  start:(body,options)=>request('/api/tours',{...options,method:'POST',body}),
  get:(id,options)=>request(url(id),options),
  prepareChapter:(id,topicId,options)=>request(url(id)+'/chapters/'+part(topicId),{...options,method:'POST',body:{}}),
  retryChapter:(id,topicId,options)=>request(url(id)+'/chapters/'+part(topicId)+'/retry',{...options,method:'POST',body:{}}),
  playbackEvent:(id,body,options)=>request(url(id)+'/playback-events',{...options,method:'POST',body}),
  saveProgress:(id,body,options)=>request(url(id)+'/progress',{...options,method:'PUT',body}),
  async waitFor(id,predicate,{signal}={}){
   for(;;){
    const tour=await client.get(id,{signal});signal?.throwIfAborted();
    if(predicate(tour))return tour;
    await abortable(()=>new Promise((resolve,reject)=>{
     const abort=()=>{clearTimeout(timer);reject(signal.reason)};
     const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},pollMs);
     signal?.addEventListener('abort',abort,{once:true});
    }),signal);
   }
  }
 };
 return client;
}
