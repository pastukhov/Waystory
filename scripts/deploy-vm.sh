#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
revision="$(git rev-parse HEAD)"
if [ "${WAYSTORY_REQUIRE_MAIN:-false}" = true ]; then
  main_revision="$(git ls-remote https://github.com/pastukhov/Waystory.git refs/heads/main | cut -f1)"
  if [ "$revision" != "$main_revision" ]; then
    echo 'Skipping an older commit: main has moved.'
    exit 0
  fi
fi

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  docker_cmd=(sudo -n docker)
  "${docker_cmd[@]}" info >/dev/null
fi

env_file="${WAYSTORY_ENV_FILE:-/opt/waystory/.env}"
proxy_network="${WAYSTORY_PROXY_NETWORK:-dogovorovoi_default}"
test -r "$env_file" || { echo "Missing readable environment file: $env_file" >&2; exit 1; }
"${docker_cmd[@]}" network inspect "$proxy_network" >/dev/null

# Pass interpolation settings explicitly through sudo without exposing secrets.
# This file contains paths and an image tag only, no credentials.
settings="$(mktemp)"
trap 'rm -f -- "$settings"' EXIT
printf 'WAYSTORY_IMAGE=waystory:%s\nWAYSTORY_ENV_FILE=%s\nWAYSTORY_PROXY_NETWORK=%s\n' \
  "$revision" "$env_file" "$proxy_network" > "$settings"
unset WAYSTORY_IMAGE WAYSTORY_ENV_FILE WAYSTORY_PROXY_NETWORK
compose() {
  "${docker_cmd[@]}" compose --env-file "$settings" -p waystory -f compose.production.yaml "$@"
}
compose config --quiet
source scripts/image-state.sh
previous_image="$("${docker_cmd[@]}" inspect waystory-waystory-1 --format '{{.Config.Image}}' 2>/dev/null || true)"
previous_health="$("${docker_cmd[@]}" inspect waystory-waystory-1 --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)"
if [[ ! -e /opt/waystory/operations/current-image && "$previous_health" == healthy && "$previous_image" =~ ^waystory:[a-f0-9]{40}$ ]]; then
  record_healthy_image /opt/waystory/operations "$previous_image"
fi
compose build --pull
compose up --detach --wait --wait-timeout 150
compose exec -T waystory node -e \
  "fetch('http://127.0.0.1:5173/api/config').then(r=>{if(!r.ok)process.exit(1);console.log('Waystory is healthy')}).catch(()=>process.exit(1))"

# Probe the deployed instance without cookies. These requests must never reach AI.
compose exec -T waystory node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5173';
const session=await (await fetch(base+'/api/session')).json();
assert.equal(session.user,null);
const config=await (await fetch(base+'/api/config')).json();
assert.equal(config.ai,false);
for(const path of ['/api/guide','/api/speech']){
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(r.status,session.enabled?401:503,`Anonymous access to ${path} must be denied`);
 console.log(`Anonymous ${path}: ${r.status}, access denied`);
}
JS

record_healthy_image /opt/waystory/operations "waystory:$revision"
