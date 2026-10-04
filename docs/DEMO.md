# Demo runbook

The idea: **every claim made in the UI is then proven outside the UI**, from the databases, Kafka, Redis, `docker` and the test tools. Keep two windows side by side: the browser (http://localhost:3000) and a terminal in the project folder.

Total time: about 20 minutes. Each section stands alone, so they can be skipped or reordered.

---

## 0. Before the reviewers arrive

```bash
docker compose up -d --build --wait                      # whole stack
scripts/reset-demo-data.sh                               # fresh data: every date of demo train 22222 untouched
docker compose --profile observability up -d             # Grafana :3001 (optional)
scripts/chaos.sh restore                                 # healthy payment gateway, everything up
python3 scripts/ui-test/ui_e2e.py                        # optional: 26-step browser self-test
```

Open these tabs:

* the UI at http://localhost:3000 (logged in)
* the Eureka dashboard at http://localhost:9761
* Grafana at http://localhost:3001 → RailReserve dashboard
* in your editor: the five code files listed in section 9

---

## 1. "These are really separate services" (2 min)

```bash
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
```

This shows 2 search, 2 inventory and 2 booking replicas plus the other services, each its own JVM. The Eureka dashboard (Spring's own page, not ours) lists the same instances.

```bash
docker compose exec postgres psql -U railway -l | grep _db
```

This shows **six separate databases**, one per service. Then show that no service reads another's data: `grep -rn "jdbc:postgresql" */src/main/resources/application.yml`.

Scale a service live, then show the load balancing in the terminal. In one terminal:

```bash
docker compose up -d --scale search-service=3 search-service   # wait ~15 s for Eureka to list it
scripts/watch-search.sh                                         # live per-replica counter
```

Then click *Fire 60 searches* in the Control room. The terminal fills in live, ending on about 20 / 20 / 20, with each line coming from a different container's own log:

```
  Search requests per replica (total 60)

  search-service-1     20  ####################
  search-service-2     20  ####################
  search-service-3     20  ####################
```

(`docker compose up -d` without `--scale` later returns search to its default of 2 replicas.)

## 2. Follow one booking through the whole system (3 min)

Book a ticket in the UI (Book → Delhi → Bhopal → a class → Book now → Pay). Copy the PNR, then run:

```bash
scripts/trace-booking.sh <PNR>
```

It prints the booking row and its saga history (booking_db), the seat rows (inventory_db), the charge (payment_db), the SMS (notification_db), the Kafka messages for the booking with their partitions, and the log lines showing **which replica handled each step**. Steps of the same booking often run on different booking replicas. That is the stateless design working.

## 3. Problem 2: the double booking we prevent (4 min)

**First show the problem is real.** In the Control room (Tatkal rush simulator card, the line under the inputs), click **NAIVE (broken)** next to *Seat allocator*, accept the warning, then click *Open Tatkal window*.

> Result seen in testing: **120 confirmed and paid tickets for a 72-seat coach**; seat S1-13 was sold to 12 passengers; the seat map shows only 16 seats actually booked.

The naive allocator does what a simple implementation does: it reads the free seats, then writes them, with no lock, no status check, and requests processed in parallel. Code: `SeatInventory.holdNaive`.

Prove it from the database, not the UI:

```bash
scripts/check-consistency.sh 22222-<yyyymmdd of that run>     # FAIL: lists seats on several PNRs
```

**Then the real system.** Switch the allocator back to **SAFE**. The simulator moves to a fresh, untouched date by itself; never compare modes on the same date, because the NAIVE run has already corrupted it. Run the rush again: exactly 72 confirmed, and ✓ consistent.

Each rush uses up one journey date per class (14 per class). If the Control room says no fresh date is left, switch class or run `scripts/reset-demo-data.sh`.

```bash
scripts/check-consistency.sh 22222-<new run>                  # all PASS
docker compose exec postgres psql -U railway -d inventory_db \
  -c "SELECT status, count(*) FROM seat WHERE run_id = '22222-<new run>' AND travel_class = 'SL' GROUP BY 1"
```

Explain *why* it is safe. Open `inventory-service/src/main/resources/db/migration/V1__inventory.sql`: one row per seat, one `booking_id` column, and `CHECK` constraints mean two owners cannot even be stored. Then open the `FOR UPDATE SKIP LOCKED` query in `SeatInventory.java`.

The same comparison from the terminal, with k6 as the load generator:

```bash
ALLOCATION=naive USERS=300 scripts/loadtest.sh     # ends with FAIL ... DOUBLE BOOKING
USERS=300 scripts/loadtest.sh                      # ends with all PASS
```

## 4. Problem 1: Tatkal rush (3 min)

Before clicking *Open Tatkal window* (SAFE mode), start the Kafka watcher in the terminal:

```bash
docker compose exec kafka kafka-console-consumer --bootstrap-server kafka:9092 \
  --topic inventory.commands --property print.key=true --property print.partition=true | cut -c1-120
```

Every request for the train arrives with key `22222-<date>` on **one partition**. That is the per-train queue. The rejected majority never appears here: Redis turned them away first. Show the Redis numbers:

```bash
docker compose exec redis redis-cli --scan --pattern 'booking:hint:*22222*'
docker compose exec redis redis-cli --scan --pattern 'request_rate_limiter*' | head
```

Then the real load test, with a third-party tool (k6) hitting the gateway:

```bash
USERS=1000 BROWSE_RPS=200 scripts/loadtest.sh
```

> Seen in testing: 1,000 users, 920 rejected instantly, 72 confirmed, **0 errors**, search p95 7 ms during the spike, all invariants PASS.

Rate limiter: set *Users = 1, Requests per user = 20*. 5 requests are accepted, 15 get **429** from the gateway.

## 5. Problem 3: money deducted, no ticket (2 min)

Click *Money deducted, no reply* in the Control room, then book and pay in the UI. The page says "verifying your payment, do not pay again", and a few seconds later the ticket is confirmed. Prove what happened:

```bash
scripts/trace-booking.sh <PNR>
```

The trace shows `PAYMENT_UNKNOWN`, the bank's row saying `SUCCEEDED`, and the reconciler log: "gateway says SUCCEEDED → confirming". Code: `PaymentClient.java` (the four outcomes) and `Reconciler.java`. Click *Reset to healthy* afterwards.

## 6. Problem 4: slow bank, no cascade (2 min)

Click *Slow bank* and pay for 5 or 6 bookings. The circuit-breaker cards turn **OPEN**, and further payments fail in milliseconds with "no money taken, seats still held". Meanwhile search still answers instantly. In the terminal:

```bash
docker compose exec booking-service curl -s localhost:8084/actuator/circuitbreakers | jq '.circuitBreakers.payment.state'
docker compose logs --since 2m payment-service | tail -5       # no new charges arrive while OPEN
```

## 7. Problem 5 plus fault tolerance: break things for real (3 min)

```bash
docker kill $(docker compose ps -q inventory-service | head -1)   # during a rush
docker compose ps inventory-service                               # one replica gone
scripts/check-consistency.sh                                      # still all PASS
scripts/chaos.sh stop-redis          # search still works (timetable + fares), booking still works
scripts/chaos.sh stop-notification   # book a ticket: it confirms; alerts arrive after restore
scripts/chaos.sh restore
```

## 8. Tests that run in front of them (2 min)

```bash
./mvnw -pl inventory-service -am test      # real Postgres in Docker; 300 threads race for 50 seats
```

The output shows 5 tests passing, including both locking strategies producing exactly 50 winners and multi-seat requests being all-or-nothing.

## 9. Code walkthrough: five files to know cold

| File | What to say |
|------|-------------|
| `inventory-service/.../db/migration/V1__inventory.sql` | One row per seat plus CHECKs: double booking cannot be stored |
| `inventory-service/.../SeatInventory.java` | `SKIP LOCKED` pick-and-update in one statement; the leases and the reaper; `holdNaive` as the counter-example |
| `booking-service/.../SeatHints.java` | Lua admit script: `avail − inflight ≥ n`, atomic, fails open |
| `booking-service/.../PaymentClient.java` + `Reconciler.java` | Four outcomes; never guess on `Unknown`; refunds |
| `common/.../messaging/Outbox.java` + `OutboxPublisher.java` | State change and event in one transaction; `SKIP LOCKED` publisher |

---

## Likely viva questions

**Why Kafka and not just a database lock?** Under a Tatkal spike, thousands of threads waiting on row locks exhaust connection pools and time out. Keying commands by train run turns the spike into an ordered queue per train: correct by construction, and different trains still run in parallel.

**What if Kafka delivers a message twice?** Every consumer records the message id in `processed_message` in the same transaction as its effect. A duplicate becomes a no-op (`Idempotency.java`).

**What if the service crashes after updating the DB but before sending the event?** That cannot lose the event. The event is written to the `outbox` table in the same transaction, and a poller publishes it later.

**Can the Redis fast-reject cause overselling?** No. It is only a hint. In one test it admitted 80 requests for 72 seats, and inventory rejected the extra 8. If Redis is lost, the system becomes slower, never wrong.

**Two booking replicas run the reconciler: won't they confirm twice?** Every state change is `UPDATE … WHERE status IN (expected)`. One wins and the other gets zero rows; the logs show "already reconciled by another replica".

**Why is payment synchronous?** The user is waiting for the bank anyway. A bounded call (3 s timeout, breaker, bulkhead) gives clear UX, and every ambiguous outcome goes to the reconciler instead of being guessed.

**CAP?** Seats are CP: the system rejects or delays rather than risk a double booking. Search is AP: a projection that may be seconds stale, labelled as such, and re-checked at booking.

**What would you do next?** Per-segment seat allocation and waitlist/RAC, 3 Kafka brokers with RF 3, a Postgres replica for catalog reads, and distributed tracing (OpenTelemetry).
