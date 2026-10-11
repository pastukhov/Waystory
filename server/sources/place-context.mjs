import {validEdition} from './languages.mjs';
const regional={VN:['vi'],HT:['ht','fr'],TR:['tr']};
export function buildPlaceContext(place,identityDocuments=[]){
 const contexts=identityDocuments.filter(d=>['osm','wikidata'].includes(d.provider)).map(d=>d.context||{});
 const countryCode=contexts.find(c=>/^[A-Z]{2}$/.test(c.countryCode))?.countryCode||null;
 const names=[...new Set([place.names.native?.text,place.names.original,...Object.values(place.names).filter(v=>typeof v==='string'),...contexts.flatMap(c=>c.aliases||[])].filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))].slice(0,12);
 const languages=[...new Set([place.names.native?.language,...(place.refs||[]).filter(r=>r.provider==='wikipedia').map(r=>r.language),...contexts.flatMap(c=>c.languages||[]),...(regional[countryCode]||[])].filter(validEdition))];
 return {placeId:place.id,names,category:place.category,coordinates:place.coordinateConflict?.length?null:place.coordinates,locality:contexts.find(c=>c.locality)?.locality||null,countryCode,languages,identityLinks:[...new Set(identityDocuments.flatMap(d=>[d.website,d.url]).filter(v=>typeof v==='string'))]};
}
