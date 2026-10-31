import test from 'node:test';
import assert from 'node:assert/strict';
import {runTourFixtures} from '../scripts/tour-fixtures.mjs';
import {runTourProbe} from '../server/tours/probe.mjs';
test('tour fixtures run station, poor and foreign source cases without network or paid models',async()=>{
 const reports=[];assert.equal(await runTourFixtures({report:r=>reports.push(r)}),true);assert.deepEqual(reports.filter(r=>r.probe==='tour-fixture').map(r=>r.name),['station','poor','foreign','wrong_object']);assert.doesNotMatch(JSON.stringify(reports),/PRIVATE_SOURCE|PRIVATE_CHAPTER/);
});
test('probe rejects a ready plan with fewer than three themes, without TTS or quota retries',async()=>{
 const events=[];let speech=0;
 assert.equal(await runTourProbe({service:{start:async()=>({tourId:'tour'}),get:()=>({status:'ready',topics:[]})},jobs:{drain:async()=>{}},ownerId:'owner',placeId:'wiki:ru:173387',speech:async()=>speech++,report:r=>events.push(r)}),false);assert.equal(speech,0);assert.equal(events.at(-1).reason,'insufficient_topics');
});
