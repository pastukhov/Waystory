// Run inside the app container: docker exec -i waystory-waystory-1 node
// --input-type=module < scripts/check-ai.mjs
const place={title:'Казанский собор',source:'https://ru.wikipedia.org/wiki/Казанский_собор_(Санкт-Петербург)',text:'Казанский собор в Санкт-Петербурге построен в 1801–1811 годах по проекту Андрея Воронихина. Он расположен на Невском проспекте. Колоннада обращена к проспекту с северной стороны, главный вход находится с западной.'};
const requests=[
 {action:'story',place},
 {action:'question',place,question:'Кто архитектор и когда построили собор?',heard:[]},
 {action:'identify',context:'Тест: одноцветное изображение, достопримечательности нет.',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAA+klEQVR4nO3RQQ0AIAzAwMlBCUrwrwEZe/SSCmhyc+7TYrN+EA8AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2n3l14MNZgWhqwAAAABJRU5ErkJggg=='}
];
for(const body of requests){
 const start=Date.now();
 const response=await fetch('http://127.0.0.1:5173/api/guide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(95000)});
 const data=await response.json();
 console.log(body.action, response.status, `${((Date.now()-start)/1000).toFixed(1)}s`);
 if(!response.ok){console.error(data.error);process.exitCode=1;continue}
 console.log(data.blocks?.map(b=>`[${b.depth}] ${b.title}: ${b.text}`).join('\n')||data.text);
}
