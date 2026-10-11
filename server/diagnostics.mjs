import {randomUUID} from 'node:crypto';
// Reconstruct an allowlisted schema. Never log provider bodies, input or credentials.
export function providerFailure(service,status,durationMs,write=console.error){
 const entry={event:'waystory_provider_error',service:['ai','speech'].includes(service)?service:'unknown',status:Number.isInteger(status)&&status>=100&&status<=599?status:null,durationMs:Math.max(0,Math.round(durationMs)),requestId:randomUUID()};
 write(JSON.stringify(entry));return entry.requestId;
}
export function safeLogLine(line){
 try{const p=JSON.parse(line);if(p.event!=='waystory_provider_error'||!['ai','speech','unknown'].includes(p.service)||!(/^[a-f0-9-]{36}$/.test(p.requestId))||!(p.status===null||Number.isInteger(p.status)&&p.status>=100&&p.status<=599)||!Number.isFinite(p.durationMs)||p.durationMs<0)return null;
 return {event:p.event,service:p.service,status:p.status,durationMs:p.durationMs,requestId:p.requestId};
 }catch{return null}
}
