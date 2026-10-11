import {selectSourceLanguages} from '../sources/languages.mjs';
import {createCollector,sourceBundle} from '../sources/collect.mjs';
import {createSourceCache} from '../sources/cache.mjs';
import {GuideError} from '../guide.mjs';import {mergePlaces,refKey} from './model.mjs';
const bad=()=>new GuideError(400,'Некорректные параметры поиска.');
export function publicSource(d){const {text,sitelinks,website,wikipediaTitle,...metadata}=d;return metadata}
export function createPlaces({store,providers,now=Date.now,enrichment}={}){
 const open=providers.filter(p=>['wikipedia','osm','wikidata','wikivoyage'].includes(p.id)),cache=new Map();let minute=now(),calls=0,active=0;
 function language(l){if(!['ru','en'].includes(l))throw bad()}
 function save(results){const documents=results.flatMap(r=>r.documents||[]),places=mergePlaces(results.flatMap(r=>r.places||[])).map(p=>store.upsert(p));return {places,sources:[...new Map(documents.map(d=>[d.id,publicSource(d)])).values()]}}
 async function hydrate(results,signal,{skipKnown=false,language='ru'}={}){
  const wiki=open.find(p=>p.id==='wikipedia');if(!wiki?.resolveTitle)return {attempted:0,failed:0};
  const links=[];for(const r of results)for(const doc of r.documents||[]){
   const editions=selectSourceLanguages({languages:[doc.language,...(doc.context?.languages||[])]},{outputLanguage:language});
   const entries=Object.entries(doc.sitelinks||{}).filter(([site])=>/^[a-z]{2,3}(?:-[a-z]{2,12})?wiki$/.test(site));
   entries.sort(([a],[b])=>{const rank=s=>{const i=editions.indexOf(s.slice(0,-4));return i<0?99:i};return rank(a)-rank(b)});
   for(const [site,title] of entries.slice(0,3))if(/^[a-z]{2,3}(?:-[a-z]{2,12})?wiki$/.test(site))links.push({doc,title,language:site.slice(0,-4)});
   if(doc.provider==='osm'&&/^[a-z]{2,3}(?:-[a-z]{2,12})?:.{1,300}$/.test(doc.wikipediaTitle||'')){const [language,...title]=doc.wikipediaTitle.split(':');links.push({doc,title:title.join(':'),language})}
  }
  // Links are explicit provider metadata, never a guess based on name or proximity.
  const known=results.flatMap(r=>r.documents||[]).filter(d=>d.provider==='wikipedia');
  const pending=links.filter(link=>!skipKnown||!known.some(d=>d.language===link.language&&d.title.replaceAll('_',' ')===link.title.replaceAll('_',' ')));
  const selected=[],editions=new Set(known.map(d=>d.language).slice(0,3));
  for(const link of pending){if(skipKnown&&!editions.has(link.language)&&editions.size>=3)continue;editions.add(link.language);selected.push(link);if(selected.length===12)break}
  const out=await Promise.allSettled(selected.map(async({doc,title,language})=>{const found=await wiki.resolveTitle(title,language,{signal});for(const p of found.places){const original=results.flatMap(r=>r.places||[]).find(p=>p.sourceIds.includes(doc.id)||p.refs.some(r=>refKey(r)===doc.id));if(original)p.refs.push(...original.refs)}return found}));
  results.push(...out.filter(r=>r.status==='fulfilled').map(r=>r.value));
  return {attempted:selected.length,failed:out.filter(r=>r.status==='rejected').length};
 }
 async function run(method,input){language(input.language);input.signal?.throwIfAborted();const key=JSON.stringify([method,input.lat,input.lon,input.radius,input.q,input.language]);const hit=cache.get(key);if(hit&&now()-hit.time<300000)return structuredClone(hit.value);if(now()-minute>=60000){calls=0;minute=now()}if(calls>=60||active>=4)throw new GuideError(429,'Поиск сейчас занят. Повторите через минуту.');calls++;active++;
  const signal=input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
  try{const selected=open.filter(p=>p[method]);const out=await Promise.allSettled(selected.map(p=>p[method]({...input,signal})));input.signal?.throwIfAborted();const statuses=selected.map((p,i)=>({provider:p.id,status:out[i].status==='fulfilled'?out[i].value.status||'ok':'unavailable'}));const good=out.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw new GuideError(503,'Источники мест временно недоступны.');
   const ids=[...new Set(good.flatMap(r=>r.places||[]).flatMap(p=>p.refs.filter(r=>r.provider==='wikidata').map(r=>r.id)))].slice(0,30),wd=open.find(p=>p.id==='wikidata');if(ids.length&&wd?.entities){try{good.push(await wd.entities(ids,{signal}));statuses.push({provider:'wikidata',status:'ok'})}catch{statuses.push({provider:'wikidata',status:'unavailable'})}}
   await hydrate(good,signal,{language:input.language});const value={...save(good),statuses};if(method==='search'){value.places=mergePlaces([...value.places,...store.search(input.q)])}else{const distance=p=>{const c=p.coordinateConflict?.length?null:p.coordinates;if(!c)return Infinity;const r=Math.PI/180,x=Math.sin((c.lat-input.lat)*r/2)**2+Math.cos(input.lat*r)*Math.cos(c.lat*r)*Math.sin((c.lon-input.lon)*r/2)**2;return 12742000*Math.atan2(Math.sqrt(Math.min(1,x)),Math.sqrt(Math.max(0,1-x)))};value.places.sort((a,b)=>distance(a)-distance(b))}value.places=value.places.slice(0,30);if(!statuses.some(s=>['unavailable','partial'].includes(s.status))){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{time:now(),value})}return value;
  }finally{active--}
 }
 const collector=createCollector({providers:[...open,...(enrichment?[enrichment]:[])],cache:store.db?createSourceCache({db:store.db,now}):null});
 return {store,providers:open,async nearby(input){if(!Number.isFinite(input.lat)||!Number.isFinite(input.lon)||Math.abs(input.lat)>90||Math.abs(input.lon)>180||![1500,5000,10000].includes(input.radius??1500))throw bad();return run('nearby',{...input,radius:input.radius??1500})},async search(input){if(typeof input.q!=='string'||input.q.trim().length<2||input.q.length>200)throw bad();return run('search',{...input,q:input.q.trim()})},async resolve(ref,{language:lang='ru',signal}={}){language(lang);try{refKey(ref)}catch{throw bad()}const provider=open.find(p=>p.id===ref.provider);if(!provider?.resolve)throw bad();try{const result=await provider.resolve(ref,{signal});if(!result?.places?.length){const cached=store.getByRef(ref);if(cached)return {place:cached,sources:[],statuses:[{provider:provider.id,status:'unavailable'}]};throw new GuideError(404,'Место не найдено.')}const resolved=[result];const wd=open.find(p=>p.id==='wikidata');const ids=result.places.flatMap(p=>p.refs.filter(r=>r.provider==='wikidata').map(r=>r.id));if(ids.length&&wd?.entities){try{resolved.push(await wd.entities(ids,{signal}))}catch{}}await hydrate(resolved,signal,{language:lang});const saved=save(resolved);return {place:saved.places[0],sources:saved.sources,statuses:[{provider:provider.id,status:result.status||'ok'}]}}catch(error){if(error instanceof GuideError)throw error;throw new GuideError(503,'Источник места временно недоступен.')}},async collect(place,options={}){
  // Collect first: healthy identity/text cache remains useful when an upstream
  // is down. Reuse explicit metadata to recover only missing selected-place links.
  const bundle=await collector(place,options);
  const resolved=[{places:[store.getById(place.id)||place],documents:bundle.documents}];
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(options.hydrationTimeoutMs||3000)]):AbortSignal.timeout(options.hydrationTimeoutMs||3000);
  const recovery=await hydrate(resolved,signal,{skipKnown:true,language:options.language});options.signal?.throwIfAborted();
  if(!recovery.attempted)return bundle;
  const saved=save(resolved),updated=saved.places.find(p=>p.id===place.id)||store.getById(place.id)||place;
  const documents=resolved.flatMap(r=>r.documents||[]);
  const statuses=bundle.statuses.map(s=>s.provider!=='wikipedia'?s:{...s,status:recovery.failed?(documents.some(d=>d.provider==='wikipedia')?'partial':'unavailable'):documents.some(d=>d.provider==='wikipedia')?'ok':'empty'});
  return sourceBundle(updated,documents,statuses);
 }};
}

