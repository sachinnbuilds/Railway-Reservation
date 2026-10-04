package com.railway.booking;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.Optional;

import static com.railway.booking.BookingStatus.*;

/**
 * Background repair loop for everything that can be left "in between":
 * <ol>
 *   <li><b>Payment unknown</b>: ask the gateway what really happened and finish the saga accordingly.</li>
 *   <li><b>Refunds</b>: retry until the gateway confirms the refund.</li>
 *   <li><b>Stale holds / stuck requests</b>: time them out and release seats.</li>
 * </ol>
 * Every transition is guarded, so running this on several instances at once is safe.
 */
@Component
public class Reconciler {

    private static final Logger log = LoggerFactory.getLogger(Reconciler.class);

    /** After this long with no record at the gateway, a charge can no longer appear (gateway enforces notAfter). */
    private static final Duration NOT_FOUND_GRACE = Duration.ofSeconds(20);

    private final BookingRepository repo;
    private final BookingService bookings;
    private final PaymentClient payments;
    private final TransactionTemplate tx;
    private final MeterRegistry meters;

    public Reconciler(BookingRepository repo, BookingService bookings, PaymentClient payments,
                      TransactionTemplate tx, MeterRegistry meters) {
        this.repo = repo;
        this.bookings = bookings;
        this.payments = payments;
        this.tx = tx;
        this.meters = meters;
    }

    @Scheduled(fixedDelay = 3000, initialDelay = 10000)
    public void run() {
        safely("payments", this::reconcilePayments);
        safely("refunds", this::processRefunds);
        safely("stale holds", this::expireStaleHolds);
        safely("stuck requests", this::timeOutStuckRequests);
    }

    void reconcilePayments() {
        // PAYMENT_PROCESSING older than the client timeout means the request thread died mid-call.
        for (Booking b : repo.findByStatusOlderThan(EnumSet.of(PAYMENT_UNKNOWN, PAYMENT_PROCESSING), "updated_at", 5, 50)) {
            Optional<PaymentClient.PaymentView> truth;
            try {
                truth = payments.status(b.id());
            } catch (Exception e) {
                log.info("Payment gateway still unreachable for booking {}: {}", b.id(), e.toString());
                continue;
            }
            String status = truth.map(PaymentClient.PaymentView::status).orElse("NOT_FOUND");
            switch (status) {
                case "SUCCEEDED" -> {
                    Boolean moved = tx.execute(s -> bookings.paymentSucceeded(b, truth.get().paymentId()));
                    if (Boolean.TRUE.equals(moved)) {
                        meters.counter("reconciled_payments", "result", "succeeded").increment();
                        log.info("Reconciled booking {}: gateway says SUCCEEDED -> confirming", b.id());
                    } else {
                        log.info("Booking {} already reconciled by another replica (guarded transition, no-op)", b.id());
                    }
                }
                case "DECLINED", "REFUNDED" -> {
                    meters.counter("reconciled_payments", "result", "failed").increment();
                    tx.executeWithoutResult(s -> bookings.paymentFailed(b, "payment declined (verified with gateway)"));
                }
                case "NOT_FOUND" -> {
                    if (b.updatedAt().isBefore(Instant.now().minus(NOT_FOUND_GRACE))) {
                        meters.counter("reconciled_payments", "result", "never_arrived").increment();
                        tx.executeWithoutResult(s -> bookings.paymentFailed(b,
                                "payment never reached the gateway; no money was taken"));
                    }
                }
                default -> {
                    // PENDING at the gateway: it is still deciding; check again next round.
                }
            }
        }
    }

    void processRefunds() {
        for (Booking b : repo.findRefundsPending(50)) {
            try {
                PaymentClient.PaymentView v = payments.refund(b.id());
                String note = "REFUNDED".equals(v.status())
                        ? "Refund of Rs " + b.totalFare() + " completed"
                        : "No charge found at the gateway, nothing to refund";
                tx.executeWithoutResult(s -> repo.markRefunded(b.id(), note));
                meters.counter("refunds_completed").increment();
            } catch (Exception e) {
                log.info("Refund for {} not possible yet: {}", b.id(), e.toString());
            }
        }
    }

    /** SEATS_HELD long past its lease (e.g. the expiry event was lost): expire and release defensively. */
    void expireStaleHolds() {
        for (Booking b : repo.findByStatusOlderThan(EnumSet.of(SEATS_HELD), "hold_expires_at", 30, 100)) {
            tx.executeWithoutResult(s -> repo.move(b.id(), EnumSet.of(SEATS_HELD), EXPIRED,
                            "Payment not completed in time; held seats released", Map.of("failure_reason", "HOLD_EXPIRED"))
                    .ifPresent(x -> bookings.releaseSeats(b, "HOLD_EXPIRED")));
        }
    }

    /** A request still PENDING after 10 minutes means inventory is down for a long time: give up cleanly. */
    void timeOutStuckRequests() {
        for (Booking b : repo.findByStatusOlderThan(EnumSet.of(PENDING), "created_at", 600, 100)) {
            tx.executeWithoutResult(s -> repo.move(b.id(), EnumSet.of(PENDING), REJECTED,
                    "Could not allocate seats in time, please try again", Map.of("failure_reason", "TIMEOUT")));
            // If the hold does happen later, SagaListener sees a REJECTED booking and releases the seats.
        }
    }

    private void safely(String what, Runnable job) {
        try {
            job.run();
        } catch (Exception e) {
            log.warn("Reconciler step '{}' failed: {}", what, e.toString());
        }
    }
}
