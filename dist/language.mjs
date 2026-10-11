export const STORY_VERSION=3;
export function detectLanguage(preferences=[]){for(const value of preferences){const language=String(value).toLowerCase().split(/[-_]/)[0];if(['ru','en'].includes(language))return language}return 'en'}
export const LANGUAGE=detectLanguage(globalThis.navigator?.languages||[globalThis.navigator?.language||'en']);
export const LANGUAGE_TAG=LANGUAGE==='ru'?'ru-RU':'en-US';
export function canReuseStory(place,language){return place.aiGenerated===true&&[2,STORY_VERSION].includes(place.storyVersion)&&place.storyLanguage===language}
