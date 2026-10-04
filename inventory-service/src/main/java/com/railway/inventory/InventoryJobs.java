package com.railway.inventory;

import com.railway.common.events.EventTypes;
import com.railway.common.events.Messages.AvailabilityChanged;
import com.railway.common.events.Messages.SeatsReleased;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Json;
import com.railway.common.messaging.Outbox;
import com.railway.common.seed.SeedCatalog;
import io.micrometer.core.instrument.MeterRegistry;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Seeding of bookable runs, hold expiry (lease reaper) and the periodic availability snapshot. */
@Component
public class InventoryJobs implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(InventoryJobs.class);
    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final SeatInventory inventory;
    private final Outbox outbox;
    private final KafkaTemplate<String, String> kafka;
    private final MeterRegistry meters;
    private final SeedCatalog catalog = SeedCatalog.load();

    public InventoryJobs(JdbcTemplate jdbc, TransactionTemplate tx, SeatInventory inventory, Outbox outbox,
                         KafkaTemplate<String, String> kafka, MeterRegistry meters) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.inventory = inventory;
        this.outbox = outbox;
        this.kafka = kafka;
        this.meters = meters;
    }

    @Override
    public void run(ApplicationArguments args) {
        openBookingWindow();
        snapshot();
    }

    /** Make sure every train has a run (with all its seats) for each day in the booking window. Idempotent. */
    @Scheduled(cron = "0 5 0 * * *", zone = "Asia/Kolkata")
    public void openBookingWindow() {
        LocalDate today = LocalDate.now(IST);
        int created = 0;
        for (int d = 0; d < SeedCatalog.BOOKING_WINDOW_DAYS; d++) {
            LocalDate date = today.plusDays(d);
            for (SeedCatalog.Train train : catalog.trains()) {
                Boolean made = tx.execute(s -> createRun(train, date));
                if (Boolean.TRUE.equals(made)) {
                    created++;
                }
            }
        }
        log.info("Booking window open from {} for {} days ({} new runs)", today, SeedCatalog.BOOKING_WINDOW_DAYS, created);
    }

    private boolean createRun(SeedCatalog.Train train, LocalDate date) {
        String runId = SeedCatalog.runId(train.number(), date);
        int inserted = jdbc.update("""
                INSERT INTO train_run (run_id, train_number, journey_date) VALUES (?, ?, ?)
                ON CONFLICT (run_id) DO NOTHING""", runId, train.number(), date);
        if (inserted == 0) {
            return false;
        }
        for (Map.Entry<String, Integer> coaches : train.coaches().entrySet()) {
            SeedCatalog.TravelClass cls = catalog.travelClass(coaches.getKey());
            jdbc.update("""
                            INSERT INTO seat (run_id, travel_class, seat_no, seat_idx)
                            SELECT ?, ?, ? || c || '-' || n, c * 1000 + n
                            FROM generate_series(1, ?) c, generate_series(1, ?) n""",
                    runId, cls.code(), cls.coachPrefix(), coaches.getValue(), cls.seatsPerCoach());
        }
        return true;
    }

    /** Lease expiry: holds that were never paid for go back to the pool. */
    @Scheduled(fixedDelayString = "${inventory.reaper-interval-ms:2000}")
    public void reapExpiredHolds() {
        try {
            List<SeatInventory.Released> released = tx.execute(s -> {
                List<SeatInventory.Released> r = inventory.reapExpired(500);
                r.stream().map(SeatInventory.Released::bookingId).distinct().forEach(bookingId -> {
                    String runId = r.stream().filter(x -> x.bookingId().equals(bookingId)).findFirst().orElseThrow().runId();
                    outbox.enqueue(Topics.INVENTORY_EVENTS, bookingId.toString(), EventTypes.SEATS_RELEASED,
                            new SeatsReleased(bookingId.toString(), runId, "HOLD_EXPIRED"));
                });
                return r;
            });
            if (released != null && !released.isEmpty()) {
                meters.counter("seat_holds_expired").increment(released.size());
                log.info("Reaped expired holds of {} bookings", released.stream().map(SeatInventory.Released::bookingId).distinct().count());
            }
        } catch (Exception e) {
            log.warn("Hold reaper failed, will retry: {}", e.toString());
        }
    }

    /**
     * Periodic full snapshot of seat counts for the read side. Heals a projection that missed events
     * or lost its cache (e.g. Redis restarted). Derived data, so it is sent directly, not via the outbox.
     */
    @Scheduled(initialDelayString = "${inventory.snapshot-interval-ms:30000}",
            fixedDelayString = "${inventory.snapshot-interval-ms:30000}")
    public void snapshot() {
        try {
            List<AvailabilityChanged> rows = jdbc.query("""
                            SELECT s.run_id, r.train_number, r.journey_date, s.travel_class,
                                   count(*) FILTER (WHERE s.status = 'AVAILABLE'), count(*), clock_timestamp()
                            FROM seat s JOIN train_run r ON r.run_id = s.run_id
                            WHERE r.journey_date >= ?
                            GROUP BY s.run_id, r.train_number, r.journey_date, s.travel_class""",
                    (rs, i) -> new AvailabilityChanged(rs.getString(1), rs.getString(2),
                            rs.getObject(3, LocalDate.class), rs.getString(4), rs.getInt(5), rs.getInt(6),
                            rs.getTimestamp(7).toInstant()),
                    LocalDate.now(IST));
            for (AvailabilityChanged a : rows) {
                var env = new com.railway.common.events.Envelope(UUID.randomUUID().toString(),
                        EventTypes.AVAILABILITY_CHANGED, Instant.now(), Json.MAPPER.valueToTree(a));
                kafka.send(new ProducerRecord<>(Topics.AVAILABILITY_EVENTS, a.runId(), Json.write(env)));
            }
            log.debug("Published availability snapshot ({} rows)", rows.size());
        } catch (Exception e) {
            log.warn("Availability snapshot failed: {}", e.toString());
        }
    }
}
