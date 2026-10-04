CREATE TABLE payment (
    id          UUID PRIMARY KEY,
    booking_id  UUID          NOT NULL UNIQUE, -- idempotency: one charge per booking, ever
    user_id     UUID          NOT NULL,
    amount      NUMERIC(10,2) NOT NULL,
    status      VARCHAR(12)   NOT NULL,         -- PENDING, SUCCEEDED, DECLINED, REFUNDED
    reason      VARCHAR(200),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX payment_created_idx ON payment (created_at DESC);
