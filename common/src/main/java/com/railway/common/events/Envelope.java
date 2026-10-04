package com.railway.common.events;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;

/**
 * Wire format of every Kafka message. {@code messageId} is unique per logical message and is what
 * idempotent consumers de-duplicate on (Kafka delivery is at-least-once).
 */
public record Envelope(String messageId, String type, Instant occurredAt, JsonNode payload) {
}
