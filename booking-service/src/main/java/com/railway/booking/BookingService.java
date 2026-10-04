package com.railway.booking;

import com.railway.common.events.EventTypes;
import com.railway.common.events.Messages.ConfirmSeats;
import com.railway.common.events.Messages.HoldSeats;
import com.railway.common.events.Messages.ReleaseSeats;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Outbox;
import com.railway.common.seed.SeedCatalog;
import com.railway.common.web.ApiException;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static com.railway.booking.BookingStatus.*;

/** Saga orchestrator: owns the booking state machine and issues commands to inventory and payment. */
@Service
public class BookingService {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public record NewBooking(String trainNumber, LocalDate journeyDate, String from, String to,
                             String travelClass, List<Booking.Passenger> passengers) {
    }

    public record CreateResult(Booking booking, boolean created) {
    }

    private final BookingRepository repo;
    private final Outbox outbox;
    private final TransactionTemplate tx;
    private final SeatHints hints;
    private final PaymentClient payments;
    private final MeterRegistry meters;
    private final SeedCatalog catalog = SeedCatalog.load();
    private final SecureRandom random = new SecureRandom();
    private final int holdSeconds;
    private final int maxPassengers;

    public BookingService(BookingRepository repo, Outbox outbox, TransactionTemplate tx, SeatHints hints,
                          PaymentClient payments, MeterRegistry meters,
                          @Value("${booking.hold-seconds}") int holdSeconds,
                          @Value("${booking.max-passengers}") int maxPassengers) {
        this.repo = repo;
        this.outbox = outbox;
        this.tx = tx;
        this.hints = hints;
        this.payments = payments;
        this.meters = meters;
        this.holdSeconds = holdSeconds;
        this.maxPassengers = maxPassengers;
    }

    // ------------------------------------------------------------------ create (Tatkal path)

    /**
     * Accepts a booking request and returns immediately (202). Seat allocation happens asynchronously
     * in the inventory service, which drains the per-train Kafka queue at its own pace. A spike
     * therefore turns into a queue, not into thousands of threads blocked on database locks.
     */
    public CreateResult create(UUID userId, String idempotencyKey, NewBooking req) {
        Optional<Booking> existing = repo.findByIdempotencyKey(userId, idempotencyKey);
        if (existing.isPresent()) {
            meters.counter("booking_requests", "outcome", "duplicate").increment();
            return new CreateResult(existing.get(), false);
        }
        Booking draft = validateAndPrice(userId, idempotencyKey, req);

        if (!hints.tryAdmit(draft.runId(), draft.travelClass(), draft.seatCount())) {
            meters.counter("booking_requests", "outcome", "fast_rejected").increment();
            throw new ApiException(HttpStatus.CONFLICT, "SOLD_OUT",
                    "No " + draft.travelClass() + " seats left on " + draft.trainNumber() + " for " + draft.journeyDate());
        }
        try {
            for (int attempt = 0; ; attempt++) {
                Booking b = withPnr(draft, newPnr());
                try {
                    tx.executeWithoutResult(s -> {
                        repo.insert(b);
                        // Same transaction as the insert: the command exists iff the booking exists.
                        outbox.enqueue(Topics.INVENTORY_COMMANDS, b.runId(), EventTypes.HOLD_SEATS,
                                new HoldSeats(b.id().toString(), b.runId(), b.travelClass(), b.seatCount(), holdSeconds));
                    });
                    meters.counter("booking_requests", "outcome", "accepted").increment();
                    return new CreateResult(b, true);
                } catch (DuplicateKeyException e) {
                    Optional<Booking> raced = repo.findByIdempotencyKey(userId, idempotencyKey);
                    if (raced.isPresent()) {
                        hints.release(draft.runId(), draft.travelClass(), draft.seatCount());
                        return new CreateResult(raced.get(), false);
                    }
                    if (attempt >= 3) {
                        throw e; // PNR collisions 4 times in a row: something else is wrong
                    }
                }
            }
        } catch (RuntimeException e) {
            hints.release(draft.runId(), draft.travelClass(), draft.seatCount());
            throw e;
        }
    }

