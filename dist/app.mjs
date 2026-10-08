import {PLACES} from './data.mjs';
import {illustration} from './art.mjs';
import {buildQueue,restoreLibrary,saveEntry,validateImage,safeSourceUrl,createEpoch} from './core.mjs';
import {Narrator} from './speech.mjs';
import {searchPlaces,nearbyPlaces,loadPlace} from './wiki.mjs';

const $=id=>document.getElementById(id);
const state={tab:'explore',places:PLACES,selected:null,heard:[],depth:1,current:null,ai:false,answer:false,photo:null,photoUrl:null};
const placeEpoch=createEpoch(),searchEpoch=createEpoch(),answerEpoch=createEpoch();
let placeController,searchController,answerController,toastTimer,recognition;
const read=key=>{try{return restoreLibrary(localStorage.getItem(key))}catch{return []}};
let saved=read('waystory-saved'),history=read('waystory-history');
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{toast('Не удалось сохранить на устройстве. Возможно, хранилище переполнено.')}}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000)}
function message(text){$('story-message').textContent=text;$('story-message').hidden=!text}
function openDialog(id){if(!$(id).open)$(id).showModal()}
function setStatus(text,error=false){$('discovery-status').textContent=text;$('discovery-status').classList.toggle('error',error)}
function showArt(node,p){
  node.replaceChildren();
  if(p.thumbnail && /^https:\/\/upload\.wikimedia\.org\//.test(p.thumbnail)){
    const img=document.createElement('img');img.src=p.thumbnail;img.alt=p.title;img.referrerPolicy='no-referrer';img.addEventListener('error',()=>node.innerHTML=illustration(p.art),{once:true});node.append(img);
  }else node.innerHTML=illustration(p.art);
}
function card(place){
 const c=document.createElement('article');c.className='place-card';
 c.innerHTML='<div class="card-art"></div><button class="card-heart" aria-label="Сохранить место">♡</button><div class="card-body"><div class="card-kicker"><span></span><span></span></div><h3 class="card-title"></h3><p class="card-subtitle"></p><button class="card-listen"><span class="play-small">▶</span>Открыть рассказ<span>↗</span></button></div>';
 showArt(c.querySelector('.card-art'),place);
 if(place.tag){const tag=document.createElement('span');tag.className='card-badge';tag.textContent=place.tag;c.querySelector('.card-art').append(tag)}
 c.querySelector('.card-title').textContent=place.title;
 c.querySelector('.card-subtitle').textContent=place.subtitle||place.address||'У каждого места своя история';
 c.querySelector('.card-kicker span').textContent=place.category||'Место';
 c.querySelector('.card-kicker span:last-child').textContent=place.distance!=null?(place.distance<1000?place.distance+' м':(place.distance/1000).toFixed(1)+' км'):place.demo?'ПРИМЕР':'';
 const heart=c.querySelector('.card-heart');const isSaved=saved.some(p=>p.id===place.id);heart.textContent=isSaved?'♥':'♡';heart.classList.toggle('saved',isSaved);heart.setAttribute('aria-label',isSaved?'Убрать из сохранённого':'Сохранить место');heart.setAttribute('aria-pressed',String(isSaved));heart.onclick=()=>toggleSave(place);
 c.querySelector('.card-listen').onclick=()=>selectPlace(place);
 return c;
}
function renderPlaces(){const grid=$('places');grid.replaceChildren(...state.places.map(card));if(!state.places.length){const p=document.createElement('p');p.className='muted';p.textContent='Ничего не нашлось. Попробуйте уточнить название или выбрать другой город.';grid.append(p)}}
function toggleSave(place){const existing=saved.some(p=>p.id===place.id);saved=existing?saved.filter(p=>p.id!==place.id):saveEntry(saved,place);persist('waystory-saved',saved);renderPlaces();renderLibrary();updateSaveButton();toast(existing?'Место убрано из сохранённого':'Место сохранено на этом устройстве')}
function updateSaveButton(){const yes=saved.some(p=>p.id===state.selected?.id);$('story-save').textContent=yes?'♥':'♡';$('story-save').classList.toggle('saved',yes);$('story-save').setAttribute('aria-pressed',String(yes));$('story-save').setAttribute('aria-label',yes?'Убрать из сохранённого':'Сохранить место');$('saved-count').textContent=String(saved.length)}
function renderLibrary(){updateSaveButton();if(state.tab==='explore')return;const entries=state.tab==='saved'?saved:history;$('library-grid').replaceChildren(...entries.map(card));$('library-empty').hidden=entries.length>0;$('clear-history').hidden=state.tab!=='history'||!entries.length;$('library-title').textContent=state.tab==='saved'?'Сохранённое':'История прогулок';$('library-description').textContent=state.tab==='saved'?'Места, к которым хочется вернуться. Сохраняются на этом устройстве.':'Здесь появляются места после первого прослушанного фрагмента.';$('library-empty').querySelector('h3').textContent=state.tab==='saved'?'Здесь появятся ваши места':'Здесь появятся услышанные истории';$('library-empty').querySelector('p').textContent=state.tab==='saved'?'Нажмите на сердечко рядом с интересным местом.':'Откройте место и прослушайте первый фрагмент.'}
function tab(name){state.tab=name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$('explore-view').hidden=name!=='explore';$('library-view').hidden=name==='explore';renderLibrary();window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('back-explore').onclick=()=>tab('explore');
$('clear-history').onclick=()=>{if(!window.confirm('Удалить историю прослушивания с этого устройства?'))return;history=[];persist('waystory-history',history);renderLibrary()};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
for(const id of ['about-open','mode-about','footer-about'])$(id).onclick=()=>openDialog('about-dialog');
$('settings-open').onclick=()=>openDialog('settings-dialog');
const narrator=new Narrator({
 onState:s=>{document.body.classList.toggle('playing',s==='playing');$('player-pause').textContent=s==='playing'?'Ⅱ':'▶';$('player-pause').setAttribute('aria-label',s==='playing'?'Пауза':'Слушать');$('story-play').textContent=s==='playing'?'Ⅱ Пауза':s==='paused'?'▶ Продолжить':'▶ Слушать рассказ';$('player-state').textContent=s==='playing'?'Слушаем · '+(state.current?.title||'История'):s==='paused'?'На паузе':s==='finished'?'Рассказ завершён':'Готово к прослушиванию'},
 onBlock:block=>{state.current=block;document.querySelectorAll('.story-block').forEach(el=>el.classList.toggle('active',el.dataset.block===block.id))},
 onComplete:block=>{
   if(block.id.startsWith('answer-'))return;
   if(!state.heard.includes(block.id))state.heard.push(block.id);
   if(state.selected){history=saveEntry(history,state.selected);persist('waystory-history',history);renderLibrary()}
   updateProgress();document.querySelectorAll('.story-block').forEach(el=>el.classList.toggle('heard',state.heard.includes(el.dataset.block)));
 },onError:message
});
function updateProgress(){const all=state.selected?.blocks?.filter(b=>b.depth<=state.depth)||[];const count=all.filter(b=>state.heard.includes(b.id)).length;$('player-progress').style.width=(all.length?100*count/all.length:0)+'%';$('player-progress-label').textContent=count+' из '+all.length+' фрагментов'}
function renderStory(){
 const p=state.selected;if(!p)return;
 $('story-title').textContent=p.title;$('reopen-story').textContent=p.title;$('story-category').textContent=p.category||'История места';$('story-address').textContent=p.address||'Материалы русской Википедии';$('story-kind').textContent=p.demo?'ГОТОВАЯ ИСТОРИЯ · РЕЖИМ ЗНАКОМСТВА':p.aiGenerated?'ИИ-РАССКАЗ ПО ИСТОЧНИКУ':'ТЕКСТ ИЗ ВИКИПЕДИИ';
 showArt($('story-art'),p);updateSaveButton();renderText();
 const url=safeSourceUrl(p.source);$('story-source').hidden=!url;if(url)$('story-source').href=url;
 $('story-source-note').textContent=p.demo?'Подготовленный пример на основе статьи. Иллюстрация стилизована. Это не ответ ИИ в реальном времени.':p.aiGenerated?'Рассказ создан ИИ по материалу статьи. Проверьте важные детали в источнике.':'Озвучивается текст статьи, разделённый на фрагменты. Доступен по лицензии статьи; авторы и история изменений — в источнике. Это не ответ ИИ.';
 $('question-chips').replaceChildren(...(p.questions||[]).map(q=>{const b=document.createElement('button');b.textContent=q.question;b.onclick=()=>ask(q.question,q.answer);return b}));
 $('question-input').disabled=!state.ai;$('send-question').disabled=!state.ai;$('voice-question').disabled=!state.ai;
 $('question-input').placeholder=state.ai?'Что вам интересно об этом месте?':'Свободный вопрос — после подключения ИИ';
 $('question-note').textContent=state.ai?'Ответ опирается на статью и контекст рассказа.':'В деморежиме доступны готовые вопросы выше.';
}
function renderText(){const p=state.selected;if(!p)return;const blocks=p.blocks.filter(b=>b.depth<=state.depth);$('story-text').replaceChildren(...blocks.map(b=>{const el=document.createElement('section');el.className='story-block';el.dataset.block=b.id;el.classList.toggle('heard',state.heard.includes(b.id));el.classList.toggle('active',state.current?.id===b.id);const title=document.createElement('h3');title.textContent=b.title;const text=document.createElement('p');text.textContent=b.text;el.append(title,text);return el}));const words=blocks.reduce((n,b)=>n+b.text.split(/\s+/).length,0);$('duration-label').textContent='≈ '+Math.max(1,Math.round(words/140))+' мин';document.querySelectorAll('[data-depth]').forEach(b=>{b.classList.toggle('selected',+b.dataset.depth===state.depth);b.setAttribute('aria-pressed',String(+b.dataset.depth===state.depth))});updateProgress()}
async function selectPlace(place){
 const token=placeEpoch.next();answerEpoch.next();answerController?.abort();placeController?.abort();placeController=new AbortController();narrator.stop();state.selected=null;state.heard=[];state.current=null;state.answer=false;
 $('story-title').textContent=place.title;$('story-kind').textContent='ЗАГРУЖАЕМ ИСТОРИЮ';$('story-text').replaceChildren();$('answer').hidden=true;$('continue-story').hidden=true;$('story-play').disabled=true;$('story-restart').disabled=true;$('story-save').disabled=true;$('question-panel').hidden=true;$('story-source').hidden=true;$('story-source-note').textContent='';$('story-address').textContent='';$('story-category').textContent='';showArt($('story-art'),place);message('');openDialog('story-dialog');$('player').hidden=true;document.body.classList.remove('has-player');
 try{
   let p=await loadPlace(place,placeController.signal);if(!placeEpoch.isCurrent(token))return;
   if(state.ai&&!p.demo){try{const result=await aiRequest({action:'story',place:{title:p.title,source:p.source,text:p.sourceText||p.blocks.map(b=>b.text).join('\n')}},placeController.signal);if(result.blocks?.length)p={...p,blocks:result.blocks,aiGenerated:true}}catch(e){if(e.name==='AbortError')throw e;message('ИИ-рассказ недоступен. Можно слушать исходный текст Википедии.')}}
   if(!placeEpoch.isCurrent(token))return;state.selected=p;$('story-play').disabled=false;$('story-restart').disabled=false;$('story-save').disabled=false;$('question-panel').hidden=false;renderStory();
 }catch(e){if(e.name==='AbortError')return;if(placeEpoch.isCurrent(token))message(e.message||'Не удалось загрузить рассказ. Попробуйте другое место.')}
}
function showPlayer(){if(!state.selected)return;$('player').hidden=false;document.body.classList.add('has-player')}
function play(){if(!state.selected)return;if(narrator.state==='playing'){narrator.pause();return}if(narrator.state==='paused'){narrator.resume();return}state.answer=false;let queue=buildQueue(state.selected,state.depth,state.heard);if(!queue.length){state.heard=[];queue=buildQueue(state.selected,state.depth,[]);renderText()}message('');showPlayer();narrator.play(queue)}
function setDepth(depth){if(!state.selected)return;answerEpoch.next();answerController?.abort();const playing=narrator.state==='playing';const wasPaused=narrator.state==='paused';narrator.stop();state.answer=false;state.depth=depth;state.current=null;renderText();const queue=buildQueue(state.selected,depth,state.heard);if(!queue.length){message('Главное вы уже услышали. Можно выбрать «Подробнее» или начать сначала.');return}message(wasPaused?'Глубина изменена. Нажмите «Слушать рассказ», когда будете готовы.':'');if(playing){showPlayer();narrator.play(queue)}}
document.querySelectorAll('[data-depth]').forEach(b=>b.onclick=()=>setDepth(+b.dataset.depth));$('story-play').onclick=play;$('player-pause').onclick=play;
$('story-restart').onclick=()=>{if(!state.selected)return;narrator.stop();state.heard=[];state.current=null;renderText();play()};
$('story-save').onclick=()=>{if(state.selected)toggleSave(state.selected)};
$('reopen-story').onclick=()=>openDialog('story-dialog');
$('player-stop').onclick=()=>{narrator.stop();state.current=null;$('player').hidden=true;document.body.classList.remove('has-player')};
$('rate').oninput=e=>{narrator.rate=Number(e.target.value);$('rate-value').textContent=narrator.rate.toFixed(2).replace(/0$/,'')+'×'};
async function aiRequest(payload,signal){const r=await fetch('/api/guide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});let data;try{data=await r.json()}catch{throw new Error('ИИ пока не подключён. Попробуйте готовые вопросы.')}if(!r.ok)throw new Error(data.error||'Не удалось получить ответ.');return data}
async function ask(question,prepared){
 if(!state.selected)return;const current=state.selected;const token=answerEpoch.next();answerController?.abort();answerController=new AbortController();narrator.stop();state.answer=true;$('answer').hidden=false;$('answer').textContent='Готовим ответ…';$('continue-story').hidden=false;
 try{const text=prepared||(await aiRequest({action:'question',question,place:{title:current.title,source:current.source,text:current.sourceText||current.blocks.map(b=>b.text).join('\n')},heard:current.blocks.filter(b=>state.heard.includes(b.id)).map(b=>b.text)},answerController.signal)).text;
 if(!answerEpoch.isCurrent(token)||state.selected?.id!==current.id)return;
 const heading=document.createElement('strong');heading.textContent=question;const p=document.createElement('span');p.textContent=text;const listen=document.createElement('button');listen.textContent='▶ Слушать ответ';listen.onclick=()=>{showPlayer();narrator.play([{id:'answer-'+Date.now(),title:'Ответ на вопрос',text}])};$('answer').replaceChildren(heading,p,listen);$('question-input').value='';
 }catch(e){if(e.name!=='AbortError'&&answerEpoch.isCurrent(token))$('answer').textContent=e.message||'Не удалось получить ответ.'}
}
$('question-form').onsubmit=e=>{e.preventDefault();const question=$('question-input').value.trim();if(!state.ai){message('Свободные вопросы появятся после подключения ИИ.');return}if(question)ask(question)};
$('continue-story').onclick=()=>{if(!state.selected)return;answerEpoch.next();answerController?.abort();state.answer=false;narrator.stop();const queue=buildQueue(state.selected,state.depth,state.heard);if(queue.length){showPlayer();narrator.play(queue)}else message('Основной рассказ уже завершён. Выберите «Подробнее» или другое место.')};
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!SpeechRecognition)$('voice-question').hidden=true;
$('voice-question').onclick=()=>{if(!SpeechRecognition||!state.ai)return;narrator.pause();recognition?.abort();recognition=new SpeechRecognition();recognition.lang='ru-RU';recognition.interimResults=false;recognition.onresult=e=>{const text=e.results[0][0].transcript;$('question-input').value=text;message('Распознано. Отправьте вопрос стрелкой или измените текст.')};recognition.onerror=()=>message('Не удалось распознать речь. Введите вопрос текстом.');recognition.onend=()=>{$('voice-question').textContent='♩'};$('voice-question').textContent='●';try{recognition.start()}catch{message('Микрофон недоступен. Введите вопрос текстом.')}};
$('story-dialog').addEventListener('close',()=>recognition?.abort());
function resetPlaces(){searchEpoch.next();searchController?.abort();state.places=PLACES;$('section-title').textContent='Прогулка по Петербургу ↗';$('location-label').textContent='ДЛЯ ПЕРВОГО ЗНАКОМСТВА';$('search-input').value='';$('reset-places').hidden=true;setStatus('Три места, чтобы попробовать гида. Это примеры, а не ваша геопозиция.');renderPlaces()}
$('reset-places').onclick=resetPlaces;
$('search-form').onsubmit=async e=>{e.preventDefault();const query=$('search-input').value.trim();if(!query){resetPlaces();return}const token=searchEpoch.next();searchController?.abort();searchController=new AbortController();setStatus('Ищем «'+query+'» в Википедии…');try{const results=await searchPlaces(query,searchController.signal);if(!searchEpoch.isCurrent(token))return;state.places=results;$('location-label').textContent='ИССЛЕДУЙТЕ ЛЮБОЕ МЕСТО';$('section-title').textContent='Результаты поиска';$('reset-places').hidden=false;setStatus('Найдено: '+results.length+'. Уточните объект по названию и источнику.');renderPlaces()}catch(e){if(e.name!=='AbortError'&&searchEpoch.isCurrent(token))setStatus(e.message,true)}};
$('locate').onclick=()=>{
 if(!navigator.geolocation){setStatus('Геолокация недоступна. Найдите место по названию.',true);return}
 const token=searchEpoch.next();searchController?.abort();searchController=new AbortController();const signal=searchController.signal;setStatus('Определяем местоположение…');$('locate').disabled=true;
 navigator.geolocation.getCurrentPosition(async pos=>{if(!searchEpoch.isCurrent(token)){$('locate').disabled=false;return}setStatus('Ищем места в радиусе 1,5 км…');try{const results=await nearbyPlaces(pos.coords.latitude,pos.coords.longitude,signal);if(!searchEpoch.isCurrent(token))return;state.places=results;$('section-title').textContent='Рядом с вами';$('location-label').textContent='В РАДИУСЕ 1,5 КМ';$('reset-places').hidden=false;setStatus('Места из Википедии. Погрешность координат — около '+Math.round(pos.coords.accuracy)+' м.');renderPlaces()}catch(e){if(e.name!=='AbortError'&&searchEpoch.isCurrent(token))setStatus(e.message,true)}finally{$('locate').disabled=false}},err=>{$('locate').disabled=false;if(searchEpoch.isCurrent(token))setStatus(err.code===1?'Доступ к местоположению запрещён. Разрешите его в настройках сайта или воспользуйтесь поиском.':'Не удалось определить местоположение. Попробуйте на открытом месте или введите название.',true)},{enableHighAccuracy:false,timeout:15000,maximumAge:60000});
};
$('photo-open').onclick=()=>openDialog('photo-dialog');
$('photo-input').onchange=e=>{const file=e.target.files[0];if(!file)return;const error=validateImage(file);if(error){$('photo-note').textContent=error;return}if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);state.photo=file;state.photoUrl=URL.createObjectURL(file);$('photo-preview').src=state.photoUrl;$('photo-preview').hidden=false;$('photo-placeholder').hidden=true;$('photo-result').hidden=true;$('photo-note').textContent=state.ai?'Фото отправится на обработку только после нажатия кнопки. При сомнении гид попросит уточнение.':'Фото выбрано и остаётся в браузере. Для распознавания нужно подключить ИИ.';$('identify-photo').disabled=!state.ai};
$('identify-photo').onclick=async()=>{if(!state.ai||!state.photo)return;$('identify-photo').disabled=true;$('photo-note').textContent='Рассматриваем фото…';const selectedPhoto=state.photo;try{const image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(selectedPhoto)});const result=await aiRequest({action:'identify',image,context:$('photo-context').value.trim()});if(state.photo!==selectedPhoto)return;$('photo-result').hidden=false;const p=document.createElement('p');p.textContent=result.text;$('photo-result').replaceChildren(p);if(result.query){const b=document.createElement('button');b.className='button secondary';b.textContent='Найти это место в источниках ↗';b.onclick=()=>{$('photo-dialog').close();tab('explore');$('search-input').value=result.query;$('search-form').requestSubmit()};$('photo-result').append(b)}$('photo-note').textContent='Это предположение по изображению. Проверьте название по источникам.'}catch(e){$('photo-note').textContent=e.message||'Не удалось обработать фото.'}finally{$('identify-photo').disabled=!state.ai||!state.photo}};
async function config(){try{const r=await fetch('/api/config',{headers:{Accept:'application/json'}});if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))return;const c=await r.json();state.ai=c.ai===true;if(state.ai){$('mode-note').querySelector('p').textContent='ИИ подключён. Можно распознавать места по фото и задавать свои вопросы по ходу рассказа.';$('photo-note').textContent='Выберите фото. Оно отправится только после нажатия «Узнать».';$('identify-photo').disabled=!state.photo;if(state.selected)renderStory()}}catch{/* Static hosting intentionally has no AI server. */}}
renderPlaces();updateSaveButton();config();
window.addEventListener('pagehide',()=>{narrator.stop();recognition?.abort();placeController?.abort();answerController?.abort();searchController?.abort();if(state.photoUrl)URL.revokeObjectURL(state.photoUrl)});
