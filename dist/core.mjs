export function buildQueue(place, depth, heard = []) {
  return (place.blocks || []).filter(b => b.depth <= depth && !heard.includes(b.id));
}
export function restoreLibrary(raw) {
  try { const data=JSON.parse(raw); return Array.isArray(data) ? data.filter(p=>p && typeof p.id==='string' && typeof p.title==='string' && (p.blocks===undefined || (Array.isArray(p.blocks) && p.blocks.every(b=>b && typeof b.id==='string' && typeof b.text==='string' && typeof b.title==='string' && [0,1,2].includes(b.depth)))) && (p.questions===undefined || (Array.isArray(p.questions) && p.questions.every(q=>q && typeof q.question==='string' && typeof q.answer==='string')))).slice(0,30) : []; } catch { return []; }
}
export function saveEntry(entries, place) { return [{...place, savedAt:Date.now()},...entries.filter(p=>p.id!==place.id)].slice(0,30); }
export function safeSourceUrl(value) {
  try { const u=new URL(value);return u.protocol==='https:' && (u.hostname==='wikipedia.org'||u.hostname.endsWith('.wikipedia.org')) ? u.href : null; } catch { return null; }
}
export function validateImage(file) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) return 'Выберите фото JPG, PNG или WebP.';
  if(file.size>5*1024*1024) return 'Фото слишком большое. Выберите файл до 5 МБ.';
  return null;
}
export function createEpoch() { let value=0;return {next:()=>++value,isCurrent:token=>token===value}; }
// Keep address abbreviations, initials and decimals inside a sentence.
export function splitSentences(text) {
 const result=[];let start=0;
 for(const match of text.matchAll(/[.!?]+[»”"')\]]*(?:\s+|$)/gu)){
  const end=match.index+match[0].trimEnd().length,next=text.slice(match.index+match[0].length);
  if(match[0].startsWith('.')&&!match[0].startsWith('..')&&next){
   const word=text.slice(0,match.index).match(/([\p{L}]+)$/u)?.[1]||'';
   const abbreviation=/^(?:ул|вл|д|им|кв|корп|стр|просп|пер|наб|пл|обл|Mr|Mrs|Ms|Dr|Prof|St)$/iu.test(word);
   const initial=/^\p{Lu}$/u.test(word)&&/^\p{Lu}/u.test(next);
   const unit=/^(?:тыс|млн|млрд|руб|коп|г|гг)$/iu.test(word)&&/^[\p{Ll}\d]/u.test(next);
   if(abbreviation||initial||unit)continue;
  }
  const sentence=text.slice(start,end).trim();if(sentence)result.push(sentence);start=match.index+match[0].length;
 }
 const rest=text.slice(start).trim();if(rest)result.push(rest);return result;
}
