import {apiUrl} from './http.mjs';import {licenseFor} from './policies.mjs';
export function createWikivoyageProvider({request,wikidata,now=Date.now}={}){
 return {id:'wikivoyage',async documents(place,{language='ru',signal}={}){
  let refs=place.refs.filter(r=>r.provider==='wikidata'),scope='place';const documents=[],seen=new Set();
  for(let hop=0;hop<=2&&refs.length;hop++){
   const result=await wikidata.entities(refs.slice(0,2).map(r=>r.id),{signal});const next=[];
   for(const record of result.places){const identity=result.documents.find(d=>d.id===record.id);const links=identity?.sitelinks||{};
    const site=[language,...['en','ru','tr'].filter(l=>l!==language)].map(l=>l+'wikivoyage').find(k=>links[k])||Object.keys(links).find(k=>k.endsWith('wikivoyage'));
    if(site&&!seen.has(site+':'+links[site])){seen.add(site+':'+links[site]);const lang=site.slice(0,-10),j=await request(apiUrl(lang+'.wikivoyage.org',{action:'query',titles:links[site],prop:'extracts|revisions',explaintext:1,exchars:6000,rvprop:'ids|timestamp'}),{signal});for(const p of Object.values(j.query?.pages||{}))if(p.pageid>0&&p.extract){documents.push({id:`wikivoyage:${lang}:${p.pageid}`,provider:'wikivoyage',url:`https://${lang}.wikivoyage.org/?curid=${p.pageid}${p.revisions?.[0]?.revid?'&oldid='+p.revisions[0].revid:''}`,title:p.title,language:lang,kind:'visitor-info',scope,placeIds:[place.id],areaRef:scope==='area'?record.id:null,retrievedAt:new Date(now()).toISOString(),publishedAt:null,updatedAt:p.revisions?.[0]?.timestamp||null,text:p.extract,revision:String(p.revisions?.[0]?.revid||''),license:licenseFor('wikimedia-cc-by-sa',`${lang} Wikivoyage contributors`)})}}
    next.push(...record.areaRefs||[]);
   }
   if(documents.length)break;refs=[...new Map(next.map(r=>[r.id,r])).values()].filter(r=>!seen.has(r.id)).slice(0,2);for(const r of refs)seen.add(r.id);scope='area';
  }
  return {places:[],documents,status:documents.length?'ok':'empty'};
 }};
}

