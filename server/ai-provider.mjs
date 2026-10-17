// Fixed endpoints prevent credentials from being sent to configurable hosts.
export function selectedProvider(env,kind){
 const value=env[kind==='speech'?'TTS_PROVIDER':'AI_PROVIDER']||(env.ROUTERAI_API_KEY?.trim()?'routerai':'yandex');
 if(!['routerai','yandex'].includes(value))throw new Error('Invalid AI/TTS provider');
 return value;
}
export function routerModel(env,name,fallback){
 const value=env[name]||fallback;
 if(!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:-]+$/.test(value)||value.length>150)throw new Error(`Invalid ${name}`);
 return value;
}
export function aiProvider(env){
 const provider=selectedProvider(env,'ai');
 if(provider==='routerai')return {provider,enabled:!!env.ROUTERAI_API_KEY?.trim(),endpoint:'https://routerai.ru/api/v1/chat/completions',headers:{Authorization:'Bearer '+(env.ROUTERAI_API_KEY||'').trim(),'Content-Type':'application/json'},models:{story:routerModel(env,'ROUTERAI_STORY_MODEL','openai/gpt-4.1-mini'),question:routerModel(env,'ROUTERAI_QUESTION_MODEL','openai/gpt-4.1-mini'),identify:routerModel(env,'ROUTERAI_VISION_MODEL','openai/gpt-4.1-mini'),translatePlaces:routerModel(env,'ROUTERAI_QUESTION_MODEL','openai/gpt-4.1-mini')},reviewModel:routerModel(env,'ROUTERAI_REVIEW_MODEL','openai/gpt-4.1-mini')};
 const enabled=!!(env.YANDEX_API_KEY?.trim()&&env.YANDEX_FOLDER_ID?.trim());
 if(enabled&&!/^[a-zA-Z0-9_-]+$/.test(env.YANDEX_FOLDER_ID))throw new Error('Invalid YANDEX_FOLDER_ID');
 function model(name,fallback){const value=env[name]||fallback;if(!/^[a-zA-Z0-9._/-]+$/.test(value)||value.length>150)throw new Error(`Invalid ${name}`);return `gpt://${env.YANDEX_FOLDER_ID}/${value}`}
 return {provider,enabled,endpoint:'https://ai.api.cloud.yandex.net/v1/chat/completions',headers:{Authorization:'Api-Key '+env.YANDEX_API_KEY,'OpenAI-Project':env.YANDEX_FOLDER_ID,'Content-Type':'application/json','x-data-logging-enabled':'false'},models:{story:model('YANDEX_STORY_MODEL','aliceai-llm'),question:model('YANDEX_QUESTION_MODEL','aliceai-llm-flash'),identify:model('YANDEX_VISION_MODEL','qwen3.6-35b-a3b'),translatePlaces:model('YANDEX_QUESTION_MODEL','aliceai-llm-flash')}};
}
