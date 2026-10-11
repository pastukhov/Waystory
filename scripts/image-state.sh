#!/usr/bin/env bash
# Call only after a health check succeeds. Failed deployments never enter this registry.
record_healthy_image() {
  local state_dir="$1" new_image="$2" old_image=""
  [[ "$new_image" =~ ^waystory:[a-f0-9]{40}$ ]] || return 1
  install -d -m 0700 "$state_dir"
  if [[ -r "$state_dir/current-image" ]]; then read -r old_image < "$state_dir/current-image"; fi
  if [[ "$old_image" =~ ^waystory:[a-f0-9]{40}$ && "$old_image" != "$new_image" ]]; then
    printf '%s\n' "$old_image" > "$state_dir/previous-image.tmp"
    mv "$state_dir/previous-image.tmp" "$state_dir/previous-image"
  fi
  printf '%s\n' "$new_image" > "$state_dir/current-image.tmp"
  mv "$state_dir/current-image.tmp" "$state_dir/current-image"
}
