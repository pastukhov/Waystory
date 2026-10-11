import {sourcePolicy,licenseFor} from './policies.mjs';
import {candidateUrl} from './search-provider.mjs';
export function extractEvidence(candidate,{placeId,now=Date.now}={}){
 const policy=sourcePolicy(candidate.usagePolicyId),url=candidateUrl(candidate.url);
 if(!url||!policy.allowModelInput||!policy.allowGeneratedAudio||!candidate.snippet?.trim())return null;
 return {id:'web:'+url,provider:'global-web',url,title:candidate.title||url,language:candidate.language||'und',kind:'history',scope:'place',placeIds:[placeId],text:candidate.snippet.slice(0,6000),revision:'',retrievedAt:new Date(now()).toISOString(),publishedAt:null,updatedAt:null,license:licenseFor(candidate.usagePolicyId,new URL(url).hostname),lineage:new URL(url).hostname};
}
