package com.railway.common.messaging;

import com.railway.common.events.Envelope;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Transactional outbox. {@link #enqueue} must run inside the same database transaction as the
 * business change, so "state changed" and "event will be published" commit or roll back together.
 * {@link OutboxPublisher} later ships the rows to Kafka (at-least-once).
 *
 * <p>Each service using it owns an {@code outbox} table (see its Flyway migration).
 */
@Component
public class Outbox {

    private final JdbcTemplate jdbc;

    public Outbox(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void enqueue(String topic, String key, String type, Object payload) {
        Envelope envelope = new Envelope(UUID.randomUUID().toString(), type, Instant.now(),
                Json.MAPPER.valueToTree(payload));
        jdbc.update("INSERT INTO outbox (topic, msg_key, payload) VALUES (?, ?, ?)",
                topic, key, Json.write(envelope));
    }
}
