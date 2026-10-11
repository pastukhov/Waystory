import {registerSourcePolicy} from './policies.mjs';
import {candidateUrl} from './search-provider.mjs';
// One provider-contract review, not a list of countries or local publishers.
// No default grant: an API subscription alone does not imply these permissions.
export function configureSearchPolicy(policy={}){
 if(policy.reviewed!==true||!candidateUrl(policy.termsUrl)||!/^\d{4}-\d{2}-\d{2}$/.test(policy.reviewedAt||'')||policy.allowModelInput!==true||policy.allowGeneratedAudio!==true||policy.allowGeneratedTextCache!==true)return false;
 registerSourcePolicy('web-search-reviewed',{licenseId:'Source terms',licenseUrl:policy.termsUrl,allowModelInput:true,allowGeneratedAudio:true,allowTextCache:policy.allowTextCache===true,ttlMs:Math.min(21600000,Math.max(0,Number(policy.ttlMs)||0)),attributionRequired:true,outputLicense:null});return true;
}
