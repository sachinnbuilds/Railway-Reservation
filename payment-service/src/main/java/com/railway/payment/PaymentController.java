package com.railway.payment;

import com.railway.common.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/** Mock payment gateway. Idempotent per booking: charging the same booking twice never moves money twice. */
@RestController
public class PaymentController {

    private static final Logger log = LoggerFactory.getLogger(PaymentController.class);

    public record ChargeRequest(UUID bookingId, UUID userId, BigDecimal amount, Instant notAfter) {
    }

    public record PaymentView(String paymentId, String bookingId, String status, BigDecimal amount, String reason,
                              Instant createdAt, Instant updatedAt) {
    }

    private static final RowMapper<PaymentView> MAPPER = (rs, i) -> new PaymentView(rs.getString("id"),
            rs.getString("booking_id"), rs.getString("status"), rs.getBigDecimal("amount"), rs.getString("reason"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());

    private final JdbcTemplate jdbc;
    private final Chaos chaos;

    public PaymentController(JdbcTemplate jdbc, Chaos chaos) {
        this.jdbc = jdbc;
        this.chaos = chaos;
    }

    @PostMapping("/payments")
    public PaymentView charge(@RequestBody ChargeRequest req) throws InterruptedException {
        Chaos.Settings s = chaos.get();
        if (s.down()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GATEWAY_DOWN", "payment gateway is down");
        }
        if (req.bookingId() == null || req.userId() == null || req.amount() == null || req.amount().signum() <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "bookingId, userId and a positive amount are required");
        }
        UUID id = UUID.randomUUID();
        try {
            // Record the attempt first, before any "bank" work: a crash or timeout later can always be
            // looked up by bookingId.
            jdbc.update("INSERT INTO payment (id, booking_id, user_id, amount, status) VALUES (?, ?, ?, ?, 'PENDING')",
                    id, req.bookingId(), req.userId(), req.amount());
        } catch (DuplicateKeyException e) {
            return find(req.bookingId()); // retry of the same charge: report the existing result
        }

        Thread.sleep(s.latencyMs() + ThreadLocalRandom.current().nextInt(Math.max(1, s.latencyMs() / 5 + 1)));

        String status;
        String reason = null;
        if (req.notAfter() != null && Instant.now().isAfter(req.notAfter())) {
            status = "DECLINED";
            reason = "request arrived after its deadline";
        } else if (chaos.roll(s.failureRate())) {
            status = "DECLINED";
            reason = "card declined by issuing bank";
        } else {
            status = "SUCCEEDED";
        }
        jdbc.update("UPDATE payment SET status = ?, reason = ?, updated_at = now() WHERE id = ?", status, reason, id);
        log.info("Charge {} for booking {}: {} Rs {}", id, req.bookingId(), status, req.amount());

        if ("SUCCEEDED".equals(status) && chaos.roll(s.timeoutAfterChargeRate())) {
            log.warn("CHAOS: charged booking {} but delaying the response past the caller's timeout", req.bookingId());
            Thread.sleep(8_000);
        }
        return find(req.bookingId());
    }

    @GetMapping("/payments/booking/{bookingId}")
    public PaymentView byBooking(@PathVariable UUID bookingId) {
        if (chaos.get().down()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GATEWAY_DOWN", "payment gateway is down");
        }
        // A PENDING charge older than any possible processing time was abandoned (gateway crashed
        // mid-charge). The bank never confirmed it, so it is final as DECLINED.
        jdbc.update("""
                UPDATE payment SET status = 'DECLINED', reason = 'abandoned: no bank confirmation', updated_at = now()
                WHERE booking_id = ? AND status = 'PENDING' AND created_at < now() - interval '60 seconds'""",
                bookingId);
        return find(bookingId);
    }

    @PostMapping("/payments/booking/{bookingId}/refund")
    public PaymentView refund(@PathVariable UUID bookingId) {
        if (chaos.get().down()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GATEWAY_DOWN", "payment gateway is down");
        }
        int n = jdbc.update("""
                UPDATE payment SET status = 'REFUNDED', reason = 'refunded', updated_at = now()
                WHERE booking_id = ? AND status = 'SUCCEEDED'""", bookingId);
        if (n == 1) {
            log.info("Refunded booking {}", bookingId);
        }
        List<PaymentView> rows = jdbc.query("SELECT * FROM payment WHERE booking_id = ?", MAPPER, bookingId);
        if (rows.isEmpty()) {
            // Nothing was ever charged: report it so the caller can close the refund.
            return new PaymentView(null, bookingId.toString(), "NOT_FOUND", null, "no charge exists", null, null);
        }
        return rows.get(0);
    }

    // ---------------------------------------------------------------- control room

    @GetMapping("/admin/chaos")
    public Chaos.Settings getChaos() {
        return chaos.get();
    }

    @PutMapping("/admin/chaos")
    public Chaos.Settings setChaos(@RequestBody Chaos.Settings settings) {
        Chaos.Settings s = chaos.set(settings);
        log.warn("Chaos settings changed: {}", s);
        return s;
    }

    @GetMapping("/admin/payments")
    public List<PaymentView> recent() {
        return jdbc.query("SELECT * FROM payment ORDER BY created_at DESC LIMIT 30", MAPPER);
    }

    private PaymentView find(UUID bookingId) {
        return jdbc.query("SELECT * FROM payment WHERE booking_id = ?", MAPPER, bookingId).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "no payment for booking"));
    }
}
