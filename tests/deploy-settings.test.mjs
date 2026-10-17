import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

function run(initial,key){
 const dir=mkdtempSync(join(tmpdir(),'waystory-env-')),file=join(dir,'.env');
 writeFileSync(file,initial,{mode:0o644});
 const result=spawnSync('python3',['scripts/sync-deploy-settings.py',file],{encoding:'utf8',env:{...process.env,WAYSTORY_TAVILY_SECRET:key}});
 const output=readFileSync(file,'utf8'),mode=statSync(file).mode&0o777;
 rmSync(dir,{recursive:true,force:true});return {...result,output,mode};
}
test('GitHub Tavily secret replaces duplicate assignments without exposing it or changing unrelated secrets',()=>{
 const key='tvly-test-new-secret';const r=run('# retained\nYANDEX_API_KEY=unchanged\nTAVILY_API_KEY=old\nexport TAVILY_API_KEY=other\n',key);
 assert.equal(r.status,0,r.stderr);assert.match(r.output,/YANDEX_API_KEY=unchanged/);assert.equal(r.output.match(/TAVILY_API_KEY=/g).length,1);assert.ok(r.output.includes(key));assert.equal(r.mode,0o600);assert.ok(!(r.stdout+r.stderr).includes(key));
 assert.match(r.output,/WEB_SEARCH_MAX_CALLS_PER_DAY=10/);assert.match(r.output,/GLOBAL_SOURCE_DISCOVERY_ENABLED=true/);
});
test('missing GitHub secret preserves the manually installed key during migration',()=>{
 const r=run("TAVILY_API_KEY='tvly-manual-secret'\nUNRELATED=keep\n",'');assert.equal(r.status,0,r.stderr);assert.match(r.output,/TAVILY_API_KEY='tvly-manual-secret'/);assert.match(r.output,/UNRELATED=keep/);
});
test('invalid secret fails before any file mutation and is not logged',()=>{
 const original='TAVILY_API_KEY=old\n';const r=run(original,'bad\nINJECTED=true');assert.notEqual(r.status,0);assert.equal(r.output,original);assert.ok(!(r.stdout+r.stderr).includes('INJECTED'));
});
test('optional Actions metrics token is delivered privately and preserved when absent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'waystory-metrics-env-')),file=join(dir,'.env'),token='metrics-test-0123456789abcdef0123456789';
 try{
  writeFileSync(file,'YANDEX_API_KEY=preserve\n');
  const first=spawnSync('python3',['scripts/sync-deploy-settings.py',file],{encoding:'utf8',env:{...process.env,WAYSTORY_TAVILY_SECRET:'',WAYSTORY_METRICS_SECRET:token}});
  assert.equal(first.status,0,first.stderr);assert.ok(readFileSync(file,'utf8').includes('METRICS_TOKEN='+token));assert.ok(!(first.stdout+first.stderr).includes(token));
  const second=spawnSync('python3',['scripts/sync-deploy-settings.py',file],{encoding:'utf8',env:{...process.env,WAYSTORY_TAVILY_SECRET:'',WAYSTORY_METRICS_SECRET:''}});assert.equal(second.status,0);assert.ok(readFileSync(file,'utf8').includes('METRICS_TOKEN='+token));
  const before=readFileSync(file,'utf8');const bad=spawnSync('python3',['scripts/sync-deploy-settings.py',file],{encoding:'utf8',env:{...process.env,WAYSTORY_METRICS_SECRET:'weak'}});assert.notEqual(bad.status,0);assert.equal(readFileSync(file,'utf8'),before);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('RouterAI secret enables both providers without logging or erasing existing credentials',()=>{
 const dir=mkdtempSync(join(tmpdir(),'waystory-router-env-')),file=join(dir,'.env'),key='router-test-secret-1234567890';
 try{
  writeFileSync(file,'YANDEX_API_KEY=keep\nROUTERAI_API_KEY=old\nAI_PROVIDER=yandex\nTTS_PROVIDER=yandex\n');
  const runRouter=value=>spawnSync('python3',['scripts/sync-deploy-settings.py',file],{encoding:'utf8',env:{...process.env,WAYSTORY_ROUTERAI_SECRET:value}});
  const r=runRouter(key);assert.equal(r.status,0,r.stderr);const text=readFileSync(file,'utf8');assert.match(text,/AI_PROVIDER=routerai/);assert.match(text,/TTS_PROVIDER=routerai/);assert.ok(text.includes('ROUTERAI_API_KEY='+key));assert.equal(text.match(/ROUTERAI_API_KEY=/g).length,1);assert.ok(!(r.stdout+r.stderr).includes(key));assert.match(text,/YANDEX_API_KEY=keep/);
  assert.equal(runRouter('').status,0);assert.deepEqual(readFileSync(file,'utf8').split('\n').sort(),text.split('\n').sort());const preserved=readFileSync(file,'utf8');
  assert.notEqual(runRouter('bad\nINJECTED=true').status,0);assert.equal(readFileSync(file,'utf8'),preserved);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
