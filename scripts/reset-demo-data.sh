#!/usr/bin/env bash
# Wipe ALL application data (users, bookings, seats, payments, alerts, Kafka topics, Redis) and start
# the stack again with fresh seat inventory for every train and date. Images are kept, so it takes
# about a minute. Use before a demo, or when every date of the demo train 22222 has been used.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != "-y" ]]; then
  read -r -p "This deletes every account and booking. Continue? [y/N] " ok
  [[ "$ok" == [yY] ]] || { echo "Aborted."; exit 1; }
fi
profiles=()
docker compose --profile observability ps -q prometheus 2>/dev/null | grep -q . && profiles=(--profile observability)
docker compose "${profiles[@]}" down -v --remove-orphans
docker compose "${profiles[@]}" up -d --wait
echo "Fresh stack is up: http://localhost:${UI_PORT:-3000} (register a new account)."
