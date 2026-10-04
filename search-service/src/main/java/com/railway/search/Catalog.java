package com.railway.search;

import com.railway.common.seed.SeedCatalog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The train catalog (stations, routes, classes). It changes rarely, so each instance keeps the whole
 * thing in memory and refreshes it periodically: a search costs zero database queries, and the
 * read path scales simply by adding instances.
 */
@Component
public class Catalog implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Catalog.class);

    public record Station(String code, String name, String city) {
    }

    public record ClassInfo(String code, String name, BigDecimal farePerKm, int seats) {
    }

    public record Stop(int seq, String station, String arrival, String departure, int day, int km) {
    }

    public record Train(String number, String name, String type, List<Stop> stops, List<ClassInfo> classes) {
        public int indexOf(String station) {
            for (int i = 0; i < stops.size(); i++) {
                if (stops.get(i).station().equals(station)) {
                    return i;
                }
            }
            return -1;
        }
    }

    private record Snapshot(Map<String, Station> stations, Map<String, Train> trains) {
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private volatile Snapshot snapshot = new Snapshot(Map.of(), Map.of());

    public Catalog(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    @Override
    public void run(ApplicationArguments args) {
        tx.executeWithoutResult(s -> seed(SeedCatalog.load()));
        reload();
    }

    public List<Station> stations() {
        return List.copyOf(snapshot.stations().values());
    }

    public Station station(String code) {
        return snapshot.stations().get(code);
    }

    public List<Train> trains() {
        return List.copyOf(snapshot.trains().values());
    }

    public Train train(String number) {
        return snapshot.trains().get(number);
    }

    @Scheduled(fixedDelay = 300_000, initialDelay = 300_000)
    public void reload() {
        Map<String, Station> stations = new LinkedHashMap<>();
        jdbc.query("SELECT code, name, city FROM station ORDER BY city", rs -> {
            stations.put(rs.getString(1), new Station(rs.getString(1), rs.getString(2), rs.getString(3)));
        });
        Map<String, Train> trains = new LinkedHashMap<>();
        jdbc.query("SELECT number, name, type FROM train ORDER BY number", rs -> {
            String n = rs.getString(1);
            List<Stop> stops = jdbc.query("""
                            SELECT seq, station_code, arrival, departure, day_offset, km FROM train_stop
                            WHERE train_number = ? ORDER BY seq""",
                    (r, i) -> new Stop(r.getInt(1), r.getString(2), r.getString(3), r.getString(4), r.getInt(5), r.getInt(6)), n);
            List<ClassInfo> classes = jdbc.query("""
                            SELECT c.class_code, t.name, t.fare_per_km, c.coaches * c.seats
                            FROM train_class c JOIN travel_class t ON t.code = c.class_code
                            WHERE c.train_number = ? ORDER BY t.fare_per_km""",
                    (r, i) -> new ClassInfo(r.getString(1), r.getString(2), r.getBigDecimal(3), r.getInt(4)), n);
            trains.put(n, new Train(n, rs.getString(2), rs.getString(3), stops, classes));
        });
        snapshot = new Snapshot(stations, trains);
        log.info("Catalog loaded: {} stations, {} trains", stations.size(), trains.size());
    }

    private void seed(SeedCatalog seed) {
        for (SeedCatalog.Station s : seed.stations()) {
            jdbc.update("INSERT INTO station (code, name, city) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                    s.code(), s.name(), s.city());
        }
        for (SeedCatalog.TravelClass c : seed.classes()) {
            jdbc.update("INSERT INTO travel_class (code, name, fare_per_km) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                    c.code(), c.name(), c.farePerKm());
        }
        for (SeedCatalog.Train t : seed.trains()) {
            jdbc.update("INSERT INTO train (number, name, type) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                    t.number(), t.name(), t.type());
            List<SeedCatalog.Stop> stops = new ArrayList<>(t.stops());
            for (int i = 0; i < stops.size(); i++) {
                SeedCatalog.Stop s = stops.get(i);
                jdbc.update("""
                                INSERT INTO train_stop (train_number, seq, station_code, arrival, departure, day_offset, km)
                                VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                        t.number(), i + 1, s.station(), s.arrival(), s.departure(), s.day(), s.km());
            }
            t.coaches().forEach((cls, coaches) -> jdbc.update("""
                            INSERT INTO train_class (train_number, class_code, coaches, seats)
                            VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                    t.number(), cls, coaches, seed.travelClass(cls).seatsPerCoach()));
        }
    }
}
