import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {messages,t,durationLabel,availableDepths,clampDepth,sourceLanguage,canListen,safeError,speechError,cardMetadataKey} from '../dist/i18n.mjs';

test('all static UI keys and dynamic translation calls have an English catalog entry',()=>{
 const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8');
 const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');
 const keys=[...html.matchAll(/data-i18n(?:-(?:aria-label|placeholder|alt|content))?="([^"]*)"/g)].map(m=>decode(m[1]));
 keys.push(...[...app.matchAll(/\bt\('([^']*)'\)/g)].map(m=>m[1]));
 for(const key of keys){assert.ok(Object.hasOwn(messages,key.trim()),key);assert.doesNotMatch(t(key,'en'),/[А-Яа-яЁё]/,key);assert.equal(t(key,'ru'),key)}
 assert.equal(t(' из ','en'),' of ');
});

test('depth choices require new blocks and clamp an unavailable selected level',()=>{
 const short=[{depth:0,text:'Only a short source.'}];
 assert.deepEqual(availableDepths(short),[0]);
 assert.equal(clampDepth(short,2),0);
 assert.deepEqual(availableDepths([...short,{depth:2,text:'Extra detail.'}]),[0,2]);
 assert.equal(clampDepth([...short,{depth:2,text:'Extra detail.'}],1),0);
});

test('duration labels distinguish seconds and cumulative minutes',()=>{
 const blocks=[{depth:0,text:Array(35).fill('word').join(' ')},{depth:1,text:Array(140).fill('word').join(' ')}];
 assert.equal(durationLabel(blocks,0,'en'),'≈ 15 sec');
 assert.equal(durationLabel(blocks,1,'en'),'≈ 1 min 15 sec');
 assert.equal(durationLabel(blocks,0,'ru'),'≈ 15 сек');
 assert.equal(durationLabel(blocks,1,'ru'),'≈ 1 мин 15 сек');
});

test('narration requires a known matching story language, independent of translated card names',()=>{
 const source={lang:'de',cardLanguage:'ru',source:'https://de.wikipedia.org/wiki/Test'};
 assert.equal(sourceLanguage(source),'de');
 assert.equal(canListen(source,'ru'),false);
 assert.equal(canListen({...source,aiGenerated:true,storyLanguage:'ru'},'ru'),true);
 assert.equal(canListen({...source,aiGenerated:true,storyLanguage:'en'},'ru'),false);
 assert.equal(canListen({aiGenerated:true,lang:'ru'},'ru'),false);
 assert.equal(canListen({source:'https://ru.wikipedia.org/wiki/Test'},'ru'),true);
 assert.equal(canListen({},'en'),false);
});

test('unrecognized backend errors are replaced with a safe localized fallback',()=>{
 assert.equal(safeError(new Error('secret internal error'),'Не удалось получить ответ.'),t('Не удалось получить ответ.'));
 assert.equal(safeError(new Error('Фото слишком большое. Выберите файл до 5 МБ.'),'Не удалось получить ответ.'),t('Фото слишком большое. Выберите файл до 5 МБ.'));
});


test('speech errors preserve actionable instructions in both UI languages',()=>{
 const autoplay='Браузер просит ещё одно нажатие: нажмите «Продолжить», чтобы включить звук.';
 const permission='Нет доступа к SpeechKit. Проверьте роль ai.speechkit-tts.user и разрешение API-ключа на синтез речи.';
 assert.equal(speechError(autoplay,'ru'),autoplay);
 assert.match(speechError(autoplay,'en'),/press Continue/);
 assert.match(speechError(permission,'en'),/ai\.speechkit-tts\.user.*API key/);
 assert.equal(speechError('Unsupported speech language.','ru'),'Язык озвучки не поддерживается.');
 assert.equal(speechError('internal secret','en'),'Could not load narration. Check your connection.');
 for(const path of ['../dist/speech.mjs','../server/tts.mjs']){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  for(const [,text] of source.matchAll(/'([^'\n]*[А-Яа-я][^'\n]*)'/g))assert.ok(Object.hasOwn(messages,text),text);
 }
});


test('metadata cache identity survives a translated display overlay but separates source changes',()=>{
 const original={id:'one',title:'Original title',subtitle:'Original subtitle'};
 const translated={...original,title:'Translated',subtitle:'Translated snippet',originalTitle:original.title,originalSubtitle:original.subtitle};
 assert.equal(cardMetadataKey(original,'ru'),cardMetadataKey(translated,'ru'));
 assert.notEqual(cardMetadataKey(original,'ru'),cardMetadataKey(original,'en'));
 assert.notEqual(cardMetadataKey(original,'ru'),cardMetadataKey({...original,subtitle:'Updated source'},'ru'));
});
