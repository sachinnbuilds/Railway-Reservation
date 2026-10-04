CREATE TABLE train_run (
    run_id       VARCHAR(32) PRIMARY KEY,
    train_number VARCHAR(10) NOT NULL,
    journey_date DATE        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per physical seat on one run. This table is the single source of truth for seat state
-- and only the inventory service writes it.
CREATE TABLE seat (
    run_id          VARCHAR(32) NOT NULL REFERENCES train_run (run_id),
    travel_class    VARCHAR(4)  NOT NULL,
    seat_no         VARCHAR(12) NOT NULL,
    seat_idx        INT         NOT NULL, -- allocation order: fills coaches front to back
    status          VARCHAR(10) NOT NULL DEFAULT 'AVAILABLE',
    booking_id      UUID,
    hold_expires_at TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, travel_class, seat_no),
    -- Structural guarantees: a seat belongs to at most one booking (one column), and a seat has an
    -- owner exactly when it is not AVAILABLE. Double-booking a seat cannot be represented.
    CONSTRAINT seat_status_valid CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),
    CONSTRAINT seat_owner_consistent CHECK ((status = 'AVAILABLE') = (booking_id IS NULL)),
    CONSTRAINT seat_hold_has_expiry CHECK ((status = 'HELD') = (hold_expires_at IS NOT NULL))
);

CREATE INDEX seat_free_idx ON seat (run_id, travel_class, seat_idx) WHERE status = 'AVAILABLE';
CREATE INDEX seat_booking_idx ON seat (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX seat_hold_expiry_idx ON seat (hold_expires_at) WHERE status = 'HELD';

CREATE TABLE outbox (
    id         BIGSERIAL PRIMARY KEY,
    topic      VARCHAR(100) NOT NULL,
    msg_key    VARCHAR(100),
    payload    TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sent_at    TIMESTAMPTZ
);
CREATE INDEX outbox_unsent_idx ON outbox (id) WHERE sent_at IS NULL;

CREATE TABLE processed_message (
    message_id   VARCHAR(64) PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
