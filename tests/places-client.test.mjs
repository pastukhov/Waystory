import test from 'node:test';import assert from 'node:assert/strict';import {toLegacyPlace,resolvePlace,discoverNearby,localNameLabel} from '../dist/places-client.mjs';
const record={id:'osm:node:7',refs:[{provider:'osm',kind:'node',id:7}],names:{original:'Hacımehmetli Camii',ru:'Мечеть Хаджи Мехметли',native:{text:'Hacımehmetli Camii',sourceId:'osm:node:7'}},category:'mosque',coordinates:{lat:36,lon:32,kind:'centroid',sourceId:'s'}};
test('OSM-only cards keep native name and centroid, conflict disables coordinates',()=>{const p=toLegacyPlace(record,[],'ru');assert.equal(p.placeId,record.id);assert.equal(p.nativeName,'Hacımehmetli Camii');assert.equal(p.source,undefined);assert.equal(p.coordinateKind,'centroid');assert.equal(toLegacyPlace({...record,coordinateConflict:[record.coordinates]},[],'ru').coords,null)});
test('resolving legacy entries preserves their library identifier and does not mutate on error',async()=>{const old={id:'wiki-en-1',pageid:1,lang:'en',title:'Tower'};const r=await resolvePlace(old,null,'ru',async()=>Response.json({place:record,sources:[]}));assert.equal(r.id,old.id);assert.equal(r.placeId,record.id);await assert.rejects(resolvePlace(old,null,'ru',async()=>Response.json({error:'down'},{status:503})));assert.equal(old.id,'wiki-en-1')});
test('nearby expands sparse radii and reports partial results',async()=>{const radii=[];const r=await discoverNearby(36,32,null,'ru',async url=>{const radius=Number(new URL(url,'https://ws.test').searchParams.get('radius'));radii.push(radius);return Response.json({places:radius===5000?[record]:[],sources:[],statuses:[{provider:'wikivoyage',status:'unavailable'}]})});assert.deepEqual(radii,[1500,5000,10000]);assert.equal(r.partial,true)});
test('nearby computes distances and sorts by proximity while retaining category',async()=>{const distant={...record,id:'osm:node:8',coordinates:{...record.coordinates,lat:36.02}};const r=await discoverNearby(36,32,null,'ru',async()=>Response.json({places:[distant,record],sources:[],statuses:[]}));assert.equal(r.places[0].placeId,'osm:node:7');assert.equal(r.places[0].distance,0);assert.ok(r.places[1].distance>1000);assert.equal(r.places[0].category,'Мечеть')});

test('only a documented native name is labelled local',()=>{assert.equal(localNameLabel({originalTitle:'English title'},'ru'),'Название в источнике: ');assert.equal(localNameLabel({nativeName:'Kızıl Kule'},'en'),'Local name: ')});


test('one nearby memorial does not hide the church just outside 1.5 km',async()=>{
 const radii=[];const memorial={...record,id:'osm:node:1',names:{original:'Alaaddin Keykubat'},coordinates:{...record.coordinates,lat:36.5541,lon:31.9743}};
 const church={...record,id:'osm:way:475444343',names:{original:'Hıdırellez Kilisesi'},coordinates:{...record.coordinates,lat:36.57067,lon:31.97550}};
 const result=await discoverNearby(36.5541,31.9743,null,'ru',async url=>{const radius=Number(new URL(url,'https://test').searchParams.get('radius'));radii.push(radius);return Response.json({places:radius===1500?[memorial]:[church],sources:[],statuses:[]})});
 assert.deepEqual(radii,[1500,5000,10000]);assert.equal(result.places.length,2);assert.equal(result.places[1].title,'Hıdırellez Kilisesi');assert.ok(result.places[1].distance>1500&&result.places[1].distance<2000);
});
test('a failed wider search preserves the nearby results and their actual radius',async()=>{
 let calls=0;const result=await discoverNearby(36,32,null,'ru',async()=>++calls===1?Response.json({places:[record],sources:[],statuses:[]}):Response.json({error:'unavailable'},{status:503}));assert.equal(result.places.length,1);assert.equal(result.radius,1500);assert.equal(result.partial,true);
});
test('dense results stop at the smallest radius and partial provider status is visible',async()=>{
 let calls=0;const result=await discoverNearby(36,32,null,'ru',async()=>{calls++;return Response.json({places:Array.from({length:5},(_,i)=>({...record,id:'osm:node:'+i})),sources:[],statuses:[{provider:'wikipedia',status:'partial'}]})});assert.equal(calls,1);assert.equal(result.radius,1500);assert.equal(result.partial,true);
});
