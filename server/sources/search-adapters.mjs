const MAX_RESPONSE_BYTES=2*1024*1024;
export async function boundedSearchJson(response){
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(Error('Search unavailable'),{httpStatus:response.status,reason:[401,403].includes(response.status)?'access_denied':response.status===429?'rate_limited':'upstream_error'})}
 const reader=response.body?.getReader();if(!reader)throw Error('Empty response');const chunks=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE_BYTES)throw Error('Response too large');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 return JSON.parse(Buffer.concat(chunks).toString());
}
export function createSearchAdapters({env,fetchFn}){
 const tavilyRequest=async(path,body,signal)=>boundedSearchJson(await fetchFn('https://api.tavily.com/'+path,{method:'POST',redirect:'error',signal,headers:{Authorization:'Bearer '+env.TAVILY_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {
  tavily:{configured:!!env.TAVILY_API_KEY?.trim(),usagePolicyId:'web-search-reviewed',
   async search(query,{signal,limit}){const data=await tavilyRequest('search',{query,search_depth:'basic',max_results:limit,include_answer:false,include_raw_content:false},signal);return Array.isArray(data.results)?data.results.map(r=>({...r,snippet:r.content})):[]},
   async extract(candidates,{signal}){const data=await tavilyRequest('extract',{urls:candidates.slice(0,3).map(c=>c.url),extract_depth:'basic',format:'markdown'},signal);return Array.isArray(data.results)?data.results:[]}
  },
  brave:{configured:!!env.BRAVE_SEARCH_API_KEY?.trim(),usagePolicyId:'brave-search-unreviewed',
   async search(query,{signal,limit}){const url=new URL('https://api.search.brave.com/res/v1/web/search');url.searchParams.set('q',query);url.searchParams.set('count',String(limit));const data=await boundedSearchJson(await fetchFn(url.href,{method:'GET',redirect:'error',signal,headers:{'X-Subscription-Token':env.BRAVE_SEARCH_API_KEY,Accept:'application/json'}}));return Array.isArray(data.web?.results)?data.web.results.map(r=>({...r,snippet:r.description})):[]}
  }
 };
}
