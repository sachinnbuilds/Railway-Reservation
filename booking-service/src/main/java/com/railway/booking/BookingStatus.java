package com.railway.booking;

/**
 * Saga states.
 * <pre>
 * PENDING --SeatsHeld--> SEATS_HELD --pay--> PAYMENT_PROCESSING --ok--> CONFIRMING --SeatsConfirmed--> CONFIRMED
 *    |                       |                    |  \--timeout--> PAYMENT_UNKNOWN --reconciler--> CONFIRMING / PAYMENT_FAILED
 *    |                       |                    \--declined--> PAYMENT_FAILED (seats released)
 *    |                       \--hold lease ran out--> EXPIRED
 *    \--SeatsRejected--> REJECTED                              CONFIRMING --SeatsConfirmFailed--> FAILED (+ refund)
 * PENDING / SEATS_HELD / CONFIRMED --cancel--> CANCELLED (+ seats released, + refund if paid)
 * </pre>
 */
public enum BookingStatus {
    PENDING,
    SEATS_HELD,
    PAYMENT_PROCESSING,
    PAYMENT_UNKNOWN,
    CONFIRMING,
    CONFIRMED,
    REJECTED,
    PAYMENT_FAILED,
    EXPIRED,
    CANCELLED,
    FAILED;

    public boolean isTerminal() {
        return switch (this) {
            case CONFIRMED, REJECTED, PAYMENT_FAILED, EXPIRED, CANCELLED, FAILED -> true;
            default -> false;
        };
    }

    /** States the user is told about (via notification-service). */
    public boolean isNotifiable() {
        return isTerminal() || this == PAYMENT_UNKNOWN;
    }
}
