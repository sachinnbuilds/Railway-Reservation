package com.railway.booking;

import com.railway.common.web.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/bookings")
public class BookingController {

    public record BookingRequest(@NotBlank String trainNumber, @NotNull LocalDate journeyDate,
                                 @NotBlank String from, @NotBlank String to, @NotBlank String travelClass,
                                 @NotEmpty List<Booking.Passenger> passengers) {
    }

    public record BookingView(String id, String pnr, String status, boolean terminal, String trainNumber,
                              String trainName, LocalDate journeyDate, String from, String to, String departureTime,
                              String travelClass, int seatCount, List<Booking.Passenger> passengers,
                              BigDecimal totalFare, List<String> seats, Instant holdExpiresAt, String paymentId,
                              String refundStatus, String failureReason, Instant createdAt, Instant updatedAt,
                              List<Booking.HistoryEntry> history) {

        static BookingView of(Booking b, List<Booking.HistoryEntry> history) {
            return new BookingView(b.id().toString(), b.pnr(), b.status().name(), b.status().isTerminal(),
                    b.trainNumber(), b.trainName(), b.journeyDate(), b.fromStation(), b.toStation(),
                    b.departureTime(), b.travelClass(), b.seatCount(), b.passengers(), b.totalFare(), b.seats(),
                    b.holdExpiresAt(), b.paymentId(), b.refundStatus(), b.failureReason(), b.createdAt(),
                    b.updatedAt(), history);
        }
    }

    private final BookingService service;
    private final BookingRepository repo;

    public BookingController(BookingService service, BookingRepository repo) {
        this.service = service;
        this.repo = repo;
    }

    /**
     * 202 Accepted: the request is queued; poll {@code GET /bookings/{id}}. Send an
     * {@code Idempotency-Key} header so a retry after a timeout returns the same booking.
     */
    @PostMapping
    public ResponseEntity<BookingView> create(@RequestHeader("X-User-Id") UUID userId,
                                              @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                              @Valid @RequestBody BookingRequest req) {
        String idempotencyKey = (key == null || key.isBlank()) ? UUID.randomUUID().toString() : key;
        if (idempotencyKey.length() > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Idempotency-Key too long");
        }
        BookingService.CreateResult result = service.create(userId, idempotencyKey,
                new BookingService.NewBooking(req.trainNumber(), req.journeyDate(), req.from().toUpperCase(),
                        req.to().toUpperCase(), req.travelClass().toUpperCase(), req.passengers()));
        Booking b = result.booking();
        return ResponseEntity.status(result.created() ? HttpStatus.ACCEPTED : HttpStatus.OK)
                .body(BookingView.of(b, repo.history(b.id())));
    }

    @GetMapping
    public List<BookingView> mine(@RequestHeader("X-User-Id") UUID userId) {
        return service.mine(userId).stream().map(b -> BookingView.of(b, List.of())).toList();
    }

    @GetMapping("/{id}")
    public BookingView get(@RequestHeader("X-User-Id") UUID userId, @PathVariable UUID id) {
        Booking b = service.owned(userId, id);
        return BookingView.of(b, service.history(id));
    }

    @GetMapping("/pnr/{pnr}")
    public BookingView byPnr(@PathVariable String pnr) {
        Booking b = repo.findByPnr(pnr)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "no booking with PNR " + pnr));
        // PNR status is public information on IRCTC; passenger names are masked.
        List<Booking.Passenger> masked = b.passengers().stream()
                .map(p -> new Booking.Passenger(p.name().charAt(0) + "****", p.age(), p.gender())).toList();
        Booking view = new Booking(b.id(), b.pnr(), b.userId(), null, b.runId(), b.trainNumber(), b.trainName(),
                b.journeyDate(), b.fromStation(), b.toStation(), b.departureTime(), b.travelClass(), b.seatCount(),
                masked, b.totalFare(), b.status(), b.seats(), b.holdExpiresAt(), null, b.refundStatus(), null,
                b.createdAt(), b.updatedAt());
        return BookingView.of(view, List.of());
    }

    @PostMapping("/{id}/pay")
    public BookingView pay(@RequestHeader("X-User-Id") UUID userId, @PathVariable UUID id) {
        Booking b = service.pay(userId, id);
        return BookingView.of(b, service.history(id));
    }

    @DeleteMapping("/{id}")
    public BookingView cancel(@RequestHeader("X-User-Id") UUID userId, @PathVariable UUID id) {
        Booking b = service.cancel(userId, id);
        return BookingView.of(b, service.history(id));
    }
}
