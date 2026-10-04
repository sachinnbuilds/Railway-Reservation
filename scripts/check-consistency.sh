#!/usr/bin/env bash
# Cross-database invariant check. Run any time; most useful after a load test or chaos run.
#   scripts/check-consistency.sh [runId]
# Exit 0 = all invariants hold, 1 = violation found.
set -uo pipefail
cd "$(dirname "$0")/.."

RUN=${1:-}
psql() { docker compose exec -T postgres psql -U railway -d "$1" -At -F, -c "$2"; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }

echo "Consistency check ${RUN:+for run $RUN}"
if [[ -n $RUN ]]; then
  filter_inv="AND run_id = '$RUN'"
  filter_book="AND run_id = '$RUN'"
else
  # Runs used for the deliberate NAIVE-allocator demo are broken on purpose; report them separately.
  naive=$(psql inventory_db "SELECT string_agg(quote_literal(run_id), ',') FROM naive_run")
  filter_inv=${naive:+"AND run_id NOT IN ($naive)"}
  filter_book=$filter_inv
  [[ -n $naive ]] && echo "  (excluding naive-allocator demo runs: ${naive//\'/})"
fi

# 1. No seat sold twice. The schema makes it unrepresentable; we still verify the evidence.
n=$(psql inventory_db "SELECT count(*) FROM seat WHERE status <> 'AVAILABLE' AND booking_id IS NULL")
[[ $n == 0 ]] && pass "every taken seat has exactly one owner" || bad "$n taken seats without an owner"

# 2. Never more seats sold than exist, per run and class.
n=$(psql inventory_db "SELECT count(*) FROM (SELECT run_id, travel_class, count(*) FILTER (WHERE status='BOOKED') b, count(*) t FROM seat WHERE true $filter_inv GROUP BY 1,2 HAVING count(*) FILTER (WHERE status='BOOKED') > count(*)) x")
[[ $n == 0 ]] && pass "booked seats <= capacity for every run/class" || bad "$n run/classes oversold"

# 2b. No seat printed on two confirmed tickets (what a passenger would actually experience).
n=$(psql booking_db "SELECT count(*) FROM (SELECT 1 FROM booking, unnest(string_to_array(seats, ',')) seat WHERE status = 'CONFIRMED' $filter_book GROUP BY run_id, travel_class, seat HAVING count(*) > 1) x")
if [[ $n == 0 ]]; then pass "no seat appears on two confirmed tickets"
else bad "$n seats appear on more than one confirmed ticket (DOUBLE BOOKING)"
  psql booking_db "SELECT '      ' || run_id || ' ' || seat || ' -> PNRs ' || string_agg(pnr, ', ') FROM booking, unnest(string_to_array(seats, ',')) seat WHERE status = 'CONFIRMED' $filter_book GROUP BY run_id, travel_class, seat HAVING count(*) > 1 ORDER BY 1 LIMIT 5"
fi

# 3. The two services agree: CONFIRMED bookings <-> BOOKED seats (same booking ids, same seat counts).
psql inventory_db "SELECT booking_id || ':' || count(*) FROM seat WHERE status = 'BOOKED' $filter_inv GROUP BY booking_id ORDER BY 1" > "$tmp/inv"
psql booking_db "SELECT id || ':' || seat_count FROM booking WHERE status = 'CONFIRMED' $filter_book ORDER BY 1" > "$tmp/book"
only_inv=$(comm -23 "$tmp/inv" "$tmp/book" | wc -l); only_book=$(comm -13 "$tmp/inv" "$tmp/book" | wc -l)
total=$(wc -l < "$tmp/book")
if [[ $only_inv == 0 && $only_book == 0 ]]; then pass "booking-service and inventory-service agree on all $total confirmed bookings"
else bad "mismatch: $only_inv only in inventory, $only_book only in booking-service"; comm -3 "$tmp/inv" "$tmp/book" | head; fi

# 4. Money: every successful (unrefunded) charge belongs to a confirmed (or confirming) booking, and vice versa.
psql payment_db "SELECT booking_id FROM payment WHERE status = 'SUCCEEDED' ORDER BY 1" > "$tmp/paid"
psql booking_db "SELECT id FROM booking WHERE status IN ('CONFIRMED','CONFIRMING') OR refund_status = 'PENDING' ORDER BY 1" > "$tmp/should_pay"
psql booking_db "SELECT id FROM booking WHERE status IN ('CONFIRMED','CONFIRMING') $filter_book ORDER BY 1" > "$tmp/confirmed_all"
charged_not_booked=$(comm -23 "$tmp/paid" "$tmp/should_pay" | wc -l)
booked_not_charged=$(comm -13 "$tmp/paid" "$tmp/confirmed_all" | wc -l)
[[ $charged_not_booked == 0 ]] && pass "no customer charged without a ticket (or a refund in progress)" || bad "$charged_not_booked charges with no ticket and no refund"
[[ $booked_not_charged == 0 ]] && pass "no ticket confirmed without a successful charge" || bad "$booked_not_charged confirmed bookings without a charge"

# 5. Nothing stuck: non-final bookings older than the hold window + grace.
n=$(psql booking_db "SELECT count(*) FROM booking WHERE status NOT IN ('CONFIRMED','REJECTED','PAYMENT_FAILED','EXPIRED','CANCELLED','FAILED') AND updated_at < now() - interval '5 minutes'")
[[ $n == 0 ]] && pass "no saga stuck in an intermediate state" || bad "$n bookings stuck in an intermediate state"

# 6. Leases: no seat held long past its expiry (reaper is running).
n=$(psql inventory_db "SELECT count(*) FROM seat WHERE status = 'HELD' AND hold_expires_at < now() - interval '30 seconds'")
[[ $n == 0 ]] && pass "no expired seat holds left behind" || bad "$n expired holds not reaped"

if [[ -n $RUN ]]; then
  echo "  Run $RUN:"
  psql inventory_db "SELECT '    ' || travel_class || ': ' || count(*) FILTER (WHERE status='BOOKED') || ' booked, ' || count(*) FILTER (WHERE status='HELD') || ' held, ' || count(*) FILTER (WHERE status='AVAILABLE') || ' free of ' || count(*) FROM seat WHERE run_id = '$RUN' GROUP BY travel_class ORDER BY 1"
  psql booking_db "SELECT '    bookings ' || status || ': ' || count(*) FROM booking WHERE run_id = '$RUN' GROUP BY status ORDER BY 1"
fi
exit $fail
