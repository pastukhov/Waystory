// Deterministic geolocation lifecycle checks; no remote providers or location access.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const {createApp}=await import('../server/index.mjs');const app=createApp({env:{MULTISOURCE_ENABLED:'false'},logWriter:()=>{}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 const record=(id,name)=>({id:'osm:node:'+id,refs:[{provider:'osm',kind:'node',id}],names:{original:name,ru:name,en:name},coordinates:{lat:36.55,lon:31.98},category:'attraction'});
 try{
  for(const language of ['ru','en'])for(const mode of ['success','denied','timeout','late','late-config','unsupported','network','network-timeout']){
   const ctx=await browser.newContext({locale:language==='ru'?'ru-RU':'en-GB',viewport:{width:390,height:844}});
   await ctx.addInitScript(mode=>{
    window.geoCalls=0;window.geoMode=mode;
    if(mode==='network-timeout'){const originalFetch=window.fetch,originalTimer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms===20000&&window.geoMode==='network-timeout'?10:ms,...args);window.fetch=(url,options)=>window.geoMode==='network-timeout'&&String(url).includes('/api/places/nearby')?new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})}):originalFetch(url,options)}
    Object.defineProperty(navigator,'geolocation',{value:mode==='unsupported'?undefined:{getCurrentPosition(success,error){window.geoCalls++;window.geoSuccess=()=>success({coords:{latitude:36.55,longitude:31.98,accuracy:20}});window.geoError=()=>error({code:1});if(window.geoMode==='late')return;queueMicrotask(()=>window.geoMode==='denied'?error({code:1}):window.geoMode==='timeout'?error({code:3}):window.geoSuccess())},watchPosition(){throw Error('Continuous tracking is forbidden')}}});
   },mode);
   const page=await ctx.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let nearby=0,failNetwork=mode==='network',releaseConfig;const configGate=mode==='late-config'?new Promise(r=>releaseConfig=r):Promise.resolve();
   await page.route('https://fonts.**/**',r=>r.abort());
   await page.route('**/api/session',r=>r.fulfill({json:{enabled:true,user:null}}));
   await page.route('**/api/config',async r=>{await configGate;return r.fulfill({json:{ai:false,multisource:true}})});
   await page.route('**/api/places/nearby?*',r=>{nearby++;return r.fulfill(failNetwork?{status:503,json:{error:'Источники мест временно недоступны.'}}:{json:{places:Array.from({length:5},(_,i)=>record(i+1,'Nearby '+i)),sources:[],statuses:[]}})});
   await page.route('**/api/places/search?*',r=>r.fulfill({json:{places:[record(99,'Manual result')],sources:[],statuses:[]}}));
   await page.goto('http://127.0.0.1:'+app.address().port);
   assert.equal(await page.locator('.hero-actions #locate').count(),0);
   if(mode==='success'){
    await page.waitForFunction(()=>document.querySelectorAll('#places .place-card').length===5);assert.equal(nearby,1);assert.equal(await page.evaluate(()=>geoCalls),1);assert.equal(await page.locator('#nearby-retry').isVisible(),false);
   }else if(mode==='late-config'){
    await page.waitForFunction(()=>geoCalls===1);assert.equal(await page.locator('#discovery-status.discovery-loading strong').textContent(),language==='ru'?'Ищем достопримечательности рядом':'Finding nearby landmarks');assert.equal(await page.locator('#places').getAttribute('aria-busy'),'true');await page.locator('#search-input').fill('Manual');await page.locator('#search-form').evaluate(el=>el.requestSubmit());releaseConfig();await page.waitForFunction(()=>document.querySelector('.card-title')?.textContent==='Manual result');assert.equal(nearby,0);
   }else if(mode==='late'){
    await page.waitForFunction(()=>geoCalls===1);await page.locator('#search-input').fill('Manual');await page.locator('#search-form').evaluate(el=>el.requestSubmit());await page.waitForFunction(()=>document.querySelector('.card-title')?.textContent==='Manual result');
    assert.equal(await page.locator('#discovery-status').evaluate(el=>el.classList.contains('discovery-loading')),false);assert.equal(await page.locator('#places').getAttribute('aria-busy'),'false');const status=await page.locator('#discovery-status').textContent();await page.evaluate(()=>{geoSuccess();geoError()});assert.equal(nearby,0);assert.equal(await page.locator('#discovery-status').textContent(),status);assert.equal(await page.locator('.card-title').textContent(),'Manual result');
   }else{
    await page.locator('#nearby-retry').waitFor({state:'visible'});assert.equal(await page.locator('#search-input').isEnabled(),true);
    if(mode==='timeout'||mode==='network'||mode==='network-timeout'){failNetwork=false;await page.evaluate(()=>window.geoMode='success');await page.locator('#nearby-retry').click();await page.waitForFunction(()=>document.querySelectorAll('#places .place-card').length===5);assert.equal(await page.evaluate(()=>geoCalls),2)}
    else{assert.equal(nearby,0);await page.locator('#search-input').fill('Manual');await page.locator('#search-form').evaluate(el=>el.requestSubmit());await page.waitForFunction(()=>document.querySelector('.card-title')?.textContent==='Manual result')}
   }
   assert.deepEqual(errors,[]);await ctx.close();console.log(language+': automatic nearby '+mode+' passed');
  }
 }finally{await browser.close();await new Promise(r=>app.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
