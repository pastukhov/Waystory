import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpeechText} from '../dist/speech-text.mjs';
test('thousands formatting is removed without rewriting words or years',()=>{for(const space of [' ','\u00a0','\u202f','\u2009'])assert.equal(normalizeSpeechText(`В 2022 году здесь проживало 2${space}144 человека.`),'В 2022 году здесь проживало 2144 человека.');assert.equal(normalizeSpeechText('1\u202f234\u202f567 человек'),'1234567 человек')});
test('dates, decimal separators, ranges and irregular groups retain their meaning',()=>{for(const text of ['12 05 2022','2022–2024','2,144','2.144','12 34','12 345 67','2022 144','1\n234','1.234 567','v2\u202f144'])assert.equal(normalizeSpeechText(text),text);assert.equal(normalizeSpeechText('−2\u202f144,5 м'),'−2144,5 м')});

test('technical citation lists are silent while surrounding narration is retained',()=>{
 for(const label of ['Источник','Источники','Source','Sources'])assert.equal(normalizeSpeechText(`Башня построена в 1226 году. ${label}: wikipedia:ru:8922043, wikipedia:en:47620877, wikipedia:tr:24241. Далее — история.`),'Башня построена в 1226 году. Далее — история.');
 assert.equal(normalizeSpeechText('Источник: wikipedia:ru:8922043.'),'');
 assert.equal(normalizeSpeechText('Источник воды находится рядом. По данным Википедии, башня построена в 1226 году.'),'Источник воды находится рядом. По данным Википедии, башня построена в 1226 году.');
});

test('Russian Roman centuries become spoken ordinals in the noun case',()=>{
 const cases=[['В XX веке появился музей.','В двадцатом веке появился музей.'],['XX век, XX века, XX веку, XX веком, XX веков, XX веках','двадцатый век, двадцатого века, двадцатому веку, двадцатым веком, XX веков, XX веках'],['III века и в III веке','третьего века и в третьем веке'],['XXI века, XXII веку, XXIII веком, XXX век','двадцать первого века, двадцать второму веку, двадцать третьим веком, тридцатый век'],['в XVII–XVIII веках; XVII–XVIII века; XVII и XVIII веков','в семнадцатом–восемнадцатом веках; семнадцатый–восемнадцатый века; семнадцатого и восемнадцатого веков'],['в XX в.; до XIX в.; в начале XVIII в.; в XVII–XVIII вв.','в двадцатом веке; до девятнадцатого века; в начале восемнадцатого века; в семнадцатом–восемнадцатом веках.']];
 for(const [input,expected] of cases){assert.equal(normalizeSpeechText(input,'ru'),expected);assert.equal(normalizeSpeechText(expected,'ru'),expected)}
});
test('only complete canonical Roman tokens next to a Russian century are rewritten',()=>{
 for(const text of ['I V X L C D M; CIVIC MIX XIVI IIX века; XXXI век','Пётр I и Людовик XIV. iPhone X, Super Bowl XX.','xviii века; prefixXX века; XX вековой; XX в.com','Дом XX в.','В XX веке еще ее все трех.'])assert.equal(normalizeSpeechText(text,'en'),text);
 for(const text of ['I V X L C D M; CIVIC MIX XIVI IIX века; XXXI век','Пётр I и Людовик XIV. iPhone X, Super Bowl XX.','xviii века; prefixXX века; XX вековой; XX в.com','Дом XX в.'])assert.equal(normalizeSpeechText(text,'ru'),text);
});
test('safe Russian yo forms improve narration without guessing ambiguous words or names',()=>{
 const text='Еще ее трех четырех друзей, все села, узнаем о Елене и Семенове. Ещё её трёх четырёх.';
 const expected='Ещё её трёх четырёх друзей, все села, узнаем о Елене и Семенове. Ещё её трёх четырёх.';
 assert.equal(normalizeSpeechText(text,'ru'),expected);assert.equal(normalizeSpeechText(expected,'ru'),expected);assert.equal(normalizeSpeechText(text,'en'),text);
});
test('canonical centuries I through XXX all have a spoken form and ranges fail as a whole',()=>{const romans=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII','XXVIII','XXIX','XXX'];for(const roman of romans){const spoken=normalizeSpeechText(`В ${roman} веке до н. э.`,'ru');assert.doesNotMatch(spoken,/[IVX]/);assert.match(spoken,/до н\. э\.$/);assert.equal(normalizeSpeechText(spoken,'ru'),spoken)}for(const source of ['XXXI–XX века','IIX–XX веков','XX–XXXI веках','IC–XX века'])assert.equal(normalizeSpeechText(source,'ru'),source)});

test('century abbreviations retain sentence boundaries and skip ambiguous plural quantities',()=>{for(const [text,expected] of [['Музей появился в XX в. Затем его перестроили.','Музей появился в двадцатом веке. Затем его перестроили.'],['Это было в XX в.','Это было в двадцатом веке.'],['В XX в. здесь был музей.','В двадцатом веке здесь был музей.'],['До XIX в., когда открыли музей.','До девятнадцатого века, когда открыли музей.'],['На протяжении XX веков и в XX веках.','На протяжении XX веков и в XX веках.']])assert.equal(normalizeSpeechText(text,'ru'),expected)});
