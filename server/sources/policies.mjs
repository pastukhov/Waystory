export const POLICY_VERSION=1;
const cc='https://creativecommons.org/licenses/by-sa/4.0/';
const policies={
 'wikidata-cc0':{licenseId:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',allowModelInput:true,allowTextCache:true,ttlMs:604800000,attributionRequired:false},
 'osm-odbl':{licenseId:'ODbL-1.0',licenseUrl:'https://www.openstreetmap.org/copyright',allowModelInput:false,allowTextCache:true,ttlMs:604800000,attributionRequired:true},
 'wikimedia-cc-by-sa':{licenseId:'CC-BY-SA-4.0',licenseUrl:cc,allowModelInput:true,allowTextCache:true,ttlMs:604800000,attributionRequired:true,outputLicense:'CC-BY-SA-4.0'}
};
export function sourcePolicy(id){return Object.freeze({...policies[id]||{licenseId:'unknown',licenseUrl:null,allowModelInput:false,allowTextCache:false,ttlMs:0,attributionRequired:true}})}
export function licenseFor(policyId,attribution){const p=sourcePolicy(policyId);return {id:p.licenseId,url:p.licenseUrl,policyId,attribution}}

export function registerSourcePolicy(id,policy){if(!id||Object.hasOwn(policies,id))return;policies[id]=Object.freeze({...policy})}
