import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {GuideError} from './guide.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const DAY=86400000;
function cookieValue(header,name){const value=String(header||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);return /^[A-Za-z0-9_-]{43}$/.test(value||'')?value:null}
function limit(env,key,fallback){const n=Number(env[key]??fallback);if(!Number.isSafeInteger(n)||n<1||n>100000)throw new Error('Invalid '+key);return n}
export function createAuth({env=process.env,dbPath,fetchFn=fetch,now=Date.now}={}){
 const unavailable=()=>{throw new GuideError(503,'Вход через Google пока не настроен.')};
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return {enabled:false,session:()=>null,start:unavailable,callback:unavailable,logout:()=>'',close:()=>{},origin:null};
 const origin=new URL(env.APP_ORIGIN||'');
 if(origin.origin!==env.APP_ORIGIN||origin.username||origin.password||(origin.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))))throw new Error('APP_ORIGIN must be a canonical HTTPS origin');
 const secure=origin.protocol==='https:',sessionName=secure?'__Host-waystory-session':'waystory-session',flowName=secure?'__Host-waystory-oauth':'waystory-oauth';
 const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; ${secure?'Secure; ':''}SameSite=Lax; Max-Age=${seconds}`;
 const allowed=new Set((env.GOOGLE_ALLOWED_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
 const permits=email=>allowed.has(email.toLowerCase());
 const limits={ai:{user:limit(env,'AI_USER_REQUESTS_PER_DAY',30),global:limit(env,'AI_REQUESTS_PER_DAY',300)},tts:{user:limit(env,'TTS_USER_REQUESTS_PER_DAY',100),global:limit(env,'TTS_REQUESTS_PER_DAY',1000)}};
 const file=dbPath||env.AUTH_DB_PATH||'data/waystory.sqlite';
 if(file!==':memory:')mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const db=new DatabaseSync(file);if(file!==':memory:')chmodSync(file,0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS oauth (hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, subject TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,subject,kind));`);
 const redirectUri=origin.origin+'/auth/google/callback';let activeCallbacks=0;
 const failure=()=>new GuideError(401,'Не удалось войти через Google. Повторите вход или проверьте приглашение.');
 function session(header){const raw=cookieValue(header,sessionName);if(!raw)return null;const row=db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>?').get(hash(raw),now());return row&&permits(row.email)?row:null}
 function count(day,subject,kind){return db.prepare('SELECT count FROM usage WHERE day=? AND subject=? AND kind=?').get(day,subject,kind)?.count||0}
 function usage(user){const day=new Date(now()).toISOString().slice(0,10);return Object.fromEntries(Object.entries(limits).map(([kind,l])=>[kind,{used:count(day,user.id,kind),limit:l.user,remaining:Math.max(0,l.user-count(day,user.id,kind))}]))}
 return {enabled:true,origin:origin.origin,session,usage,close:()=>db.close(),
  start(){
   db.prepare('DELETE FROM oauth WHERE expires<=?').run(now());db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
   db.prepare('DELETE FROM usage WHERE day<?').run(new Date(now()-90*DAY).toISOString().slice(0,10));
   if(db.prepare('SELECT COUNT(*) AS n FROM oauth').get().n>=1000)throw new GuideError(429,'Слишком много попыток входа. Попробуйте позже.');
   const state=token(),verifier=token();db.prepare('INSERT INTO oauth VALUES (?,?,?)').run(hash(state),verifier,now()+10*60000);
   const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'});
   return {location:'https://accounts.google.com/o/oauth2/v2/auth?'+params,cookie:cookie(flowName,state,600)};
  },
  async callback(url,header){
   const state=url.searchParams.get('state'),bound=cookieValue(header,flowName),code=url.searchParams.get('code');
   if(!state||!bound||state!==bound||!code||code.length>4096||url.searchParams.has('error'))throw failure();
   if(activeCallbacks>=4)throw new GuideError(429,'Слишком много попыток входа. Попробуйте позже.');
   const flow=db.prepare('DELETE FROM oauth WHERE hash=? AND expires>? RETURNING verifier').get(hash(state),now());if(!flow)throw failure();
   activeCallbacks++;
   try{
    const response=await fetchFn('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri,code,code_verifier:flow.verifier,grant_type:'authorization_code'}).toString()});
    if(!response.ok)throw failure();const tokens=await response.json();if(typeof tokens.access_token!=='string'||tokens.access_token.length>10000)throw failure();
    const info=await fetchFn('https://openidconnect.googleapis.com/v1/userinfo',{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+tokens.access_token}});
    if(!info.ok)throw failure();const user=await info.json();
    if(typeof user.sub!=='string'||! /^[A-Za-z0-9_-]{1,255}$/.test(user.sub)||user.email_verified!==true||typeof user.email!=='string'||user.email.length>320||!permits(user.email))throw failure();
    const name=typeof user.name==='string'?user.name.slice(0,150):'';
    db.prepare('INSERT INTO users VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name').run(user.sub,user.email,name);
    const sid=token();db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(sid),user.sub,now()+7*DAY);
    return {cookie:cookie(sessionName,sid,7*86400),clearFlow:cookie(flowName,'',0)};
   }catch{throw failure()}finally{activeCallbacks--}
  },
  logout(header){const raw=cookieValue(header,sessionName);if(raw)db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(raw));return cookie(sessionName,'',0)},
  consume(user,kind){
   const day=new Date(now()).toISOString().slice(0,10),l=limits[kind];
   db.exec('BEGIN IMMEDIATE');
   try{
    if(count(day,user.id,kind)>=l.user||count(day,'*',kind)>=l.global)throw new GuideError(429,'Дневной лимит исчерпан. Попробуйте завтра.');
    const stmt=db.prepare('INSERT INTO usage VALUES (?,?,?,1) ON CONFLICT(day,subject,kind) DO UPDATE SET count=count+1');
    stmt.run(day,user.id,kind);stmt.run(day,'*',kind);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e}
  }
 };
}
