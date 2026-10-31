import test from 'node:test';
import assert from 'node:assert/strict';
import * as spansModule from '../server/sources/spans.mjs';
const doc=(text,extra={})=>({id:'wiki:en:1',revision:'17',text,scope:'place',language:'en',license:{policyId:'wikimedia-cc-by-sa'},...extra});

test('spans preserve original paragraphs, UTF-16 offsets, language and scope',()=>{
 const text='  🏛 Museum opened in 1900.\r\n\r\n Le musée a été restauré.  ';
 const spans=spansModule.buildEvidenceSpans([doc(text,{language:'fr',scope:'area'})]);
 assert.equal(spans.length,2);
 assert.deepEqual(spans.map(s=>[s.start,s.end,s.text]),[[2,27,'🏛 Museum opened in 1900.'],[32,56,'Le musée a été restauré.']]);
 for(const s of spans){assert.equal(s.text,text.slice(s.start,s.end));assert.equal(s.language,'fr');assert.equal(s.scope,'area');assert.equal(s.sourceId,'wiki:en:1');assert.equal(s.revision,'17');}
});
test('span IDs are stable for one snapshot and change for text or revision updates',()=>{
 const a=spansModule.buildEvidenceSpans([doc('First paragraph.\n\nSecond paragraph.')]);
 assert.deepEqual(spansModule.buildEvidenceSpans([doc('First paragraph.\n\nSecond paragraph.')]),a);
 for(const changed of [doc('First paragraph.\n\nChanged paragraph.'),doc('First paragraph.\n\nSecond paragraph.',{revision:'18'}),doc('First paragraph.\n\nSecond paragraph.',{id:'wiki:en:2'})])assert.notEqual(spansModule.buildEvidenceSpans([changed])[0].id,a[0].id);
 assert.match(a[0].id,/^[a-f0-9]{64}$/);
 const repeated=spansModule.buildEvidenceSpans([doc('Repeated.\n\nRepeated.')]);assert.notEqual(repeated[0].id,repeated[1].id);
});
test('disallowed and unknown policies never become model evidence',()=>{
 assert.deepEqual(spansModule.buildEvidenceSpans([doc('Restricted',{license:{policyId:'osm-odbl'}}),doc('Unknown',{license:{policyId:'unknown'}})]),[]);
});
test('long paragraphs are bounded overlapping source slices without losing coverage',()=>{
 const text=Array.from({length:700},(_,i)=>`word${i}`).join(' '),spans=spansModule.buildEvidenceSpans([doc(text)]);
 assert.ok(spans.length>2);assert.equal(spans[0].start,0);assert.equal(spans.at(-1).end,text.length);
 for(const [i,s] of spans.entries()){assert.ok(s.text.length<=1200);assert.equal(s.text,text.slice(s.start,s.end));if(i){const prev=spans[i-1];assert.ok(s.start>prev.start);assert.ok(s.start<=prev.end);assert.ok(prev.end-s.start<=150);assert.equal(text[s.start-1],' ');}}
});
test('one long token and whitespace-only paragraphs terminate with bounded spans',()=>{
 const text='a'.repeat(4000),spans=spansModule.buildEvidenceSpans([doc('   \n\n'+text)]);
 assert.ok(spans.length>=4);assert.equal(spans.at(-1).end,text.length+5);for(const s of spans)assert.ok(s.text.length<=1200);
 assert.deepEqual(spansModule.buildEvidenceSpans([doc(' \n\r\n\t ')]),[]);
});
test('source and revision field boundaries cannot collide in span identity',()=>{
 const [a,b]=spansModule.buildEvidenceSpans([doc('Same snapshot.',{id:'wikipedia:en:1',revision:'23'}),doc('Same snapshot.',{id:'wikipedia:en:12',revision:'3'})]);
 assert.notEqual(a.id,b.id);
});
