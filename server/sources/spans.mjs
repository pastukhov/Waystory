import {createHash} from 'node:crypto';
import {sourcePolicy} from './policies.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
const MAX_SPAN=1200,OVERLAP=150;

// Slice the permitted snapshot itself: never normalize, translate or split
// sentences. Offsets count UTF-16 code units, like String.prototype.slice.
export function buildEvidenceSpans(documents){
 const spans=[];
 for(const document of documents){
  if(!sourcePolicy(document.license?.policyId).allowModelInput||typeof document.text!=='string')continue;
  const {text}=document,revision=String(document.revision??''),snapshotHash=hash(text);
  for(const paragraph of text.matchAll(/[^\r\n]+/g)){
   const content=paragraph[0],first=content.search(/\S/);
   if(first<0)continue;
   const paragraphEnd=paragraph.index+content.trimEnd().length;
   let start=paragraph.index+first;
   while(start<paragraphEnd){
    let end=Math.min(start+MAX_SPAN,paragraphEnd);
    if(end<paragraphEnd){
     // Prefer a word boundary; a very long single token still has a hard cap.
     const whitespace=text.slice(start,end).search(/\s+\S*$/);
     if(whitespace>0)end=start+whitespace;
     else if(/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
    }
    spans.push(Object.freeze({id:hash(JSON.stringify([document.id,revision,snapshotHash,start,end])),sourceId:document.id,revision,start,end,text:text.slice(start,end),scope:document.scope,language:document.language}));
    if(end===paragraphEnd)break;
    let next=Math.max(start+1,end-OVERLAP);
    // Move forward to a word boundary, keeping overlap at most 150 units.
    while(next<end&&!/\s/.test(text[next-1]))next++;
    while(next<paragraphEnd&&/\s/.test(text[next]))next++;
    start=next;
   }
  }
 }
 return Object.freeze(spans);
}
