import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';

const MAX_BYTES = 512 * 1024;
const fail = (reason, message = reason) => Object.assign(new Error(message), {reason});

// Fail closed on special-use networks, including IPv4-mapped and transition IPv6.
export function isPublicAddress(address) {
 if (isIP(address) === 4) {
  const [a,b,c] = address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===100&&b>=64&&b<=127) ||
   (a===169&&b===254) || (a===172&&b>=16&&b<=31) ||
   (a===192&&(b===168 || b===0 || (b===88&&c===99))) ||
   (a===198&&(b===18||b===19||(b===51&&c===100))) || (a===203&&b===0&&c===113));
 }
 if (isIP(address) !== 6) return false;
 const normalized = new URL(`https://[${address}]/`).hostname.slice(1,-1);
 const groups = normalized.split(':');
 const first = parseInt(groups[0],16), second = parseInt(groups[1]||'0',16);
 return first>=0x2000 && first<=0x3fff && first!==0x2002 &&
  !(first===0x2001&&(second<=0x1ff || second===0xdb8)) && !(first===0x3fff&&second<=0x0fff);
}

export function validateOfficialUrl(value) {
 const url = new URL(value);
 const host = url.hostname.replace(/^\[|\]$/g,'');
 if (url.protocol!=='https:' || url.port || url.username || url.password || url.href.length>2000 ||
  host.endsWith('.') || !host.includes('.')&&!isIP(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
  (isIP(host)&&!isPublicAddress(host))) throw fail('unsafe_url','Official URL prohibited');
 url.hash='';
 return url;
}

function aborted(signal, promise) {
 if (!signal) return promise;
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}

// Each redirect is validated and resolved again. The socket uses the vetted address,
// while TLS certificate verification and SNI retain the original hostname.
export function createOfficialHttp({lookup=dnsLookup, requestFn=httpsRequest}={}) {
 return async function request(value,{signal,maxBytes=MAX_BYTES,onRequest=()=>{}}={}) {
  let url=validateOfficialUrl(value);
  for(let redirects=0;;redirects++) {
   signal?.throwIfAborted();
   const hostname=url.hostname.replace(/^\[|\]$/g,'');
   const records=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await aborted(signal,lookup(hostname,{all:true,verbatim:true}));
   if (!records.length || records.some(r=>!isPublicAddress(r.address))) throw fail('unsafe_url','DNS address is not public');
   onRequest();
   const pinned=records[0];
   const response=await new Promise((resolve,reject)=>{
    const req=requestFn(url,{method:'GET',agent:false,signal,
     lookup:(_host,options,callback)=>callback(null,...(options?.all?[[pinned]]:[pinned.address,pinned.family])),
     headers:{Accept:'text/html,application/xhtml+xml','Accept-Encoding':'identity','User-Agent':'Waystory/1.0 (https://ws.nayg.ru)'}},res=>{
      const status=res.statusCode;
      if ([301,302,303,307,308].includes(status)) {res.destroy();resolve({redirect:res.headers.location});return;}
      if (status<200 || status>=300) {res.destroy();reject(fail('upstream_error'));return;}
      if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(res.headers['content-type']||'')) {res.destroy();reject(fail('unsupported_content'));return;}
      if (res.headers['content-encoding'] && res.headers['content-encoding']!=='identity') {res.destroy();reject(fail('unsupported_encoding'));return;}
      if (Number(res.headers['content-length'])>maxBytes) {res.destroy();reject(fail('response_too_large'));return;}
      let bytes=0;const parts=[];
      res.on('data',part=>{bytes+=part.length;if(bytes>maxBytes){res.destroy();reject(fail('response_too_large'));}else parts.push(part);});
      res.on('error',reject);res.on('aborted',()=>reject(fail('upstream_error')));
      res.on('end',()=>resolve({html:Buffer.concat(parts).toString('utf8')}));
     });
    req.on('error',reject);req.end();
   });
   if ('redirect' in response) {
    if (redirects>=2 || !response.redirect) throw fail('redirect_limit');
    const next=validateOfficialUrl(new URL(response.redirect,url).href);
    if(!sameSite(next,url))throw fail('offsite_redirect');
    url=next;continue;
   }
   return {...response,url:url.href};
  }
 };
}

