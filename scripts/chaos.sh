#!/usr/bin/env bash
# Failure injection for demos. Each scenario prints what to expect.
#   scripts/chaos.sh <scenario>
# Scenarios:
#   kill-inventory    kill one inventory replica (Kafka moves its partitions to the survivor in ~10s)
#   kill-booking      kill one booking replica (gateway/Eureka route around it; its outbox rows are published by the other)
#   stop-notification stop notification-service (bookings still confirm; alerts arrive after 'restore')
#   stop-redis        stop Redis (search degrades to timetable-only, fast-reject and rate limiter fail open)
#   payment-slow      bank takes 4s per charge (timeouts -> circuit breaker opens -> instant 503s, seats kept)
#   payment-timeout   bank charges but never answers in time (PAYMENT_UNKNOWN -> reconciler confirms)
#   payment-flaky     40% of charges declined (seats released, no money taken)
#   payment-down      bank returns 503 (no money taken, seats kept, user retries)
#   restore           undo everything above
set -euo pipefail
cd "$(dirname "$0")/.."
GATEWAY=http://localhost:${GATEWAY_PORT:-9080}

token() {
  curl -fsS -X POST "$GATEWAY/api/auth/register" -H 'Content-Type: application/json' \
    -d "{\"name\":\"chaos\",\"email\":\"chaos-$RANDOM$RANDOM@ops.test\",\"password\":\"chaos-password\"}" | jq -r .token
}
chaos() {
  curl -fsS -X PUT "$GATEWAY/api/admin/payment/chaos" -H "Authorization: Bearer $(token)" \
    -H 'Content-Type: application/json' -d "$1"; echo
}

case "${1:-}" in
  kill-inventory)    docker kill "$(docker compose ps -q inventory-service | head -1)" >/dev/null
                     echo "Killed one inventory replica. In-flight commands are redelivered to the survivor; run scripts/check-consistency.sh afterwards." ;;
  kill-booking)      docker kill "$(docker compose ps -q booking-service | head -1)" >/dev/null
                     echo "Killed one booking replica. New requests go to the other within ~15s (Eureka lease expiry); connect failures are retried by the gateway." ;;
  stop-notification) docker compose stop notification-service
                     echo "Notifications stopped. Book a ticket: it still confirms. Run 'restore' and the alerts appear." ;;
  stop-redis)        docker compose stop redis
                     echo "Redis stopped. Search shows timetable + fares with 'Check at booking'; booking still works (slower, no fast-reject)." ;;
  payment-slow)      chaos '{"latencyMs":4000,"failureRate":0,"timeoutAfterChargeRate":0,"down":false}' ;;
  payment-timeout)   chaos '{"latencyMs":300,"failureRate":0,"timeoutAfterChargeRate":1,"down":false}' ;;
  payment-flaky)     chaos '{"latencyMs":300,"failureRate":0.4,"timeoutAfterChargeRate":0,"down":false}' ;;
  payment-down)      chaos '{"latencyMs":300,"failureRate":0,"timeoutAfterChargeRate":0,"down":true}' ;;
  restore)           docker compose up -d --wait redis notification-service inventory-service booking-service >/dev/null 2>&1
                     chaos '{"latencyMs":300,"failureRate":0,"timeoutAfterChargeRate":0,"down":false}'
                     echo "All services up, payment gateway healthy." ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
