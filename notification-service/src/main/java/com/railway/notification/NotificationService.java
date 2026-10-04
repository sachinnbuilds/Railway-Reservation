package com.railway.notification;

import com.railway.common.events.Envelope;
import com.railway.common.events.EventTypes;
import com.railway.common.events.Messages.BookingStatusChanged;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Json;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Deliberately non-critical: booking never waits for it. If this service is down, events simply
 * wait in Kafka and are delivered when it comes back (try: docker compose stop notification-service).
 */
@RestController
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    public record NotificationView(long id, String bookingId, String pnr, String status, String channel,
                                   String message, Instant createdAt) {
    }

    private final JdbcTemplate jdbc;

    public NotificationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @KafkaListener(topics = Topics.BOOKING_EVENTS)
    public void on(ConsumerRecord<String, String> record) {
        Envelope env = Json.readEnvelope(record.value());
        if (!EventTypes.BOOKING_STATUS_CHANGED.equals(env.type())) {
            return;
        }
        BookingStatusChanged e = Json.payload(env, BookingStatusChanged.class);
        String text = "PNR " + e.pnr() + " | Train " + e.trainNumber() + " on " + e.journeyDate() + ": " + e.message();
        int inserted = jdbc.update("""
                        INSERT INTO notification (message_id, user_id, booking_id, pnr, status, channel, message)
                        VALUES (?, ?, ?, ?, ?, 'SMS', ?) ON CONFLICT (message_id) DO NOTHING""",
                env.messageId(), UUID.fromString(e.userId()), UUID.fromString(e.bookingId()), e.pnr(), e.status(),
                text.length() > 500 ? text.substring(0, 500) : text);
        if (inserted == 1) {
            log.info("[SMS to user {}] {}", e.userId(), text);
        }
    }

    @GetMapping("/notifications")
    public List<NotificationView> mine(@RequestHeader("X-User-Id") UUID userId) {
        return jdbc.query("""
                        SELECT id, booking_id, pnr, status, channel, message, created_at FROM notification
                        WHERE user_id = ? ORDER BY created_at DESC LIMIT 50""",
                (rs, i) -> new NotificationView(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getTimestamp(7).toInstant()),
                userId);
    }
}
