-- Support for the "naive allocator" demonstration (see SeatInventory#holdNaive). Never used unless
-- an operator switches allocation_mode to NAIVE to show what goes wrong without our safeguards.

-- Runtime settings shared by every inventory replica.
CREATE TABLE inventory_setting (
    key   VARCHAR(50) PRIMARY KEY,
    value VARCHAR(50) NOT NULL
);
INSERT INTO inventory_setting (key, value) VALUES ('allocation_mode', 'SAFE');

-- The classic naive schema: an allocation table with NO uniqueness on the seat, so nothing stops
-- two bookings from recording the same seat.
CREATE TABLE naive_allocation (
    booking_id   UUID        NOT NULL,
    run_id       VARCHAR(32) NOT NULL,
    travel_class VARCHAR(4)  NOT NULL,
    seat_no      VARCHAR(12) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX naive_allocation_booking_idx ON naive_allocation (booking_id);

-- Runs that were allocated naively at least once; consistency checks report them separately.
CREATE TABLE naive_run (
    run_id     VARCHAR(32) PRIMARY KEY,
    first_used TIMESTAMPTZ NOT NULL DEFAULT now()
);
