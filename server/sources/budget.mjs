export function createProviderBudget({db,maxCalls=0,providerLimits={},now=Date.now}={}){
 const valid=value=>Number.isSafeInteger(value)&&value>=0&&value<=10000;
 if(!valid(maxCalls)||Object.values(providerLimits).some(value=>!valid(value)))throw Error('Invalid web provider budget');
 db.exec('CREATE TABLE IF NOT EXISTS provider_budget(provider TEXT NOT NULL,day TEXT NOT NULL,calls INTEGER NOT NULL,PRIMARY KEY(provider,day))');
 const day=()=>new Date(now()).toISOString().slice(0,10);
 // One SQL statement checks the shared UTC-day cap and reserves a provider call.
 // Existing Tavily rows count immediately; no migration can reset spending.
 const reserve=db.prepare(`INSERT INTO provider_budget(provider,day,calls)
 SELECT ?,?,1 WHERE (SELECT COALESCE(SUM(calls),0) FROM provider_budget WHERE day=?)<?
 AND (SELECT COALESCE((SELECT calls FROM provider_budget WHERE provider=? AND day=?),0))<?
 ON CONFLICT(provider,day) DO UPDATE SET calls=calls+1 RETURNING calls`);
 return {
  reserveProviderCall({provider,day:date=day()}){return !!reserve.get(provider,date,date,maxCalls,provider,date,providerLimits[provider]??maxCalls)},
  remaining(provider){const date=day(),total=db.prepare('SELECT COALESCE(SUM(calls),0) AS calls FROM provider_budget WHERE day=?').get(date).calls,used=db.prepare('SELECT calls FROM provider_budget WHERE provider=? AND day=?').get(provider,date)?.calls||0;return Math.max(0,Math.min(maxCalls-total,(providerLimits[provider]??maxCalls)-used))}
 };
}
