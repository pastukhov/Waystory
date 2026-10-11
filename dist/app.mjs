import {LANGUAGE,LANGUAGE_TAG,STORY_VERSION,canReuseStory} from './language.mjs';
import {t,localizeDocument,durationLabel,availableDepths,clampDepth,sourceLanguage,canListen,safeError,speechError,cardMetadataKey} from './i18n.mjs';
import {illustration} from './art.mjs';
import {buildQueue,restoreLibrary,saveEntry,validateImage,safeSourceUrl,createEpoch} from './core.mjs';
import {CloudNarrator} from './speech.mjs';
import {requestGuide} from './ai-client.mjs';
import {searchPlaces,nearbyPlaces,loadPlace} from './wiki.mjs';

localizeDocument();
const $=id=>document.getElementById(id);
const state={user:null,authEnabled:false,tab:'explore',places:[],selected:null,heard:[],depth:1,current:null,ai:false,vision:false,answer:false,photo:null,photoUrl:null};
const placeEpoch=createEpoch(),searchEpoch=createEpoch(),answerEpoch=createEpoch(),photoEpoch=createEpoch();
let discoveryToken=0;
const libraryMetadata=new Map(),libraryAttempts=new Set();
function nextDiscovery(){return discoveryToken=searchEpoch.next()}
let placeController,searchController,answerController,photoController,toastTimer,recognition;
const read=key=>{try{return restoreLibrary(localStorage.getItem(key))}catch{return []}};
let saved=read('waystory-saved'),history=read('waystory-history');
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{toast(t('Не удалось сохранить на устройстве. Возможно, хранилище переполнено.'))}}
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
 const translated=libraryMetadata.get(cardMetadataKey(place,LANGUAGE));
 if(translated&&!(place.aiGenerated&&place.storyLanguage===LANGUAGE))place={...place,originalTitle:place.originalTitle||place.title,originalSubtitle:place.originalSubtitle??place.subtitle??'',...translated,cardLanguage:LANGUAGE};
 const c=document.createElement('article');c.className='place-card';
 c.innerHTML='<div class="card-art"></div><button class="card-heart" aria-label="">♡</button><div class="card-body"><div class="card-kicker"><span></span><span></span></div><h3 class="card-title"></h3><p class="card-subtitle"></p><button class="card-listen"><span class="play-small">▶</span><span class="card-open-label"></span><span>↗</span></button></div>';
 c.querySelector('.card-open-label').textContent=t('Открыть рассказ');
 showArt(c.querySelector('.card-art'),place);
 if(place.tag){const tag=document.createElement('span');tag.className='card-badge';tag.textContent=metadata(place.tag);c.querySelector('.card-art').append(tag)}
 c.querySelector('.card-title').textContent=place.title;
 c.querySelector('.card-subtitle').textContent=place.aiGenerated&&place.storyLanguage===LANGUAGE&&place.cardLanguage!==LANGUAGE?t('У каждого места своя история'):metadata(place.subtitle)||place.address||t('У каждого места своя история');
 if((place.aiGenerated?place.storyLanguage:place.cardLanguage||place.lang||'ru')!==LANGUAGE){const source=document.createElement('small');source.className='source-note';source.textContent=ui('source')+': '+(place.aiGenerated?place.storyLanguage||ui('unknown'):place.lang||'ru');c.querySelector('.card-body').append(source)}
 c.querySelector('.card-kicker span').textContent=metadata(place.category)||t('Место');
 c.querySelector('.card-kicker span:last-child').textContent=place.distance!=null?(place.distance<1000?place.distance+t(' м'):(place.distance/1000).toFixed(1)+t(' км')):place.demo?t('ПРИМЕР'):'';
 const heart=c.querySelector('.card-heart');const isSaved=saved.some(p=>p.id===place.id);heart.textContent=isSaved?'♥':'♡';heart.classList.toggle('saved',isSaved);heart.setAttribute('aria-label',isSaved?t('Убрать из сохранённого'):t('Сохранить место'));heart.setAttribute('aria-pressed',String(isSaved));heart.onclick=()=>toggleSave(place);
 c.querySelector('.card-listen').onclick=()=>selectPlace(place);
 return c;
}
function renderPlaces(){const grid=$('places');grid.replaceChildren(...state.places.map(card));if(!state.places.length&&!$('reset-places').hidden){const p=document.createElement('p');p.className='muted';p.textContent=state.emptyNearby?t('В доступных статьях Википедии в радиусе 10 км мест не найдено. Попробуйте поиск по названию или сфотографируйте объект.'):t('Ничего не нашлось. Попробуйте уточнить название или выбрать другой город.');grid.append(p)}}
function toggleSave(place){const existing=saved.some(p=>p.id===place.id);saved=existing?saved.filter(p=>p.id!==place.id):saveEntry(saved,place);persist('waystory-saved',saved);renderPlaces();renderLibrary();updateSaveButton();toast(existing?t('Место убрано из сохранённого'):t('Место сохранено на этом устройстве'))}
function updateSaveButton(){const yes=saved.some(p=>p.id===state.selected?.id);$('story-save').textContent=yes?'♥':'♡';$('story-save').classList.toggle('saved',yes);$('story-save').setAttribute('aria-pressed',String(yes));$('story-save').setAttribute('aria-label',yes?t('Убрать из сохранённого'):t('Сохранить место'));$('saved-count').textContent=String(saved.length)}
function renderLibrary(){updateSaveButton();if(state.tab==='explore')return;const entries=state.tab==='saved'?saved:history;$('library-grid').replaceChildren(...entries.map(card));$('library-empty').hidden=entries.length>0;$('clear-history').hidden=state.tab!=='history'||!entries.length;$('library-title').textContent=state.tab==='saved'?t('Сохранённое'):t('История прогулок');$('library-description').textContent=state.tab==='saved'?t('Места, к которым хочется вернуться. Сохраняются на этом устройстве.'):t('Здесь появляются места после первого прослушанного фрагмента.');$('library-empty').querySelector('h3').textContent=state.tab==='saved'?t('Здесь появятся ваши места'):t('Здесь появятся услышанные истории');$('library-empty').querySelector('p').textContent=state.tab==='saved'?t('Нажмите на сердечко рядом с интересным местом.'):t('Откройте место и прослушайте первый фрагмент.');translateLibrary()}
function tab(name){state.tab=name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$('explore-view').hidden=name!=='explore';$('library-view').hidden=name==='explore';renderLibrary();window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));$('back-explore').onclick=()=>tab('explore');
$('clear-history').onclick=()=>{if(!window.confirm(t('Удалить историю прослушивания с этого устройства?')))return;history=[];persist('waystory-history',history);renderLibrary()};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
for(const id of ['about-open','mode-about','footer-about'])$(id).onclick=()=>openDialog('about-dialog');
$('settings-open').onclick=()=>openDialog('settings-dialog');
const authFailed=new URL(location.href).searchParams.has('auth_error');
function renderAccount(data){
 state.user=data.user;state.authEnabled=data.enabled;
 $('account-open').textContent=t(data.user?'Аккаунт':'Войти');
 $('account-email').textContent=data.user?.email||'';
 $('account-status').textContent=data.user?data.user.name||t('Аккаунт'):t(authFailed?'Не удалось войти через Google. Повторите вход или проверьте приглашение.':data.enabled?'Пилот доступен по приглашению. Войдите разрешённым Google-аккаунтом.':'Вход через Google пока не настроен.');
 $('google-login').hidden=!!data.user||!data.enabled;$('account-logout').hidden=!data.user;
 $('account-usage').replaceChildren();
 if(data.user&&data.usage){for(const [kind,label] of [['ai','Запросы ИИ сегодня'],['tts','Фрагменты озвучки сегодня']]){const p=document.createElement('p');p.textContent=t(label)+': '+data.usage[kind].used+' / '+data.usage[kind].limit;$('account-usage').append(p)}const note=document.createElement('p');note.className='small muted';note.textContent=t('Лимиты обновляются в полночь UTC. Неудачные запросы тоже учитываются.');$('account-usage').append(note)}
}
async function loadAccount(){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{const r=await fetch('/api/session',{signal:controller.signal});if(!r.ok)throw new Error();const data=await r.json();renderAccount(data);return data}
 catch{state.user=null;state.authEnabled=false;$('google-login').hidden=true;$('account-status').textContent=t('Не удалось загрузить аккаунт. Повторите попытку.');return null}finally{clearTimeout(timer)}
}
$('account-open').onclick=()=>{openDialog('account-dialog');loadAccount()};
$('account-logout').onclick=async()=>{
 $('account-logout').disabled=true;
 try{const r=await fetch('/auth/logout',{method:'POST'});if(!r.ok)throw new Error();narrator.stop();location.reload()}
 catch{$('account-status').textContent=t('Не удалось выйти. Повторите попытку.');$('account-logout').disabled=false}
};
if(new URL(location.href).searchParams.has('auth_error')){openDialog('account-dialog');$('account-status').textContent=t('Не удалось войти через Google. Повторите вход или проверьте приглашение.');const url=new URL(location.href);url.searchParams.delete('auth_error');window.history.replaceState(null,'',url.pathname+url.search+url.hash)}
const narrator=new CloudNarrator({
 onState:s=>{document.body.classList.toggle('playing',s==='playing');$('player-pause').textContent=['playing','loading'].includes(s)?'Ⅱ':'▶';$('player-pause').setAttribute('aria-label',['playing','loading'].includes(s)?t('Пауза'):t('Слушать'));$('story-play').textContent=['playing','loading'].includes(s)?t('Ⅱ Пауза'):s==='paused'?t('▶ Продолжить'):t('▶ Слушать рассказ');$('player-state').textContent=s==='loading'?t('Загружаем голос…'):s==='playing'?t('Слушаем · ')+(state.current?.title||t('История')):s==='paused'?t('На паузе'):s==='finished'?t('Рассказ завершён'):t('Готово к прослушиванию')},
 onBlock:block=>{state.current=block;document.querySelectorAll('.story-block').forEach(el=>el.classList.toggle('active',el.dataset.block===block.id))},
 onComplete:block=>{
   if(block.id.startsWith('answer-'))return;
   if(!state.heard.includes(block.id))state.heard.push(block.id);
   if(state.selected){history=saveEntry(history,state.selected);persist('waystory-history',history);renderLibrary()}
   updateProgress();document.querySelectorAll('.story-block').forEach(el=>el.classList.toggle('heard',state.heard.includes(el.dataset.block)));
 },onError:error=>message(speechError(error))
});
narrator.language=LANGUAGE;
function updateProgress(){const all=state.selected?.blocks?.filter(b=>b.depth<=state.depth)||[];const count=all.filter(b=>state.heard.includes(b.id)).length;$('player-progress').style.width=(all.length?100*count/all.length:0)+'%';$('player-progress-label').textContent=count+t(' из ')+all.length+t(' фрагментов')}
function renderStory(){
 const p=state.selected;if(!p)return;
 $('story-title').textContent=p.title;$('reopen-story').textContent=p.title;$('story-category').textContent=metadata(p.category)||t('История места');$('story-address').textContent=p.address&&(p.lang||(/https:\/\/([a-z]+)\.wikipedia\.org/.exec(p.source||'')?.[1]))===LANGUAGE?p.address:t('Материалы Википедии');$('story-kind').textContent=p.demo?t('ГОТОВАЯ ИСТОРИЯ · РЕЖИМ ЗНАКОМСТВА'):p.aiGenerated?t('ИИ-РАССКАЗ ПО ИСТОЧНИКУ'):t('ТЕКСТ ИЗ ВИКИПЕДИИ');
 showArt($('story-art'),p);updateSaveButton();renderText();
 $('story-detail-notice').hidden=!(p.detailLimited||availableDepths(p.blocks).length<3);$('story-detail-notice').textContent=ui('limited');
 $('story-language-notice').hidden=canListen(p);$('story-language-notice').textContent=ui('original')+' ('+(sourceLanguage(p)||ui('unknown'))+'). '+ui('noVoice');
 const url=safeSourceUrl(p.source);$('story-source').hidden=!url;if(url)$('story-source').href=url;
 $('story-source-note').textContent=p.demo?t('Подготовленный пример на основе статьи. Иллюстрация стилизована. Это не ответ ИИ в реальном времени.'):p.aiGenerated?t('Рассказ создан ИИ по материалу статьи. Проверьте важные детали в источнике.'):t('Озвучивается текст статьи, разделённый на фрагменты. Доступен по лицензии статьи; авторы и история изменений — в источнике. Это не ответ ИИ.');
 $('question-chips').replaceChildren(...((p.lang||'ru')===LANGUAGE?(p.questions||[]):[]).map(q=>{const b=document.createElement('button');b.textContent=q.question;b.onclick=()=>ask(q.question,state.ai?undefined:q.answer);return b}));
 $('question-input').disabled=!state.ai;$('send-question').disabled=!state.ai;$('voice-question').disabled=!state.ai;
 $('question-input').placeholder=state.ai?t('Что вам интересно об этом месте?'):t('Свободный вопрос — после подключения ИИ');
 $('question-note').textContent=state.ai?t('Ответ опирается на статью и контекст рассказа.'):t('В деморежиме доступны готовые вопросы выше.');
}
function renderText(){const p=state.selected;if(!p)return;state.depth=clampDepth(p.blocks,state.depth);const blocks=p.blocks.filter(b=>b.depth<=state.depth);$('story-text').replaceChildren(...blocks.map(b=>{const el=document.createElement('section');el.className='story-block';el.dataset.block=b.id;el.classList.toggle('heard',state.heard.includes(b.id));el.classList.toggle('active',state.current?.id===b.id);const title=document.createElement('h3');title.textContent=metadata(b.title);const text=document.createElement('p');text.textContent=b.text;el.append(title,text);return el}));$('duration-label').textContent=durationLabel(p.blocks,state.depth);document.querySelectorAll('[data-depth]').forEach(b=>{const depth=+b.dataset.depth;b.disabled=!availableDepths(p.blocks).includes(depth);b.classList.toggle('selected',depth===state.depth);b.setAttribute('aria-pressed',String(depth===state.depth));if(b.closest('.depth-switch'))b.textContent=t(['Коротко','Обычно','Подробно'][depth])+' · '+durationLabel(p.blocks,depth)});updateProgress()}
async function selectPlace(place){
 const token=placeEpoch.next();answerEpoch.next();answerController?.abort();placeController?.abort();placeController=new AbortController();narrator.stop();state.selected=null;state.heard=[];state.current=null;state.answer=false;
 $('story-detail-notice').hidden=true;$('story-language-notice').hidden=true;$('story-title').textContent=place.title;$('story-kind').textContent=t('ЗАГРУЖАЕМ ИСТОРИЮ');$('story-text').replaceChildren();$('answer').hidden=true;$('continue-story').hidden=true;$('story-play').disabled=true;$('story-restart').disabled=true;$('story-save').disabled=true;$('question-panel').hidden=true;$('story-source').hidden=true;$('story-source-note').textContent='';$('story-address').textContent='';$('story-category').textContent='';showArt($('story-art'),place);message('');openDialog('story-dialog');$('player').hidden=true;document.body.classList.remove('has-player');
 try{
   let p=await loadPlace(place,placeController.signal);if(!placeEpoch.isCurrent(token))return;
   await configReady;if(!placeEpoch.isCurrent(token)||placeController.signal.aborted)return;
   if(state.ai&&!canReuseStory(p,LANGUAGE)){try{const sourceText=p.sourceText||p.blocks.map(b=>b.text).join('\n');message(t('ИИ готовит рассказ…'));const result=await aiRequest({action:'story',place:{title:p.originalTitle||p.title,source:p.source,text:sourceText}},placeController.signal);if(result.blocks?.length&&result.language===LANGUAGE&&result.storyVersion===STORY_VERSION){p={...p,title:result.title||p.title,originalTitle:p.originalTitle||p.title,blocks:result.blocks,sourceText,storyLanguage:result.language,cardLanguage:LANGUAGE,subtitle:result.blocks[0].text.slice(0,180),storyVersion:result.storyVersion,detailLimited:result.detailLimited,aiGenerated:true,demo:false};if(placeEpoch.isCurrent(token))message('')}else throw new Error('Invalid story response')}catch(e){if(e.name==='AbortError')throw e;if(placeEpoch.isCurrent(token))message(t('ИИ-рассказ недоступен.'))}}
   if(!placeEpoch.isCurrent(token))return;state.selected=p;$('story-play').disabled=!canListen(p);$('story-restart').disabled=!canListen(p);$('story-save').disabled=false;$('question-panel').hidden=false;renderStory();
 }catch(e){if(e.name==='AbortError')return;if(placeEpoch.isCurrent(token))message(safeError(e,'Не удалось загрузить рассказ. Попробуйте другое место.'))}
}
function showPlayer(){if(!state.selected)return;$('player').hidden=false;document.body.classList.add('has-player')}
function play(){if(!state.user){openDialog('account-dialog');loadAccount();return;}if(!state.selected||!canListen(state.selected))return;if(['playing','loading'].includes(narrator.state)){narrator.pause();return}if(narrator.state==='paused'){narrator.resume();return}state.answer=false;let queue=buildQueue(state.selected,state.depth,state.heard);if(!queue.length){state.heard=[];queue=buildQueue(state.selected,state.depth,[]);renderText()}message('');showPlayer();narrator.play(queue)}
function setDepth(depth){if(!state.selected||!availableDepths(state.selected.blocks).includes(depth))return;answerEpoch.next();answerController?.abort();const playing=['playing','loading'].includes(narrator.state);const wasPaused=narrator.state==='paused';narrator.stop();state.answer=false;state.depth=depth;state.current=null;renderText();const queue=buildQueue(state.selected,depth,state.heard);if(!queue.length){message(t('Главное вы уже услышали. Можно выбрать «Подробнее» или начать сначала.'));return}message(wasPaused?t('Глубина изменена. Нажмите «Слушать рассказ», когда будете готовы.'):'');if(playing&&canListen(state.selected)){showPlayer();narrator.play(queue)}}
document.querySelectorAll('[data-depth]').forEach(b=>b.onclick=()=>setDepth(+b.dataset.depth));$('story-play').onclick=play;$('player-pause').onclick=play;
$('story-restart').onclick=()=>{if(!state.selected)return;narrator.stop();state.heard=[];state.current=null;renderText();play()};
$('story-save').onclick=()=>{if(state.selected)toggleSave(state.selected)};
$('reopen-story').onclick=()=>openDialog('story-dialog');
$('player-stop').onclick=()=>{narrator.stop();state.current=null;$('player').hidden=true;document.body.classList.remove('has-player')};
$('rate').oninput=e=>{narrator.rate=Number(e.target.value);$('rate-value').textContent=narrator.rate.toFixed(2).replace(/0$/,'')+'×'};
async function aiRequest(payload,signal){try{return await requestGuide({...payload,language:LANGUAGE},{signal})}catch(e){if(e.status===401){state.user=null;state.ai=false;state.vision=false;openDialog('account-dialog');loadAccount()}throw e}}
async function ask(question,prepared){
 if(!state.selected)return;const current=state.selected;const token=answerEpoch.next();answerController?.abort();answerController=new AbortController();narrator.stop();state.answer=true;$('answer').hidden=false;$('answer').textContent=t('Готовим ответ…');$('continue-story').hidden=false;
 try{const text=prepared||(await aiRequest({action:'question',question,place:{title:current.title,source:current.source,text:current.sourceText||current.blocks.map(b=>b.text).join('\n')},heard:current.blocks.filter(b=>state.heard.includes(b.id)).map(b=>b.text)},answerController.signal)).text;
 if(!answerEpoch.isCurrent(token)||state.selected?.id!==current.id)return;
 const heading=document.createElement('strong');heading.textContent=question;const p=document.createElement('span');p.textContent=text;const listen=document.createElement('button');listen.textContent=t('▶ Слушать ответ');listen.onclick=()=>{showPlayer();narrator.play([{id:'answer-'+Date.now(),title:t('Ответ на вопрос'),text}])};$('answer').replaceChildren(heading,p,listen);$('question-input').value='';
 }catch(e){if(e.name!=='AbortError'&&answerEpoch.isCurrent(token))$('answer').textContent=safeError(e,'Не удалось получить ответ.')}
}
$('question-form').onsubmit=e=>{e.preventDefault();const question=$('question-input').value.trim();if(!state.ai){message(t('Свободные вопросы появятся после подключения ИИ.'));return}if(question)ask(question)};
$('continue-story').onclick=()=>{if(!state.selected||!canListen(state.selected))return;answerEpoch.next();answerController?.abort();state.answer=false;narrator.stop();const queue=buildQueue(state.selected,state.depth,state.heard);if(queue.length){showPlayer();narrator.play(queue)}else message(t('Основной рассказ уже завершён. Выберите «Подробнее» или другое место.'))};
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!SpeechRecognition)$('voice-question').hidden=true;
$('voice-question').onclick=()=>{if(!SpeechRecognition||!state.ai)return;narrator.pause();recognition?.abort();recognition=new SpeechRecognition();recognition.lang=LANGUAGE_TAG;recognition.interimResults=false;recognition.onresult=e=>{const text=e.results[0][0].transcript;$('question-input').value=text;message(t('Распознано. Отправьте вопрос стрелкой или измените текст.'))};recognition.onerror=()=>message(t('Не удалось распознать речь. Введите вопрос текстом.'));recognition.onend=()=>{$('voice-question').textContent='♩'};$('voice-question').textContent='●';try{recognition.start()}catch{message(t('Микрофон недоступен. Введите вопрос текстом.'))}};
$('story-dialog').addEventListener('close',()=>recognition?.abort());
function resetPlaces(){nextDiscovery();searchController?.abort();state.places=[];state.emptyNearby=false;$('section-title').textContent=t('Найдите своё место');$('location-label').textContent=t('ВАШ ГОРОД, ВАШИ ИСТОРИИ');$('search-input').value='';$('reset-places').hidden=true;setStatus(t('Нажмите «Что рядом со мной» или введите город или название места.'));renderPlaces()}
$('reset-places').onclick=resetPlaces;
$('search-form').onsubmit=async e=>{e.preventDefault();const query=$('search-input').value.trim();if(!query){resetPlaces();return}const token=nextDiscovery();searchController?.abort();searchController=new AbortController();setStatus(t('Ищем «')+query+t('» в Википедии…'));try{const results=await searchPlaces(query,searchController.signal,LANGUAGE);if(!searchEpoch.isCurrent(token))return;state.places=results;translateDiscovery(token,searchController.signal);state.emptyNearby=false;$('location-label').textContent=t('ИССЛЕДУЙТЕ ЛЮБОЕ МЕСТО');$('section-title').textContent=t('Результаты поиска');$('reset-places').hidden=false;setStatus(t('Найдено: ')+results.length+t('. Уточните объект по названию и источнику.'));renderPlaces()}catch(e){if(e.name!=='AbortError'&&searchEpoch.isCurrent(token))setStatus(safeError(e,'Не удалось загрузить рассказ. Попробуйте другое место.'),true)}};
$('locate').onclick=()=>{
 if(!navigator.geolocation){setStatus(t('Геолокация недоступна. Найдите место по названию.'),true);return}
 const token=nextDiscovery();searchController?.abort();searchController=new AbortController();const signal=searchController.signal;setStatus(t('Определяем местоположение…'));$('locate').disabled=true;
 navigator.geolocation.getCurrentPosition(async pos=>{if(!searchEpoch.isCurrent(token)){$('locate').disabled=false;return}setStatus(t('Ищем места в радиусе 1,5 км…'));try{const results=await nearbyPlaces(pos.coords.latitude,pos.coords.longitude,signal,LANGUAGE);if(!searchEpoch.isCurrent(token))return;state.places=results.places;translateDiscovery(token,signal);state.emptyNearby=true;$('section-title').textContent=t('Рядом с вами');$('location-label').textContent=t('В РАДИУСЕ ')+(results.radius/1000).toLocaleString(LANGUAGE_TAG)+t(' КМ');$('reset-places').hidden=false;setStatus(t('Найдено: ')+results.places.length+t('. Радиус — ')+(results.radius/1000).toLocaleString(LANGUAGE_TAG)+t(' км. Точность геопозиции — около ')+Math.round(pos.coords.accuracy)+t(' м. Координаты: ')+pos.coords.latitude.toFixed(4)+', '+pos.coords.longitude.toFixed(4)+'.'+(results.partial?t(' Часть источников недоступна — попробуйте повторить поиск.'):''));renderPlaces()}catch(e){if(e.name!=='AbortError'&&searchEpoch.isCurrent(token))setStatus(safeError(e,'Не удалось загрузить рассказ. Попробуйте другое место.'),true)}finally{$('locate').disabled=false}},err=>{$('locate').disabled=false;if(searchEpoch.isCurrent(token))setStatus(err.code===1?t('Доступ к местоположению запрещён. Разрешите его в настройках сайта или воспользуйтесь поиском.'):t('Не удалось определить местоположение. Попробуйте на открытом месте или введите название.'),true)},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
};
$('photo-open').onclick=()=>openDialog('photo-dialog');
function cancelPhoto(){photoEpoch.next();photoController?.abort();$('identify-photo').disabled=!state.vision||!state.photo}
$('photo-input').onchange=e=>{
 const file=e.target.files[0];if(!file)return;cancelPhoto();
 if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);
 state.photo=null;state.photoUrl=null;$('photo-result').hidden=true;
 const error=validateImage(file);
 if(error){$('photo-note').textContent=t(error);$('photo-preview').hidden=true;$('photo-placeholder').hidden=false;$('identify-photo').disabled=true;return}
 state.photo=file;state.photoUrl=URL.createObjectURL(file);$('photo-preview').src=state.photoUrl;$('photo-preview').hidden=false;$('photo-placeholder').hidden=true;
 $('photo-note').textContent=state.vision?t('Фото отправится на обработку только после нажатия кнопки. При сомнении гид попросит уточнение.'):t('Фото выбрано и остаётся в браузере. Для распознавания нужно подключить ИИ.');
 $('identify-photo').disabled=!state.vision;
};
$('identify-photo').onclick=async()=>{
 if(!state.vision||!state.photo)return;
 photoController?.abort();photoController=new AbortController();const signal=photoController.signal;
 const token=photoEpoch.next(),selectedPhoto=state.photo;
 $('identify-photo').disabled=true;$('photo-note').textContent=t('Рассматриваем фото…');
 try{
  const image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(selectedPhoto)});
  if(!photoEpoch.isCurrent(token))return;
  const result=await aiRequest({action:'identify',image,context:$('photo-context').value.trim()},signal);
  if(!photoEpoch.isCurrent(token))return;
  $('photo-result').hidden=false;const p=document.createElement('p');p.textContent=result.text;$('photo-result').replaceChildren(p);
  if(result.query){const b=document.createElement('button');b.className='button secondary';b.textContent=t('Найти это место в источниках ↗');b.onclick=()=>{$('photo-dialog').close();tab('explore');$('search-input').value=result.query;$('search-form').requestSubmit()};$('photo-result').append(b)}
  $('photo-note').textContent=t('Это предположение по изображению. Проверьте название по источникам.');
 }catch(e){if(e.name!=='AbortError'&&photoEpoch.isCurrent(token))$('photo-note').textContent=safeError(e,'Не удалось обработать фото.')}
 finally{if(photoEpoch.isCurrent(token))$('identify-photo').disabled=!state.vision||!state.photo}
};
$('photo-dialog').addEventListener('close',()=>{cancelPhoto();$('photo-note').textContent=t('Фото отправится только после нажатия «Узнать».')});
async function config(){await loadAccount();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);try{const r=await fetch('/api/config',{headers:{Accept:'application/json'},signal:controller.signal});if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))return;const c=await r.json();state.ai=c.ai===true&&!!state.user;state.vision=c.vision===true&&!!state.user;narrator.cloud=c.tts===true&&!!state.user;if(!state.user){$('mode-note').querySelector('p').textContent=t('Поиск доступен без входа. ИИ-рассказы, вопросы и облачная озвучка — после входа через Google.');$('photo-note').textContent=t('Войдите через Google, чтобы пользоваться ИИ.');}if(narrator.cloud){$('voice-description').textContent=t('Облачный голос Yandex SpeechKit. Текст отправляется на озвучку при нажатии «Слушать». Готовые фрагменты временно сохраняются на сервере.');$('rate-description').textContent=t('Темп меняется сразу, без повторного синтеза.');}if(state.ai){$('mode-note').querySelector('p').textContent=t('ИИ-гид подключён: рассказы по источникам, вопросы и распознавание фото. Подробность можно менять во время прослушивания.');$('about-ai-title').textContent=t('ИИ-гид подключён');$('about-ai-description').textContent=t('Рассказы и ответы создаёт ИИ по переданному источнику. Фото помогает предположить название места. ')+(narrator.cloud?t('Озвучка — Yandex SpeechKit.'):t('Озвучка использует голос вашего устройства.'));$('photo-note').textContent=t('Выберите фото. Оно отправится только после нажатия «Узнать».');$('identify-photo').disabled=!state.vision||!state.photo;if(state.selected)renderStory();translateDiscovery(discoveryToken);translateLibrary()}}catch{/* Static hosting intentionally has no AI server. */}finally{clearTimeout(timer)}}
const configReady=config();
renderPlaces();updateSaveButton();
window.addEventListener('pagehide',()=>{narrator.stop();recognition?.abort();placeController?.abort();answerController?.abort();searchController?.abort();photoController?.abort();if(state.photoUrl)URL.revokeObjectURL(state.photoUrl)});

