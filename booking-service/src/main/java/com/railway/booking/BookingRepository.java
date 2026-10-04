package com.railway.booking;

import com.fasterxml.jackson.core.type.TypeReference;
import com.railway.common.events.EventTypes;
import com.railway.common.events.Messages.BookingStatusChanged;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Json;
import com.railway.common.messaging.Outbox;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Repository
public class BookingRepository {

    private static final RowMapper<Booking> MAPPER = (rs, i) -> new Booking(
            rs.getObject("id", UUID.class),
            rs.getString("pnr"),
            rs.getObject("user_id", UUID.class),
            rs.getString("idempotency_key"),
            rs.getString("run_id"),
            rs.getString("train_number"),
            rs.getString("train_name"),
            rs.getObject("journey_date", LocalDate.class),
            rs.getString("from_station"),
            rs.getString("to_station"),
            rs.getString("departure_time"),
            rs.getString("travel_class"),
            rs.getInt("seat_count"),
            readPassengers(rs.getString("passengers")),
            rs.getBigDecimal("total_fare"),
            BookingStatus.valueOf(rs.getString("status")),
            rs.getString("seats") == null ? List.of() : Arrays.asList(rs.getString("seats").split(",")),
            toInstant(rs.getTimestamp("hold_expires_at")),
            rs.getString("payment_id"),
            rs.getString("refund_status"),
            rs.getString("failure_reason"),
            toInstant(rs.getTimestamp("created_at")),
            toInstant(rs.getTimestamp("updated_at")));

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(BookingRepository.class);

    private final JdbcTemplate jdbc;
    private final Outbox outbox;

