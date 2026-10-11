import {candidateUrl} from './search-provider.mjs';
const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const categories={viewpoint:['viewpoint','observation','смотров','panorama','belvédère'],museum:['museum','musée','bảo tàng','музей'],monument:['monument','memorial','памятник','đài'],castle:['castle','fortress','château','крепость'],tower:['tower','tháp','tour','башня']};
function distance(a,b){const r=Math.PI/180,x=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;return 12742000*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)))}
export function matchCandidate(context,candidate){
 const url=candidateUrl(candidate.url);if(!url)return {decision:'rejected',signals:[],reason:'invalid_url'};
 const text=normalize(candidate.title+' '+candidate.snippet),names=context.names.map(normalize).filter(n=>n.length>=3),matched=names.filter(n=>(' '+text+' ').includes(' '+n+' '));
 const coordinates=candidate.identitySignals?.coordinates,located=context.coordinates&&coordinates&&Number.isFinite(coordinates.lat)&&Number.isFinite(coordinates.lon);
 if(located&&distance(context.coordinates,coordinates)>(context.coordinates.kind==='centroid'?2000:500))return {decision:'rejected',signals:[],reason:'wrong_location'};
 if(!matched.length)return {decision:'rejected',signals:[],reason:'wrong_name'};
 if(context.identityLinks.some(link=>candidateUrl(link)===url))return {decision:'verified',signals:['explicit_link','name'],reason:null};
 const locality=context.locality&&text.includes(normalize(context.locality));
 const category=(categories[context.category]||[context.category]).filter(Boolean).some(c=>text.includes(normalize(c)));
 const country=candidate.identitySignals?.countryCode;
 if(country&&context.countryCode&&country!==context.countryCode)return {decision:'rejected',signals:[],reason:'wrong_country'};
 const address=context.address&&normalize(context.address).length>=12&&text.includes(normalize(context.address))&&country===context.countryCode;
 if((locality||located)&&category&&(located||address))return {decision:'verified',signals:['name','locality','category',located?'coordinates':'address'],reason:null};
 return {decision:'ambiguous',signals:['name'],reason:'insufficient_identity'};
}
