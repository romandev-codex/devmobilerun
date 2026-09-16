#!/usr/bin/env bash
# Prepares the environment shared by all processes, then hands over to supervisord.
set -euo pipefail

log() { printf '[entrypoint] %s\n' "$*"; }

: "${MOBILERUN_CONFIG:=/config/config.yaml}"
export MOBILERUN_CONFIG

# MongoDB is external (e.g. Atlas); the image does not ship a server.
if [ -z "${MONGODB_URI:-}" ]; then
  log "MONGODB_URI is required, e.g. mongodb+srv://user:pass@cluster.example.mongodb.net/"
  exit 1
fi
case "$MONGODB_URI" in
  mongodb://127.0.0.1[:/]* | mongodb://localhost[:/]* | *@127.0.0.1[:/]* | *@localhost[:/]*)
    log "warning: MONGODB_URI points at this container's loopback, where no MongoDB runs" ;;
esac

# The app and the executor authenticate to each other over loopback with this
# token. Generate one when the operator did not supply it.
if [ -z "${EXECUTOR_TOKEN:-}" ]; then
  EXECUTOR_TOKEN="$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"
  log "EXECUTOR_TOKEN not set; generated one for this container"
fi
export EXECUTOR_TOKEN

# Seed the framework config on first start so it can be edited in the /config
# volume without rebuilding the image.
if [ ! -e "$MOBILERUN_CONFIG" ]; then
  mkdir -p "$(dirname "$MOBILERUN_CONFIG")"
  cp /srv/defaults/config.yaml "$MOBILERUN_CONFIG"
  log "seeded $MOBILERUN_CONFIG from the bundled default"
fi

exec "$@"
