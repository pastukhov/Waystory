import {readFileSync} from 'node:fs';
export function validateRequest(request){
 if(!request||Object.keys(request).sort().join(',')!=='id,operation'||! /^[a-z0-9][a-z0-9-]{5,79}$/.test(request.id)||!['diagnose','sources-test','web-source-test','global-source-test','speech-test','speech-format-test','ai-test','restart','rollback'].includes(request.operation))throw new Error('Invalid operations request');
 return request;
}
if(process.argv[1]?.endsWith('/ops-request.mjs')){const request=validateRequest(JSON.parse(readFileSync(new URL('../ops/request.json',import.meta.url),'utf8')));console.log(request.operation+' '+request.id)}

