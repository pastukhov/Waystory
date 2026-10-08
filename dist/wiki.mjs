import {splitSentences} from './core.mjs';
const API='https://ru.wikipedia.org/w/api.php';
async function api(params,signal){
  const url=new URL(API);Object.entries({...params,format:'json',origin:'*'}).forEach(([k,v])=>url.searchParams.set(k,v));
  const response=await fetch(url,{signal,headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Википедия сейчас недоступна. Попробуйте позже или откройте пример.');
  const json=await response.json();if(json.error)throw new Error('Не удалось получить места. Попробуйте другой запрос.');return json;
}
function normalize(page){return {id:'wiki-'+page.pageid,pageid:page.pageid,title:page.title,category:'Из Википедии',subtitle:page.description||'Открыть рассказ и источник',source:'https://ru.wikipedia.org/?curid='+page.pageid,art:'generic',coords:page.coordinates?.[0]?[page.coordinates[0].lat,page.coordinates[0].lon]:null,demo:false,thumbnail:page.thumbnail?.source}}
export async function searchPlaces(query,signal){
  const j=await api({action:'query',generator:'search',gsrsearch:query,gsrnamespace:0,gsrlimit:8,prop:'pageimages|description|coordinates',piprop:'thumbnail',pithumbsize:600},signal);
  return Object.values(j.query?.pages||{}).sort((a,b)=>(a.index||0)-(b.index||0)).map(normalize);
}
export async function nearbyPlaces(lat,lon,signal){
  const j=await api({action:'query',generator:'geosearch',ggscoord:lat+'|'+lon,ggsradius:1500,ggslimit:12,prop:'pageimages|description|coordinates',piprop:'thumbnail',pithumbsize:600},signal);
  return Object.values(j.query?.pages||{}).map(normalize).map(p=>({...p,distance:p.coords?distance(lat,lon,...p.coords):null})).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity));
}
function distance(a,b,c,d){const r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return Math.round(6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)))}
export async function loadPlace(place,signal){
  if(place.blocks)return place;
  const j=await api({action:'query',pageids:place.pageid,prop:'extracts|info',explaintext:1,exchars:9000,inprop:'url'},signal);
  const page=Object.values(j.query?.pages||{})[0];if(!page?.extract)throw new Error('Для этого места нет текста. Выберите другой объект.');
  const clean=page.extract.replace(/==+[^\n]*==+/g,'').replace(/\[[^\]]*\]/g,'').trim();
  const sentences=splitSentences(clean).slice(0,32);
  const blocks=[];for(let i=0;i<sentences.length;i+=3)blocks.push({id:place.id+'-'+i,depth:i===0?0:i<9?1:2,title:i===0?'Главное':i<9?'История и детали':'Подробнее',text:sentences.slice(i,i+3).join(' ')});
  return {...place,blocks,source:page.fullurl||place.source,sourceText:clean.slice(0,9000),questions:[]};
}
