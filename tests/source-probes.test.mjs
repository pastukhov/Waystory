import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../scripts/ops-probe.mjs',import.meta.url),'utf8');
import {runSourcesProbe} from '../server/sources/probe.mjs';
import {licenseFor} from '../server/sources/policies.mjs';
const payload={places:[{id:'osm:node:1',names:{original:'Tower'},refs:[],coordinates:{lat:1,lon:1}}],statuses:[{provider:'osm',status:'ok'}]};
const material={text:'Tower built in 1226.',license:licenseFor('wikimedia-cc-by-sa','Contributors')};
async function run(repeated,documents=[material]){let calls=0;const output=[],process={exitCode:0};const passed=await runSourcesProbe({fetchFn:async()=>++calls%2?Response.json(payload):repeated(),collect:async()=>({documents,statuses:[{provider:'wikipedia',status:documents.length?'ok':'empty'}]}),report:x=>output.push(x)});process.exitCode=passed?0:1;return {output,process}}
test('failed repeated source requests cannot pass the deployment probe',async()=>{const r=await run(()=>Response.json({error:'down'},{status:503}));assert.equal(r.process.exitCode,1);assert.equal(r.output.some(x=>x.cachedMs!==undefined),false)});
test('changed repeat results are not presented as cached measurements',async()=>{const r=await run(()=>Response.json({...payload,places:[]}));assert.equal(r.process.exitCode,1);assert.equal(r.output.some(x=>x.cachedMs!==undefined),false)});
test('matching successful responses report repeat timing',async()=>{const r=await run(()=>Response.json(payload));assert.equal(r.process.exitCode,0);assert.equal(r.output.length,3);assert.ok(r.output.every(x=>x.cachedMs>=0))});
test('explicit paid verification succeeds only with enrichment documents',()=>{const functionText=source.match(/function webVerified\(result\)\{[^\n]+\}/)?.[0];assert.ok(functionText,'central paid verification predicate');const verified=runInNewContext(functionText+';webVerified');for(const status of ['disabled','empty','budget-exhausted','unavailable'])assert.equal(verified({status,documents:[]}),false);assert.equal(verified({status:'ok',documents:[{id:'s'}]}),true)});

test('metadata-only discovery fails rich-scenario evidence coverage',async()=>{const r=await run(()=>Response.json(payload),[]);assert.equal(r.process.exitCode,1);assert.ok(r.output.every(x=>x.testedPlaces>=0));assert.ok(r.output.every(x=>x.materials===0))});

test('populated rich samples pass while sparse coverage can honestly be empty',async()=>{
 const output=[];const passed=await runSourcesProbe({fetchFn:async url=>Response.json({...payload,places:url.includes('36.566')?[]:payload.places}),collect:async()=>({documents:[material],statuses:[{provider:'wikipedia',status:'ok'}]}),report:x=>output.push(x)});
 assert.equal(passed,true);assert.equal(output[0].testedPlaces,1);assert.equal(output[0].materials,1);assert.equal(output[0].evidence[0].statuses[0].status,'ok');assert.equal(output[1].materials,0);assert.equal(output[1].evidenceRequired,false);
});
test('unknown rights and whitespace are not model-eligible material',async()=>{const r=await run(()=>Response.json(payload),[{...material,text:'  '},{...material,license:licenseFor('unknown','Unknown')}]);assert.equal(r.process.exitCode,1);assert.ok(r.output.every(x=>x.materials===0))});
