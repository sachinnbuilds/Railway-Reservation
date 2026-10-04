package com.railway.common.events;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** Payload records for every command and event. Kept in one file so the whole contract is visible at once. */
public final class Messages {

    // ---- inventory.commands -------------------------------------------------------------

    public record HoldSeats(String bookingId, String runId, String travelClass, int seatCount, int holdSeconds) {
    }

    public record ConfirmSeats(String bookingId, String runId) {
    }

    public record ReleaseSeats(String bookingId, String runId, String reason) {
    }

    // ---- inventory.events ---------------------------------------------------------------

    public record SeatsHeld(String bookingId, String runId, String travelClass, List<String> seats, Instant expiresAt) {
    }

    public record SeatsRejected(String bookingId, String runId, String reason) {
    }

    public record SeatsConfirmed(String bookingId, String runId, List<String> seats) {
    }

    public record SeatsConfirmFailed(String bookingId, String runId, String reason) {
    }

    public record SeatsReleased(String bookingId, String runId, String reason) {
    }

    // ---- availability.events ------------------------------------------------------------

    public record AvailabilityChanged(String runId, String trainNumber, LocalDate journeyDate, String travelClass,
                                      int available, int total, Instant asOf) {
    }

    // ---- booking.events -----------------------------------------------------------------

    public record BookingStatusChanged(String bookingId, String pnr, String userId, String status,
                                       String trainNumber, LocalDate journeyDate, String message) {
    }

    private Messages() {
    }
}
