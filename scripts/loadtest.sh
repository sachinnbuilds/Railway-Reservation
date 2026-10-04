#!/usr/bin/env bash
# Runs the k6 Tatkal-rush scenario inside the compose network, then checks consistency.
# Env: USERS (500), BROWSE_RPS (100), CLASS (SL), DATE (a fresh day for train 22222), FAST_REJECT (on|off),
#      ALLOCATION (safe|naive; naive = the deliberately broken allocator, reset to safe on exit)
set -euo pipefail
cd "$(dirname "$0")/.."

USERS=${USERS:-500}
BROWSE_RPS=${BROWSE_RPS:-100}
CLASS=${CLASS:-SL}
if [[ -z "${DATE:-}" ]]; then
  # First day in the booking window on which this class of train 22222 is still completely unsold.
  for d in $(seq 1 14); do
    cand=$(TZ=Asia/Kolkata date -d "+$d days" +%F)
    taken=$(docker compose exec -T postgres psql -U railway -d inventory_db -At -c \
      "SELECT count(*) FROM seat WHERE run_id = '22222-${cand//-/}' AND travel_class = '$CLASS' AND status <> 'AVAILABLE'")
    if [[ "$taken" == "0" ]]; then DATE=$cand; break; fi
  done
  [[ -n "${DATE:-}" ]] || { echo "No unsold day left for 22222 $CLASS; pass DATE=yyyy-mm-dd or reset the stack (docker compose down -v)"; exit 1; }
fi
GATEWAY=http://localhost:${GATEWAY_PORT:-9080}

tok=$(curl -fsS -X POST "$GATEWAY/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"name\":\"ops\",\"email\":\"ops-$RANDOM$RANDOM@ops.test\",\"password\":\"ops-password\"}" | jq -r .token)
if [[ -n "${FAST_REJECT:-}" ]]; then
  enabled=$([[ "$FAST_REJECT" == "off" ]] && echo false || echo true)
  curl -fsS -X PUT "$GATEWAY/api/admin/booking/fast-reject?enabled=$enabled" -H "Authorization: Bearer $tok"; echo
fi
# ALLOCATION=naive runs this test against the deliberately broken allocator (double-booking demo).
mode=$(echo "${ALLOCATION:-safe}" | tr a-z A-Z)
curl -fsS -X PUT "$GATEWAY/api/admin/inventory/allocation-mode?mode=$mode" -H "Authorization: Bearer $tok" | jq -c '{allocationMode: .mode}'
trap 'curl -fsS -X PUT "$GATEWAY/api/admin/inventory/allocation-mode?mode=SAFE" -H "Authorization: Bearer $tok" >/dev/null' EXIT

echo "Tatkal rush on train 22222 $CLASS, journey date $DATE, $USERS users, $BROWSE_RPS searches/s in the background"
docker run --rm -i --network rrs_default -v "$PWD/loadtest:/scripts:ro" grafana/k6:0.54.0 run --quiet \
  -e USERS="$USERS" -e BROWSE_RPS="$BROWSE_RPS" -e CLASS="$CLASS" -e DATE="$DATE" -e RUN_TAG="$(date +%s)" \
  /scripts/tatkal.js || echo "(k6 reported threshold failures, see above)"

echo "Waiting 5s for in-flight saga steps to settle..."
sleep 5
scripts/check-consistency.sh "22222-${DATE//-/}"
