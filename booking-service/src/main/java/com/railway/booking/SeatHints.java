package com.railway.booking;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * Tatkal fast-reject. Keeps two Redis numbers per (run, class):
 * <ul>
 *   <li>{@code avail}: last seat count published by inventory (absolute, newest wins)</li>
 *   <li>{@code inflight}: seats requested by bookings that are accepted but not yet allocated</li>
 * </ul>
 * A request is admitted only if {@code avail - inflight >= seats}, decided atomically in a Lua script.
 * When a train has 64 seats and 5,000 people press "book", roughly 64 requests are queued and the rest
 * get an instant "sold out" without touching Postgres or Kafka.
 *
 * <p>This is a <b>hint, not the truth</b>: inventory still decides. If Redis is down or the counts are
 * missing, every request is admitted (fail open): slower under load, never incorrect.
 */
@Component
public class SeatHints {

    private static final Logger log = LoggerFactory.getLogger(SeatHints.class);
    private static final String ENABLED_KEY = "booking:config:fast-reject";

    private static final DefaultRedisScript<Long> ADMIT = new DefaultRedisScript<>("""
            local avail = redis.call('GET', KEYS[1])
            local n = tonumber(ARGV[1])
            if avail then
              local inflight = tonumber(redis.call('GET', KEYS[2]) or '0')
              if tonumber(avail) - inflight < n then return 0 end
            end
            redis.call('INCRBY', KEYS[2], n)
            redis.call('EXPIRE', KEYS[2], 300)
            return 1""", Long.class);

    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>("""
            local v = redis.call('DECRBY', KEYS[1], tonumber(ARGV[1]))
            if v < 0 then redis.call('SET', KEYS[1], 0) end
            return v""", Long.class);

    /** Set the absolute seat count only if this reading is newer than the one stored. */
    private static final DefaultRedisScript<Long> SET_IF_NEWER = new DefaultRedisScript<>("""
            local cur = redis.call('GET', KEYS[2])
            if cur and tonumber(cur) >= tonumber(ARGV[2]) then return 0 end
            redis.call('SET', KEYS[1], ARGV[1], 'EX', 86400)
            redis.call('SET', KEYS[2], ARGV[2], 'EX', 86400)
            return 1""", Long.class);

    private final StringRedisTemplate redis;
    private final MeterRegistry meters;

    public SeatHints(StringRedisTemplate redis, MeterRegistry meters) {
        this.redis = redis;
        this.meters = meters;
    }

    public boolean tryAdmit(String runId, String travelClass, int seats) {
        try {
            if (!isEnabled()) {
                return true;
            }
            Long ok = redis.execute(ADMIT, List.of(availKey(runId, travelClass), inflightKey(runId, travelClass)),
                    String.valueOf(seats));
            return ok == null || ok == 1L;
        } catch (Exception e) {
            meters.counter("fast_reject_redis_errors").increment();
            log.warn("Redis unavailable, admitting without fast-reject: {}", e.toString());
            return true;
        }
    }

    public void release(String runId, String travelClass, int seats) {
        try {
            if (isEnabled()) {
                redis.execute(RELEASE, List.of(inflightKey(runId, travelClass)), String.valueOf(seats));
            }
        } catch (Exception e) {
            log.debug("Redis unavailable on hint release: {}", e.toString());
        }
    }

    public void updateAvailability(String runId, String travelClass, int available, Instant asOf) {
        try {
            redis.execute(SET_IF_NEWER, List.of(availKey(runId, travelClass), availKey(runId, travelClass) + ":asof"),
                    String.valueOf(available), String.valueOf(asOf.toEpochMilli()));
        } catch (Exception e) {
            log.debug("Redis unavailable on availability update: {}", e.toString());
        }
    }

    public boolean isEnabled() {
        try {
            return !"off".equals(redis.opsForValue().get(ENABLED_KEY));
        } catch (Exception e) {
            return false;
        }
    }

    public void setEnabled(boolean enabled) {
        redis.opsForValue().set(ENABLED_KEY, enabled ? "on" : "off");
    }

    private static String availKey(String runId, String cls) {
        return "booking:hint:avail:" + runId + ":" + cls;
    }

    private static String inflightKey(String runId, String cls) {
        return "booking:hint:inflight:" + runId + ":" + cls;
    }
}
