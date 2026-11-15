#!/usr/bin/env bash

validate_backup_key() {
  local key="${1:-}" normalized decoded_bytes

  [[ "$key" =~ ^[[:xdigit:]]{64}$ ]] && return 0
  [[ "$key" =~ ^[A-Za-z0-9+/]{43}=?$ ]] || return 1

  normalized="$key"
  [ "${#normalized}" -eq 44 ] || normalized="${normalized}="
  decoded_bytes="$(printf '%s' "$normalized" | base64 --decode 2>/dev/null | wc -c)" || return 1
  decoded_bytes="${decoded_bytes//[[:space:]]/}"
  [ "$decoded_bytes" = 32 ]
}
