import {DatabaseSync} from 'node:sqlite';
import {createTourStore} from './store.mjs';
import {createTourJobs} from './jobs.mjs';
import {createTourResearch} from './research.mjs';
import {createTours,createTourModel} from './service.mjs';
import {licenseFor} from '../sources/policies.mjs';
import {runTourProbe} from './probe.mjs';
export async function runTourFixtures({report=()=>{}}={}){
 let passed=true;
 for(const name of ['station','poor','foreign','wrong_object']){
  const db=new DatabaseSync(':memory:'),store=createTourStore({db}),jobs=createTourJobs({store});
  const place={id:name==='station'?'wiki:en:8392086':'wiki:en:1',names:{original:name==='station'?'Belorussky railway station':'Aunesis'},refs:[],coordinates:{lat:36,lon:32}};
  const ru=['Объект расположен в городе.','Здание построено в XIX веке.','Фасад выполнен из камня.','Внутри находится музей.'];
  const originals=name==='foreign'?['The object is in the town.','The building dates to the nineteenth century.','The facade is made of stone.','A museum is inside.']:ru;
  const doc={id:'wikipedia:en:1',provider:'wikipedia',title:place.names.original,url:'https://en.wikipedia.org/?curid=1',language:name==='foreign'?'en':'ru',scope:'place',kind:'history',revision:'fixture-v1',text:originals.join('\n\n'),license:licenseFor('wikimedia-cc-by-sa','Fixture contributors')};
  let modelCalls=0;
  const model=createTourModel({env:{ROUTERAI_API_KEY:'fixture'},fetchFn:async(url,options)=>{
   modelCalls++;const body=JSON.parse(options.body),payload=JSON.parse(body.messages[1].content),schema=body.response_format.json_schema.name;let data;
   if(schema==='tour_plan')data={topics:name==='poor'?[]:payload.spans.slice(1,4).map((span,i)=>({title:['История','Архитектура','Музей'][i],summary:'Подтверждённая тема.',status:'available',reason:null,evidenceIds:[span.id]}))};
   else if(schema==='chapter_grounding')data={supported:true,issues:[]};
   else{const span=payload.spans[0],index=originals.indexOf(span.text),text=ru[index];data={language:'ru',segments:[{text,evidenceIds:[span.id]}]};}
   return Response.json({usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]});
  }});
  const research=createTourResearch({collect:async()=>({documents:name==='wrong_object'?[]:[doc],statuses:[]}),search:name==='wrong_object'?async()=>({calls:1,candidates:[{url:'https://other.example/museum',title:'Another Museum',snippet:'Another museum in a different country',identitySignals:{}}],outcomes:[]}):null,loadPage:async()=>{throw Error('Wrong-object page should never load')}});
  const service=createTours({store,jobs,research,complete:model.complete,review:model.review,consume:()=>true,resolvePlace:async()=>place});
  try{
   let ok;
   if(name==='wrong_object'){
    const result=await service.start('fixture',{placeId:place.id,language:'ru'});await jobs.drain();await new Promise(r=>setImmediate(r));await jobs.drain();const tour=service.get('fixture',result.tourId);ok=tour.topics.length===0&&tour.chapters[0].status==='insufficient'&&modelCalls===0;
   }else ok=await runTourProbe({service,jobs,ownerId:'fixture',placeId:place.id,requiredThemes:name==='poor'?0:3,report});
   passed&&=ok;report({probe:'tour-fixture',name,passed:ok,modelCalls});
  }finally{await jobs.shutdown();db.close()}
 }
 return passed;
}
