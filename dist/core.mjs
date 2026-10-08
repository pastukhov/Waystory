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
export function splitSentences(text) { return (text.match(/[^.!?]+(?:[.!?]+|$)/gu)||[text]).map(s=>s.trim()).filter(Boolean); }
