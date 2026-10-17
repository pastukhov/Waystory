import {requestId} from './request-context.mjs';
import {safeTelemetryEntry} from './observability.mjs';
import {randomUUID} from 'node:crypto';
// Reconstruct an allowlisted schema. Never log provider bodies, input or credentials.
export function providerFailure(service,status,durationMs,write=console.error){
 const entry={event:'waystory_provider_error',service:['ai','speech'].includes(service)?service:'unknown',status:Number.isInteger(status)&&status>=100&&status<=599?status:null,durationMs:Math.max(0,Math.round(durationMs)),requestId:requestId()||randomUUID()};
 write(JSON.stringify(entry));return entry.requestId;
}
export function safeLogLine(line){
 try{const p=JSON.parse(line);
 const telemetry=safeTelemetryEntry(p);if(telemetry)return telemetry;
 if(p.event==='waystory_sources'){
  if(!/^[a-f0-9-]{36}$/.test(p.requestId)||! /^(osm:(node|way|relation):[1-9]\d*|wd:Q[1-9]\d*|wiki:[a-z-]+:[1-9]\d*)$/.test(p.placeId)||!['ready','limited','context_only','no_material','temporarily_unavailable','not_configured','budget_exhausted','policy_restricted'].includes(p.outcome)||!Number.isFinite(p.durationMs)||p.durationMs<0)return null;
  const statuses=(Array.isArray(p.statuses)?p.statuses:[]).slice(0,12).map(s=>({provider:['osm','wikipedia','wikidata','wikivoyage','official-web','global-web','collection'].includes(s.provider)?s.provider:'unknown',...( ['tavily','brave'].includes(s.engine)?{engine:s.engine}:{}),status:['ok','empty','partial','unavailable','disabled','budget-exhausted'].includes(s.status)?s.status:'unavailable',reason:['no_match','timeout','rate_limited','upstream_error','not_configured','budget_exhausted','policy_restricted','access_denied'].includes(s.reason)?s.reason:null,...(Number.isInteger(s.httpStatus)&&s.httpStatus>=100&&s.httpStatus<=599?{httpStatus:s.httpStatus}:{}),...(Number.isFinite(s.durationMs)?{durationMs:Math.max(0,s.durationMs)}:{}),...(Number.isSafeInteger(s.documentCount)?{documentCount:Math.max(0,s.documentCount)}:{})}));
  return {event:p.event,requestId:p.requestId,placeId:p.placeId,outcome:p.outcome,durationMs:p.durationMs,statuses};
 }
 if(p.event!=='waystory_provider_error'||!['ai','speech','unknown'].includes(p.service)||!(/^[a-f0-9-]{36}$/.test(p.requestId))||!(p.status===null||Number.isInteger(p.status)&&p.status>=100&&p.status<=599)||!Number.isFinite(p.durationMs)||p.durationMs<0)return null;
 return {event:p.event,service:p.service,status:p.status,durationMs:p.durationMs,requestId:p.requestId};
 }catch{return null}
}

