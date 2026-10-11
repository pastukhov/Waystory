export function createProviderBudget({db,maxCalls=0,now=Date.now}={}){
 if(!Number.isSafeInteger(maxCalls)||maxCalls<0||maxCalls>10000)throw Error('Invalid web provider budget');
 db.exec('CREATE TABLE IF NOT EXISTS provider_budget(provider TEXT NOT NULL,day TEXT NOT NULL,calls INTEGER NOT NULL,PRIMARY KEY(provider,day))');
 const day=()=>new Date(now()).toISOString().slice(0,10);
 return {reserveProviderCall({provider,day:date=day()}){if(maxCalls===0)return false;const row=db.prepare('INSERT INTO provider_budget VALUES(?,?,1) ON CONFLICT(provider,day) DO UPDATE SET calls=calls+1 WHERE calls<? RETURNING calls').get(provider,date,maxCalls);return !!row},remaining(provider){return Math.max(0,maxCalls-(db.prepare('SELECT calls FROM provider_budget WHERE provider=? AND day=?').get(provider,day())?.calls||0))}};
}
