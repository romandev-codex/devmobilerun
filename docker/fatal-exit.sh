#!/usr/bin/env bash
# Supervisor event listener: stops the container when a process gives up
# restarting, so the orchestrator restarts the container instead of leaving a
# half-dead one running. Its stdout is the supervisor protocol channel.
set -u

printf 'READY\n'
while read -r header; do
  len=${header##*len:}
  payload=""
  [ -n "$len" ] && IFS= read -r -n "$len" payload || true
  printf 'RESULT 2\nOK'
  name=$(printf '%s' "$payload" | tr ' ' '\n' | sed -n 's/^processname://p')
  printf '[supervisor] %s entered FATAL; stopping the container\n' "${name:-a process}" >&2
  kill -TERM 1
  printf 'READY\n'
done
