#!/bin/sh
# Docker creates a bind-mounted ./data owned by root. Give it to the app user, then drop root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R 1001:1001 "${DATA_DIR:-/data}"
  exec setpriv --reuid=1001 --regid=1001 --clear-groups "$@"
fi
exec "$@"
