// Collapse only complete groups of thousands, before audio chunking and caching.
// Preserve decimal punctuation, dates, newlines and irregular digit sequences.
export function normalizeSpeechText(text){
 return text.replace(/(?<![\p{L}\p{N}.,])\d+(?:[ \u00a0\u202f\u2009]+\d+)+(?![\p{L}\p{N}])/gu,
  number=>/^\d{1,3}(?:[ \u00a0\u202f\u2009]\d{3})+$/.test(number)?number.replace(/[ \u00a0\u202f\u2009]/g,''):number);
}
