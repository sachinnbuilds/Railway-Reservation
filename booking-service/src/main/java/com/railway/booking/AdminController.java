package com.railway.booking;

import com.railway.common.web.ServedByFilter;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/** Live numbers for the demo control room. */
@RestController
@RequestMapping("/admin")
public class AdminController {

    private final BookingRepository repo;
    private final PaymentClient payments;
    private final SeatHints hints;
    private final MeterRegistry meters;

    public AdminController(BookingRepository repo, PaymentClient payments, SeatHints hints, MeterRegistry meters) {
        this.repo = repo;
        this.payments = payments;
        this.hints = hints;
        this.meters = meters;
    }

    @GetMapping("/stats")
    public Map<String, Object> stats(@RequestParam(required = false) String runId) {
        CircuitBreaker cb = payments.breaker();
        CircuitBreaker.Metrics m = cb.getMetrics();
        Map<String, Object> breaker = new LinkedHashMap<>();
        breaker.put("state", cb.getState().name());
        breaker.put("failureRate", m.getFailureRate());
        breaker.put("slowCallRate", m.getSlowCallRate());
        breaker.put("bufferedCalls", m.getNumberOfBufferedCalls());
        breaker.put("notPermittedCalls", m.getNumberOfNotPermittedCalls());

        Map<String, Object> bulkhead = new LinkedHashMap<>();
        bulkhead.put("available", payments.bulkhead().getMetrics().getAvailableConcurrentCalls());
        bulkhead.put("max", payments.bulkhead().getMetrics().getMaxAllowedConcurrentCalls());

        Map<String, Object> requests = new LinkedHashMap<>();
        for (String outcome : new String[]{"accepted", "fast_rejected", "duplicate"}) {
            Counter c = meters.find("booking_requests").tag("outcome", outcome).counter();
            requests.put(outcome, c == null ? 0 : (long) c.count());
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("servedBy", ServedByFilter.instanceName());
        out.put("bookingsByStatus", repo.countByStatus(runId));
        out.put("refundsPending", repo.refundsPending());
        out.put("paymentCircuitBreaker", breaker);
        out.put("paymentBulkhead", bulkhead);
        out.put("fastRejectEnabled", hints.isEnabled());
        out.put("requestsThisInstance", requests);
        return out;
    }

    @PutMapping("/fast-reject")
    public Map<String, Object> setFastReject(@RequestParam boolean enabled) {
        hints.setEnabled(enabled);
        return Map.of("fastRejectEnabled", hints.isEnabled());
    }

    @GetMapping("/runs/{runId}/seat-conflicts")
    public java.util.List<BookingRepository.SeatConflict> seatConflicts(@PathVariable String runId,
                                                                        @RequestParam(required = false) String travelClass) {
        return repo.seatConflicts(runId, travelClass);
    }

    /** Booking id -> seat count for CONFIRMED bookings; compared against inventory's BOOKED seats. */
    @GetMapping("/runs/{runId}/confirmed")
    public Map<String, Integer> confirmed(@PathVariable String runId,
                                          @RequestParam(required = false) String travelClass) {
        return repo.confirmedSeatsByBooking(runId, travelClass);
    }
}
