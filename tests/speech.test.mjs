import test from 'node:test';
import assert from 'node:assert/strict';
import { Narrator } from '../dist/speech.mjs';
function fake(){const spoken=[];const synth={speak:u=>spoken.push(u),cancel:()=>{},pause:()=>{},resume:()=>{},getVoices:()=>[]};return {spoken,synth};}
class Utterance{constructor(text){this.text=text;}}
test('cancelled speech cannot mark blocks heard or start another block',()=>{const f=fake(),heard=[];const n=new Narrator({synth:f.synth,Utterance,onComplete:b=>heard.push(b.id)});n.play([{id:'a',text:'A'},{id:'b',text:'B'}]);const old=f.spoken[0];n.stop();old.onend();assert.deepEqual(heard,[]);assert.equal(f.spoken.length,1)});
test('completion advances only after real end event',()=>{const f=fake(),heard=[];const n=new Narrator({synth:f.synth,Utterance,onComplete:b=>heard.push(b.id)});n.play([{id:'a',text:'A'},{id:'b',text:'B'}]);assert.deepEqual(heard,[]);f.spoken[0].onend();assert.deepEqual(heard,['a']);assert.equal(f.spoken.length,2)});
test('new play replaces old and ignores its callbacks',()=>{const f=fake(),heard=[];const n=new Narrator({synth:f.synth,Utterance,onComplete:b=>heard.push(b.id)});n.play([{id:'a',text:'A'}]);n.play([{id:'b',text:'B'}]);f.spoken[0].onend();f.spoken[1].onend();assert.deepEqual(heard,['b'])});
test('unsupported speech reports readable fallback',()=>{let error='';const n=new Narrator({synth:null,Utterance:null,onError:e=>error=e});n.play([{id:'a',text:'A'}]);assert.match(error,/текст/)});
