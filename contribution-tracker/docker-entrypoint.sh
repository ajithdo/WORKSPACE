#!/bin/sh
# Docker creates a bind-mounted ./data owned by root. Give it to the app user, then drop root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  # Some hosts (Docker Desktop on Windows) don't support chown on bind mounts; those mounts are writable anyway.
  chown -R 1001:1001 "${DATA_DIR:-/data}" 2>/dev/null || true
  exec setpriv --reuid=1001 --regid=1001 --clear-groups "$@"
fi
exec "$@"
