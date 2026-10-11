const langs=['ru','en','tr'];
const string=(v,max=300)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function refKey(ref){
 if(ref?.provider==='wikidata'&&/^Q[1-9]\d*$/.test(ref.id))return 'wd:'+ref.id;
 if(ref?.provider==='wikipedia'&&langs.includes(ref.language)&&Number.isSafeInteger(ref.pageId)&&ref.pageId>0)return `wiki:${ref.language}:${ref.pageId}`;
 if(ref?.provider==='osm'&&['node','way','relation'].includes(ref.kind)&&Number.isSafeInteger(ref.id)&&ref.id>0)return `osm:${ref.kind}:${ref.id}`;
 throw new Error('Invalid place reference');
}
export function validCoordinates(c){return c&&Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&Math.abs(c.lat)<=90&&Math.abs(c.lon)<=180&&['point','centroid','unknown'].includes(c.kind)&&string(c.sourceId)}
export function normalizePlace(raw){
 if(!raw||!string(raw.id)||!Array.isArray(raw.refs)||!raw.refs.length||raw.refs.length>50||!string(raw.names?.original)||!Array.isArray(raw.sourceIds)||raw.sourceIds.length>50||!raw.sourceIds.every(x=>string(x)))throw new Error('Invalid place');
 const refs=[...new Map(raw.refs.map(ref=>[refKey(ref),structuredClone(ref)])).values()];
 if(!refs.some(ref=>refKey(ref)===raw.id))throw new Error('Invalid canonical place id');
 const names={original:raw.names.original.trim()};for(const lang of ['ru','en'])if(string(raw.names[lang]))names[lang]=raw.names[lang].trim();
 if(raw.names.native){if(!string(raw.names.native.text)||!string(raw.names.native.sourceId))throw new Error('Invalid native name');names.native={text:raw.names.native.text,sourceId:raw.names.native.sourceId,...(string(raw.names.native.language,20)?{language:raw.names.native.language}:{})}}
 if(raw.coordinates!=null&&!validCoordinates(raw.coordinates))throw new Error('Invalid coordinates');
 const result={id:raw.id,refs,names,coordinates:raw.coordinates?{...raw.coordinates}:null,category:string(raw.category,120)?raw.category:'place',sourceIds:[...new Set(raw.sourceIds)]};
 if(raw.coordinateConflict?.length){if(!raw.coordinateConflict.every(validCoordinates))throw new Error('Invalid coordinate conflict');result.coordinateConflict=raw.coordinateConflict.slice(0,8).map(c=>({...c}))}
 if(Array.isArray(raw.areaRefs))result.areaRefs=raw.areaRefs.filter(r=>r?.provider==='wikidata'&&/^Q[1-9]\d*$/.test(r.id)).slice(0,2);
 return result;
}
function meters(a,b){const r=Math.PI/180,x=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;return 12742000*Math.atan2(Math.sqrt(Math.min(1,x)),Math.sqrt(Math.max(0,1-x)))}
function combine(a,b){
 let coordinates=a.coordinates||b.coordinates;
 // A linked geometry centre is not an entrance, even when another provider calls it a point.
 if(a.coordinates&&b.coordinates&&meters(a.coordinates,b.coordinates)<=250){const centre=[a.coordinates,b.coordinates].find(c=>c.kind==='centroid');if(centre)coordinates=centre}
 const conflict=[...(a.coordinateConflict||[]),...(b.coordinateConflict||[])];
 if(a.coordinates&&b.coordinates&&meters(a.coordinates,b.coordinates)>250)conflict.push(a.coordinates,b.coordinates);
 return {...a,category:a.category==='place'?b.category:a.category,refs:[...new Map([...a.refs,...b.refs].map(r=>[refKey(r),r])).values()],names:{...b.names,...a.names},coordinates,sourceIds:[...new Set([...a.sourceIds,...b.sourceIds])],...(b.areaRefs||a.areaRefs?{areaRefs:[...new Map([...(a.areaRefs||[]),...(b.areaRefs||[])].map(r=>[refKey(r),r])).values()].slice(0,2)}:{}),...(conflict.length?{coordinateConflict:[...new Map(conflict.map(c=>[JSON.stringify(c),c])).values()].slice(0,8)}:{})};
}
export function mergePlaces(records){
 const groups=[];
 for(const raw of records){let p=normalizePlace(raw);const keys=new Set(p.refs.map(refKey));const indices=[];for(let i=0;i<groups.length;i++)if(groups[i].refs.some(r=>keys.has(refKey(r))))indices.push(i);
 if(!indices.length){groups.push(p);continue}
 const first=indices[0];p=combine(groups[first],p);for(const index of indices.slice(1))p=combine(p,groups[index]);groups[first]=p;for(const index of indices.slice(1).reverse())groups.splice(index,1);
 }
 return groups;
}
