import {stripSourceCitations} from '../dist/speech-text.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
import {durationLabel,availableDepths,clampDepth,canListen,t} from '../dist/i18n.mjs';
const source=readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8');
for(const language of ['ru','en']){
 test(`${language}: zero words have no duration`,()=>{assert.equal(canListen({lang:language,blocks:[{depth:0,text:'  '}]},language),false);assert.equal(durationLabel([],0,language),'');assert.equal(durationLabel([{depth:0,text:'  '}],0,language),'')});
 test(`${language}: empty card hides story-only UI and restores it after material arrives`,()=>{
  const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{hidden:false,disabled:false,textContent:'',dataset:{},style:{},classList:{toggle(){}},replaceChildren(...children){this.children=children},append(...children){this.children=children},setAttribute(){}});return nodes.get(key)};
  const state={selected:{title:'Tower',originalTitle:'Tower',blocks:[],placeId:'osm:node:1',sources:[{id:'osm:node:1'}]},depth:0,heard:[]};
  const context={stripSourceCitations,state,$:node,document:{querySelector:node,querySelectorAll:()=>[],createElement:()=>node(Symbol())},LANGUAGE:language,t:key=>t(key,language),metadata:x=>x,canListen:p=>canListen(p,language),availableDepths,clampDepth,durationLabel:(b,d)=>durationLabel(b,d,language),localNameLabel:()=>'',originalPlaceName:p=>p.title,placeMapAnchor:()=>({href:'map'}),showArt(){},updateSaveButton(){},renderSources(){},ui:()=>'',sourceLanguage:()=>language,safeSourceUrl:()=>null,citationLinks:()=>[],updateProgress(){}};
  state.ai=true;runInNewContext(source.slice(source.indexOf('function renderStory(){'),source.indexOf('async function selectPlace('))+';renderStory()',context);
  for(const id of ['story-detail-notice','story-language-notice','story-source-note','question-panel'])assert.equal(node(id).hidden,true,id);
  for(const selector of ['.depth-label','.depth-switch'])assert.equal(node(selector).hidden,true,selector);
  assert.equal(node('duration-label').textContent,'');assert.equal(node('story-play').disabled,true);assert.equal(node('story-save').disabled,false);assert.equal(node('story-refresh').hidden,false);assert.equal(node('story-map').children.length,1);
  state.selected={...state.selected,lang:language,detailLimited:true,blocks:[{id:'a',title:'Title. Источник: wikipedia:bg:746989',depth:0,text:'A real story with text.'}]};runInNewContext('renderStory()',context);
  assert.equal(node('story-text').children[0].children[0].textContent,'Title.');
  for(const selector of ['.depth-label','.depth-switch'])assert.equal(node(selector).hidden,false,selector);
  assert.equal(node('story-detail-notice').hidden,false);assert.equal(node('story-source-note').hidden,false);assert.equal(node('question-panel').hidden,false);assert.equal(node('story-play').disabled,false);assert.match(node('duration-label').textContent,/≈/);
  state.selected.evidenceScope='area';runInNewContext('renderStory()',context);assert.equal(node('story-kind').textContent,t('Региональный контекст',language));
 });
}
