import {validateOfficialUrl} from './official-discovery.mjs';
import {apiUrl} from './http.mjs';
import {candidateUrl} from './search-provider.mjs';
// Only explicitly labelled official-site templates; never arbitrary external links.
export function officialWebsiteFromWikitext(text){
 const pattern=/\{\{\s*(?:официальный\s+сайт|official\s+website|site\s+officiel|resm[iî]\s+site|trang\s+web\s+chính\s+thức)\s*\|\s*(?:url\s*=\s*)?(https:\/\/[^\s|{}<>]+)\s*(?:\||\}\})/giu;
 for(const match of String(text).matchAll(pattern)){const url=candidateUrl(match[1]);if(url)return url}return null;
}
export async function addOfficialIdentity(bundle,{request,signal}={}){
 if(bundle.documents.some(d=>{if(!['osm','wikidata'].includes(d.provider)||d.kind!=='identity'||!d.website)return false;try{validateOfficialUrl(d.website);return true}catch{return false}}))return bundle;
 const ref=bundle.place.refs?.find(r=>r.provider==='wikipedia');if(!ref||!request)return bundle;
 try{
  const data=await request(apiUrl(ref.language+'.wikipedia.org',{action:'parse',pageid:ref.pageId,prop:'wikitext'}),{signal,timeoutMs:3000,maxBytes:1024*1024});
  const website=officialWebsiteFromWikitext(data.parse?.wikitext?.['*']||'');if(!website)return bundle;
  return {...bundle,documents:bundle.documents.map(d=>d.id===`wikipedia:${ref.language}:${ref.pageId}`?{...d,website,officialWebsite:true}:d)};
 }catch{signal?.throwIfAborted();return bundle}
}
