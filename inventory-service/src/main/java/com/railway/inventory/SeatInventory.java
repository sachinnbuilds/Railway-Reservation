package com.railway.inventory;

import com.railway.common.events.EventTypes;
import com.railway.common.events.Messages.AvailabilityChanged;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Outbox;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * All seat-state changes. Every method must run inside the caller's transaction so the seat change,
 * the idempotency marker and the outgoing events commit atomically.
 *
 * <p>Correctness does not depend on the Kafka ordering or on locks being taken in the right order:
 * every state change is a conditional UPDATE ({@code WHERE status = ...}) on the single row that
 * represents a seat, and the table's CHECK constraints make "one seat, two owners" unrepresentable.
 * Locking strategy (SKIP LOCKED) only affects throughput.
 */
@Component
@Transactional(propagation = Propagation.MANDATORY)
public class SeatInventory {

    private static final Logger log = LoggerFactory.getLogger(SeatInventory.class);
    private static final int MAX_ATTEMPTS = 3;

    public sealed interface HoldResult permits Held, Rejected {
    }

    public record Held(List<String> seats, Instant expiresAt) implements HoldResult {
    }

    public record Rejected(String reason) implements HoldResult {
    }

    public record Released(UUID bookingId, String runId, String travelClass, int seats) {
    }

    private final JdbcTemplate jdbc;
    private final Outbox outbox;
    private final String pickSql;
    private final Counter allocationRetries;

