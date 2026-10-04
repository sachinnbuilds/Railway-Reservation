CREATE TABLE notification (
    id         BIGSERIAL PRIMARY KEY,
    message_id VARCHAR(64)  NOT NULL UNIQUE, -- idempotent consumer: one notification per event
    user_id    UUID         NOT NULL,
    booking_id UUID         NOT NULL,
    pnr        VARCHAR(10),
    status     VARCHAR(24)  NOT NULL,
    channel    VARCHAR(10)  NOT NULL,
    message    VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX notification_user_idx ON notification (user_id, created_at DESC);