    public BookingRepository(JdbcTemplate jdbc, Outbox outbox) {
        this.jdbc = jdbc;
        this.outbox = outbox;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void insert(Booking b) {
        jdbc.update("""
                        INSERT INTO booking (id, pnr, user_id, idempotency_key, run_id, train_number, train_name,
                            journey_date, from_station, to_station, departure_time, travel_class, seat_count,
                            passengers, total_fare, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                b.id(), b.pnr(), b.userId(), b.idempotencyKey(), b.runId(), b.trainNumber(), b.trainName(),
                b.journeyDate(), b.fromStation(), b.toStation(), b.departureTime(), b.travelClass(), b.seatCount(),
                Json.write(b.passengers()), b.totalFare(), b.status().name());
        history(b.id(), b.status(), "Booking request accepted and queued for seat allocation");
        log.info("Booking {} PNR {} -> PENDING: {} {} {} x{} queued", b.id(), b.pnr(), b.runId(), b.travelClass(),
                b.fromStation() + "-" + b.toStation(), b.seatCount());
    }

    public Optional<Booking> find(UUID id) {
        return jdbc.query("SELECT * FROM booking WHERE id = ?", MAPPER, id).stream().findFirst();
    }

    public Optional<Booking> findByIdempotencyKey(UUID userId, String key) {
        return jdbc.query("SELECT * FROM booking WHERE user_id = ? AND idempotency_key = ?", MAPPER, userId, key)
                .stream().findFirst();
    }

    public Optional<Booking> findByPnr(String pnr) {
        return jdbc.query("SELECT * FROM booking WHERE pnr = ?", MAPPER, pnr).stream().findFirst();
    }

    public List<Booking> findByUser(UUID userId, int limit) {
        return jdbc.query("SELECT * FROM booking WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                MAPPER, userId, limit);
    }

    public List<Booking> findByStatusOlderThan(Set<BookingStatus> statuses, String column, int seconds, int limit) {
        if (!Set.of("updated_at", "created_at", "hold_expires_at").contains(column)) {
            throw new IllegalArgumentException(column);
        }
        return jdbc.query("SELECT * FROM booking WHERE status = ANY (?) AND " + column
                        + " < now() - make_interval(secs => ?) ORDER BY " + column + " LIMIT ?",
                MAPPER, names(statuses), seconds, limit);
    }

    public List<Booking> findRefundsPending(int limit) {
        return jdbc.query("SELECT * FROM booking WHERE refund_status = 'PENDING' ORDER BY updated_at LIMIT ?",
                MAPPER, limit);
    }

    public List<Booking.HistoryEntry> history(UUID bookingId) {
        return jdbc.query("SELECT status, note, at FROM booking_history WHERE booking_id = ? ORDER BY id",
                (rs, i) -> new Booking.HistoryEntry(rs.getString(1), rs.getString(2), toInstant(rs.getTimestamp(3))),
                bookingId);
    }

    /**
     * Guarded state transition: only applies if the booking is currently in one of {@code from}.
     * Concurrent actors (Kafka consumers, the pay endpoint, the reconciler, two booking instances)
     * can race freely; exactly one wins each transition and the others see an empty result.
     *
     * @param sets extra columns to update (names are code constants, never user input)
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<Booking> move(UUID id, Set<BookingStatus> from, BookingStatus to, String note,
                                  Map<String, Object> sets) {
        StringBuilder sql = new StringBuilder("UPDATE booking SET status = ?, updated_at = now()");
        List<Object> args = new ArrayList<>();
        args.add(to.name());
        sets.forEach((col, value) -> {
            sql.append(", ").append(col).append(" = ?");
            args.add(value instanceof Instant t ? Timestamp.from(t) : value);
        });
        sql.append(" WHERE id = ? AND status = ANY (?) RETURNING *");
        args.add(id);
        args.add(names(from));
        Optional<Booking> updated = jdbc.query(sql.toString(), MAPPER, args.toArray()).stream().findFirst();
        updated.ifPresent(b -> {
            log.info("Booking {} PNR {} -> {}: {}", id, b.pnr(), to, note);
            history(id, to, note);
            if (to.isNotifiable()) {
                notifyUser(b, note);
            }
        });
        return updated;
    }

    public Optional<Booking> move(UUID id, Set<BookingStatus> from, BookingStatus to, String note) {
        return move(id, from, to, note, Map.of());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public boolean markRefunded(UUID id, String note) {
        Optional<Booking> b = jdbc.query("""
                UPDATE booking SET refund_status = 'DONE', updated_at = now()
                WHERE id = ? AND refund_status = 'PENDING' RETURNING *""", MAPPER, id).stream().findFirst();
        b.ifPresent(booking -> {
            history(id, booking.status(), note);
            notifyUser(booking, note);
        });
        return b.isPresent();
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void history(UUID bookingId, BookingStatus status, String note) {
        jdbc.update("INSERT INTO booking_history (booking_id, status, note) VALUES (?, ?, ?)",
                bookingId, status.name(), note);
    }

    private void notifyUser(Booking b, String message) {
        outbox.enqueue(Topics.BOOKING_EVENTS, b.id().toString(), EventTypes.BOOKING_STATUS_CHANGED,
                new BookingStatusChanged(b.id().toString(), b.pnr(), b.userId().toString(), b.status().name(),
                        b.trainNumber(), b.journeyDate(), message));
    }

    public Map<String, Long> countByStatus(String runId) {
        Map<String, Long> out = new LinkedHashMap<>();
        for (BookingStatus s : BookingStatus.values()) {
            out.put(s.name(), 0L);
        }
        String sql = "SELECT status, count(*) FROM booking" + (runId == null ? "" : " WHERE run_id = ?")
                + " GROUP BY status";
        Object[] args = runId == null ? new Object[0] : new Object[]{runId};
        jdbc.query(sql, rs -> {
            out.put(rs.getString(1), rs.getLong(2));
        }, args);
        return out;
    }

    /** @param travelClass optional; null = every class of the run */
    public Map<String, Integer> confirmedSeatsByBooking(String runId, String travelClass) {
        Map<String, Integer> out = new LinkedHashMap<>();
        jdbc.query("""
                        SELECT id, seat_count FROM booking WHERE run_id = ? AND status = 'CONFIRMED'
                          AND (?::text IS NULL OR travel_class = ?) ORDER BY id""",
                rs -> {
                    out.put(rs.getString(1), rs.getInt(2));
                }, runId, travelClass, travelClass);
        return out;
    }

    public record SeatConflict(String seat, List<String> pnrs) {
    }

    /** Seats printed on more than one CONFIRMED ticket of a run: must always be empty. */
    public List<SeatConflict> seatConflicts(String runId, String travelClass) {
        return jdbc.query("""
                        SELECT seat, array_agg(pnr ORDER BY pnr) FROM booking, unnest(string_to_array(seats, ',')) seat
                        WHERE run_id = ? AND status = 'CONFIRMED' AND (?::text IS NULL OR travel_class = ?)
                        GROUP BY travel_class, seat HAVING count(*) > 1 ORDER BY seat""",
                (rs, i) -> new SeatConflict(rs.getString(1), Arrays.asList((String[]) rs.getArray(2).getArray())),
                runId, travelClass, travelClass);
    }

    public long refundsPending() {
        Long n = jdbc.queryForObject("SELECT count(*) FROM booking WHERE refund_status = 'PENDING'", Long.class);
        return n == null ? 0 : n;
    }

    private static String[] names(Set<BookingStatus> statuses) {
        return statuses.stream().map(Enum::name).collect(Collectors.toSet()).toArray(String[]::new);
    }

    private static Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }

    private static List<Booking.Passenger> readPassengers(String json) {
        try {
            return Json.MAPPER.readValue(json, new TypeReference<>() {
            });
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
