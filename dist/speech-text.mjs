// Collapse only complete groups of thousands, before audio chunking and caching.
// Preserve decimal punctuation, dates, newlines and irregular digit sequences.
export function normalizeSpeechText(text){
 // Source IDs belong to the source panel, never to spoken narration. Only
 // remove explicit machine citations, not ordinary mentions of a source.
 const id=String.raw`(?:wikipedia|wikivoyage):[a-z-]+:\d+|wikidata:Q\d+|osm:(?:node|way|relation):\d+`;
 const citation=new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:Источники?|Sources?)\s*:\s*(?:${id})(?:\s*[,;]\s*(?:${id}))*(?![\p{L}\p{N}_:])\.?[ \t]*`,'giu');
 text=text.replace(citation,'').trim();
 return text.replace(/(?<![\p{L}\p{N}.,])\d+(?:[ \u00a0\u202f\u2009]+\d+)+(?![\p{L}\p{N}])/gu,
  number=>/^\d{1,3}(?:[ \u00a0\u202f\u2009]\d{3})+$/.test(number)?number.replace(/[ \u00a0\u202f\u2009]/g,''):number);
}

