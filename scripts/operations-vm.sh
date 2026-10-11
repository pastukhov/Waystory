#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
operation="${1:-diagnose}"
request_id="${2:-}"
case "$operation" in diagnose|sources-test|web-source-test|global-source-test|speech-test|speech-format-test|ai-test|restart|rollback) ;; *) echo 'Unsupported operation' >&2; exit 2;; esac
if [[ ! "$request_id" =~ ^[a-z0-9][a-z0-9-]{5,79}$ ]]; then echo 'Invalid request identifier' >&2; exit 2; fi
# No credentials, arbitrary commands, paths or image names are accepted as inputs.
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then docker_cmd=(sudo -n docker); fi
container=waystory-waystory-1
actual_image="$("${docker_cmd[@]}" inspect "$container" --format '{{.Config.Image}}')"
if [[ -n "${WAYSTORY_EXPECT_REVISION:-}" && "$actual_image" != "waystory:$WAYSTORY_EXPECT_REVISION" ]]; then
  echo 'Checked-out revision was not deployed; refusing automatic operations.' >&2
  exit 1
fi
source scripts/image-state.sh
ops_dir=/opt/waystory/operations
mkdir -p -- "$ops_dir/requests"
chmod 700 "$ops_dir" "$ops_dir/requests"
if ! mkdir -- "$ops_dir/requests/$request_id" 2>/dev/null; then
  echo 'This operations request was already claimed. Use a new request ID to retry.'
  exit 0
fi
printf '%s\n' "$operation" > "$ops_dir/requests/$request_id/operation"
container=waystory-waystory-1
"${docker_cmd[@]}" inspect "$container" --format 'Container status: {{.State.Status}}; image: {{.Config.Image}}; restarts: {{.RestartCount}}'
if [[ "$operation" == restart || "$operation" == rollback ]]; then
  current_image="$("${docker_cmd[@]}" inspect "$container" --format '{{.Config.Image}}')"
  image="$current_image"
  if [[ "$operation" == rollback ]]; then
    image=""
    if [[ -r "$ops_dir/previous-image" ]]; then read -r image < "$ops_dir/previous-image"; fi
    if [[ -r "$ops_dir/current-image" ]]; then
      read -r known_good < "$ops_dir/current-image"
      if [[ "$current_image" != "$known_good" ]]; then image="$known_good"; fi
    fi
    test -n "$image" || { echo 'No previous healthy image recorded' >&2; exit 1; }
  fi
  [[ "$image" =~ ^waystory:[a-f0-9]{40}$ ]] || { echo 'Image is not an approved Waystory revision' >&2; exit 1; }
  "${docker_cmd[@]}" image inspect "$image" --format '{{.Id}}' >/dev/null
  settings="$(mktemp)"
  trap 'rm -f -- "$settings"' EXIT
  printf 'WAYSTORY_IMAGE=%s\nWAYSTORY_ENV_FILE=/opt/waystory/.env\nWAYSTORY_PROXY_NETWORK=dogovorovoi_default\n' "$image" > "$settings"
  unset WAYSTORY_IMAGE WAYSTORY_ENV_FILE WAYSTORY_PROXY_NETWORK
  "${docker_cmd[@]}" compose --env-file "$settings" -p waystory -f compose.production.yaml up -d --no-build --force-recreate --wait --wait-timeout 150 waystory
  operation=diagnose
fi
# Only the new allowlisted JSON error records are emitted. Raw Docker logs stay on VM.
if [[ "$operation" == diagnose ]]; then
  "${docker_cmd[@]}" logs --since 1h --tail 200 "$container" 2>&1 | node --input-type=module -e '
    import {safeLogLine} from "./server/diagnostics.mjs";
    let text="";for await(const chunk of process.stdin)text+=chunk;
    for(const line of text.split("\n")){const entry=safeLogLine(line);if(entry)console.log(JSON.stringify(entry));}
  '
fi
"${docker_cmd[@]}" exec -i "$container" node --input-type=module - "$operation" < scripts/ops-probe.mjs
if [[ "${1:-diagnose}" == restart || "${1:-diagnose}" == rollback ]]; then
  record_healthy_image "$ops_dir" "$image"
fi
printf 'success\n' > "$ops_dir/requests/$request_id/result"

