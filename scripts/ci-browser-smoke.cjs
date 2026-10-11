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
   let failStory=false,configDelay=0,signedIn=true;const calls=[];
   const title=language==='ru'?'Казанский собор':'Kazan Cathedral';
   await page.route('https://fonts.googleapis.com/**',r=>r.abort());
   await page.route('https://fonts.gstatic.com/**',r=>r.abort());
   await page.route('**/api/session',r=>r.fulfill({json:{enabled:true,user:signedIn?{name:'Pilot',email:'pilot@example.com'}:null,usage:signedIn?{ai:{used:1,limit:30},tts:{used:2,limit:100}}:null}}));
   await page.route('**/auth/logout',r=>{signedIn=false;return r.fulfill({json:{ok:true}})});
   await page.route('**/api/config',async r=>{if(configDelay)await new Promise(resolve=>setTimeout(resolve,configDelay));return r.fulfill({json:{ai:signedIn,mode:signedIn?'live':'demo',vision:signedIn,tts:signedIn}})});
   await page.route('**/api/guide',async r=>{
    const body=r.request().postDataJSON();calls.push(body);assert.equal(body.language,language);
    if(body.action==='translatePlaces')return r.fulfill({json:{language,places:body.places.map(p=>({...p,title,subtitle:language==='ru'?'История города':'City history'}))}});
    if(body.action==='story'){
     if(failStory)return r.fulfill({status:502,json:{error:'Translation temporarily unavailable'}});
     return r.fulfill({json:{title,language,storyVersion:2,detailLimited:false,blocks:[{id:'s0',depth:0,title,text:(language==='ru'?'Главное. ':'Essentials. ').repeat(40)},{id:'s1',depth:1,title,text:(language==='ru'?'История. ':'History. ').repeat(80)},{id:'s2',depth:2,title,text:(language==='ru'?'Подробности. ':'Details. ').repeat(150)}]}});
    }
    return r.fulfill({json:{text:language==='ru'?'Ответ по источнику.':'An answer based on the source.'}});
   });
   await page.route('**/api/speech',r=>{assert.equal(r.request().postDataJSON().language,language);return r.fulfill({contentType:'audio/wav',body:wave()})});
   await page.route('https://*.wikipedia.org/**',r=>r.fulfill({json:{query:{pages:{1:{pageid:1,title,description:'City history',extract:language==='ru'?'Собор находится в центре города. Здесь сохранилась историческая архитектура.':'The cathedral stands in the city centre. Historic architecture survives here.',fullurl:'https://'+language+'.wikipedia.org/wiki/Test'}}}}}));
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
   await search();
   await page.waitForFunction(()=>/ИИ-гид подключён:|AI guide connected:/.test(document.querySelector('#mode-note p')?.textContent||''));await page.waitForFunction(expected=>document.querySelector('.card-title')?.textContent===expected,title);
   assert.equal(await page.locator('html').getAttribute('lang'),language);
   if(language==='en'){await page.locator('[data-tab="saved"]').click();await page.waitForFunction(expected=>document.querySelector('#library-grid .card-title')?.textContent===expected,title);await page.locator('[data-tab="explore"]').click();}
   await page.locator('.card-listen').first().click();await page.waitForFunction(expected=>document.querySelector('#story-title')?.textContent===expected&&!document.querySelector('#story-play').disabled,title);
   const durations=[];
   for(const depth of [0,1,2]){await page.locator('.depth-switch [data-depth="'+depth+'"]').click();assert.equal(await page.locator('.story-block').count(),depth+1);durations.push(await page.locator('#duration-label').innerText())}
   assert.equal(new Set(durations).size,3);
   const speech=page.waitForRequest(r=>r.url().endsWith('/api/speech'));
   await page.locator('#story-play').click();await speech;
   assert.equal((await page.locator('#story-message').textContent()).includes('Illegal invocation'),false);
   const bounds=await page.locator('#story-dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));
   assert.deepEqual(errors,[]);
   if(language==='en'){
    failStory=true;await page.reload();await page.waitForFunction(()=>/AI guide connected:/.test(document.querySelector('#mode-note p')?.textContent||''));await page.locator('[data-tab="saved"]').click();await page.locator('#library-grid .card-listen').first().click();await page.waitForFunction(()=>!document.querySelector('#story-language-notice').hidden);assert.equal(await page.locator('#story-play').isDisabled(),true);
   }
   // Open immediately while config is deliberately delayed: AI must still run.
   failStory=false;configDelay=600;await page.reload({waitUntil:'domcontentloaded'});await search();await page.locator('.card-listen').first().click();await page.waitForFunction(expected=>document.querySelector('#story-title')?.textContent===expected&&!document.querySelector('#story-play').disabled,title);
   assert.equal(await page.locator('.story-block').count(),2);
   assert.ok(calls.some(c=>c.action==='story'));await page.locator('[data-close="story-dialog"]').click();await page.locator('#reset-places').click();assert.equal(await page.locator('#places .place-card').count(),0);assert.equal(await page.locator('#places').innerText(),'');assert.equal(await page.locator('#reset-places').isVisible(),false);await page.locator('#account-open').click();await page.waitForFunction(()=>document.querySelector('#account-email').textContent==='pilot@example.com');assert.match(await page.locator('#account-usage').innerText(),/1 \/ 30/);await page.locator('#account-logout').click();await page.waitForFunction(()=>document.querySelector('#account-open').textContent==='Войти'||document.querySelector('#account-open').textContent==='Sign in');await search();const before=calls.length;await page.locator('.card-listen').first().click();await page.waitForFunction(()=>!document.querySelector('#story-save').disabled);assert.equal(calls.length,before);await page.locator('[data-close="story-dialog"]').click();await page.locator('#account-open').click();assert.equal(await page.locator('#google-login').getAttribute('href'),'/auth/google');assert.equal(await page.locator('#google-login').isVisible(),true);await context.close();console.log(language+': UI, translated story, cumulative depth, native fetch audio and mobile width passed');
  }
 }finally{await browser?.close();await new Promise(r=>app.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
