import http from 'node:http';
import {createAuth} from './auth.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvironment,serverAddress} from './config.mjs';
import {createGuide,GuideError} from './guide.mjs';
import {createSpeech} from './tts.mjs';
import {sourceSettings} from './config.mjs';
import {createPlaceStore} from './places/store.mjs';
import {createPlaces} from './places/service.mjs';
import {createSourceHttp} from './sources/http.mjs';
import {createWikipediaProvider} from './sources/wikipedia.mjs';
import {createOsmProvider} from './sources/osm.mjs';
import {createWikivoyageProvider} from './sources/wikivoyage.mjs';
import {createWikidataProvider} from './sources/wikidata.mjs';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
async function readJson(req){
 const limit=7*1024*1024;
 if(Number(req.headers['content-length'])>limit)throw new GuideError(413,'Фото слишком большое. Выберите файл до 5 МБ.');
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new GuideError(415,'Ожидается JSON.');
 let length=0;const chunks=[];
 const stream=req.iterator?req.iterator({destroyOnReturn:false}):req;
 for await(const chunk of stream){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>limit){req.resume?.();throw new GuideError(413,'Запрос слишком большой.')}chunks.push(bytes)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new GuideError(400,'Некорректный JSON.')}
}
export function createApp(options={}){
 const settings=sourceSettings(options.env||process.env);
 const store=options.placeStore||(settings.enabled?createPlaceStore({dbPath:options.sourceDbPath||settings.dbPath}):null);
 const sourceRequest=settings.enabled?createSourceHttp({fetchFn:options.sourceFetchFn,osmEndpoint:settings.osmEndpoint}):null;
 const wikidata=sourceRequest?createWikidataProvider({request:sourceRequest}):null;
 const places=options.places||(store?createPlaces({store,providers:options.sourceProviders||[createWikipediaProvider({request:sourceRequest}),createOsmProvider({request:sourceRequest,endpoint:settings.osmEndpoint}),wikidata,createWikivoyageProvider({request:sourceRequest,wikidata})]}):null);
 const guide=createGuide(options),speech=createSpeech(options),auth=options.auth||createAuth({env:options.env,fetchFn:options.authFetchFn,dbPath:options.authDbPath});const server=http.createServer(async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: https://upload.wikimedia.org; media-src 'self' blob:; connect-src 'self' https://ru.wikipedia.org https://en.wikipedia.org https://tr.wikipedia.org; object-src 'none'; base-uri 'self'");
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{return json(400,{error:'Неверный адрес.'})}
 const redirect=(location,cookies)=>{res.writeHead(303,{'Location':location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...(cookies?{'Set-Cookie':cookies}:{})});res.end()};
 if(pathname.startsWith('/api/places/')){
  if(!places)return json(503,{error:'Поиск по дополнительным источникам пока выключен.'});
  const controller=new AbortController();req.once?.('aborted',()=>controller.abort());res.once?.('close',()=>{if(!res.writableEnded)controller.abort()});
  try{
   const url=new URL(req.url,'http://localhost'),language=url.searchParams.get('language')||'ru';
   if(['/api/places/nearby','/api/places/search'].includes(pathname)){
    if(req.method!=='GET')return json(405,{error:'Метод не поддерживается.'});
    if(pathname.endsWith('/search'))return json(200,await places.search({q:url.searchParams.get('q'),language,signal:controller.signal}));
    const getNumber=k=>url.searchParams.has(k)&&url.searchParams.get(k).trim()?Number(url.searchParams.get(k)):NaN;
    return json(200,await places.nearby({lat:getNumber('lat'),lon:getNumber('lon'),radius:url.searchParams.has('radius')?getNumber('radius'):1500,language,signal:controller.signal}));
   }
   if(pathname==='/api/places/resolve'){
    if(req.method!=='POST')return json(405,{error:'Метод не поддерживается.'});
    const user=auth.session(req.headers.cookie);if(!user)return json(auth.enabled?401:503,{error:'Войдите через Google.'});
    if(!auth.origin||req.headers.origin!==auth.origin)return json(403,{error:'Неверный источник.'});
    const body=await readJson(req);return json(200,await places.resolve(body.ref,{language:body.language||'ru',signal:controller.signal}));
   }
   return json(404,{error:'Не найдено.'});
  }catch(error){if(error.status===429)res.setHeader('Retry-After','60');if(!res.destroyed)return json(error.status||503,{error:error instanceof GuideError?error.message:'Источники мест временно недоступны.'})}
  return;
 }
 if(pathname.startsWith('/auth/')||pathname==='/api/session'){
  try{
   if(pathname==='/auth/google'&&req.method==='GET'){const started=auth.start();return redirect(started.location,started.cookie)}
   if(pathname==='/auth/google/callback'&&req.method==='GET'){
    try{const signed=await auth.callback(new URL(req.url,auth.origin||'https://localhost'),req.headers.cookie);return redirect('/',[signed.cookie,signed.clearFlow])}catch{return redirect('/?auth_error=1')}
   }
   if(pathname==='/api/session'&&req.method==='GET'){const user=auth.session(req.headers.cookie);return json(200,{enabled:auth.enabled,user:user?{name:user.name,email:user.email}:null,usage:user?auth.usage(user):null})}
   if(pathname==='/auth/logout'&&req.method==='POST'){
    if(!auth.origin||req.headers.origin!==auth.origin)return json(403,{error:'Неверный источник.'});
    res.setHeader('Set-Cookie',auth.logout(req.headers.cookie));return json(200,{ok:true});
   }
   return json(404,{error:'Не найдено.'});
  }catch(error){return json(error instanceof GuideError?error.status:503,{error:error instanceof GuideError?error.message:'Вход временно недоступен.'})}
 }
 let user=null;
 try{if(['/api/config','/api/guide','/api/speech'].includes(pathname))user=auth.session(req.headers.cookie)}catch{return json(503,{error:'Вход временно недоступен.'})}
 if(pathname==='/api/config'&&!user)return json(200,{ai:false,mode:'demo',multisource:!!places});
 if(pathname==='/api/config')return json(200,guide.enabled?{ai:true,mode:'live',multisource:!!places,vision:true,tts:speech.enabled}:{ai:false,mode:'demo',multisource:!!places,...(speech.enabled?{tts:true}:{})});
 if(pathname==='/api/guide'||pathname==='/api/speech'){
  if(!auth.origin&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return json(403,{error:'Запрос с другого сайта запрещён.'})}catch{return json(403,{error:'Неверный источник.'})}}
  if(req.method!=='POST')return json(405,{error:'Метод не поддерживается.'});
  if(!user)return json(auth.enabled?401:503,{error:auth.enabled?'Войдите через Google, чтобы пользоваться ИИ.':'Вход через Google пока не настроен.'});
  if(auth.origin&&req.headers.origin!==auth.origin)return json(403,{error:'Неверный источник.'});
  const controller=new AbortController();
  req.once?.('aborted',()=>controller.abort());
  res.once?.('close',()=>{if(!res.writableEnded)controller.abort()});
  try{
   auth.consume(user,pathname==='/api/speech'?'tts':'ai');
   if(pathname==='/api/speech'){
    const audio=await speech.run(await readJson(req),controller.signal);
    if(!res.destroyed){res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'private, no-store'});res.end(audio)}
    return;
   }
   if(!guide.enabled)return await guide.run();
   return json(200,await guide.run(await readJson(req),controller.signal));
  }catch(error){
   const status=error instanceof GuideError?error.status:500;
   if(status===429)res.setHeader('Retry-After','60');
   if(!res.destroyed)return json(status,{error:error instanceof GuideError?error.message:'Ошибка сервера. Попробуйте позже.'});
  }
  return;
 }
 if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Метод не поддерживается.'});
 if(pathname.split('/').some(s=>s.startsWith('.'))||pathname.includes('\\'))return json(404,{error:'Не найдено.'});
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root))return json(404,{error:'Не найдено.'});
 try{const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body)}catch{json(404,{error:'Не найдено.'})}
});server.on('close',()=>{auth.close?.();store?.close?.()});return server}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 loadEnvironment();
 const {host,port}=serverAddress();
 createApp().listen(port,host,()=>console.log('Waystory: http://'+host+':'+port));
}
