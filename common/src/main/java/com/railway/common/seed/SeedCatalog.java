package com.railway.common.seed;

import com.railway.common.messaging.Json;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/**
 * Static reference data shared by the catalog (search) and inventory services. Both services seed
 * their own databases from this file, so neither depends on the other at startup.
 */
public record SeedCatalog(List<Station> stations, List<TravelClass> classes, List<Train> trains) {

    /** How many days ahead (inclusive of today) train runs are opened for booking. */
    public static final int BOOKING_WINDOW_DAYS = 15;

    private static final DateTimeFormatter RUN_DATE = DateTimeFormatter.BASIC_ISO_DATE;

    public record Station(String code, String name, String city) {
    }

    public record TravelClass(String code, String name, double farePerKm, int seatsPerCoach, String coachPrefix) {
    }

    public record Stop(String station, String arrival, String departure, int day, int km) {
    }

    public record Train(String number, String name, String type, Map<String, Integer> coaches, List<Stop> stops) {
    }

    /** A train run (one departure of a train on one date) is identified by {@code <trainNo>-<yyyyMMdd>}. */
    public static String runId(String trainNumber, LocalDate journeyDate) {
        return trainNumber + "-" + journeyDate.format(RUN_DATE);
    }

    public TravelClass travelClass(String code) {
        return classes.stream().filter(c -> c.code().equals(code)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unknown class " + code));
    }

    public static SeedCatalog load() {
        try (InputStream in = SeedCatalog.class.getResourceAsStream("/seed/railway-seed.json")) {
            return Json.MAPPER.readValue(in, SeedCatalog.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
