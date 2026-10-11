#!/usr/bin/env bash
set -euo pipefail
source scripts/image-state.sh
state_dir="$(mktemp -d)"
trap 'rm -rf -- "$state_dir"' EXIT
image_a=waystory:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
image_c=waystory:cccccccccccccccccccccccccccccccccccccccc
record_healthy_image "$state_dir" "$image_a"
# A failed B never calls record_healthy_image; C must preserve A, not B.
record_healthy_image "$state_dir" "$image_c"
test "$(cat "$state_dir/previous-image")" = "$image_a"
test "$(cat "$state_dir/current-image")" = "$image_c"
record_healthy_image "$state_dir" "$image_c"
test "$(cat "$state_dir/previous-image")" = "$image_a"
if record_healthy_image "$state_dir" 'untrusted:image'; then exit 1; fi
echo 'Healthy image history passed'
