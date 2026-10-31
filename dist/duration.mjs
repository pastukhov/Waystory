export const WORDS_PER_MINUTE=140;
export function estimatedSeconds(text){
 const words=String(text||'').trim().split(/\s+/u).filter(Boolean).length;
 return words?Math.max(1,Math.round(words/WORDS_PER_MINUTE*60)):0;
}
