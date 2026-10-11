import test from 'node:test';import assert from 'node:assert/strict';
import {createPlaceStore} from '../server/places/store.mjs';
const p={id:'wiki:en:1',refs:[{provider:'wikipedia',language:'en',pageId:1},{provider:'wikidata',id:'Q1'}],names:{original:'Tower'},coordinates:null,category:'historic',sourceIds:['s']};
test('catalog preserves first id and legacy aliases across enrichment',()=>{const s=createPlaceStore({dbPath:':memory:'});try{s.upsert(p);const r=s.upsert({...p,id:'osm:node:5',refs:[{provider:'osm',kind:'node',id:5},{provider:'wikidata',id:'Q1'}]});assert.equal(r.id,p.id);assert.equal(s.getById('wiki-en-1').id,p.id);assert.equal(s.getByRef({provider:'osm',kind:'node',id:5}).id,p.id);assert.equal(s.getById('osm:node:5').id,p.id)}finally{s.close()}});
