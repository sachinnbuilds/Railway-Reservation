package com.railway.common.messaging;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Idempotent-consumer helper. Call {@link #firstDelivery} inside the transaction that applies the
 * message's effect: the marker row and the effect commit together, so a redelivered message is a no-op.
 */
@Component
public class Idempotency {

    private final JdbcTemplate jdbc;

    public Idempotency(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public boolean firstDelivery(String messageId) {
        return jdbc.update("INSERT INTO processed_message (message_id) VALUES (?) ON CONFLICT DO NOTHING",
                messageId) == 1;
    }
}