function ui(key){const values={limited:['В источнике недостаточно материала для всех уровней подробности. Доступны только уровни с новым содержанием.','The source has limited detail. Only levels with additional content are available.'],original:['Показан оригинальный текст источника','Showing the original source text'],noVoice:['Озвучка недоступна, пока рассказ не переведён на русский.','Listening is unavailable until the story is translated into English.'],unknown:['язык неизвестен','unknown language'],source:['Оригинал','Original'],translationFailed:['Названия и описания показаны на языке источника: перевод пока недоступен.','Names and descriptions are shown in the source language: translation is unavailable.']};return values[key][LANGUAGE==='ru'?0:1]}
function metadata(value){return t(value||'')}
async function translateDiscovery(token,signal){
 if(!state.ai||!searchEpoch.isCurrent(token))return;
 const snapshot=state.places;
 const places=snapshot.filter(p=>(p.cardLanguage||p.lang||'ru')!==LANGUAGE);
 try{
  const translations=[];
  for(let offset=0;offset<places.length;offset+=12){
   if(!searchEpoch.isCurrent(token)||state.places!==snapshot)return;
   const result=await aiRequest({action:'translatePlaces',places:places.slice(offset,offset+12).map(p=>({id:p.id,title:(p.originalTitle||p.title).slice(0,300),subtitle:(p.originalSubtitle??p.subtitle??'').slice(0,500)}))},signal);
   if(!searchEpoch.isCurrent(token)||state.places!==snapshot)return;
   if(result.language!==LANGUAGE||!Array.isArray(result.places))throw new Error('Invalid translation');
   translations.push(...result.places);
  }
  if(!searchEpoch.isCurrent(token)||state.places!==snapshot)return;
  const byId=new Map(translations.map(p=>[p.id,p]));
  state.places=state.places.map(p=>{const translated=byId.get(p.id);return translated?.title?{...p,originalTitle:p.originalTitle||p.title,title:translated.title,subtitle:translated.subtitle||'',cardLanguage:LANGUAGE}:p});renderPlaces();
 }catch(error){if(error.name!=='AbortError'&&searchEpoch.isCurrent(token)&&state.places===snapshot)setStatus(ui('translationFailed'))}
}

