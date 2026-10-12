import test from 'node:test';
import assert from 'node:assert/strict';
import * as language from '../dist/language.mjs';
test('browser language preferences pick supported language with English fallback',()=>{assert.equal(language.detectLanguage(['ru-RU','en-US']),'ru');assert.equal(language.detectLanguage(['en-GB','ru']),'en');assert.equal(language.detectLanguage(['tr-TR','ru-RU']),'ru');assert.equal(language.detectLanguage(['tr']),'en')});
test('cached stories are reused only for the current language and story format',()=>{assert.equal(language.canReuseStory({aiGenerated:true,storyLanguage:'ru',storyVersion:language.STORY_VERSION},'ru'),true);assert.equal(language.canReuseStory({aiGenerated:true,storyLanguage:'en',storyVersion:2},'ru'),false);assert.equal(language.canReuseStory({aiGenerated:true},'ru'),false)});


test('older generated stories must be regenerated after consistency checks change',()=>{for(const version of [2,3])assert.equal(language.canReuseStory({aiGenerated:true,storyLanguage:'ru',storyVersion:version},'ru'),false)});
