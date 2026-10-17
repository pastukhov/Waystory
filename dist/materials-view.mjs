import {t} from './i18n.mjs';
import {safeCitationUrl} from './sources-view.mjs';

// Titles and URLs are remote data: build every element through DOM APIs.
export function renderMaterials(node,place={},language){
 const translate=key=>t(key,language),doc=node.ownerDocument||document;
 node.replaceChildren();
 const heading=doc.createElement('h3');heading.textContent=translate('Путеводители и аудиогиды');node.append(heading);
 const kinds={website:'Официальный сайт',exhibition:'Выставки',guide:'Путеводитель',audio:'Аудиогид'};
 const priority=item=>item?.kind==='audio'||item?.kind==='guide'?0:item?.kind==='exhibition'?1:2;
 const list=(links,official)=>{
  const ul=doc.createElement('ul'),seen=new Set();
  const items=Array.isArray(links)?[...links]:[];if(official)items.sort((a,b)=>priority(a)-priority(b));
  for(const item of items){
   const url=safeCitationUrl(item?.url);if(!url||seen.has(url))continue;seen.add(url);
   const li=doc.createElement('li'),a=doc.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=typeof item.title==='string'&&item.title.trim()?item.title:new URL(url).hostname;
   li.append(a);if(official){const kind=doc.createElement('small');kind.textContent=translate(Object.hasOwn(kinds,item.kind)?kinds[item.kind]:'Официальный материал');li.append(kind)}ul.append(li);
   if(ul.children.length>=(official?8:5))break;
  }
  return ul;
 };
 const official=list(place.officialLinks,true);if(official.children.length)node.append(official);
 const status=doc.createElement('div');status.className='materials-status';status.setAttribute('role','status');
 const note=key=>{const p=doc.createElement('p');p.textContent=translate(key);status.append(p)};
 if(place.materialsLoading)note('Ищем путеводители и аудиогиды…');
 const discovery=place.discoveryStatus||{};
 if(['unavailable','not_configured','budget_exhausted'].includes(discovery.web))note('Дополнительный веб-поиск недоступен. Рассказ может не учитывать новые материалы.');
 if(discovery.official==='unavailable')note('Не удалось проверить официальные материалы. Попробуйте обновить рассказ позже.');
 else if(!place.materialsLoading&&!official.children.length)note('Официальные путеводители и аудиогиды пока не найдены.');
 node.append(status);
 const search=list(place.searchLinks,false);if(search.children.length){const title=doc.createElement('h4');title.textContent=translate('Найдено в интернете');node.append(title,search)}
 node.hidden=false;
}
