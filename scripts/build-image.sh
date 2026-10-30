#!/usr/bin/env bash
# Retry only the observed Docker Hub token TLS timeout, retaining the same
# Dockerfile and build context. A failed cached build must stop deployment.
build_with_registry_fallback() {
  local build_log build_status
  build_log="$(mktemp)"
  if "$@" build --pull >"$build_log" 2>&1; then
    cat "$build_log"
    rm -f -- "$build_log"
    return 0
  else
    build_status=$?
  fi
  cat "$build_log"
  if grep -q 'failed to fetch anonymous token.*TLS handshake timeout' "$build_log"; then
    rm -f -- "$build_log"
    echo 'Docker Hub token TLS timeout; retrying the same build without forcing a base-image refresh.'
    "$@" build --pull=false
    return $?
  fi
  rm -f -- "$build_log"
  return "$build_status"
}
