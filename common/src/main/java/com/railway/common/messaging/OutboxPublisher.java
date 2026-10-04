package com.railway.common.messaging;

import org.apache.kafka.clients.producer.ProducerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Polls unsent outbox rows and publishes them. {@code FOR UPDATE SKIP LOCKED} lets several
 * instances of the same service publish in parallel without sending a row twice. A crash after
 * send but before commit re-sends the row later, which consumers tolerate via {@link Idempotency}.
 */
@Component
public class OutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(OutboxPublisher.class);
    private static final int BATCH = 500;

    private final JdbcTemplate jdbc;
    private final KafkaTemplate<String, String> kafka;
    private final TransactionTemplate tx;

    public OutboxPublisher(JdbcTemplate jdbc, KafkaTemplate<String, String> kafka, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.kafka = kafka;
        this.tx = tx;
    }

    private record Row(long id, String topic, String key, String payload) {
    }

    @Scheduled(fixedDelayString = "${outbox.poll-ms:100}")
    public void publish() {
        try {
            Integer sent;
            do {
                sent = tx.execute(status -> publishBatch());
            } while (sent != null && sent == BATCH);
        } catch (Exception e) {
            log.warn("Outbox publish failed, will retry: {}", e.toString());
        }
    }

    private int publishBatch() {
        List<Row> rows = jdbc.query("""
                        SELECT id, topic, msg_key, payload FROM outbox
                        WHERE sent_at IS NULL ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED""",
                (rs, i) -> new Row(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4)), BATCH);
        if (rows.isEmpty()) {
            return 0;
        }
        List<CompletableFuture<?>> futures = new ArrayList<>(rows.size());
        for (Row row : rows) {
            futures.add(kafka.send(new ProducerRecord<>(row.topic(), row.key(), row.payload())));
        }
        try {
            CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).get(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new IllegalStateException("Kafka send failed", e);
        }
        jdbc.batchUpdate("UPDATE outbox SET sent_at = now() WHERE id = ?",
                rows.stream().map(r -> new Object[]{r.id()}).toList());
        return rows.size();
    }

    @Scheduled(fixedDelay = 60_000)
    public void purgeSent() {
        jdbc.update("DELETE FROM outbox WHERE sent_at < now() - interval '1 hour'");
    }
}