    private Booking validateAndPrice(UUID userId, String key, NewBooking req) {
        SeedCatalog.Train train = catalog.trains().stream().filter(t -> t.number().equals(req.trainNumber()))
                .findFirst().orElseThrow(() -> bad("UNKNOWN_TRAIN", "no train " + req.trainNumber()));
        List<SeedCatalog.Stop> stops = train.stops();
        int fromIdx = indexOf(stops, req.from());
        int toIdx = indexOf(stops, req.to());
        if (fromIdx < 0 || toIdx < 0 || fromIdx >= toIdx) {
            throw bad("INVALID_ROUTE", train.number() + " does not run from " + req.from() + " to " + req.to());
        }
        if (!train.coaches().containsKey(req.travelClass())) {
            throw bad("INVALID_CLASS", train.number() + " has no class " + req.travelClass());
        }
        LocalDate today = LocalDate.now(IST);
        if (req.journeyDate() == null || req.journeyDate().isBefore(today)
                || !req.journeyDate().isBefore(today.plusDays(SeedCatalog.BOOKING_WINDOW_DAYS))) {
            throw bad("OUTSIDE_BOOKING_WINDOW", "journeys can be booked from today up to "
                    + (SeedCatalog.BOOKING_WINDOW_DAYS - 1) + " days ahead");
        }
        if (req.passengers() == null || req.passengers().isEmpty() || req.passengers().size() > maxPassengers) {
            throw bad("INVALID_PASSENGERS", "between 1 and " + maxPassengers + " passengers per booking");
        }
        for (Booking.Passenger p : req.passengers()) {
            if (p.name() == null || p.name().isBlank() || p.age() < 1 || p.age() > 120) {
                throw bad("INVALID_PASSENGERS", "each passenger needs a name and an age between 1 and 120");
            }
        }
        int km = stops.get(toIdx).km() - stops.get(fromIdx).km();
        BigDecimal perSeat = BigDecimal.valueOf(Math.max(km, 50) * catalog.travelClass(req.travelClass()).farePerKm())
                .add(BigDecimal.valueOf(40)) // reservation charge
                .setScale(0, RoundingMode.HALF_UP);
        BigDecimal total = perSeat.multiply(BigDecimal.valueOf(req.passengers().size())).setScale(2, RoundingMode.UNNECESSARY);
        Instant now = Instant.now();
        return new Booking(UUID.randomUUID(), null, userId, key, SeedCatalog.runId(train.number(), req.journeyDate()),
                train.number(), train.name(), req.journeyDate(), req.from(), req.to(), stops.get(fromIdx).departure(),
                req.travelClass(), req.passengers().size(), req.passengers(), total, PENDING, List.of(), null, null,
                "NONE", null, now, now);
    }

    // ------------------------------------------------------------------ payment

