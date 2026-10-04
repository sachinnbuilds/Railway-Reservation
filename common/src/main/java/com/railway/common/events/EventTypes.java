package com.railway.common.events;

public final class EventTypes {
    // inventory.commands
    public static final String HOLD_SEATS = "HoldSeats";
    public static final String CONFIRM_SEATS = "ConfirmSeats";
    public static final String RELEASE_SEATS = "ReleaseSeats";

    // inventory.events
    public static final String SEATS_HELD = "SeatsHeld";
    public static final String SEATS_REJECTED = "SeatsRejected";
    public static final String SEATS_CONFIRMED = "SeatsConfirmed";
    public static final String SEATS_CONFIRM_FAILED = "SeatsConfirmFailed";
    public static final String SEATS_RELEASED = "SeatsReleased";

    // availability.events
    public static final String AVAILABILITY_CHANGED = "AvailabilityChanged";

    // booking.events
    public static final String BOOKING_STATUS_CHANGED = "BookingStatusChanged";

    private EventTypes() {
    }
}
