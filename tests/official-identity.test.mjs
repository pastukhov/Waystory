import test from 'node:test';import assert from 'node:assert/strict';import {officialWebsiteFromWikitext,addOfficialIdentity} from '../server/sources/official-identity.mjs';
test('recognizes official website templates without treating references as official',()=>{
 assert.equal(officialWebsiteFromWikitext('* {{Официальный сайт|https://centrezotov.ru/|Центр}}'),'https://centrezotov.ru/');
 assert.equal(officialWebsiteFromWikitext('{{Official website|url=https://museum.example/}}'),'https://museum.example/');
 assert.equal(officialWebsiteFromWikitext('[https://unrelated.example/ article]'),null);
 assert.equal(officialWebsiteFromWikitext('{{Official website|https://user:pass@museum.example/}}'),null);
});
test('verified official template enriches only the matching identity document',async()=>{
 const bundle={place:{refs:[{provider:'wikipedia',language:'ru',pageId:1}]},documents:[{id:'wikipedia:ru:1',provider:'wikipedia'},{id:'other'}]};
 const value=await addOfficialIdentity(bundle,{request:async()=>({parse:{wikitext:{'*':'{{Официальный сайт|https://museum.example/}}'}}})});
 assert.equal(value.documents[0].website,'https://museum.example/');assert.equal(value.documents[0].officialWebsite,true);assert.equal(value.documents[1].website,undefined);
});
test('HTTP OSM tag does not suppress a usable HTTPS Wikipedia official template',async()=>{
 const bundle={place:{refs:[{provider:'wikipedia',language:'ru',pageId:1}]},documents:[{id:'osm',provider:'osm',kind:'identity',website:'http://museum.example/'},{id:'wikipedia:ru:1',provider:'wikipedia'}]};
 const value=await addOfficialIdentity(bundle,{request:async()=>({parse:{wikitext:{'*':'{{Официальный сайт|https://museum.example/}}'}}})});assert.equal(value.documents[1].website,'https://museum.example/');
});
