import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialDiscovery, createOfficialHttp, isPublicAddress, validateOfficialUrl} from '../server/sources/official-discovery.mjs';
const bundle = {documents:[{provider:'osm',kind:'identity',website:'https://centrezotov.ru/',title:'Зотов'}]};
test('discovers official exhibition and external audio through official pages without copying bodies',async()=>{
 const pages={
 'https://centrezotov.ru/':'<a href="/about">About</a><a href="/events/">Все события</a><a href="/events/hleb/">Выставка Хлеб</a>',
 'https://centrezotov.ru/events/hleb/':'<p>Copyright exhibition essay</p><a href="/events/hleb/audiogid-hleb/">Аудиогид Хлеб</a>',
 'https://centrezotov.ru/events/hleb/audiogid-hleb/':'<a href="https://hleb.mave.digital">Слушать аудиогид</a>',
 'https://centrezotov.ru/events/':'<a href="/events/hleb/">Выставка Хлеб</a>'};
 const calls=[];const result=await createOfficialDiscovery({request:async url=>{calls.push(url);return {url,html:pages[url]||''}},now:()=>0})(bundle,{});
 assert.ok(result.links.some(l=>l.url==='https://hleb.mave.digital/'&&l.kind==='audio'&&l.sourceUrl==='https://centrezotov.ru/events/hleb/audiogid-hleb/'));
 assert.ok(result.links.some(l=>l.kind==='exhibition'&&l.url.endsWith('/events/hleb/')));
 assert.equal(result.statuses[0].status,'ok');assert.ok(calls.length<=4);assert.ok(calls.every(u=>u.startsWith('https://centrezotov.ru/')));
 assert.equal(result.documents,undefined);assert.ok(!JSON.stringify(result).includes('Copyright exhibition essay'));
});
test('seeds exclusively trusted identity website fields',async()=>{
 let calls=0;const result=await createOfficialDiscovery({request:async()=>{calls++;return {html:''}}})({documents:[{provider:'tavily',kind:'identity',website:'https://evil.example/'},{provider:'osm',kind:'article',website:'https://evil.example/'},{provider:'wikidata',kind:'identity',url:'https://evil.example/'}]});
 assert.equal(calls,0);assert.equal(result.statuses[0].status,'empty');
});
test('recognizes French Turkish and Vietnamese guides',async()=>{
 for(const title of ['Audioguide français','Sesli rehber','Hướng dẫn âm thanh']){
 const result=await createOfficialDiscovery({request:async url=>({url,html:`<a href="https://audio.example/listen">${title}</a>`})})(bundle);
 assert.ok(result.links.some(l=>l.kind==='audio'&&l.url==='https://audio.example/listen'),title);
 }
});
test('rejects non-public literal addresses and unsafe URLs',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','172.20.0.1','192.168.1.2','192.0.0.1','198.18.0.1','198.51.100.2','203.0.113.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002:0808:0808::1'])assert.equal(isPublicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','93.184.216.34','2606:4700:4700::1111'])assert.equal(isPublicAddress(ip),true,ip);
 for(const url of ['http://example.com','https://user:pass@example.com','https://example.com:8443','https://localhost','https://127.1','https://[::1]'])assert.throws(()=>validateOfficialUrl(url));
});
test('rejects private and mixed DNS answers before opening a socket',async()=>{
 for(const records of [[{address:'127.0.0.1',family:4}],[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]]){
 const request=createOfficialHttp({lookup:async()=>records});
 await assert.rejects(()=>request('https://museum.example/'),/public|prohibited/i);
 }
});
test('failed request remains unavailable and discovery obeys deadline even for hung injected transport',async()=>{
 const result=await createOfficialDiscovery({request:()=>new Promise(()=>{}),timeoutMs:20})(bundle);
 assert.equal(result.statuses[0].status,'unavailable');assert.equal(result.statuses[0].reason,'timeout');
});
test('accepts explicitly verified Wikipedia official-site identity metadata',async()=>{
 for(const officialWebsite of [true,false]){
 const result=await createOfficialDiscovery({request:async()=>({html:''})})({documents:[{provider:'wikipedia',kind:'article',website:'https://centrezotov.ru/',officialWebsite}]});
 assert.equal(result.statuses[0].status,officialWebsite?'ok':'empty');
 }
});

