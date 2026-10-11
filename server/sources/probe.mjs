import {modelDocuments} from './evidence.mjs';

// Fixed public locations only. This operation never generates a story or uses
// paid enrichment, and reports counts/statuses rather than source text.
const scenarios=[{name:'Alanya tower',lat:36.536,lon:31.999,rich:true},{name:'Alanya sparse coverage',lat:36.566,lon:31.982,rich:false},{name:'Paris',lat:48.858,lon:2.294,rich:true}];
export async function runSourcesProbe({collect,fetchFn=fetch,report,signal=AbortSignal.timeout(110000),now=Date.now}){
 let passed=true;
 for(const scenario of scenarios){
  const url='http://127.0.0.1:5173/api/places/nearby?'+new URLSearchParams({lat:scenario.lat,lon:scenario.lon,radius:1500,language:'ru'}),start=now();
  const request=()=>fetchFn(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
  try{
   signal.throwIfAborted();const r=await request(),data=await r.json(),coldMs=now()-start;
   if(!r.ok){report({probe:'sources-test',scenario:scenario.name,status:r.status,testedPlaces:0,materials:0});passed=false;continue}
   const cachedStart=now(),second=await request(),repeated=await second.json(),repeatMs=now()-cachedStart;
   const places=data.places||[],repeatPlaces=repeated.places||[],sameIds=JSON.stringify(places.map(p=>p.id).sort())===JSON.stringify(repeatPlaces.map(p=>p.id).sort());
   const cacheEligible=!(data.statuses||[]).some(s=>['unavailable','partial'].includes(s.status));
   const repeatOk=second.ok&&sameIds;
   // Prefer known explicit text identities; all sampled entries still pass
   // through the real selected-place collector and the model-input policy.
   const sample=[...places].sort((a,b)=>Number(b.refs.some(r=>r.provider==='wikipedia'))-Number(a.refs.some(r=>r.provider==='wikipedia'))).slice(0,3);
   const evidence=await Promise.all(sample.map(async place=>{
    try{const bundle=await collect(place,{language:'ru',includeWeb:false,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});const texts=modelDocuments(bundle);return {id:place.id,materials:texts.length,characters:texts.reduce((n,d)=>n+d.text.trim().length,0),statuses:bundle.statuses}}
    catch{return {id:place.id,materials:0,characters:0,statuses:[{provider:'collection',status:'unavailable'}]}}
   }));
   const materials=evidence.reduce((n,p)=>n+p.materials,0),withMaterials=evidence.filter(p=>p.materials>0).length;
   const discoveryOk=repeatOk&&new Set(places.map(p=>p.id)).size===places.length&&(!scenario.rich||places.length>0);
   const evidenceOk=!scenario.rich||withMaterials>0;if(!discoveryOk||!evidenceOk)passed=false;
   report({probe:'sources-test',scenario:scenario.name,status:r.status,found:places.length,coldMs,repeatMs,repeatStatus:second.status,repeatSameIds:sameIds,cacheEligible,...(repeatOk&&cacheEligible?{cachedMs:repeatMs}:{}),discoveryOk,evidenceRequired:scenario.rich,evidenceOk,testedPlaces:sample.length,withMaterials,materials,evidence,nativeNames:places.filter(p=>p.names.native).length,coordinates:places.filter(p=>p.coordinates&&!p.coordinateConflict?.length).length,conflicts:places.filter(p=>p.coordinateConflict?.length).length,statuses:data.statuses,paidCalls:0});
  }catch{report({probe:'sources-test',scenario:scenario.name,error:'unavailable',testedPlaces:0,materials:0});passed=false}
 }
 return passed;
}
