export function originalPlaceName(place){return String(place.originalTitle||place.title||'').trim()}
export function mapLink(place){
 const coords=place.coords;
 if(Array.isArray(coords)&&coords.length===2&&coords.every(Number.isFinite)&&Math.abs(coords[0])<=90&&Math.abs(coords[1])<=180){
  const url=new URL('https://www.google.com/maps/dir/');url.searchParams.set('api','1');url.searchParams.set('destination',coords.join(','));return {url:url.href,directions:true};
 }
 const name=originalPlaceName(place);if(!name)return null;
 const url=new URL('https://www.google.com/maps/search/');url.searchParams.set('api','1');url.searchParams.set('query',name);return {url:url.href,directions:false};
}
