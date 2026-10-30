import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const run=(first,second,error)=>spawnSync('bash',['-c',`set -euo pipefail
source scripts/build-image.sh
compose(){
 printf 'CALL %s\\n' "$*"
 if [ "$*" = 'build --pull' ]; then printf '%s\\n' "$BUILD_ERROR"; return "$FIRST_STATUS"; fi
 return "$SECOND_STATUS"
}
build_with_registry_fallback compose
echo DEPLOY_CONTINUES
`],{encoding:'utf8',env:{...process.env,FIRST_STATUS:String(first),SECOND_STATUS:String(second),BUILD_ERROR:error}});
test('successful pull uses one build',()=>{const r=run(0,9,'');assert.equal(r.status,0);assert.match(r.stdout,/DEPLOY_CONTINUES/);assert.equal(r.stdout.includes('CALL build --pull=false'),false)});
test('Docker Hub token TLS timeout can use a cached base for the same build',()=>{const r=run(1,0,'failed to fetch anonymous token: Get "https://auth.docker.io/token": net/http: TLS handshake timeout');assert.equal(r.status,0);assert.match(r.stdout,/CALL build --pull=false/);assert.match(r.stdout,/DEPLOY_CONTINUES/)});
test('failed cached build stops before container replacement',()=>{const r=run(1,7,'failed to fetch anonymous token: TLS handshake timeout');assert.equal(r.status,7);assert.doesNotMatch(r.stdout,/DEPLOY_CONTINUES/)});
test('unrelated build errors do not silently select an older base',()=>{const r=run(4,0,'Dockerfile syntax error');assert.equal(r.status,4);assert.doesNotMatch(r.stdout,/pull=false|DEPLOY_CONTINUES/)});
