import {t} from './i18n.mjs';
import {estimatedSeconds} from './duration.mjs';
export function renderTour(container,tour,{onOverview,onTopic,onContinue,onRetry,onResume,onPause,selected,cursor,state='idle',completedChapterIds=[]}={}){
 container.replaceChildren();container.hidden=false;container.dataset.current=selected?.id||'';
 const make=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el};
 const button=(text,callback,key,value='',primary=false)=>{const b=make('button',text,'button '+(primary?'primary':'secondary'));b.type='button';b.dataset[key]=value;b.onclick=callback;return b};
 container.append(make('h3',t('Экскурсия')));
 if(!tour){container.append(make('p',t('Готовим план экскурсии…'),'muted'));return}
 if(tour.status==='planning')container.append(make('p',t('Готовим план экскурсии…'),'muted'));
 if(tour.status==='failed'){container.append(make('p',t('Не удалось подготовить экскурсию. Попробуйте открыть место снова.'),'inline-message'));return}
 const overview=tour.chapters.find(c=>c.topicId==='overview'),row=make('div',null,'tour-actions');
 row.append(button(t('Слушать обзор'),onOverview,'tourOverview','',true));
 row.append(button(t('Продолжить экскурсию'),onContinue,'tourContinue'));
 if(cursor&&selected?.status==='ready')row.append(button(t('Продолжить с сохранённого места'),onResume,'tourResume'));
 if(['playing','loading','paused'].includes(state))row.append(button(t(state==='paused'?'▶ Продолжить':'Ⅱ Пауза'),state==='paused'?onResume:onPause,'tourPause'));
 if(!overview||tour.status!=='ready')row.firstChild.disabled=true;
 container.append(row);
 const list=make('div',null,'tour-topics');
 for(const topicId of ['overview',...tour.topics.map(topic=>topic.id)]){
  const topic=tour.topics.find(t=>t.id===topicId),c=tour.chapters.find(c=>c.topicId===topicId);if(!c)continue;
  const section=make('section',null,'tour-topic');section.dataset.tourChapter=c.id;
  const heading=make('h4',topic?.title||t('Обзор'));section.append(heading);
  if(topic?.summary)section.append(make('p',topic.summary,'muted'));
  const status=c.status==='ready'?t('Готово')+' · '+'≈ '+(estimatedSeconds(c.text)<60?estimatedSeconds(c.text)+' '+t('сек'):Math.round(estimatedSeconds(c.text)/60)+' '+t('мин')):c.status==='insufficient'?t('Недостаточно материалов по этой теме'):c.status==='failed'?t('Не удалось подготовить главу.'):c.status==='generating'?t('Готовим главу…'):t('Глава по запросу');
  section.append(make('p',status,'source-note'));
  if(completedChapterIds.includes(c.id))section.append(make('span',t('Прослушано'),'source-note'));
  if(c.status==='failed'&&c.error?.retryable)section.append(button(t('Повторить'),()=>onRetry?.(topicId),'tourRetry',topicId));
  else if(!['failed','insufficient'].includes(c.status)&&topicId!=='overview')section.append(button(t('Слушать тему'),()=>onTopic?.(topicId),'tourTopic',topicId));
  if(c.status==='ready'&&c.text){const details=make('details');if(c.id===selected?.id)details.open=true;details.append(make('summary',t('Читать главу')));for(const paragraph of c.text.split(/\n\s*\n/u))details.append(make('p',paragraph));section.append(details)}
  list.append(section);
 }container.append(list);
}
