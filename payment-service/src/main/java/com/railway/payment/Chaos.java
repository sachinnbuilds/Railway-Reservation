package com.railway.payment;

import org.springframework.stereotype.Component;

import java.util.concurrent.ThreadLocalRandom;

/**
 * Fault injection for the mock gateway, switchable at runtime from the control room:
 * <ul>
 *   <li>{@code latencyMs}: every charge takes this long (simulates a slow bank)</li>
 *   <li>{@code failureRate}: fraction of charges declined</li>
 *   <li>{@code timeoutAfterChargeRate}: fraction of charges that succeed and are recorded, but whose
 *       response is delayed beyond the caller's timeout - the classic "money deducted, ticket not booked"</li>
 *   <li>{@code down}: gateway answers 503 without processing anything</li>
 * </ul>
 */
@Component
public class Chaos {

    public record Settings(int latencyMs, double failureRate, double timeoutAfterChargeRate, boolean down) {
    }

    private volatile Settings settings = new Settings(300, 0.0, 0.0, false);

    public Settings get() {
        return settings;
    }

    public Settings set(Settings s) {
        settings = new Settings(Math.max(0, Math.min(s.latencyMs(), 30_000)),
                clamp(s.failureRate()), clamp(s.timeoutAfterChargeRate()), s.down());
        return settings;
    }

    boolean roll(double probability) {
        return ThreadLocalRandom.current().nextDouble() < probability;
    }

    private static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }
}
