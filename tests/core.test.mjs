import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, restoreLibrary, saveEntry, validateImage, safeSourceUrl, createEpoch } from '../dist/core.mjs';

const place={blocks:[{id:'intro',depth:0,text:'Введение'},{id:'history',depth:1,text:'История'},{id:'detail',depth:2,text:'Деталь'}]};
test('short starts with just the introduction',()=>assert.deepEqual(buildQueue(place,0,[]).map(b=>b.id),['intro']));
test('more detail does not repeat completed blocks',()=>assert.deepEqual(buildQueue(place,2,['intro']).map(b=>b.id),['history','detail']));
test('shortening discards remaining detail',()=>assert.deepEqual(buildQueue(place,0,['intro']),[]));
test('unfinished block remains available after interruption',()=>assert.equal(buildQueue(place,1,[])[0].id,'intro'));
test('corrupt or wrong-shape storage is recoverable',()=>{assert.deepEqual(restoreLibrary('{'),[]);assert.deepEqual(restoreLibrary('{}'),[]);assert.deepEqual(restoreLibrary('[null,4,{}]'),[])});
test('history replaces duplicate and is capped at 30',()=>{const old=Array.from({length:30},(_,i)=>({id:String(i),title:'Place '+i})); const next=saveEntry(old,{id:'5',title:'Updated'});assert.equal(next.length,30);assert.equal(next[0].title,'Updated');assert.equal(next.filter(p=>p.id==='5').length,1);assert.equal(saveEntry(next,{id:'new',title:'New'}).length,30)});
test('sources cannot point to executable or lookalike URLs',()=>{assert.equal(safeSourceUrl('javascript:alert(1)'),null);assert.equal(safeSourceUrl('https://ru.wikipedia.org.evil.test/a'),null);assert.equal(safeSourceUrl('https://ru.wikipedia.org/wiki/Test'),'https://ru.wikipedia.org/wiki/Test')});
test('photo validation enforces type and 5MB bound',()=>{assert.equal(validateImage({type:'image/jpeg',size:100}),null);assert.ok(validateImage({type:'image/svg+xml',size:100}));assert.ok(validateImage({type:'image/png',size:6*1024*1024}))});
test('a newer request invalidates the old one',()=>{const epoch=createEpoch();const first=epoch.next();assert.equal(epoch.isCurrent(first),true);epoch.next();assert.equal(epoch.isCurrent(first),false)});
test('corrupted saved blocks are discarded before rendering',()=>{assert.deepEqual(restoreLibrary(JSON.stringify([{id:'a',title:'Bad',blocks:'oops'},{id:'b',title:'Bad',blocks:[{id:'x',text:4,depth:0}]}])),[])});
