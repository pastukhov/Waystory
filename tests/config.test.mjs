import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {serverAddress} from '../server/config.mjs';

test('defaults to a local listener and accepts a container address',()=>{
 assert.deepEqual(serverAddress({}),{host:'127.0.0.1',port:5173});
 assert.deepEqual(serverAddress({HOST:'0.0.0.0',PORT:'8080'}),{host:'0.0.0.0',port:8080});
});
test('invalid ports fail before startup',()=>{
 for(const PORT of ['0','-1','65536','abc','80.5','1e3'])assert.throws(()=>serverAddress({PORT}),/PORT/);
});
test('dotenv loads secrets while preserving existing environment and allows a missing file',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'waystory-env-'));
 try{
  writeFileSync(path.join(dir,'.env'),"WAYSTORY_TEST_SECRET='fake$with#symbols'\nWAYSTORY_TEST_EXISTING=file\n");
  const moduleUrl=new URL('../server/config.mjs',import.meta.url).href;
  const script=`import assert from 'node:assert/strict';import {loadEnvironment} from ${JSON.stringify(moduleUrl)};loadEnvironment();assert.equal(process.env.WAYSTORY_TEST_SECRET,'fake$with#symbols');assert.equal(process.env.WAYSTORY_TEST_EXISTING,'outside');loadEnvironment('absent.env');`;
  const env={...process.env,WAYSTORY_TEST_EXISTING:'outside'};delete env.WAYSTORY_TEST_SECRET;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:dir,env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
