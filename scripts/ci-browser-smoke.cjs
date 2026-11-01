// Browser integration with deterministic API fixtures; never calls paid providers.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
function wave(){const pcm=Buffer.alloc(8000),b=Buffer.alloc(44+pcm.length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length,40);pcm.copy(b,44);return b}
(async()=>{
 const {createApp}=await import('../server/index.mjs');const app=createApp({env:{}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});
  for(const language of ['ru','en']){
   const context=await browser.newContext({locale:language==='ru'?'ru-RU':'en-GB',viewport:{width:390,height:844}});
   if(language==='en')await context.addInitScript(()=>localStorage.setItem('waystory-saved',JSON.stringify([{id:'legacy-place',title:'Старая русская карточка',subtitle:'Русское описание',lang:'ru',source:'https://ru.wikipedia.org/wiki/Test',blocks:[{id:'old',depth:0,title:'Главное',text:'Русский источник.'}]}])));
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   let tourGate=null,releaseTour;let configDelay=0,signedIn=true,failSession=false;const calls=[],tourCalls=[];
   const title=language==='ru'?'Казанский собор':'Kazan Cathedral';
   await page.route('https://fonts.googleapis.com/**',r=>r.abort());
   await page.route('https://fonts.gstatic.com/**',r=>r.abort());
   await page.route('**/api/session',r=>failSession?r.fulfill({status:503,json:{error:'temporary'}}):r.fulfill({json:{enabled:true,user:signedIn?{name:'Pilot',email:'pilot@example.com'}:null,usage:signedIn?{ai:{used:1,limit:null},tts:{used:2,limit:null}}:null}}));
   await page.route('**/auth/logout',r=>{signedIn=false;return r.fulfill({json:{ok:true}})});
   await page.route('**/api/config',async r=>{if(configDelay)await new Promise(resolve=>setTimeout(resolve,configDelay));return r.fulfill({json:{ai:signedIn,tours:signedIn,mode:signedIn?'live':'demo',vision:signedIn,tts:signedIn}})});
   await page.route('**/api/guide',async r=>{
    const body=r.request().postDataJSON();calls.push(body);assert.equal(body.language,language);
    if(body.action==='translatePlaces')return r.fulfill({json:{language,places:body.places.map(p=>({...p,title,subtitle:language==='ru'?'История города':'City history'}))}});
    assert.notEqual(body.action,'story','current live config must activate tours');
    return r.fulfill({json:{text:language==='ru'?'Ответ по источнику.':'An answer based on the source.'}});
   });
   await page.route('**/api/speech',r=>{assert.equal(r.request().postDataJSON().language,language);return r.fulfill({contentType:'audio/wav',body:wave()})});
   await page.route('https://*.wikipedia.org/**',r=>r.fulfill({json:{query:{pages:{1:{pageid:1,title,description:'City history',coordinates:[{lat:36.57,lon:31.98}],extract:language==='ru'?'Собор находится в центре города. Здесь сохранилась историческая архитектура.':'The cathedral stands in the city centre. Historic architecture survives here.',fullurl:'https://'+language+'.wikipedia.org/wiki/Test'}}}}}));
   const tour={id:'browser-tour',placeId:'wiki:'+language+':1',language,status:'ready',topics:[{id:'history',title:language==='ru'?'История':'History'}],chapters:[{id:'overview',topicId:'overview',status:'ready',text:(language==='ru'?'Обзор места. ':'Place overview. ').repeat(40)},{id:'history',topicId:'history',status:'ready',text:'Verified history.'}]};
   await page.route('**/api/places/resolve',r=>r.fulfill({json:{place:{id:tour.placeId,refs:[{provider:'wikipedia',language,pageId:1}],names:{original:title,[language]:title},sourceIds:[]},sources:[]}}));
   await page.route('**/api/tours',async r=>{tourCalls.push(r.request().postDataJSON());if(tourGate)await tourGate;return r.fulfill({json:{tourId:tour.id,tour}})});
   await page.route('**/api/tours/browser-tour',r=>r.fulfill({json:tour}));
   await page.route('**/api/tours/browser-tour/progress',r=>r.fulfill({json:r.request().postDataJSON()}));
   async function search(){await page.locator('#search-input').fill('cathedral');await page.locator('#search-form').evaluate(el=>el.requestSubmit());await page.waitForFunction(()=>document.querySelectorAll('#places .place-card').length===1)}
   await page.goto('http://127.0.0.1:'+app.address().port);
   assert.equal(await page.locator('#places .place-card').count(),0);
   assert.equal(await page.locator('#reset-places').isVisible(),false);
   assert.equal(await page.locator('#section-title').innerText(),language==='ru'?'Найдите своё место↗':'Find your place↗');
   for(const width of [320,390,780]){
    await page.setViewportSize({width,height:844});
    const layout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,labels:[...document.querySelectorAll('.hero-actions [data-i18n]')].map(el=>({size:parseFloat(getComputedStyle(el).fontSize),right:el.getBoundingClientRect().right})),eyebrows:[...document.querySelectorAll('.eyebrow [data-i18n]')].filter(el=>el.getClientRects().length).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))}));
    assert.ok(layout.scroll<=layout.viewport+1,JSON.stringify(layout));assert.ok(layout.labels.every(x=>x.size<=12&&x.right<=width),JSON.stringify(layout));assert.ok(layout.eyebrows.every(x=>x.width>50&&x.height>5),JSON.stringify(layout));
   }
   await page.setViewportSize({width:390,height:844});
   await page.waitForFunction(()=>/ИИ-гид подключён:|AI guide connected:/.test(document.querySelector('#mode-note p')?.textContent||''));
   await page.locator('#photo-open').click();
   const cameraPicker=page.waitForEvent('filechooser');await page.locator('#photo-camera-open').click();const camera=await cameraPicker;
   assert.equal(await camera.element().getAttribute('capture'),'environment');assert.equal(await camera.element().getAttribute('accept'),'image/*');
   const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;return canvas.toDataURL('image/png').split(',')[1]});
   const photo={name:'camera.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')};
   await camera.setFiles(photo);await page.locator('#photo-preview').waitFor({state:'visible'});assert.equal(await page.locator('#photo-preview').isVisible(),true);assert.equal(await page.locator('#identify-photo').isEnabled(),true);
   assert.equal(calls.filter(x=>x.action==='identify').length,0);
   const galleryPicker=page.waitForEvent('filechooser');await page.locator('.photo-drop').click();const gallery=await galleryPicker;
   assert.equal(await gallery.element().getAttribute('capture'),null);await gallery.setFiles(photo);
   assert.equal(await page.locator('#photo-input').inputValue(),'');
   await page.locator('#identify-photo').click();await page.waitForFunction(()=>!document.querySelector('#photo-result').hidden);
   assert.equal(calls.filter(x=>x.action==='identify').length,1);
   await page.locator('[data-close="photo-dialog"]').click();
   await search();
   await page.waitForFunction(()=>/ИИ-гид подключён:|AI guide connected:/.test(document.querySelector('#mode-note p')?.textContent||''));await page.waitForFunction(expected=>document.querySelector('.card-title')?.textContent===expected,title);
   assert.equal(await page.locator('html').getAttribute('lang'),language);
   if(language==='en'){await page.locator('[data-tab="saved"]').click();await page.waitForFunction(expected=>document.querySelector('#library-grid .card-title')?.textContent===expected,title);await page.locator('[data-tab="explore"]').click();}
   // The live server contract selects progressive tours. Old depth/story
   // generation is covered by source/saved-story unit tests, not live fixtures.
   tourGate=new Promise(resolve=>{releaseTour=resolve});
   await page.locator('.card-listen').first().click();
   await page.waitForFunction(()=>/Готовим план|Preparing the tour plan/.test(document.querySelector('#tour-panel').textContent));
   for(const selector of ['.depth-label','.depth-switch'])assert.equal(await page.locator(selector).isVisible(),false,selector);
   releaseTour();tourGate=null;await page.locator('[data-tour-primary]').waitFor();
   assert.equal(await page.locator('#story-play').isVisible(),false);assert.equal(await page.locator('[data-tour-primary]').count(),1);assert.equal(await page.locator('.tour-topics details').count(),0);assert.equal(await page.locator('.tour-reader').evaluate(el=>el.open),false);assert.equal(await page.locator('#tour-panel').evaluate(el=>el.compareDocumentPosition(document.querySelector('#story-materials'))&Node.DOCUMENT_POSITION_FOLLOWING),4);assert.equal(tourCalls.length,1);assert.equal(calls.some(c=>c.action==='story'),false);
   const route=new URL(await page.locator('#story-map a').getAttribute('href'));assert.equal(route.searchParams.get('destination'),'36.57,31.98');assert.equal(await page.locator('#story-map a').getAttribute('rel'),'noopener noreferrer');
   const speech=page.waitForRequest(r=>r.url().endsWith('/api/speech'));
   await page.locator('[data-tour-primary]').click();await speech;
   assert.equal((await page.locator('#story-message').textContent()).includes('Illegal invocation'),false);
   await page.locator('#question-input').fill(language==='ru'?'Какова история места?':'What is its history?');await page.locator('#question-form').evaluate(el=>el.requestSubmit());await page.locator('#answer').waitFor({state:'visible'});assert.ok(calls.some(c=>c.action==='question'));
   const bounds=await page.locator('#story-dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));
   assert.deepEqual(errors,[]);
   // Reload/selection waits for delayed capabilities and still uses /api/tours.
   configDelay=600;await page.addInitScript(()=>localStorage.removeItem('waystory-tour-cursor'));await page.reload({waitUntil:'domcontentloaded'});await search();await page.locator('.card-listen').first().click();await page.locator('[data-tour-primary]').waitFor();assert.equal(calls.some(c=>c.action==='story'),false);
   await page.locator('[data-close="story-dialog"]').click();failSession=true;await page.evaluate(()=>localStorage.removeItem('waystory-tour-cursor'));await page.reload();await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('аккаунт')||document.querySelector('#account-status').textContent.includes('Could not load'));failSession=false;await page.locator('#account-open').click();await page.waitForFunction(()=>/ИИ-гид подключён:|AI guide connected:/.test(document.querySelector('#mode-note p')?.textContent||''));await page.locator('[data-close="account-dialog"]').click();await search();await page.locator('#reset-places').click();assert.equal(await page.locator('#places .place-card').count(),0);assert.equal(await page.locator('#places').innerText(),'');assert.equal(await page.locator('#reset-places').isVisible(),false);await page.locator('#account-open').click();await page.waitForFunction(()=>document.querySelector('#account-email').textContent==='pilot@example.com');assert.match(await page.locator('#account-usage').innerText(),/1 \/ (Безлимит|Unlimited)/);await page.locator('#account-logout').click();await page.waitForFunction(()=>document.querySelector('#account-open').textContent==='Войти'||document.querySelector('#account-open').textContent==='Sign in');await search();const before=calls.length;await page.locator('.card-listen').first().click();await page.waitForFunction(()=>document.querySelector('#account-dialog').open);assert.equal(await page.locator('#story-dialog').evaluate(el=>el.open),false);assert.equal(await page.locator('.story-block').count(),0);assert.equal(calls.length,before);assert.equal(await page.locator('#google-login').getAttribute('href'),'/auth/google');assert.equal(await page.locator('#google-login').isVisible(),true);await context.close();console.log(language+': UI, photo, translation, tour selection, questions, native audio, account and mobile width passed');
  }
  // Multi-source UI: deterministic OSM identity, regional evidence, missing material,
  // stale async responses and a saved v2 story. No upstream API calls.
  for(const language of ['ru','en']){
   const ctx=await browser.newContext({locale:language==='ru'?'ru-RU':'en-GB',viewport:{width:390,height:844}}),page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const native='Hacımehmetli Camii',title=language==='ru'?'Мечеть Хаджи Мехметли':'Hacımehmetli Mosque';
   const place=id=>({id:'osm:node:'+id,refs:[{provider:'osm',kind:'node',id}],names:{original:native,native:{text:native,sourceId:'osm:node:'+id},[language]:title+' '+id},coordinates:{lat:36.54,lon:32,kind:'centroid',sourceId:'osm:node:'+id},category:'mosque',sourceIds:['osm:node:'+id]});
   const sources=[{id:'voyage',provider:'wikivoyage',title:'Alanya',url:'https://en.wikivoyage.org/?curid=1',scope:'area',language:'en',retrievedAt:'2026-10-11',publishedAt:null,updatedAt:null,placeIds:['osm:node:1','osm:node:2'],license:{id:'CC-BY-SA-4.0',url:'https://creativecommons.org/licenses/by-sa/4.0/',attribution:'Wikivoyage contributors'}}];
   let missing=false,calls=0;
   await page.route('https://fonts.**/**',r=>r.abort());
   await page.route('**/api/session',r=>r.fulfill({json:{enabled:true,user:{name:'Pilot',email:'pilot@example.com'}}}));
   await page.route('**/api/config',r=>r.fulfill({json:{ai:true,tours:true,vision:true,tts:false,multisource:true}}));
   await page.route('**/api/places/search?**',r=>r.fulfill({json:{places:[place(1),place(2)],sources,statuses:[{provider:'wikivoyage',status:'unavailable'}]}}));
   // Keep discovery fixtures independent of AI failures and avoid upstream resolution.
   await page.route('**/api/places/resolve',r=>r.fulfill({json:{place:{id:'wiki:en:1',refs:[{provider:'wikipedia',language:'en',pageId:1}],names:{original:'Saved v2',en:'Saved v2'},sourceIds:[]},sources:[]}}));
   await page.route('**/api/places/enrich',()=>assert.fail('tours provide materials without legacy enrichment'));
   await page.route('**/api/guide',r=>{const body=r.request().postDataJSON();assert.equal(body.action,'translatePlaces');return r.fulfill({json:{language,places:body.places}})});
   await page.route('**/api/tours',async r=>{
    const {placeId}=r.request().postDataJSON();calls++;if(placeId==='osm:node:1')await new Promise(resolve=>setTimeout(resolve,200));
    const officialLinks=[...Array.from({length:12},(_,i)=>({url:`https://museum.example/${placeId}/page-${i}`,title:`Website ${i}`,kind:'website'})),{url:`https://museum.example/${placeId}/guide`,title:'Official guide '+placeId,kind:'guide'},{url:`https://museum.example/${placeId}/audio`,title:'Official audio '+placeId,kind:'audio'}];
    return r.fulfill({json:{tourId:'tour-'+placeId,tour:{id:'tour-'+placeId,placeId,language,status:missing?'failed':'ready',topics:[],chapters:[{id:'overview',topicId:'overview',status:'ready',text:'Verified '+placeId}],sources,officialLinks,searchLinks:[{url:'https://visitor.example/guide',title:'Independent visitor guide'}],outputLicense:'CC-BY-SA-4.0'}}});
   });
   await ctx.addInitScript(()=>localStorage.setItem('waystory-saved',JSON.stringify([{id:'wiki-en-1',title:'Saved v2',lang:'en',storyLanguage:'en',storyVersion:2,aiGenerated:true,source:'https://en.wikipedia.org/?curid=1',blocks:[{id:'old',title:'Saved',text:'Saved story text.',depth:0}]}])));
   await page.goto('http://127.0.0.1:'+app.address().port);
   await page.locator('#search-input').fill('mosque');await page.locator('#search-form').evaluate(el=>el.requestSubmit());await page.waitForSelector('#places .place-card');
   assert.equal(await page.locator('#places .place-card').count(),2);
   await page.locator('.card-listen').first().click();await page.locator('[data-close="story-dialog"]').click();await page.locator('.card-listen').nth(1).click();
   await page.locator('[data-tour-primary]').waitFor();await page.waitForTimeout(250);assert.equal(await page.locator('#story-title').textContent(),title+' 2');assert.match(await page.locator('#tour-panel').textContent(),/osm:node:2/);assert.doesNotMatch(await page.locator('#tour-panel').textContent(),/osm:node:1/);
   assert.match(await page.locator('#story-original').textContent(),/Hacımehmetli/);assert.match(await page.locator('#story-sources').textContent(),language==='ru'?/Региональный контекст/:/Regional context/);assert.equal(await page.locator('#story-sources a').first().getAttribute('href'),'https://en.wikivoyage.org/?curid=1');assert.equal(await page.locator('.story-block .citation-links a').count(),0);assert.equal(await page.locator('#story-sources').isVisible(),false);await page.locator('#story-attribution summary').click();assert.equal(await page.locator('#story-sources').isVisible(),true);await page.locator('#story-attribution summary').click();
   for(const width of [320,390,780]){await page.setViewportSize({width,height:844});const b=await page.locator('#story-dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(b.scroll<=b.width+1,JSON.stringify(b))}
   assert.equal(await page.locator('.depth-switch').isVisible(),false);assert.equal(await page.locator('#story-refresh').isVisible(),false);assert.equal(await page.locator('#story-save').isEnabled(),true);
   await page.waitForFunction(()=>document.querySelector('#story-materials a')?.textContent==='Official guide osm:node:2');
   assert.equal(await page.locator('#story-materials').isVisible(),true);assert.equal(await page.locator('#story-materials > ul').first().locator('a').count(),8);
   assert.equal(await page.locator('#story-materials a').first().getAttribute('rel'),'noopener noreferrer');
   assert.match(await page.locator('#story-materials').textContent(),language==='ru'?/Найдено в интернете/:/Found on the web/);
   assert.doesNotMatch(await page.locator('#story-materials').textContent(),/osm:node:1/);
   for(const width of [320,390]){await page.setViewportSize({width,height:844});const b=await page.locator('#story-dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(b.scroll<=b.width+1,JSON.stringify(b))}
   missing=true;await page.locator('[data-close="story-dialog"]').click();await page.locator('.card-listen').nth(1).click();await page.waitForFunction(()=>/Не удалось подготовить экскурсию|Could not prepare the tour/.test(document.querySelector('#tour-panel').textContent));assert.equal(await page.locator('#story-map a').count(),1);
   missing=false;await page.locator('[data-close="story-dialog"]').click();await page.locator('.card-listen').nth(1).click();await page.locator('[data-tour-primary]').waitFor();
   if(language==='en'){await page.locator('[data-close="story-dialog"]').click();await page.locator('[data-tab="saved"]').click();const before=calls;await page.locator('#library-grid .card-listen').click();await page.locator('[data-tour-primary]').waitFor();assert.equal(calls,before+1);assert.match(await page.locator('#tour-panel').textContent(),/wiki:en:1/)}
   assert.deepEqual(errors,[]);await ctx.close();console.log(language+': multi-source mobile, citations, stale response, retry and library passed');
  }
  // Source-only configuration preserves the requested-language article fallback.
  {
   const ctx=await browser.newContext({locale:'ru-RU',viewport:{width:390,height:844}}),page=await ctx.newPage(),editions=[];
   const station={id:'wiki:en:8392086',refs:[{provider:'wikipedia',language:'en',pageId:8392086},{provider:'wikipedia',language:'ru',pageId:231936}],names:{original:'Moscow Belorussky railway station',ru:'Белорусский вокзал'},category:'place',sourceIds:[]};
   await page.route('https://fonts.**/**',r=>r.abort());
   await page.route('**/api/session',r=>r.fulfill({json:{enabled:true,user:{name:'Pilot'}}}));
   await page.route('**/api/config',r=>r.fulfill({json:{ai:false,tours:false,multisource:true,tts:false}}));
   await page.route('**/api/places/search?**',r=>r.fulfill({json:{places:[station],sources:[],statuses:[]}}));
   await page.route('**/api/places/enrich',r=>r.fulfill({json:{officialLinks:[],discoveryStatus:{web:'not_needed',official:'empty'}}}));
   await page.route('**/api/guide',r=>r.fulfill({status:502,json:{error:'Не удалось проверить факты в ИИ-рассказе. Попробуйте ещё раз.',code:'story_unverified'}}));
   await page.route('https://*.wikipedia.org/**',r=>{const u=new URL(r.request().url());editions.push(u.hostname);assert.equal(u.searchParams.get('pageids'),'231936');return r.fulfill({json:{query:{pages:{231936:{pageid:231936,title:'Белорусский вокзал',extract:'Вокзал открыт в 1870 году. Он находится в Москве.',fullurl:'https://ru.wikipedia.org/wiki/Белорусский_вокзал'}}}}});});
   await page.goto('http://127.0.0.1:'+app.address().port);
   await page.locator('#search-input').fill('Белорусский вокзал');await page.locator('#search-form').evaluate(el=>el.requestSubmit());await page.locator('.card-listen').first().click();
   await page.waitForFunction(()=>!document.querySelector('#story-play').disabled&&document.querySelector('#story-text').textContent.includes('Вокзал открыт'));
   assert.equal(await page.locator('#story-text h3').count(),0);assert.equal(await page.locator('#story-text .source-paragraph').count(),1);assert.deepEqual(editions,['ru.wikipedia.org']);assert.match(await page.locator('#story-text').innerText(),/Вокзал открыт/);assert.equal(await page.locator('#story-language-notice').isVisible(),false);
   assert.equal(await page.locator('#story-message').innerText(),'');
   await ctx.close();console.log('ru: Belorussky English identity, source-only Russian readable/playable fallback passed');
  }
 }finally{await browser?.close();await new Promise(r=>app.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});