test('refuses redirects to other hosts before connecting to them',async()=>{
 const {EventEmitter}=await import('node:events');
 const {Readable}=await import('node:stream');
 let sockets=0;
 const request=createOfficialHttp({lookup:async()=>[{address:'93.184.216.34',family:4}],requestFn:(_url,_options,callback)=>{
  sockets++;const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=Readable.from([]);res.statusCode=302;res.headers={location:'https://other-public.example/'};callback(res);});return req;
 }});
 await assert.rejects(()=>request('https://museum.example/'),/offsite_redirect/);assert.equal(sockets,1);
});
test('pins the vetted DNS answer in HTTPS lookup and caps streamed bytes',async()=>{
 const {EventEmitter}=await import('node:events');const {Readable}=await import('node:stream');
 let resolved=0,pinned;
 const request=createOfficialHttp({lookup:async()=>{resolved++;return [{address:'93.184.216.34',family:4}]},requestFn:(_url,options,callback)=>{
  options.lookup('museum.example',{all:true},(err,addresses)=>{assert.equal(err,null);pinned=addresses});
  const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=Readable.from([Buffer.from('123456')]);res.statusCode=200;res.headers={'content-type':'text/html'};callback(res);});return req;
 }});
 await assert.rejects(()=>request('https://museum.example/',{maxBytes:4}),/response_too_large/);
 assert.equal(resolved,1);assert.deepEqual(pinned,[{address:'93.184.216.34',family:4}]);
});
test('reports every redirect connection through the request budget callback',async()=>{
 const {EventEmitter}=await import('node:events');const {Readable}=await import('node:stream');let sockets=0;
 const http=createOfficialHttp({lookup:async()=>[{address:'93.184.216.34',family:4}],requestFn:(url,_options,callback)=>{
  sockets++;const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{
   const redirect=url.pathname==='/';const res=Readable.from(redirect?[]:[Buffer.from('<a href="/events/one/">Exhibition</a><a href="/events/two/">Exhibition</a><a href="/events/three/">Exhibition</a>')]);
   res.statusCode=redirect?302:200;res.headers=redirect?{location:'/home/'}:{'content-type':'text/html'};callback(res);
  });return req;
 }});
 // The discovery injection is a page transport; its onRequest hook is tested directly
 // here, using the same shared four-connection budget as production discovery.
 let remaining=4;
 await http('https://museum.example/',{onRequest:()=>{assert.ok(remaining>0);remaining--;}});
 assert.equal(sockets,2);assert.equal(remaining,2);
});
test('redirect loops stop after at most two redirects',async()=>{
 const {EventEmitter}=await import('node:events');const {Readable}=await import('node:stream');let sockets=0;
 const request=createOfficialHttp({lookup:async()=>[{address:'93.184.216.34',family:4}],requestFn:(_url,_options,callback)=>{
  sockets++;const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=Readable.from([]);res.statusCode=302;res.headers={location:'/again/'};callback(res);});return req;
 }});
 await assert.rejects(()=>request('https://museum.example/'),/redirect_limit/);assert.equal(sockets,3);
});
test('ignores script markup, unsafe links and external non-audio links',async()=>{
 const result=await createOfficialDiscovery({request:async()=>({html:'<script>const s=`<a href="https://evil.example/audio">Audio</a>`</script><a href="http://museum.example/audio">Audio</a><a href="https://127.0.0.1/audio">Audio</a><a href="https://foreign.example/guide">Guide</a>'})})(bundle);
 assert.equal(result.links.length,1);
});
test('prioritizes exhibition detail over child activities and excludes cinema event cards',async()=>{
 const pages={
 'https://centrezotov.ru/':`
  <a href="/events/">События</a>
  <a href="/events/concert/">Концерт</a>
  <a href="/events/hleb/" class="home-afisha__content"><div class="home-afisha__tag">Выставка</div><div class="home-afisha__title">Хлеб</div><div class="home-afisha__desc">Long descriptive copyrighted prose must not become the link title</div></a>
  <a href="/events/hleb/weekend/workshop/">Мастер-класс</a>
  <a href="/events/hleb/weekend/excursion/">Экскурсия по выставке Хлеб</a>
  <a href="/events/movie/">Кино: специальный показ</a>`,
 'https://centrezotov.ru/events/hleb/':'<a href="/events/hleb/audiogid-hleb/">Аудиогид к выставке «Хлеб»</a>',
 'https://centrezotov.ru/events/hleb/audiogid-hleb/':'<a href="https://hleb.mave.digital/">Слушать</a>'};
 const calls=[];const result=await createOfficialDiscovery({request:async url=>{calls.push(url);return {url,html:pages[url]||''}}})(bundle);
 assert.deepEqual(calls.slice(0,3),['https://centrezotov.ru/','https://centrezotov.ru/events/hleb/','https://centrezotov.ru/events/hleb/audiogid-hleb/']);
 assert.ok(result.links.some(l=>l.url==='https://hleb.mave.digital/'&&l.kind==='audio'));
 assert.equal(result.links.find(l=>l.url==='https://centrezotov.ru/events/hleb/').title,'Хлеб');
 assert.ok(!result.links.some(l=>l.url.endsWith('/movie/')||l.url.endsWith('/concert/')));
 assert.ok(!JSON.stringify(result).includes('copyrighted prose'));
});
test('redirect re-resolves same hostname and rejects DNS rebinding into private network',async()=>{
 const {EventEmitter}=await import('node:events');const {Readable}=await import('node:stream');let lookups=0,sockets=0;
 const http=createOfficialHttp({lookup:async()=>[{address:++lookups===1?'93.184.216.34':'127.0.0.1',family:4}],requestFn:(_url,_options,callback)=>{sockets++;const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=Readable.from([]);res.statusCode=302;res.headers={location:'/palace'};callback(res)});return req}});
 await assert.rejects(http('https://museum.example/'),/not public/);assert.equal(sockets,1);assert.equal(lookups,2);
});