    public SeatInventory(JdbcTemplate jdbc, Outbox outbox, MeterRegistry meters,
                         @Value("${inventory.skip-locked:true}") boolean skipLocked) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.allocationRetries = meters.counter("seat_allocation_retries");
        // Pick the first N free seats and flip them to HELD in one statement.
        // SKIP LOCKED: concurrent allocators for the same class take *different* seats instead of
        // queueing behind each other. Without it, a waiter re-checks status after the lock is
        // released and may come back short, so we retry.
        this.pickSql = """
                WITH picked AS (
                    SELECT seat_no FROM seat
                    WHERE run_id = ? AND travel_class = ? AND status = 'AVAILABLE'
                    ORDER BY seat_idx
                    LIMIT ?
                    FOR UPDATE %s
                )
                UPDATE seat s
                SET status = 'HELD', booking_id = ?, hold_expires_at = now() + make_interval(secs => ?),
                    updated_at = now()
                FROM picked
                WHERE s.run_id = ? AND s.travel_class = ? AND s.seat_no = picked.seat_no
                  AND s.status = 'AVAILABLE'
                RETURNING s.seat_no, s.hold_expires_at""".formatted(skipLocked ? "SKIP LOCKED" : "");
        log.info("Seat allocation uses {}", skipLocked ? "FOR UPDATE SKIP LOCKED" : "plain FOR UPDATE");
    }

    public HoldResult hold(UUID bookingId, String runId, String travelClass, int count, int holdSeconds) {
        List<String> existing = seatsOf(bookingId);
        if (!existing.isEmpty()) {
            // Same booking asked twice (e.g. replayed command): answer with what it already has.
            Instant expiry = jdbc.queryForObject(
                    "SELECT max(hold_expires_at) FROM seat WHERE booking_id = ?", Instant.class, bookingId);
            return new Held(existing, expiry);
        }
        Integer total = jdbc.queryForObject(
                "SELECT count(*) FROM seat WHERE run_id = ? AND travel_class = ?", Integer.class, runId, travelClass);
        if (total == null || total == 0) {
            return new Rejected("NO_SUCH_RUN_OR_CLASS");
        }
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            record Picked(String seat, Instant expiresAt) {
            }
            List<Picked> picked = jdbc.query(pickSql,
                    (rs, i) -> new Picked(rs.getString(1), rs.getTimestamp(2).toInstant()),
                    runId, travelClass, count, bookingId, holdSeconds, runId, travelClass);
            if (picked.size() == count) {
                publishAvailability(runId, travelClass);
                return new Held(picked.stream().map(Picked::seat).sorted().toList(), picked.get(0).expiresAt());
            }
            // Came back short: undo the partial grab (same transaction) and decide whether to retry.
            if (!picked.isEmpty()) {
                releaseRows(bookingId);
            }
            int free = availableCount(runId, travelClass);
            if (free < count) {
                return new Rejected("NOT_ENOUGH_SEATS");
            }
            // Seats exist but were locked by a concurrent allocator that may still roll back.
            allocationRetries.increment();
            sleepQuietly(10L * attempt);
        }
        return new Rejected("NOT_ENOUGH_SEATS");
    }

    /** HELD -> BOOKED. Returns the booked seats, or empty if the hold no longer exists (expired and reaped). */
    public List<String> confirm(UUID bookingId) {
        jdbc.update("""
                UPDATE seat SET status = 'BOOKED', hold_expires_at = NULL, updated_at = now()
                WHERE booking_id = ? AND status = 'HELD'""", bookingId);
        // Includes seats that were already BOOKED, so a repeated confirm returns the same answer.
        return jdbc.queryForList(
                "SELECT seat_no FROM seat WHERE booking_id = ? AND status = 'BOOKED' ORDER BY seat_idx",
                String.class, bookingId);
    }

    /** Frees every seat (held or booked) owned by the booking. Idempotent. */
    public int release(UUID bookingId) {
        List<String[]> runs = jdbc.query(
                "SELECT DISTINCT run_id, travel_class FROM seat WHERE booking_id = ?",
                (rs, i) -> new String[]{rs.getString(1), rs.getString(2)}, bookingId);
        int n = releaseRows(bookingId);
        runs.forEach(r -> publishAvailability(r[0], r[1]));
        return n;
    }

    /** Releases holds whose lease ran out. SKIP LOCKED lets several instances reap concurrently. */
    public List<Released> reapExpired(int limit) {
        List<Released> released = jdbc.query("""
                WITH expired AS (
                    SELECT run_id, travel_class, seat_no, booking_id FROM seat
                    WHERE status = 'HELD' AND hold_expires_at < now()
                    LIMIT ?
                    FOR UPDATE SKIP LOCKED
                ), freed AS (
                    UPDATE seat s
                    SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL, updated_at = now()
                    FROM expired e
                    WHERE s.run_id = e.run_id AND s.travel_class = e.travel_class AND s.seat_no = e.seat_no
                    RETURNING e.booking_id, e.run_id, e.travel_class
                )
                SELECT booking_id, run_id, travel_class, count(*) FROM freed
                GROUP BY booking_id, run_id, travel_class""",
                (rs, i) -> new Released(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getInt(4)),
                limit);
        released.stream().map(r -> r.runId() + "|" + r.travelClass()).distinct()
                .forEach(k -> publishAvailability(k.split("\\|")[0], k.split("\\|")[1]));
        return released;
    }

    public List<String> seatsOf(UUID bookingId) {
        return jdbc.queryForList("SELECT seat_no FROM seat WHERE booking_id = ? ORDER BY seat_idx",
                String.class, bookingId);
    }

    public int availableCount(String runId, String travelClass) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM seat WHERE run_id = ? AND travel_class = ? AND status = 'AVAILABLE'",
                Integer.class, runId, travelClass);
        return n == null ? 0 : n;
    }

    /** Queue a fresh seat count for the read side. Absolute value + timestamp, so consumers can drop stale ones. */
    public void publishAvailability(String runId, String travelClass) {
        record Counts(int available, int total, Instant asOf, String train, LocalDate date) {
        }
        Counts c = jdbc.queryForObject("""
                        SELECT count(*) FILTER (WHERE s.status = 'AVAILABLE'), count(*), clock_timestamp(),
                               r.train_number, r.journey_date
                        FROM seat s JOIN train_run r ON r.run_id = s.run_id
                        WHERE s.run_id = ? AND s.travel_class = ?
                        GROUP BY r.train_number, r.journey_date""",
                (rs, i) -> new Counts(rs.getInt(1), rs.getInt(2), rs.getTimestamp(3).toInstant(),
                        rs.getString(4), rs.getObject(5, LocalDate.class)),
                runId, travelClass);
        outbox.enqueue(Topics.AVAILABILITY_EVENTS, runId, EventTypes.AVAILABILITY_CHANGED,
                new AvailabilityChanged(runId, c.train(), c.date(), travelClass, c.available(), c.total(), c.asOf()));
    }

    // ------------------------------------------------------------------ naive allocator (demo only)

    /**
     * DELIBERATELY BROKEN: what a straightforward "read free seats, then write them" implementation
     * does. No row locks, no status check on the write (last writer wins), and the allocation is
     * recorded in a table with no uniqueness on the seat. Run concurrently, two bookings read the
     * same free seats and both believe they own them. Only reachable when allocation_mode = NAIVE.
     */
    public HoldResult holdNaive(UUID bookingId, String runId, String travelClass, int count, int holdSeconds) {
        List<String> free = jdbc.queryForList("""
                SELECT seat_no FROM seat
                WHERE run_id = ? AND travel_class = ? AND status = 'AVAILABLE'
                ORDER BY seat_idx LIMIT ?""", String.class, runId, travelClass, count);
        if (free.size() < count) {
            return new Rejected("NOT_ENOUGH_SEATS");
        }
        // Stands in for the work a real service does between reading and writing (pricing, quota
        // rules, a call to another service...). This is the race window.
        sleepQuietly(30);
        for (String seat : free) {
            jdbc.update("""
                    UPDATE seat SET status = 'HELD', booking_id = ?, hold_expires_at = now() + make_interval(secs => ?),
                        updated_at = now()
                    WHERE run_id = ? AND travel_class = ? AND seat_no = ?""",
                    bookingId, holdSeconds, runId, travelClass, seat);
            jdbc.update("INSERT INTO naive_allocation (booking_id, run_id, travel_class, seat_no) VALUES (?, ?, ?, ?)",
                    bookingId, runId, travelClass, seat);
        }
        jdbc.update("INSERT INTO naive_run (run_id) VALUES (?) ON CONFLICT DO NOTHING", runId);
        publishAvailability(runId, travelClass);
        Instant expiry = jdbc.queryForObject("SELECT now() + make_interval(secs => ?)", Instant.class, holdSeconds);
        return new Held(free.stream().sorted().toList(), expiry);
    }

    public boolean isNaiveBooking(UUID bookingId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM naive_allocation WHERE booking_id = ?",
                Integer.class, bookingId);
        return n != null && n > 0;
    }

    /** Naive confirm trusts its own allocation table and blindly marks those seats as this booking's. */
    public List<String> confirmNaive(UUID bookingId) {
        List<String> seats = jdbc.queryForList(
                "SELECT seat_no FROM naive_allocation WHERE booking_id = ? ORDER BY seat_no", String.class, bookingId);
        for (String seat : seats) {
            jdbc.update("""
                    UPDATE seat SET status = 'BOOKED', booking_id = ?, hold_expires_at = NULL, updated_at = now()
                    WHERE seat_no = ? AND (run_id, travel_class) =
                        (SELECT run_id, travel_class FROM naive_allocation WHERE booking_id = ? LIMIT 1)""",
                    bookingId, seat, bookingId);
        }
        return seats;
    }

    public int releaseNaive(UUID bookingId) {
        jdbc.update("DELETE FROM naive_allocation WHERE booking_id = ?", bookingId);
        return release(bookingId);
    }

    private int releaseRows(UUID bookingId) {
        return jdbc.update("""
                UPDATE seat SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL, updated_at = now()
                WHERE booking_id = ?""", bookingId);
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
