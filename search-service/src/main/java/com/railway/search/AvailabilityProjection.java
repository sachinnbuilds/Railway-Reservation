package com.railway.search;

import com.railway.common.events.Envelope;
import com.railway.common.events.Messages.AvailabilityChanged;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Json;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CQRS read model: seat counts per (run, class), maintained from inventory's events into Redis.
 * Searches read only this projection, never the inventory database, so browsing traffic cannot
 * slow down seat allocation. The price is staleness (seconds), which the UI shows openly;
 * the real check happens at booking time.
 */
@Component
public class AvailabilityProjection {

    private static final Logger log = LoggerFactory.getLogger(AvailabilityProjection.class);

    public record Availability(int available, int total, Instant asOf) {
    }

    /** Field value "available|total|asOfMillis"; written only if newer than what is stored. */
    private static final DefaultRedisScript<Long> SET_IF_NEWER = new DefaultRedisScript<>("""
            local cur = redis.call('HGET', KEYS[1], ARGV[1])
            if cur then
              local curTs = tonumber(string.match(cur, '([^|]+)$'))
              if curTs >= tonumber(ARGV[3]) then return 0 end
            end
            redis.call('HSET', KEYS[1], ARGV[1], ARGV[2] .. '|' .. ARGV[3])
            redis.call('EXPIRE', KEYS[1], 172800)
            return 1""", Long.class);

    private final StringRedisTemplate redis;

    public AvailabilityProjection(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @KafkaListener(topics = Topics.AVAILABILITY_EVENTS)
    public void on(ConsumerRecord<String, String> record) {
        Envelope env = Json.readEnvelope(record.value());
        AvailabilityChanged a = Json.payload(env, AvailabilityChanged.class);
        try {
            redis.execute(SET_IF_NEWER, List.of(key(a.runId())), a.travelClass(),
                    a.available() + "|" + a.total(), String.valueOf(a.asOf().toEpochMilli()));
        } catch (Exception e) {
            // Projection is rebuilt from inventory's periodic snapshot; nothing to retry here.
            log.debug("Redis unavailable, dropped availability update: {}", e.toString());
        }
    }

    /** @return class -> availability, or null if the projection store is unreachable. */
    public Map<String, Availability> forRun(String runId) {
        Map<Object, Object> raw = redis.opsForHash().entries(key(runId));
        Map<String, Availability> out = new HashMap<>();
        raw.forEach((cls, v) -> {
            String[] p = v.toString().split("\\|");
            out.put(cls.toString(), new Availability(Integer.parseInt(p[0]), Integer.parseInt(p[1]),
                    Instant.ofEpochMilli(Long.parseLong(p[2]))));
        });
        return out;
    }

    private static String key(String runId) {
        return "search:avail:" + runId;
    }
}