// Cache only display metadata, never replace saved/history arrays with an async snapshot.
// A completed request therefore cannot restore deleted places or switch the current tab.
async function translateLibrary(){
 if(!state.ai||state.tab==='explore')return;
 const entries=state.tab==='saved'?saved:history;
 const pending=entries.filter(p=>{
  const language=p.cardLanguage||(p.aiGenerated?p.storyLanguage:p.lang||'ru');
  return language!==LANGUAGE&&!libraryAttempts.has(cardMetadataKey(p,LANGUAGE));
 });
 if(!pending.length)return;
 for(const p of pending)libraryAttempts.add(cardMetadataKey(p,LANGUAGE));
 for(let offset=0;offset<pending.length;offset+=12){
  const batch=pending.slice(offset,offset+12);
  try{
   const result=await aiRequest({action:'translatePlaces',places:batch.map(p=>({id:p.id,title:(p.originalTitle||p.title).slice(0,300),subtitle:(p.originalSubtitle??p.subtitle??'').slice(0,500)}))});
   if(result.language!==LANGUAGE||!Array.isArray(result.places))throw new Error('Invalid translation');
   const byId=new Map(result.places.map(p=>[p.id,p]));
   for(const p of batch){const translated=byId.get(p.id);if(translated?.title)libraryMetadata.set(cardMetadataKey(p,LANGUAGE),{title:translated.title,subtitle:translated.subtitle||''})}
  }catch{/* Original-language labels stay visible. Do not rebill a failed batch on every render. */}
 }
 // Always derive the next view from live arrays; late results are display-cache entries only.
 if(state.tab!=='explore')renderLibrary();
}
