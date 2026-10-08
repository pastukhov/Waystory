import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
export function createApp(){return http.createServer(async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: https://upload.wikimedia.org; connect-src 'self' https://ru.wikipedia.org; object-src 'none'; base-uri 'self'");
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{return json(400,{error:'Неверный адрес.'})}
 if(pathname==='/api/config')return json(200,{ai:false,mode:'demo'});
 if(pathname==='/api/guide'){
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return json(403,{error:'Запрос с другого сайта запрещён.'})}catch{return json(403,{error:'Неверный источник.'})}}
  return json(503,{error:'ИИ пока не подключён. Попробуйте готовые истории и вопросы.'});
 }
 if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Метод не поддерживается.'});
 if(pathname.split('/').some(s=>s.startsWith('.'))||pathname.includes('\\'))return json(404,{error:'Не найдено.'});
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root))return json(404,{error:'Не найдено.'});
 try{const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body)}catch{json(404,{error:'Не найдено.'})}
})}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT)||5173;createApp().listen(port,'127.0.0.1',()=>console.log('Waystory: http://127.0.0.1:'+port))}
