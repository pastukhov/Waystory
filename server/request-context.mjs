import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const requestId=()=>context.getStore()?.requestId;
export const withRequestContext=(value,work)=>context.run(value,work);
// Instrumentation must never change the outcome of a business request.
export function observe(event,fields={}){try{context.getStore()?.observer.record(event,fields)}catch{}}
