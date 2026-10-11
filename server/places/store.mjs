import {DatabaseSync} from 'node:sqlite';import {mkdirSync,chmodSync} from 'node:fs';import {dirname} from 'node:path';
import {normalizePlace,mergePlaces,refKey} from './model.mjs';
export function createPlaceStore({dbPath=process.env.SOURCE_DB_PATH||'data/sources.sqlite',now=Date.now}={}){
 if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});const db=new DatabaseSync(dbPath);if(dbPath!==':memory:')chmodSync(dbPath,0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS place_refs(ref TEXT PRIMARY KEY,place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS place_aliases(alias TEXT PRIMARY KEY,place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE);`);
 const getById=id=>{const row=db.prepare('SELECT data FROM places WHERE id=? OR id=(SELECT place_id FROM place_aliases WHERE alias=?)').get(id,id);return row?JSON.parse(row.data):null};
 const getByRef=ref=>{const row=db.prepare('SELECT place_id FROM place_refs WHERE ref=?').get(refKey(ref));return row?getById(row.place_id):null};
 return {db,getById,getByRef,close:()=>db.close(),upsert(raw){
  const p=normalizePlace(raw);db.exec('BEGIN IMMEDIATE');try{
   const existing=[...new Map(p.refs.map(r=>getByRef(r)).filter(Boolean).map(x=>[x.id,x])).values()];const same=getById(p.id);if(same&&!existing.some(x=>x.id===same.id))existing.unshift(same);
   const merged=mergePlaces([...existing,p])[0];const aliases=new Set([p.id,...existing.map(x=>x.id)]);
   for(const old of existing){for(const a of db.prepare('SELECT alias FROM place_aliases WHERE place_id=?').all(old.id))aliases.add(a.alias);db.prepare('DELETE FROM places WHERE id=?').run(old.id)}
   db.prepare('INSERT INTO places VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(merged.id,JSON.stringify(merged),now());
   for(const r of merged.refs){const key=refKey(r);db.prepare('INSERT OR REPLACE INTO place_refs VALUES(?,?)').run(key,merged.id);aliases.add(key);if(r.provider==='wikipedia')aliases.add('wiki-'+(r.language==='ru'?'':r.language+'-')+r.pageId)}
   for(const alias of aliases)db.prepare('INSERT OR REPLACE INTO place_aliases VALUES(?,?)').run(alias,merged.id);
   db.exec('COMMIT');return merged;
  }catch(e){db.exec('ROLLBACK');throw e}
 },search(query,limit=30){const q=query.toLocaleLowerCase();return db.prepare('SELECT data FROM places ORDER BY updated DESC LIMIT 1000').all().map(r=>JSON.parse(r.data)).filter(p=>Object.values(p.names).some(n=>typeof n==='string'&&n.toLocaleLowerCase().includes(q))).slice(0,limit)}};
}
