import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSentences} from '../dist/core.mjs';
test('Russian address and initials stay within their sentence',()=>{
 const intro='Больница имени А. М. Никифорова расположена по адресу: ул. Давыдковская, вл. 7.';
 assert.deepEqual(splitSentences(intro+' Строительство началось в 2011 году.'),[intro,'Строительство началось в 2011 году.']);
});
test('measurements and decimal numbers are not sentence boundaries',()=>{
 const text='Площадь — 52 тыс. кв. метров, стоимость — 5.5 млрд рублей.';
 assert.deepEqual(splitSentences(text+' Работы завершены.'),[text,'Работы завершены.']);
});
test('sentence punctuation and closing quotes stay with the sentence',()=>{
 assert.deepEqual(splitSentences('Он сказал: «Готово!» Следующий раздел. Правда? Да!'),['Он сказал: «Готово!»','Следующий раздел.','Правда?','Да!']);
});
test('English initials and titles stay together without losing ordinary boundaries',()=>{
 assert.deepEqual(splitSentences('Dr. Smith met A. B. Jones. It cost 2.5 million. Next!'),['Dr. Smith met A. B. Jones.','It cost 2.5 million.','Next!']);
});
