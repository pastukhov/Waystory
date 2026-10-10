import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpeechText} from '../dist/speech-text.mjs';
test('thousands formatting is removed without rewriting words or years',()=>{for(const space of [' ','\u00a0','\u202f','\u2009'])assert.equal(normalizeSpeechText(`В 2022 году здесь проживало 2${space}144 человека.`),'В 2022 году здесь проживало 2144 человека.');assert.equal(normalizeSpeechText('1\u202f234\u202f567 человек'),'1234567 человек')});
test('dates, decimal separators, ranges and irregular groups retain their meaning',()=>{for(const text of ['12 05 2022','2022–2024','2,144','2.144','12 34','12 345 67','2022 144','1\n234','1.234 567','v2\u202f144'])assert.equal(normalizeSpeechText(text),text);assert.equal(normalizeSpeechText('−2\u202f144,5 м'),'−2144,5 м')});
