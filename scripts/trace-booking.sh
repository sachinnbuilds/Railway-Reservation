#!/usr/bin/env bash
# Follow ONE booking through the whole distributed system, straight from the sources of truth:
# 4 databases, 3 Kafka topics and the logs of every container that touched it.
#   scripts/trace-booking.sh <PNR | booking-id>      (no argument = the most recent booking)
set -uo pipefail
cd "$(dirname "$0")/.."

q() { docker compose exec -T postgres psql -U railway -d "$1" -At -F' | ' -c "$2"; }
table() { docker compose exec -T postgres psql -U railway -d "$1" -P pager=off -c "$2"; }
h() { printf '\n\033[1;36m== %s\033[0m\n' "$1"; }

ARG=${1:-}
if [[ -z $ARG ]]; then
  ID=$(q booking_db "SELECT id FROM booking ORDER BY created_at DESC LIMIT 1")
elif [[ $ARG =~ ^[0-9]{10}$ ]]; then
  ID=$(q booking_db "SELECT id FROM booking WHERE pnr = '$ARG'")
else
  ID=$ARG
fi
[[ -n $ID ]] || { echo "No booking found for '$ARG'"; exit 1; }
PNR=$(q booking_db "SELECT pnr FROM booking WHERE id = '$ID'")
RUN=$(q booking_db "SELECT run_id FROM booking WHERE id = '$ID'")
echo "Tracing booking $ID  (PNR $PNR, train run $RUN)"

h "1. booking-service  ->  booking_db.booking   (the saga's state)"
table booking_db "SELECT pnr, status, run_id, travel_class AS cls, seat_count AS pax, seats, total_fare, payment_id IS NOT NULL AS paid, refund_status AS refund FROM booking WHERE id = '$ID'"

h "2. booking-service  ->  booking_db.booking_history   (every saga transition)"
table booking_db "SELECT to_char(at, 'HH24:MI:SS.MS') AS at, status, note FROM booking_history WHERE booking_id = '$ID' ORDER BY id"

h "3. inventory-service  ->  inventory_db.seat   (the single source of truth for seats)"
table inventory_db "SELECT run_id, travel_class AS cls, seat_no, status, to_char(hold_expires_at, 'HH24:MI:SS') AS hold_until, to_char(updated_at, 'HH24:MI:SS.MS') AS updated FROM seat WHERE booking_id = '$ID' ORDER BY seat_idx"
n=$(q inventory_db "SELECT count(*) FROM seat WHERE booking_id = '$ID'")
[[ $n == 0 ]] && echo "  (no seat rows owned now: never allocated, released, expired, or cancelled - see the history above)"

h "4. payment-service  ->  payment_db.payment   (the mock bank's record)"
table payment_db "SELECT id AS payment_id, status, amount, reason, to_char(created_at, 'HH24:MI:SS.MS') AS charged_at FROM payment WHERE booking_id = '$ID'"

h "5. notification-service  ->  notification_db.notification   (what the passenger was told)"
table notification_db "SELECT to_char(created_at, 'HH24:MI:SS') AS at, status, message FROM notification WHERE booking_id = '$ID' ORDER BY id"

h "6. Kafka messages about this booking   (UTC time, topic[partition], key, type)"
docker compose exec -T kafka kafka-console-consumer --bootstrap-server kafka:9092 \
  --include 'inventory\.commands|inventory\.events|booking\.events' --from-beginning --timeout-ms 5000 \
  --property print.partition=true --property print.key=true --property print.timestamp=true 2>/dev/null \
  | grep -F "$ID" | while IFS=$'\t' read -r ts part key value; do
      t=$(date -u -d "@$(( ${ts#CreateTime:} / 1000 ))" +%H:%M:%S)
      type=$(jq -r '.type' <<<"$value" 2>/dev/null)
      topic=$(case $type in HoldSeats|ConfirmSeats|ReleaseSeats) echo inventory.commands;; BookingStatusChanged) echo booking.events;; *) echo inventory.events;; esac)
      printf '  %s  %-19s %-5s key=%-38s %s\n' "$t" "$topic" "[${part#Partition:}]" "$key" "$type"
    done | sort
echo "  (inventory.commands is keyed by train run: every request for $RUN lands on the same partition, in order)"

h "7. Container logs mentioning this booking   (which replica did what)"
docker compose logs --no-color booking-service inventory-service payment-service notification-service 2>/dev/null \
  | grep -E "$ID|$PNR" | grep -v "DEBUG" | sed -E 's/ +\| /  /; s/[0-9]{4}-[0-9]{2}-[0-9]{2}T([0-9:.]{12})[0-9]*Z +INFO [0-9]+ --- \[[^]]*\] \[[^]]*\] [^ ]+ +: /\1  /' | sort -k2 | cut -c1-220
