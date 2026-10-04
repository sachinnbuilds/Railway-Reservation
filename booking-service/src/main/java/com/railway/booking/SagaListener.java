package com.railway.booking;

import com.railway.common.events.Envelope;
import com.railway.common.events.EventTypes;
import com.railway.common.events.Messages.AvailabilityChanged;
import com.railway.common.events.Messages.SeatsConfirmFailed;
import com.railway.common.events.Messages.SeatsConfirmed;
import com.railway.common.events.Messages.SeatsHeld;
import com.railway.common.events.Messages.SeatsRejected;
import com.railway.common.events.Messages.SeatsReleased;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Idempotency;
import com.railway.common.messaging.Json;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.EnumSet;
import java.util.Map;
import java.util.UUID;

import static com.railway.booking.BookingStatus.*;

/** Reacts to inventory outcomes and advances the saga. Each message is applied exactly once (idempotent consumer). */
@Component
public class SagaListener {

    private static final Logger log = LoggerFactory.getLogger(SagaListener.class);

    private final BookingRepository repo;
    private final BookingService bookings;
    private final Idempotency idempotency;
    private final TransactionTemplate tx;
    private final SeatHints hints;

    public SagaListener(BookingRepository repo, BookingService bookings, Idempotency idempotency,
                        TransactionTemplate tx, SeatHints hints) {
        this.repo = repo;
        this.bookings = bookings;
        this.idempotency = idempotency;
        this.tx = tx;
        this.hints = hints;
    }

    @KafkaListener(topics = Topics.INVENTORY_EVENTS)
    public void onInventoryEvent(ConsumerRecord<String, String> record) {
        Envelope env = Json.readEnvelope(record.value());
        Runnable afterCommit = tx.execute(status -> {
            if (!idempotency.firstDelivery(env.messageId())) {
                return () -> { };
            }
            return switch (env.type()) {
                case EventTypes.SEATS_HELD -> seatsHeld(Json.payload(env, SeatsHeld.class));
                case EventTypes.SEATS_REJECTED -> seatsRejected(Json.payload(env, SeatsRejected.class));
                case EventTypes.SEATS_CONFIRMED -> seatsConfirmed(Json.payload(env, SeatsConfirmed.class));
                case EventTypes.SEATS_CONFIRM_FAILED -> confirmFailed(Json.payload(env, SeatsConfirmFailed.class));
                case EventTypes.SEATS_RELEASED -> seatsReleased(Json.payload(env, SeatsReleased.class));
                default -> () -> log.warn("Unknown inventory event {}", env.type());
            };
        });
        if (afterCommit != null) {
            afterCommit.run();
        }
    }

    /** Read-side feed, used only to keep the fast-reject hint fresh. */
    @KafkaListener(topics = Topics.AVAILABILITY_EVENTS, groupId = "booking-service-hints")
    public void onAvailability(ConsumerRecord<String, String> record) {
        Envelope env = Json.readEnvelope(record.value());
        AvailabilityChanged a = Json.payload(env, AvailabilityChanged.class);
        hints.updateAvailability(a.runId(), a.travelClass(), a.available(), a.asOf());
    }

    private Runnable seatsHeld(SeatsHeld e) {
        UUID id = UUID.fromString(e.bookingId());
        var moved = repo.move(id, EnumSet.of(PENDING), SEATS_HELD,
                "Seats " + String.join(", ", e.seats()) + " held until payment",
                Map.of("seats", String.join(",", e.seats()), "hold_expires_at", e.expiresAt()));
        if (moved.isPresent()) {
            Booking b = moved.get();
            return () -> hints.release(b.runId(), b.travelClass(), b.seatCount());
        }
        repo.find(id).ifPresent(b -> {
            if (b.status() == CANCELLED || b.status() == REJECTED) {
                // User cancelled (or we timed out) while the request was queued: give the seats back.
                bookings.releaseSeats(b, "CANCELLED_WHILE_PENDING");
            }
        });
        return () -> { };
    }

    private Runnable seatsRejected(SeatsRejected e) {
        var moved = repo.move(UUID.fromString(e.bookingId()), EnumSet.of(PENDING), REJECTED,
                "No seats available (" + e.reason() + ")", Map.of("failure_reason", e.reason()));
        return moved.<Runnable>map(b -> () -> hints.release(b.runId(), b.travelClass(), b.seatCount()))
                .orElse(() -> { });
    }

    private Runnable seatsConfirmed(SeatsConfirmed e) {
        repo.move(UUID.fromString(e.bookingId()), EnumSet.of(CONFIRMING), CONFIRMED,
                "Ticket confirmed. Seats: " + String.join(", ", e.seats()),
                Map.of("seats", String.join(",", e.seats())));
        return () -> { };
    }

    /** Paid, but the hold had already been reaped and the seats may be someone else's now: refund. */
    private Runnable confirmFailed(SeatsConfirmFailed e) {
        repo.move(UUID.fromString(e.bookingId()), EnumSet.of(CONFIRMING), FAILED,
                "Seat hold expired before payment completed; full refund initiated",
                Map.of("failure_reason", e.reason(), "refund_status", "PENDING"));
        return () -> { };
    }

    private Runnable seatsReleased(SeatsReleased e) {
        UUID id = UUID.fromString(e.bookingId());
        if ("HOLD_EXPIRED".equals(e.reason())) {
            var moved = repo.move(id, EnumSet.of(SEATS_HELD), EXPIRED,
                    "Payment not completed in time; held seats released", Map.of("failure_reason", "HOLD_EXPIRED"));
            if (moved.isEmpty()) {
                repo.find(id).filter(b -> !b.status().isTerminal())
                        .ifPresent(b -> repo.history(id, b.status(), "Seat hold expired while payment was in progress"));
            }
        }
        return () -> { };
    }
}
