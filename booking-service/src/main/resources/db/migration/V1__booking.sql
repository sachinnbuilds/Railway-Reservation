CREATE TABLE booking (
    id               UUID PRIMARY KEY,
    pnr              VARCHAR(10)   NOT NULL UNIQUE,
    user_id          UUID          NOT NULL,
    idempotency_key  VARCHAR(100)  NOT NULL,
    run_id           VARCHAR(32)   NOT NULL,
    train_number     VARCHAR(10)   NOT NULL,
    train_name       VARCHAR(100)  NOT NULL,
    journey_date     DATE          NOT NULL,
    from_station     VARCHAR(8)    NOT NULL,
    to_station       VARCHAR(8)    NOT NULL,
    departure_time   VARCHAR(5),
    travel_class     VARCHAR(4)    NOT NULL,
    seat_count       INT           NOT NULL,
    passengers       TEXT          NOT NULL,
    total_fare       NUMERIC(10,2) NOT NULL,
    status           VARCHAR(24)   NOT NULL,
    seats            TEXT,
    hold_expires_at  TIMESTAMPTZ,
    payment_id       VARCHAR(64),
    refund_status    VARCHAR(12)   NOT NULL DEFAULT 'NONE',
    failure_reason   VARCHAR(300),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- A client retrying POST /bookings with the same Idempotency-Key gets the same booking back.
    CONSTRAINT booking_idempotency UNIQUE (user_id, idempotency_key)
);

CREATE INDEX booking_user_idx ON booking (user_id, created_at DESC);
CREATE INDEX booking_run_idx ON booking (run_id, status);
CREATE INDEX booking_status_idx ON booking (status, updated_at);
CREATE INDEX booking_refund_idx ON booking (refund_status) WHERE refund_status = 'PENDING';

-- Saga timeline, shown in the UI.
CREATE TABLE booking_history (
    id         BIGSERIAL PRIMARY KEY,
    booking_id UUID         NOT NULL REFERENCES booking (id),
    status     VARCHAR(24)  NOT NULL,
    note       VARCHAR(300),
    at         TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX booking_history_idx ON booking_history (booking_id, id);

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
