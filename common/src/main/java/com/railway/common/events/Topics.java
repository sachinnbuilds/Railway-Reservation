package com.railway.common.events;

/** Kafka topic names shared by all services. */
public final class Topics {
    /** Commands to the inventory service. Keyed by runId so every request for one train run is processed in order on one partition. */
    public static final String INVENTORY_COMMANDS = "inventory.commands";
    /** Outcomes of inventory commands. Keyed by bookingId. */
    public static final String INVENTORY_EVENTS = "inventory.events";
    /** Seat-count projection feed for the read side (search) and booking fast-reject hints. Keyed by runId. */
    public static final String AVAILABILITY_EVENTS = "availability.events";
    /** Booking lifecycle notifications (confirmed, failed, cancelled...). Keyed by bookingId. */
    public static final String BOOKING_EVENTS = "booking.events";

    private Topics() {
    }
}
