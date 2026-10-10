import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
let html=await readFile(new URL('dist/index.html',root),'utf8');
let css=await readFile(new URL('dist/styles.css',root),'utf8');
css=css.replace(/^@import[^\n]+\n/,'');
html=html.replace('<link rel="stylesheet" href="/styles.css">','<style>'+css+'</style>');
for(const name of ['mark.svg','walk-map.svg']){const bytes=await readFile(new URL('dist/assets/'+name,root));html=html.replaceAll('/assets/'+name,'data:image/svg+xml;base64,'+bytes.toString('base64'));}
const modules=['language','i18n','core','data','art','speech','wiki','ai-client','app'];let js='';
for(const name of modules){let code=await readFile(new URL('dist/'+name+'.mjs',root),'utf8');code=code.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');js+=code+'\n';}
html=html.replace('<script type="module" src="/app.mjs"></script>','<script type="module">'+js.replaceAll('</script','<\\/script')+'</script>');
await mkdir(new URL('artifacts/',root),{recursive:true});await writeFile(new URL('artifacts/waystory-pilot.html',root),html);console.log('Standalone HTML created');
