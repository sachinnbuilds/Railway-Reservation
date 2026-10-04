package com.railway.inventory;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * SAFE (default) or NAIVE. Stored in the database so every inventory replica sees the same mode;
 * cached for one second so it costs nothing per message.
 */
@Component
public class AllocationMode {

    public enum Mode { SAFE, NAIVE }

    private final JdbcTemplate jdbc;
    private volatile Mode cached = Mode.SAFE;
    private volatile long readAt;

    public AllocationMode(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Mode get() {
        long now = System.currentTimeMillis();
        if (now - readAt > 1000) {
            cached = Mode.valueOf(jdbc.queryForObject(
                    "SELECT value FROM inventory_setting WHERE key = 'allocation_mode'", String.class));
            readAt = now;
        }
        return cached;
    }

    public Mode set(Mode mode) {
        jdbc.update("UPDATE inventory_setting SET value = ? WHERE key = 'allocation_mode'", mode.name());
        readAt = 0;
        return get();
    }
}
