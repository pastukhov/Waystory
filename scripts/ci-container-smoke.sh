#!/usr/bin/env bash
set -euo pipefail

# Work in a disposable copy: never overwrite a developer's real .env.
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
smoke_dir="$(mktemp -d)"
compose_project="waystory-ci-${GITHUB_RUN_ID:-$$}"
cleanup() {
  smoke_exit=$?
  if [ "$smoke_exit" -ne 0 ]; then
    docker compose -p "$compose_project" -f "$smoke_dir/compose.yaml" logs --no-color || true
  fi
  docker compose -p "$compose_project" -f "$smoke_dir/compose.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$smoke_dir"
  exit "$smoke_exit"
}
trap cleanup EXIT

cp "$project_root/Dockerfile" "$project_root/compose.yaml" "$project_root/.dockerignore" "$project_root/package.json" "$smoke_dir/"
cp -R "$project_root/dist" "$project_root/server" "$smoke_dir/"
cat > "$smoke_dir/.env" <<'ENV'
PORT=18080
HOST=127.0.0.1
BIND_ADDRESS=127.0.0.1
WAYSTORY_CI_SECRET='ci-only$not-a-real-secret#sentinel'
ENV

# Avoid shell environment overriding this test fixture during interpolation.
export PORT=18080 BIND_ADDRESS=127.0.0.1
cd "$smoke_dir"
docker compose -p "$compose_project" config --quiet
docker compose -p "$compose_project" up --build --detach --wait --wait-timeout 90

# This call exercises the published host port, not just container loopback.
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:18080/ > "$smoke_dir/response.html"
test -s "$smoke_dir/response.html"
docker compose -p "$compose_project" exec -T waystory node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
writeFileSync('/app/data/smoke','persistent');
assert.equal(readFileSync('/app/data/smoke','utf8'),'persistent');

assert.notEqual(process.getuid(), 0, 'The container must run without root');
assert.equal(existsSync('/app/.env'), false, '.env must not be included in the image');
assert.equal(process.env.WAYSTORY_CI_SECRET, 'ci-only$not-a-real-secret#sentinel');
assert.equal(process.env.HOST, '0.0.0.0');

const base = 'http://127.0.0.1:' + process.env.PORT;
const config = await fetch(base + '/api/config');
assert.equal(config.status, 200);
const data = await config.json();
assert.deepEqual(data, {ai: false, mode: 'demo'});
assert.equal(JSON.stringify(data).includes(process.env.WAYSTORY_CI_SECRET), false);
for (const url of ['/.env', '/server/config.mjs']) {
  assert.equal((await fetch(base + url)).status, 404);
}
assert.equal((await fetch(base + '/api/guide', {method: 'POST'})).status, 503);
assert.match(await (await fetch(base + '/')).text(), /Waystory/);
console.log('Container, HTTP, non-root user, and runtime environment checks passed.');
JS
