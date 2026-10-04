package com.railway.inventory;

import com.railway.common.messaging.Outbox;
import com.zaxxer.hikari.HikariDataSource;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Many threads race for few seats against a real Postgres. Assertions are on database invariants,
 * never on timing: whatever the interleaving, no seat may end up with two owners and every
 * request must be all-or-nothing.
 */
@Testcontainers
class SeatAllocationConcurrencyTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16");

    static HikariDataSource ds;
    static JdbcTemplate jdbc;
    static TransactionTemplate tx;

    @BeforeAll
    static void setUp() {
        ds = new HikariDataSource();
        ds.setJdbcUrl(PG.getJdbcUrl());
        ds.setUsername(PG.getUsername());
        ds.setPassword(PG.getPassword());
        ds.setMaximumPoolSize(20);
        Flyway.configure().dataSource(ds).load().migrate();
        jdbc = new JdbcTemplate(ds);
        tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
    }

    @AfterAll
    static void tearDown() {
        ds.close();
    }

    @BeforeEach
    void freshRun() {
        jdbc.update("DELETE FROM outbox");
        jdbc.update("DELETE FROM seat");
        jdbc.update("DELETE FROM train_run");
        jdbc.update("INSERT INTO train_run (run_id, train_number, journey_date) VALUES ('T-1', 'T', current_date)");
    }

    private static void seats(int n) {
        jdbc.update("""
                INSERT INTO seat (run_id, travel_class, seat_no, seat_idx)
                SELECT 'T-1', 'SL', 'S1-' || i, i FROM generate_series(1, ?) i""", n);
    }

    private static SeatInventory inventory(boolean skipLocked) {
        return new SeatInventory(jdbc, new Outbox(jdbc), new SimpleMeterRegistry(), skipLocked);
    }

    private static <T> T inTx(java.util.function.Supplier<T> work) {
        return tx.execute(status -> work.get());
    }

    private static SeatInventory.HoldResult hold(SeatInventory inv, UUID id, int n, int ttl) {
        return inTx(() -> inv.hold(id, "T-1", "SL", n, ttl));
    }

    private static List<String> confirm(SeatInventory inv, UUID id) {
        return inTx(() -> inv.confirm(id));
    }

    private record Attempt(UUID bookingId, int requested, SeatInventory.HoldResult result) {
    }

    /** Starts all threads at the same instant (latch) to maximise contention. */
    private static List<Attempt> race(SeatInventory inv, int requests, int maxSeatsPerRequest) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(32);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Attempt>> futures = new ArrayList<>();
        for (int i = 0; i < requests; i++) {
            int want = 1 + ThreadLocalRandom.current().nextInt(maxSeatsPerRequest);
            futures.add(pool.submit(() -> {
                start.await();
                UUID id = UUID.randomUUID();
                return new Attempt(id, want, hold(inv, id, want, 300));
            }));
        }
        start.countDown();
        List<Attempt> out = new ArrayList<>();
        for (Future<Attempt> f : futures) {
            out.add(f.get());
        }
        pool.shutdown();
        return out;
    }

    @ParameterizedTest(name = "skipLocked={0}")
    @ValueSource(booleans = {true, false})
    void manyUsersOneSeatEach_exactlyCapacityWin(boolean skipLocked) throws Exception {
        seats(50);
        List<Attempt> attempts = race(inventory(skipLocked), 300, 1);

        long held = attempts.stream().filter(a -> a.result() instanceof SeatInventory.Held).count();
        assertThat(held).as("winners").isEqualTo(50);
        assertThat(attempts.stream().filter(a -> a.result() instanceof SeatInventory.Rejected)).hasSize(250);

        // Every seat is owned by exactly one winning booking; no two winners share a seat.
        Map<String, UUID> owner = new ConcurrentHashMap<>();
        attempts.stream().filter(a -> a.result() instanceof SeatInventory.Held).forEach(a ->
                ((SeatInventory.Held) a.result()).seats().forEach(seat ->
                        assertThat(owner.putIfAbsent(seat, a.bookingId())).as("seat %s double-allocated", seat).isNull()));
        assertThat(owner).hasSize(50);
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT booking_id) FROM seat WHERE status = 'HELD'", Long.class))
                .isEqualTo(50);
    }

    @Test
    void multiSeatRequests_areAllOrNothing() throws Exception {
        seats(100);
        List<Attempt> attempts = race(inventory(true), 200, 4);

        int seatsGranted = 0;
        for (Attempt a : attempts) {
            int inDb = jdbc.queryForObject("SELECT count(*) FROM seat WHERE booking_id = ?", Integer.class, a.bookingId());
            if (a.result() instanceof SeatInventory.Held h) {
                assertThat(h.seats()).hasSize(a.requested());
                assertThat(inDb).isEqualTo(a.requested());
                seatsGranted += a.requested();
            } else {
                assertThat(inDb).as("rejected request must not keep partial seats").isZero();
            }
        }
        assertThat(seatsGranted).isLessThanOrEqualTo(100);
        // Requests are served while enough seats remain, so at most 3 seats (less than the largest request) stay unsold.
        assertThat(100 - seatsGranted).isLessThan(4);
    }

    @Test
    void expiredHoldsAreReapedAndRebookable() throws Exception {
        seats(2);
        SeatInventory inv = inventory(true);
        UUID first = UUID.randomUUID();
        assertThat(hold(inv, first, 2, 1)).isInstanceOf(SeatInventory.Held.class);
        assertThat(hold(inv, UUID.randomUUID(), 1, 60)).isInstanceOf(SeatInventory.Rejected.class);

        Thread.sleep(1500);
        List<SeatInventory.Released> released = inTx(() -> inv.reapExpired(100));
        assertThat(released).singleElement().satisfies(r -> {
            assertThat(r.bookingId()).isEqualTo(first);
            assertThat(r.seats()).isEqualTo(2);
        });
        assertThat(hold(inv, UUID.randomUUID(), 2, 60)).isInstanceOf(SeatInventory.Held.class);
    }

    @Test
    void confirmIsIdempotentAndReleaseFreesSeats() {
        seats(3);
        SeatInventory inv = inventory(true);
        UUID id = UUID.randomUUID();
        hold(inv, id, 2, 60);

        assertThat(confirm(inv, id)).containsExactly("S1-1", "S1-2");
        assertThat(confirm(inv, id)).as("second confirm, same answer").containsExactly("S1-1", "S1-2");
        assertThat(hold(inv, id, 2, 60))
                .as("replayed hold for the same booking returns its seats, takes no more")
                .isInstanceOfSatisfying(SeatInventory.Held.class, h -> assertThat(h.seats()).containsExactly("S1-1", "S1-2"));

        assertThat(inTx(() -> inv.release(id))).isEqualTo(2);
        assertThat(inv.availableCount("T-1", "SL")).isEqualTo(3);
        assertThat(confirm(inv, id)).as("confirm after release fails").isEmpty();
    }
}