    public Booking pay(UUID userId, UUID bookingId) {
        Booking b = owned(userId, bookingId);
        switch (b.status()) {
            case PAYMENT_PROCESSING, PAYMENT_UNKNOWN, CONFIRMING, CONFIRMED -> {
                return b; // already paying / paid: never charge twice
            }
            case SEATS_HELD -> {
            }
            default -> throw new ApiException(HttpStatus.CONFLICT, "NOT_PAYABLE",
                    "booking is " + b.status() + " and cannot be paid");
        }
        if (b.holdExpiresAt() != null && b.holdExpiresAt().isBefore(Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, "HOLD_EXPIRED", "seat hold expired, please book again");
        }
        Optional<Booking> started = tx.execute(s -> repo.move(bookingId, EnumSet.of(SEATS_HELD), PAYMENT_PROCESSING,
                "Payment of Rs " + b.totalFare() + " started"));
        if (started == null || started.isEmpty()) {
            return repo.find(bookingId).orElseThrow();
        }

        PaymentClient.Outcome outcome = payments.charge(bookingId, userId, b.totalFare());
        meters.counter("payment_outcomes", "outcome", outcome.getClass().getSimpleName()).increment();
        switch (outcome) {
            case PaymentClient.Succeeded ok -> tx.executeWithoutResult(s -> paymentSucceeded(b, ok.paymentId()));
            case PaymentClient.Declined d -> tx.executeWithoutResult(s -> paymentFailed(b, d.reason()));
            case PaymentClient.Unknown u -> tx.executeWithoutResult(s -> repo.move(bookingId,
                    EnumSet.of(PAYMENT_PROCESSING), PAYMENT_UNKNOWN,
                    "Payment status unknown (" + u.reason() + "). We are verifying with the bank - do not pay again."));
            case PaymentClient.NotAttempted n -> {
                tx.executeWithoutResult(s -> repo.move(bookingId, EnumSet.of(PAYMENT_PROCESSING), SEATS_HELD,
                        "Payment not attempted: " + n.reason() + ". No money was taken; seats are still held."));
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_UNAVAILABLE",
                        n.reason() + ". No money was taken and your seats are still held - retry in a few seconds.");
            }
        }
        return repo.find(bookingId).orElseThrow();
    }

    /** Payment is final: ask inventory to turn the hold into a booking. */
    boolean paymentSucceeded(Booking b, String paymentId) {
        return repo.move(b.id(), EnumSet.of(PAYMENT_PROCESSING, PAYMENT_UNKNOWN), CONFIRMING,
                        "Payment " + paymentId + " succeeded; confirming seats", Map.of("payment_id", paymentId))
                .map(x -> {
                    outbox.enqueue(Topics.INVENTORY_COMMANDS, b.runId(), EventTypes.CONFIRM_SEATS,
                            new ConfirmSeats(b.id().toString(), b.runId()));
                    return true;
                }).orElse(false);
    }

    /** Compensation: payment definitely failed, give the seats back. */
    void paymentFailed(Booking b, String reason) {
        repo.move(b.id(), EnumSet.of(PAYMENT_PROCESSING, PAYMENT_UNKNOWN), PAYMENT_FAILED,
                        "Payment failed: " + reason + ". Seats released.", Map.of("failure_reason", reason))
                .ifPresent(x -> releaseSeats(b, "PAYMENT_FAILED"));
    }

    // ------------------------------------------------------------------ cancel

    public Booking cancel(UUID userId, UUID bookingId) {
        Booking b = owned(userId, bookingId);
        Optional<Booking> result = tx.execute(s -> switch (b.status()) {
            case PENDING -> repo.move(bookingId, EnumSet.of(PENDING), CANCELLED, "Cancelled before seats were allocated")
                    .map(x -> {
                        hints.release(b.runId(), b.travelClass(), b.seatCount());
                        return x;
                    });
            case SEATS_HELD -> repo.move(bookingId, EnumSet.of(SEATS_HELD), CANCELLED, "Cancelled; held seats released")
                    .map(x -> {
                        releaseSeats(b, "CANCELLED");
                        return x;
                    });
            case CONFIRMED -> repo.move(bookingId, EnumSet.of(CONFIRMED), CANCELLED,
                            "Ticket cancelled; seats released and refund of Rs " + b.totalFare() + " initiated",
                            Map.of("refund_status", "PENDING"))
                    .map(x -> {
                        releaseSeats(b, "CANCELLED");
                        return x;
                    });
            case PAYMENT_PROCESSING, PAYMENT_UNKNOWN, CONFIRMING -> throw new ApiException(HttpStatus.CONFLICT,
                    "PAYMENT_IN_PROGRESS", "payment is being processed; try again once it completes");
            default -> throw new ApiException(HttpStatus.CONFLICT, "NOT_CANCELLABLE", "booking is already " + b.status());
        });
        if (result == null || result.isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "CONCURRENT_UPDATE", "booking changed, please refresh");
        }
        return result.get();
    }

    void releaseSeats(Booking b, String reason) {
        outbox.enqueue(Topics.INVENTORY_COMMANDS, b.runId(), EventTypes.RELEASE_SEATS,
                new ReleaseSeats(b.id().toString(), b.runId(), reason));
    }

    // ------------------------------------------------------------------ queries

    public Booking owned(UUID userId, UUID bookingId) {
        Booking b = repo.find(bookingId).orElseThrow(() -> notFound());
        if (!b.userId().equals(userId)) {
            throw notFound(); // do not reveal other users' bookings exist
        }
        return b;
    }

    public List<Booking> mine(UUID userId) {
        return repo.findByUser(userId, 50);
    }

    public List<Booking.HistoryEntry> history(UUID bookingId) {
        return repo.history(bookingId);
    }

    // ------------------------------------------------------------------ helpers

    private String newPnr() {
        return String.valueOf(4_000_000_000L + (long) (random.nextDouble() * 5_999_999_999L));
    }

    private static Booking withPnr(Booking b, String pnr) {
        return new Booking(b.id(), pnr, b.userId(), b.idempotencyKey(), b.runId(), b.trainNumber(), b.trainName(),
                b.journeyDate(), b.fromStation(), b.toStation(), b.departureTime(), b.travelClass(), b.seatCount(),
                b.passengers(), b.totalFare(), b.status(), b.seats(), b.holdExpiresAt(), b.paymentId(),
                b.refundStatus(), b.failureReason(), b.createdAt(), b.updatedAt());
    }

    private static int indexOf(List<SeedCatalog.Stop> stops, String code) {
        for (int i = 0; i < stops.size(); i++) {
            if (stops.get(i).station().equalsIgnoreCase(code)) {
                return i;
            }
        }
        return -1;
    }

    private static ApiException bad(String code, String msg) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, msg);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "booking not found");
    }
}
