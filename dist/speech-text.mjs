// Collapse only complete groups of thousands, before audio chunking and caching.
// Preserve decimal punctuation, dates, newlines and irregular digit sequences.
export function stripSourceCitations(text){
 // Source IDs belong to the source panel, never to spoken narration. Only
 // remove explicit machine citations, not ordinary mentions of a source.
 const id=String.raw`(?:wikipedia|wikivoyage):[a-z-]+:\d+|wikidata:Q\d+|osm:(?:node|way|relation):\d+`;
 const citation=new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:Источники?|Sources?)\s*:\s*(?:${id})(?:\s*[,;]\s*(?:${id}))*(?![\p{L}\p{N}_:])\.?[ \t]*`,'giu');
 return text.replace(citation,'').trim();
}
// Roman numerals are read as ordinals only in an explicit Russian century
// context. Keep names, brands and unsupported/malformed numerals intact.
const romanCenturies=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII','XXVIII','XXIX','XXX'];
const centuryOrdinals=['первый','второй','третий','четвёртый','пятый','шестой','седьмой','восьмой','девятый','десятый','одиннадцатый','двенадцатый','тринадцатый','четырнадцатый','пятнадцатый','шестнадцатый','семнадцатый','восемнадцатый','девятнадцатый','двадцатый','двадцать первый','двадцать второй','двадцать третий','двадцать четвёртый','двадцать пятый','двадцать шестой','двадцать седьмой','двадцать восьмой','двадцать девятый','тридцатый'];
const centuryCases={век:'n',века:'g',веку:'d',веком:'i',веков:'g',веках:'p',векам:'d',веками:'i'};
function centuryOrdinal(roman,grammaticalCase){
 const word=centuryOrdinals[romanCenturies.indexOf(roman)];if(!word)return null;if(grammaticalCase==='n')return word;
 const third=word.endsWith('третий');return word.slice(0,-2)+(third?{g:'ьего',d:'ьему',i:'ьим',p:'ьем'}:{g:'ого',d:'ому',i:'ым',p:'ом'})[grammaticalCase];
}
const romanPair=String.raw`([IVXLCDM]+)(?:([ \u00a0]*(?:[–—-]|и)[ \u00a0]*)([IVXLCDM]+))?`;
function spokenCenturies(first,join,second,grammaticalCase){const a=centuryOrdinal(first,grammaticalCase),b=second?centuryOrdinal(second,grammaticalCase):null;return a&&(!second||b)?a+(second?join+b:''):null}
function russianSpeechText(text){
 const centuries=new RegExp(String.raw`(?<![\p{L}\p{N}_])${romanPair}([ \u00a0]+)(век(?:ами|ах|ам|ом|ов|а|у|е)?)(?![\p{L}\p{N}_])`,'gu');
 text=text.replace(centuries,(match,first,join,second,space,noun)=>{if(!second&&['веков','веках','векам','веками'].includes(noun))return match;const grammaticalCase=noun==='веке'?'p':second&&noun==='века'?'n':centuryCases[noun],spoken=spokenCenturies(first,join,second,grammaticalCase);return spoken?spoken+space+noun:match});
 // Abbreviations need an explicit governing word; “дом XX в.” is ambiguous.
 const abbreviated=new RegExp(String.raw`(?<![\p{L}\p{N}_])([Вв]о?|[Кк]о?|[Дд]о|[Пп]осле|[Оо]т|[Ии]з|[Нн]ачал[ае]|[Кк]онц[ае]|[Сс]ередин[аые])([ \u00a0]+)${romanPair}[ \u00a0]+(вв?)\.(?![\p{L}\p{N}_])`,'gu');
 text=text.replace(abbreviated,(match,governor,space,first,join,second,abbr,offset,source)=>{if(Boolean(second)!==(abbr==='вв'))return match;const prep=governor.toLowerCase(),grammaticalCase=/^во?$/.test(prep)?'p':/^ко?$/.test(prep)?'d':'g',spoken=spokenCenturies(first,join,second,grammaticalCase),noun=grammaticalCase==='p'?(second?'веках':'веке'):grammaticalCase==='d'?(second?'векам':'веку'):(second?'веков':'века');const tail=source.slice(offset+match.length),period=/^(?:[ \t]*$|[ \t]+[А-ЯЁA-Z]|[ \t]*[\r\n])/.test(tail)?'.':'';return spoken?governor+space+spoken+' '+noun+period:match});
 // These complete word forms have no competing е spelling in Russian. Never
 // guess все/всё, stress marks, surnames or other context-dependent readings.
 const yo={еще:'ещё',ее:'её',трех:'трёх',четырех:'четырёх'};
 return text.replace(/(?<![\p{L}\p{N}_])(?:еще|ее|трех|четырех)(?![\p{L}\p{N}_])/giu,word=>{const replacement=yo[word.toLowerCase()];return word===word.toUpperCase()?replacement.toUpperCase():word[0]===word[0].toUpperCase()?replacement[0].toUpperCase()+replacement.slice(1):replacement});
}
export function normalizeSpeechText(text,language='ru'){
 text=stripSourceCitations(text);
 text=text.replace(/(?<![\p{L}\p{N}.,])\d+(?:[ \u00a0\u202f\u2009]+\d+)+(?![\p{L}\p{N}])/gu,
  number=>/^\d{1,3}(?:[ \u00a0\u202f\u2009]\d{3})+$/.test(number)?number.replace(/[ \u00a0\u202f\u2009]/g,''):number);
 return language==='ru'?russianSpeechText(text):text;
}

