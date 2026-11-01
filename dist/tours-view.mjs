import {t} from './i18n.mjs';
import {estimatedSeconds} from './duration.mjs';
const views=new WeakMap();
export function renderTour(container,tour,{onPrimary,onTopic,onRetry,selected,action='start',completedChapterIds=[]}={}){
 const previous=views.get(container),same=previous?.id===tour?.id;
 const view=same?previous:{id:tour?.id,reader:null,chapterId:null,text:null};views.set(container,view);
 const focused=container.contains(document.activeElement)?document.activeElement?.dataset?.tourFocus:null;
 const make=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el};
 const button=(text,callback,key,value='',className='button secondary')=>{const b=make('button',text,className);b.type='button';b.dataset[key]=value;b.dataset.tourFocus=key+':'+value;b.onclick=callback;return b};
 const nodes=[];container.hidden=false;container.dataset.current=selected?.id||'';
 if(!tour){container.replaceChildren(make('p',t('Готовим план экскурсии…'),'muted'));return}
 if(tour.status==='failed'){container.replaceChildren(make('p',t('Не удалось подготовить экскурсию. Попробуйте открыть место снова.'),'inline-message'));return}
 const labels={preparing:'Готовим главу…',start:'Слушать экскурсию',resume:'Продолжить',continue:'Продолжить',pause:'Ⅱ Пауза',restart:'Слушать заново',retry:'Повторить главу',unavailable:'Готовим план экскурсии…'};
 const primary=button(t(labels[action]),onPrimary,'tourPrimary','','button primary');primary.disabled=['unavailable','preparing'].includes(action)||tour.status!=='ready';nodes.push(primary);
 nodes.push(make('h3',t('Главы экскурсии')));
 const list=make('ol',null,'tour-topics');list.setAttribute('aria-label',t('Главы экскурсии'));
 for(const [index,topicId] of ['overview',...tour.topics.map(topic=>topic.id)].entries()){
  const topic=tour.topics.find(t=>t.id===topicId),c=tour.chapters.find(c=>c.topicId===topicId);if(!c)continue;
  const item=make('li',null,'tour-topic');item.dataset.tourChapter=c.id;
  const title=topic?.title||t('Обзор'),done=completedChapterIds.includes(c.id),current=c.id===selected?.id;
  const status=c.status==='ready'?(done?t('Прослушано')+' · ':'')+'≈ '+(estimatedSeconds(c.text)<60?estimatedSeconds(c.text)+' '+t('сек'):Math.round(estimatedSeconds(c.text)/60)+' '+t('мин')):c.status==='insufficient'?t('Недостаточно материалов по этой теме'):c.status==='failed'?t('Не удалось подготовить главу.'):c.status==='generating'?t('Готовим главу…'):t('Глава по запросу');
  const retry=c.status==='failed'&&c.error?.retryable;
  const choose=button('',()=>{view.requestedTopic=topicId;return retry?onRetry?.(topicId):onTopic?.(topicId)},retry?'tourRetry':'tourTopic',topicId,'tour-chapter-button');
  choose.setAttribute('aria-label',t(retry?'Повторить главу':'Слушать')+': '+title);choose.disabled=['failed','insufficient'].includes(c.status)&&!retry;choose.setAttribute('aria-current',current?'true':'false');
  choose.append(make('span',String(index+1),'tour-number'));
  const label=make('span',null,'tour-chapter-label');label.append(make('strong',title),make('small',status));const icon=make('span',retry?'↻':current?'●':'','tour-chapter-icon'+(!retry&&!current?' tour-play-icon':''));icon.setAttribute('aria-hidden','true');choose.append(label,icon);item.append(choose);list.append(item);
 }nodes.push(list);
 const c=selected||tour.chapters.find(c=>c.topicId==='overview');
 if(c?.status==='ready'&&c.text){
  if(!view.reader){view.reader=make('details',null,'tour-reader');const summary=make('summary');summary.dataset.tourFocus='reader';view.reader.append(summary,make('div',null,'tour-reader-text'))}
  if((!view.reader.open||view.requestedTopic===c.topicId||!view.chapterId||view.chapterId===c.id)&&(view.chapterId!==c.id||view.text!==c.text)){if(view.requestedTopic===c.topicId)view.requestedTopic=null;view.chapterId=c.id;view.text=c.text;view.reader.firstChild.textContent=t('Читать главу')+': '+(tour.topics.find(v=>v.id===c.topicId)?.title||t('Обзор'));view.reader.lastChild.replaceChildren(...c.text.split(/\n\s*\n/u).map(p=>make('p',p)))}
  nodes.push(view.reader);
 }else if(view.reader?.open&&view.chapterId){nodes.push(view.reader)}
 // Reuse the reader so a voice state update cannot reset its disclosure/scroll.
 container.replaceChildren(...nodes);
 if(focused){const target=[...container.querySelectorAll('[data-tour-focus]')].find(el=>el.dataset.tourFocus===focused);target?.focus({preventScroll:true})}
}
