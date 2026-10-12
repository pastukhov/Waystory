async function placesRequest(url,{method='GET',body,signal,fetchFn=fetch}={}){
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,20000);
 try{const response=await fetchFn(url,{method,signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Источники мест временно недоступны.'),{status:response.status});return data}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
const categories={place:['Место','Place'],mosque:['Мечеть','Mosque'],museum:['Музей','Museum'],attraction:['Достопримечательность','Attraction'],viewpoint:['Смотровая площадка','Viewpoint'],artwork:['Произведение искусства','Artwork'],gallery:['Галерея','Gallery'],castle:['Замок','Castle'],ruins:['Руины','Ruins'],monument:['Памятник','Monument'],memorial:['Мемориал','Memorial']};
export function localNameLabel(place,language='ru'){const native=!!place.nativeName;return language==='en'?(native?'Local name: ':'Source name: '):(native?'Местное название: ':'Название в источнике: ')}
export function distanceMeters(lat,lon,coords){if(!coords)return null;const r=Math.PI/180,x=Math.sin((coords[0]-lat)*r/2)**2+Math.cos(lat*r)*Math.cos(coords[0]*r)*Math.sin((coords[1]-lon)*r/2)**2;return Math.round(12742000*Math.atan2(Math.sqrt(Math.min(1,x)),Math.sqrt(Math.max(0,1-x))))}
export function toLegacyPlace(record,sources=[],language='ru'){
 const wiki=record.refs.find(r=>r.provider==='wikipedia'),native=record.names.native?.text,coords=record.coordinateConflict?.length?null:record.coordinates;
 return {id:record.id,placeId:record.id,refs:record.refs,title:record.names[language]||record.names.original,originalTitle:record.names.original,nativeName:native,category:(categories[record.category]||categories.place)[language==='en'?1:0],subtitle:'',lang:record.names[language]?language:wiki?.language||record.names.native?.language||'und',cardLanguage:record.names[language]?language:wiki?.language||'und',art:'generic',demo:false,coords:coords?[coords.lat,coords.lon]:null,coordinateKind:record.coordinates?.kind||'unknown',coordinateConflict:!!record.coordinateConflict?.length,sources:sources.filter(d=>(d.placeIds||[]).some(id=>id===record.id||record.refs.some(r=>r.provider==='wikipedia'&&id===`wiki:${r.language}:${r.pageId}`||r.provider==='wikidata'&&id==='wd:'+r.id||r.provider==='osm'&&id===`osm:${r.kind}:${r.id}`))),...(wiki?{pageid:wiki.pageId,lang:wiki.language,source:`https://${wiki.language}.wikipedia.org/?curid=${wiki.pageId}`}:{})};
}
export async function discoverNearby(lat,lon,signal,language='ru',fetchFn=fetch){
 const found=new Map(),statuses=[];let completedRadius=1500,partial=false;
 const result=()=>({places:[...found.values()].sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)).slice(0,30),radius:completedRadius,partial,statuses});
 for(const radius of [1500,5000,10000]){
  signal?.throwIfAborted();
  let response;
  try{response=await placesRequest('/api/places/nearby?'+new URLSearchParams({lat,lon,radius,language}),{signal,fetchFn})}
  catch(error){signal?.throwIfAborted();if(!found.size)throw error;partial=true;return result()}
  completedRadius=radius;statuses.push(...response.statuses);
  partial ||= response.statuses.some(s=>['unavailable','partial'].includes(s.status));
  for(const record of response.places){const place=toLegacyPlace(record,response.sources,language);found.set(place.placeId,{...place,distance:distanceMeters(lat,lon,place.coords)})}
  // A single result must not prevent discovering landmarks just beyond 1.5 km.
  if(found.size>=5||radius===10000)return result();
 }
}
export async function searchCatalog(q,signal,language='ru',fetchFn=fetch){const r=await placesRequest('/api/places/search?'+new URLSearchParams({q,language}),{signal,fetchFn});return {places:r.places.map(p=>toLegacyPlace(p,r.sources,language)),partial:r.statuses.some(s=>s.status==='unavailable')}}
export async function resolvePlace(place,signal,language='ru',fetchFn=fetch){let ref=place.refs?.[0];if(!ref){const match=/^wiki-(?:(ru|en|tr)-)?([1-9]\d*)$/.exec(place.id);const pageId=place.pageid||Number(match?.[2]);if(!pageId)throw Error('Место не найдено. Повторите поиск.');ref={provider:'wikipedia',language:place.lang||match?.[1]||'ru',pageId}}
 const r=await placesRequest('/api/places/resolve',{method:'POST',body:{ref,language},signal,fetchFn});return {...place,...toLegacyPlace(r.place,r.sources,language),id:place.id};
}
export async function enrichPlace(placeId,signal,language='ru'){return placesRequest('/api/places/enrich',{method:'POST',body:{placeId,language},signal})}

