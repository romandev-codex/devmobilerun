#!/usr/bin/env bash
# Prepares the environment shared by all processes, then hands over to supervisord.
set -euo pipefail

log() { printf '[entrypoint] %s\n' "$*"; }

: "${MONGODB_URI:=mongodb://127.0.0.1:27017/mobilerun}"
: "${MOBILERUN_CONFIG:=/config/config.yaml}"
export MONGODB_URI MOBILERUN_CONFIG

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

# MongoDB runs in this container unless MONGODB_URI points somewhere else.
case "${MONGODB_EMBEDDED:-auto}" in
  yes | true | 1) embedded=yes ;;
  no | false | 0) embedded=no ;;
  *)
    case "$MONGODB_URI" in
      mongodb://127.0.0.1[:/]* | mongodb://localhost[:/]* | *@127.0.0.1[:/]* | *@localhost[:/]*) embedded=yes ;;
      *) embedded=no ;;
    esac
    ;;
esac

if [ "$embedded" = yes ]; then
  : "${MONGODB_PORT:=27017}"
  mkdir -p /data/db
  cache_opt=""
  [ -n "${MONGO_WIREDTIGER_CACHE_GB:-}" ] && cache_opt="--wiredTigerCacheSizeGB ${MONGO_WIREDTIGER_CACHE_GB}"
  cat > /etc/supervisor/conf.d/mongod.conf <<CONF
[program:mongod]
priority=10
command=/usr/bin/mongod --dbpath /data/db --bind_ip 127.0.0.1 --port ${MONGODB_PORT} ${cache_opt}
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
redirect_stderr=true
CONF
  # start-app.sh blocks until this is accepting connections.
  export WAIT_FOR_TCP="127.0.0.1:${MONGODB_PORT}"
  log "MongoDB runs in this container on port ${MONGODB_PORT} (data in /data/db)"
else
  rm -f /etc/supervisor/conf.d/mongod.conf
  export WAIT_FOR_TCP=""
  log "using the external MongoDB from MONGODB_URI"
fi

exec "$@"
