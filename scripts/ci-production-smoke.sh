#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
fixture="$(mktemp -d)"
project="waystory-prod-ci-${GITHUB_RUN_ID:-$$}"
export WAYSTORY_PROXY_NETWORK="$project"
export WAYSTORY_IMAGE="waystory:$project"
export WAYSTORY_ENV_FILE="$fixture/.env"
compose() { docker compose -p "$project" -f compose.production.yaml "$@"; }
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    compose logs --no-color || true
    docker logs "$project-proxy" || true
  fi
  docker rm -f "$project-proxy" >/dev/null 2>&1 || true
  compose down --volumes >/dev/null 2>&1 || true
  docker network rm "$project" >/dev/null 2>&1 || true
  rm -rf -- "$fixture"
  exit "$result"
}
trap cleanup EXIT
printf "WAYSTORY_CI_SECRET='production-test-only'\n" > "$WAYSTORY_ENV_FILE"
mkdir -p "$fixture/certs/live/ws.nayg.ru"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=ws.nayg.ru \
  -keyout "$fixture/certs/live/ws.nayg.ru/privkey.pem" \
  -out "$fixture/certs/live/ws.nayg.ru/fullchain.pem" >/dev/null 2>&1
docker network create "$project" >/dev/null
compose config --quiet
compose up --build --detach --wait --wait-timeout 150
container_id="$(compose ps -q waystory)"
test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$container_id")" = 0
docker run --detach --name "$project-proxy" --network "$project" --network-alias gateway \
  -v "$PWD/deploy/nginx/waystory.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$fixture/certs:/etc/letsencrypt:ro" nginx:1.27-alpine
docker exec "$project-proxy" nginx -t
# A disposable client validates TLS termination, routing and browser permissions.
# Self-signed certificates are used only by this isolated CI fixture.
docker run --rm -i --network "$project" --entrypoint node "$WAYSTORY_IMAGE" --input-type=module <<'JS'
import https from 'node:https';
import assert from 'node:assert/strict';
const get = path => new Promise((resolve, reject) => {
  https.get({hostname:'gateway', path, servername:'ws.nayg.ru',
    headers:{Host:'ws.nayg.ru'}, rejectUnauthorized:false, timeout:5000}, response => {
      let body=''; response.on('data', chunk => body+=chunk);
      response.on('end', () => resolve({response, body}));
    }).on('error', reject).on('timeout', function(){this.destroy(new Error('timeout'));});
});
let result;
for(let attempt=0;attempt<20;attempt++) {
  try { result=await get('/api/config'); if(result.response.statusCode===200) break; } catch {}
  await new Promise(resolve=>setTimeout(resolve,500));
}
assert.equal(result?.response.statusCode,200);
assert.deepEqual(JSON.parse(result.body),{ai:false,mode:'demo'});
assert.match(result.response.headers['permissions-policy'],/geolocation=\(self\)/);
assert.match(result.response.headers['permissions-policy'],/microphone=\(self\)/);
assert.equal((await get('/.env')).response.statusCode,404);
assert.match((await get('/')).body,/Waystory/);
console.log('Production Compose, TLS proxy, browser permissions and secret isolation passed.');
JS
