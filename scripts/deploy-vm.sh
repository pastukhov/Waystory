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
compose build --pull
compose up --detach --wait --wait-timeout 150
compose exec -T waystory node -e \
  "fetch('http://127.0.0.1:5173/api/config').then(r=>{if(!r.ok)process.exit(1);console.log('Waystory is healthy')}).catch(()=>process.exit(1))"
