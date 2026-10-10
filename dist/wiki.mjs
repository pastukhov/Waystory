import {splitSentences} from './core.mjs';
const editions=['ru','en','tr'];
const edition=lang=>editions.includes(lang)?lang:'ru';
async function api(params,signal,lang='ru'){
  const url=new URL('https://'+edition(lang)+'.wikipedia.org/w/api.php');Object.entries({...params,format:'json',origin:'*'}).forEach(([k,v])=>url.searchParams.set(k,v));
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,10000);
  try{
   const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
   if(!response.ok)throw new Error('Википедия сейчас недоступна. Попробуйте позже.');
   const json=await response.json();if(json.error)throw new Error('Не удалось получить места. Попробуйте другой запрос.');return json;
  }catch(e){if(signal?.aborted)throw new DOMException('Поиск отменён.','AbortError');throw new Error('Википедия недоступна. Проверьте соединение и повторите поиск.')}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}

function normalize(page,lang='ru'){return {id:'wiki-'+(lang==='ru'?'':lang+'-')+page.pageid,lang,wikidata:page.pageprops?.wikibase_item,pageid:page.pageid,title:page.title,category:'Из Википедии',subtitle:page.description||'Открыть рассказ и источник',source:'https://'+lang+'.wikipedia.org/?curid='+page.pageid,art:'generic',coords:page.coordinates?.[0]?[page.coordinates[0].lat,page.coordinates[0].lon]:null,demo:false,thumbnail:page.thumbnail?.source}}
export async function searchPlaces(query,signal,language='ru'){
  const lang=language==='en'?'en':'ru';
  const j=await api({action:'query',generator:'search',gsrsearch:query,gsrnamespace:0,gsrlimit:8,prop:'pageimages|description|coordinates',piprop:'thumbnail',pithumbsize:600},signal,lang);
  return Object.values(j.query?.pages||{}).sort((a,b)=>(a.index||0)-(b.index||0)).map(p=>normalize(p,lang));
}
export async function nearbyPlaces(lat,lon,signal,language='ru'){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Получены неверные координаты. Повторите определение местоположения.');
 const preferred=language==='en'?'en':'ru',orderedEditions=[preferred,...editions.filter(lang=>lang!==preferred)];
 let partial=false;const found=new Map();
 for(const radius of [1500,5000,10000]){
  const results=await Promise.allSettled(orderedEditions.map(async lang=>{
   const j=await api({action:'query',generator:'geosearch',ggscoord:lat+'|'+lon,ggsradius:radius,ggslimit:12,prop:'pageimages|description|coordinates|pageprops',ppprop:'wikibase_item',piprop:'thumbnail',pithumbsize:600},signal,lang);
   return Object.values(j.query?.pages||{}).map(p=>normalize(p,lang));
  }));
  if(signal?.aborted)throw new DOMException('Поиск отменён.','AbortError');
  if(results.every(r=>r.status==='rejected'))throw new Error('Википедия недоступна. Проверьте соединение и повторите поиск.');
  partial ||= results.some(r=>r.status==='rejected');
  for(const r of results)if(r.status==='fulfilled')for(const p of r.value){const key=p.wikidata||p.id;if(!found.has(key))found.set(key,p)}
  const places=[...found.values()].map(p=>({...p,distance:p.coords?distance(lat,lon,...p.coords):null})).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)).slice(0,12);
  if(places.length||radius===10000)return {places,radius,partial};
 }
}

function distance(a,b,c,d){const r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return Math.round(6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)))}
export async function loadPlace(place,signal){
  if(place.blocks)return place;
  const j=await api({action:'query',pageids:place.pageid,prop:'extracts|info',explaintext:1,exchars:9000,inprop:'url'},signal,edition(place.lang));
  const page=Object.values(j.query?.pages||{})[0];if(!page?.extract)throw new Error('Для этого места нет текста. Выберите другой объект.');
  const clean=page.extract.replace(/==+[^\n]*==+/g,'').replace(/\[[^\]]*\]/g,'').trim();
  const sentences=splitSentences(clean).slice(0,32);
  const blocks=[];for(let i=0;i<sentences.length;i+=3)blocks.push({id:place.id+'-'+i,depth:i===0?0:i<9?1:2,title:i===0?'Главное':i<9?'История и детали':'Подробнее',text:sentences.slice(i,i+3).join(' ')});
  return {...place,blocks,source:page.fullurl||place.source,sourceText:clean.slice(0,9000),questions:[]};
}
