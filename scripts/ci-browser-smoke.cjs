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
   let failStory=false,configDelay=0;const calls=[];
   const title=language==='ru'?'Казанский собор':'Kazan Cathedral';
   await page.route('https://fonts.googleapis.com/**',r=>r.abort());
   await page.route('https://fonts.gstatic.com/**',r=>r.abort());
   await page.route('**/api/config',async r=>{if(configDelay)await new Promise(resolve=>setTimeout(resolve,configDelay));return r.fulfill({json:{ai:true,mode:'live',vision:true,tts:true}})});
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
   await page.goto('http://127.0.0.1:'+app.address().port);
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
    failStory=true;await page.reload();await page.waitForFunction(()=>/ИИ-гид подключён:|AI guide connected:/.test(document.querySelector('#mode-note p')?.textContent||''));await page.waitForFunction(expected=>document.querySelector('.card-title')?.textContent===expected,title);await page.locator('.card-listen').first().click();await page.waitForFunction(()=>!document.querySelector('#story-language-notice').hidden);assert.equal(await page.locator('#story-play').isDisabled(),true);
   }
   // Open immediately while config is deliberately delayed: AI must still run.
   failStory=false;configDelay=600;await page.reload({waitUntil:'domcontentloaded'});await page.locator('.card-listen').first().click();await page.waitForFunction(expected=>document.querySelector('#story-title')?.textContent===expected&&!document.querySelector('#story-play').disabled,title);
   assert.equal(await page.locator('.story-block').count(),2);
   assert.ok(calls.some(c=>c.action==='story'));await context.close();console.log(language+': UI, translated story, cumulative depth, native fetch audio and mobile width passed');
  }
 }finally{await browser?.close();await new Promise(r=>app.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
