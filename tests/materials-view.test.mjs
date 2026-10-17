import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMaterials} from '../dist/materials-view.mjs';
function element(tag='section'){
 return {tag,children:[],textContent:'',attributes:{},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},setAttribute(key,value){this.attributes[key]=value},ownerDocument:{createElement:element}};
}
const all=node=>[node,...node.children.flatMap(all)];
const text=node=>all(node).map(n=>n.textContent).join(' ');
for(const language of ['ru','en'])test(`${language}: official links survive unavailable web search and have neutral exhibition labels`,()=>{
 const node=element();renderMaterials(node,{officialLinks:[{url:'https://museum.example/exhibition',title:'<img src=x onerror=alert(1)>',kind:'exhibition'},{url:'javascript:alert(1)',title:'Unsafe'},{url:'http://museum.example/guide',title:'HTTP'},{url:'https://user:pass@museum.example/guide',title:'Credentials'},{url:'https://museum.example/exhibition',title:'Duplicate'}],searchLinks:[{url:'https://other.example/guide',title:'Independent guide'}],discoveryStatus:{web:'unavailable',official:'ok'}},language);
 const links=all(node).filter(n=>n.tag==='a');assert.equal(links.length,2);assert.equal(links[0].textContent,'<img src=x onerror=alert(1)>');assert.equal(links[0].rel,'noopener noreferrer');assert.equal(links[0].target,'_blank');assert.equal(node.hidden,false);
 assert.match(text(node),language==='ru'?/Дополнительный веб-поиск недоступен/:/Additional web search is unavailable/);
 assert.match(text(node),language==='ru'?/Найдено в интернете/:/Found on the web/);
 assert.doesNotMatch(text(node),/current|ongoing|текущ|актуальн/i);
 assert.match(text(node),language==='ru'?/Выставки/:/Exhibitions/);
 if(language==='en')assert.doesNotMatch(text(node),/[А-Яа-я]/);
});
test('loading, empty and failed official discovery are explicit and independent',()=>{
 const node=element();renderMaterials(node,{materialsLoading:true},'en');assert.match(text(node),/Looking for guides/);assert.doesNotMatch(text(node),/No official guides/);
 renderMaterials(node,{discoveryStatus:{web:'not_needed',official:'empty'}},'en');assert.match(text(node),/No official guides/);assert.doesNotMatch(text(node),/unavailable/);
 renderMaterials(node,{officialLinks:[{url:'https://museum.example',title:'Museum',kind:'website'}],discoveryStatus:{web:'ok',official:'unavailable'}},'en');assert.match(text(node),/Could not check official/);assert.equal(all(node).filter(n=>n.tag==='a').length,1);
 for(const web of ['not_configured','budget_exhausted']){renderMaterials(node,{discoveryStatus:{web,official:'empty'}},'en');assert.match(text(node),/Additional web search is unavailable/)}
});
test('phone lists prioritize guides and audio, cap official links at eight and web results at five',()=>{
 const node=element(),websites=Array.from({length:100},(_,i)=>({url:`https://museum.example/${i}`,title:`Website ${i}`,kind:'website'}));
 renderMaterials(node,{officialLinks:[...websites,{url:'https://museum.example/exhibition',title:'Exhibition',kind:'exhibition'},{url:'https://museum.example/guide',title:'Guide',kind:'guide'},{url:'https://museum.example/audio',title:'Audio',kind:'audio'}],searchLinks:websites},'en');
 const lists=node.children.filter(n=>n.tag==='ul');assert.equal(lists[0].children.length,8);assert.equal(lists[1].children.length,5);
 assert.deepEqual(lists[0].children.slice(0,3).map(n=>n.children[0].textContent),['Guide','Audio','Exhibition']);
});
