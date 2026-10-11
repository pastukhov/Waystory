import test from 'node:test';import assert from 'node:assert/strict';
import {createPlaceStore} from '../server/places/store.mjs';
const p={id:'wiki:en:1',refs:[{provider:'wikipedia',language:'en',pageId:1},{provider:'wikidata',id:'Q1'}],names:{original:'Tower'},coordinates:null,category:'historic',sourceIds:['s']};
test('catalog preserves first id and legacy aliases across enrichment',()=>{const s=createPlaceStore({dbPath:':memory:'});try{s.upsert(p);const r=s.upsert({...p,id:'osm:node:5',refs:[{provider:'osm',kind:'node',id:5},{provider:'wikidata',id:'Q1'}]});assert.equal(r.id,p.id);assert.equal(s.getById('wiki-en-1').id,p.id);assert.equal(s.getByRef({provider:'osm',kind:'node',id:5}).id,p.id);assert.equal(s.getById('osm:node:5').id,p.id)}finally{s.close()}});
test('catalog search includes native names beyond recent entries',()=>{const store=createPlaceStore({dbPath:':memory:'});try{store.upsert({id:'wd:Q9000',refs:[{provider:'wikidata',id:'Q9000'}],names:{original:'Local district',native:{text:'Hacımehmetli',sourceId:'s'}},coordinates:null,category:'place',sourceIds:['s']});for(let i=1;i<=1001;i++)store.upsert({id:'wd:Q'+i,refs:[{provider:'wikidata',id:'Q'+i}],names:{original:'Place '+i},coordinates:null,category:'place',sourceIds:['s']});assert.equal(store.search('Hacımehmetli')[0].id,'wd:Q9000')}finally{store.close()}});


test('same upstream refresh replaces owned names and coordinates while retaining linked data and aliases',()=>{
 const s=createPlaceStore({dbPath:':memory:'});
 const osm={id:'osm:node:5',refs:[{provider:'osm',kind:'node',id:5}],names:{original:'Old',native:{text:'Eski',sourceId:'osm:node:5'}},coordinates:{lat:36,lon:32,kind:'point',sourceId:'osm:node:5'},category:'historic',sourceIds:['osm:node:5']};
 try{
  s.upsert(osm);s.upsert({...p,names:{original:'English title',en:'English title'},refs:[...p.refs,...osm.refs],sourceIds:['wikipedia:en:1']});
  for(const lat of [36.001,36.01,36.01]){
   const r=s.upsert({...osm,names:{original:'New',native:{text:'Yeni',sourceId:'osm:node:5'}},coordinates:{...osm.coordinates,lat}});
   assert.equal(r.id,osm.id);assert.equal(r.names.original,'New');assert.equal(r.names.native.text,'Yeni');assert.equal(r.names.en,'English title');assert.equal(r.coordinates.lat,lat);assert.equal(r.coordinateConflict,undefined);assert.equal(s.getById('wiki-en-1').id,osm.id);assert.ok(r.refs.some(r=>r.provider==='wikidata'));
  }
 }finally{s.close()}
});
test('refresh heals a persisted same-source conflict but keeps disagreement with a different provider',()=>{
 const s=createPlaceStore({dbPath:':memory:'});const c={lat:36,lon:32,kind:'point',sourceId:'s'};
 try{
  s.upsert({...p,coordinates:c,coordinateConflict:[c,{...c,lat:37}]});
  const healed=s.upsert({...p,names:{original:'New'},coordinates:{...c,lat:38}});assert.equal(healed.coordinates.lat,38);assert.equal(healed.coordinateConflict,undefined);
  const conflicting=s.upsert({...p,id:'wd:Q1',names:{original:'Other'},sourceIds:['wikidata:Q1'],coordinates:{...c,sourceId:'wikidata:Q1',lat:39}});
  assert.equal(conflicting.coordinateConflict.length,2);
  const corrected=s.upsert({...p,coordinates:{...c,lat:39}});assert.equal(corrected.coordinateConflict,undefined);
 }finally{s.close()}
});
