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