function entities(value) {
 return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(match,entity)=>{
  if(entity[0]==='#') {const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[entity.toLowerCase()]||match;
 });
}
const clean = value => entities(value.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,180);
function classify(value) {
 const text=value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 if (/audio|аудио|аудiо|audiogid|sesli|am thanh|mave\.digital|podcast|soundcloud|izi\.travel/.test(text)) return 'audio';
 if (/guide|гид|путевод|rehber|huong dan/.test(text)) return 'guide';
 if (/exhibit|exposition|выстав|экспози|sergi|trien lam/.test(text)) return 'exhibition';
 return null;
}
function anchors(html,base) {
 const result=[];
 const body=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 for (const match of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
  const href=/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]);
  if(!href)continue;
  try {const url=validateOfficialUrl(new URL(entities(href[1]??href[2]??href[3]),base).href);
   const heading=/<([a-z][\w-]*)\b[^>]*class\s*=\s*["'][^"']*(?:__title|__sub|\btitle\b)[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/i.exec(match[2])?.[2] || /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/i.exec(match[2])?.[1];
   const title=clean(heading||'')||clean(/\b(?:aria-label|title)\s*=\s*["']([^"']*)/i.exec(match[1])?.[1]||'')||clean(match[2]);
   const kind=classify(`${clean(match[2])} ${title} ${decodeURI(url.pathname)} ${url.hostname}`);
   if(kind)result.push({url:url.href,title:title||url.hostname,kind});
  }catch{}
  if(result.length>=200)break;
 }
 return result;
}
const sameSite=(a,b)=>a.hostname.replace(/^www\./,'')===b.hostname.replace(/^www\./,'');

/**
 * Discover link metadata only. `request` is an optional trusted test/page transport
 * returning {url, html}; production uses DNS-pinned HTTPS and counts redirects.
 * `timeoutMs` and `maxPages` may lower (never raise) the 8s/four-request limits.
 * OSM/Wikidata identity websites and verified Wikipedia official-site metadata
 * are the only seeds. Article bodies never enter documents or model context.
 */
export function createOfficialDiscovery({request,now=Date.now,timeoutMs=8000,maxPages=4}={}) {
 const transport=request||createOfficialHttp();
 return async function discover(bundle,{signal,language}={}) {
  const timerController=new AbortController();
  const timer=setTimeout(()=>timerController.abort(fail('timeout')),Math.min(8000,Math.max(1,timeoutMs)));
  const combined=signal?AbortSignal.any([signal,timerController.signal]):timerController.signal;
  const links=new Map(),queue=[],seen=new Set();let requests=0,successful=0,lastReason;
  const checkedAt=new Date(now()).toISOString();
  const add=(link)=>{const previous=links.get(link.url);if((!previous&&links.size<100)||(previous?.title===new URL(link.url).hostname&&link.title!==previous.title))links.set(link.url,{...link,checkedAt});};
  for(const document of bundle?.documents||[]) {
   const trustedIdentity=['osm','wikidata'].includes(document.provider)&&document.kind==='identity';
   const verifiedWiki=document.provider==='wikipedia'&&document.officialWebsite===true;
   if(!(trustedIdentity||verifiedWiki)||typeof document.website!=='string')continue;
   try {const url=validateOfficialUrl(document.website);
    if(queue.some(item=>item.url===url.href))continue;
    add({url:url.href,title:clean(document.title||url.hostname),kind:'website',sourceUrl:document.url||url.href});
    queue.push({url:url.href,root:url,priority:0});
   }catch{lastReason='unsafe_url';}
  }
  const hadSeeds=queue.length>0;
  const consume=()=>{combined.throwIfAborted();if(requests>=Math.min(4,maxPages))throw fail('request_limit');requests++;};
  try {
   while(queue.length&&requests<Math.min(4,maxPages)&&!combined.aborted) {
    queue.sort((a,b)=>b.priority-a.priority);const item=queue.shift();if(seen.has(item.url))continue;seen.add(item.url);
    try {
     if(request)consume();
     const page=await aborted(combined,transport(item.url,{signal:combined,maxBytes:MAX_BYTES,onRequest:consume,language}));
     const finalUrl=validateOfficialUrl(page.url||item.url);
     if(!sameSite(finalUrl,item.root))throw fail('offsite_redirect');
     if(typeof page.html!=='string'||Buffer.byteLength(page.html)>MAX_BYTES)throw fail('response_too_large');
     successful++;
     for(const link of anchors(page.html,finalUrl)) {
      const linkedUrl=new URL(link.url),local=sameSite(linkedUrl,item.root);
      if(!local&&link.kind!=='audio')continue;
      add({...link,sourceUrl:finalUrl.href});
      const depth=linkedUrl.pathname.split('/').filter(Boolean).length;
      // Detail pages outrank generic sections; shallow exhibition pages outrank
      // their nested excursions/workshops. Audio always wins the next request.
      const priority=({audio:100,guide:70,exhibition:40}[link.kind])-(depth<2?20:Math.min(15,depth));
      if(local&&!seen.has(link.url)&&!queue.some(q=>q.url===link.url))queue.push({url:link.url,root:item.root,priority});
     }
    }catch(error){lastReason=combined.aborted?(signal?.aborted?'aborted':'timeout'):(error.reason||'upstream_error');}
   }
  }finally{clearTimeout(timer);}
  const status=successful?'ok':hadSeeds||lastReason?'unavailable':'empty';
  return {links:[...links.values()],statuses:[{provider:'official-web',status,...(lastReason?{reason:lastReason}:{})}]};
 };
}
