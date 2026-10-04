package com.railway.booking;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record Booking(UUID id, String pnr, UUID userId, String idempotencyKey, String runId, String trainNumber,
                      String trainName, LocalDate journeyDate, String fromStation, String toStation,
                      String departureTime, String travelClass, int seatCount, List<Passenger> passengers,
                      BigDecimal totalFare, BookingStatus status, List<String> seats, Instant holdExpiresAt,
                      String paymentId, String refundStatus, String failureReason, Instant createdAt,
                      Instant updatedAt) {

    public record Passenger(String name, int age, String gender) {
    }

    public record HistoryEntry(String status, String note, Instant at) {
    }
}
