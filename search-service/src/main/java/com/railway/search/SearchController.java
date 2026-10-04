package com.railway.search;

import com.railway.common.seed.SeedCatalog;
import com.railway.common.web.ApiException;
import com.railway.common.web.ServedByFilter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

@RestController
public class SearchController {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SearchController.class);

    public record ClassResult(String code, String name, BigDecimal fare, Integer available, Integer total,
                              String status, Long ageSeconds) {
    }

    /**
     * {@code journeyDate} is the date the train leaves its origin (what a booking refers to);
     * {@code boardingDate} is the date the passenger boards at {@code from}.
     */
    public record TrainResult(String number, String name, String type, String from, String to,
                              String departure, String arrival, LocalDate boardingDate, LocalDate journeyDate,
                              LocalDate arrivalDate, int durationMinutes, int distanceKm, List<ClassResult> classes) {
    }

    public record SearchResponse(String from, String to, LocalDate date, String servedBy, boolean availabilityLive,
                                 String note, List<TrainResult> trains) {
    }

    private final Catalog catalog;
    private final AvailabilityProjection projection;
    private final MeterRegistry meters;
    private final AtomicLong served = new AtomicLong();

    public SearchController(Catalog catalog, AvailabilityProjection projection, MeterRegistry meters) {
        this.catalog = catalog;
        this.projection = projection;
        this.meters = meters;
    }

    @GetMapping("/stations")
    public List<Catalog.Station> stations() {
        return catalog.stations();
    }

    @GetMapping("/trains")
    public List<Catalog.Train> trains() {
        return catalog.trains();
    }

    @GetMapping("/trains/{number}")
    public Catalog.Train train(@PathVariable String number) {
        Catalog.Train t = catalog.train(number);
        if (t == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "no train " + number);
        }
        return t;
    }

    @GetMapping("/search")
    public SearchResponse search(@RequestParam String from, @RequestParam String to, @RequestParam LocalDate date) {
        served.incrementAndGet();
        String f = from.toUpperCase();
        String t = to.toUpperCase();
        if (catalog.station(f) == null || catalog.station(t) == null || f.equals(t)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ROUTE", "choose two different, known stations");
        }
        boolean live = true;
        List<TrainResult> results = new ArrayList<>();
        for (Catalog.Train train : catalog.trains()) {
            int fi = train.indexOf(f);
            int ti = train.indexOf(t);
            if (fi < 0 || ti < 0 || fi >= ti) {
                continue;
            }
            Catalog.Stop a = train.stops().get(fi);
            Catalog.Stop b = train.stops().get(ti);
            LocalDate runDate = date.minusDays(a.day());
            Map<String, AvailabilityProjection.Availability> avail = null;
            if (live) {
                try {
                    avail = projection.forRun(SeedCatalog.runId(train.number(), runDate));
                } catch (Exception e) {
                    // Degraded mode: Redis is down. Still answer with timetable and fares.
                    live = false;
                    meters.counter("search_degraded").increment();
                }
            }
            int km = b.km() - a.km();
            boolean bookable = isBookable(runDate);
            List<ClassResult> classes = new ArrayList<>();
            for (Catalog.ClassInfo c : train.classes()) {
                BigDecimal fare = c.farePerKm().multiply(BigDecimal.valueOf(Math.max(km, 50)))
                        .add(BigDecimal.valueOf(40)).setScale(0, RoundingMode.HALF_UP);
                AvailabilityProjection.Availability av = avail == null ? null : avail.get(c.code());
                String status;
                if (!bookable) {
                    status = "NOT_OPEN";
                } else if (av == null) {
                    status = "CHECK_AT_BOOKING";
                } else {
                    status = av.available() > 0 ? "AVAILABLE" : "SOLD_OUT";
                }
                classes.add(new ClassResult(c.code(), c.name(), fare,
                        av == null ? null : av.available(), av == null ? c.seats() : av.total(), status,
                        av == null ? null : Duration.between(av.asOf(), Instant.now()).toSeconds()));
            }
            LocalTime dep = LocalTime.parse(a.departure());
            LocalTime arr = LocalTime.parse(b.arrival());
            int minutes = (int) (Duration.between(dep, arr).toMinutes() + (b.day() - a.day()) * 1440L);
            results.add(new TrainResult(train.number(), train.name(), train.type(), f, t, a.departure(), b.arrival(),
                    date, runDate, runDate.plusDays(b.day()), minutes, km, classes));
        }
        results.sort(Comparator.comparing(TrainResult::departure));
        // One line per search so load balancing across replicas can be watched live (scripts/watch-search.sh).
        log.info("SEARCH {}->{} {} : {} trains, availability {}", f, t, date, results.size(), live ? "live" : "degraded");
        meters.counter("search_requests").increment();
        return new SearchResponse(f, t, date, "search-service@" + ServedByFilter.instanceName(), live,
                live ? "Availability is refreshed continuously and may be a few seconds old; it is re-checked when you book."
                        : "Live availability is temporarily unavailable; timetable and fares are shown.",
                results);
    }

    @GetMapping("/admin/stats")
    public Map<String, Object> stats() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("servedBy", ServedByFilter.instanceName());
        out.put("searchesServedByThisInstance", served.get());
        return out;
    }

    private static boolean isBookable(LocalDate runDate) {
        LocalDate today = LocalDate.now(IST);
        return !runDate.isBefore(today) && runDate.isBefore(today.plusDays(SeedCatalog.BOOKING_WINDOW_DAYS));
    }
}
