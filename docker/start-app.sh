#!/usr/bin/env bash
# Waits for the in-container MongoDB, then runs the Next.js standalone server.
set -euo pipefail

if [ -n "${WAIT_FOR_TCP:-}" ]; then
  host=${WAIT_FOR_TCP%:*}
  port=${WAIT_FOR_TCP##*:}
  for _ in $(seq 1 120); do
    if (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
      exec 3>&- 2>/dev/null || true
      break
    fi
    sleep 0.5
  done
fi

exec node /srv/app/server.js
