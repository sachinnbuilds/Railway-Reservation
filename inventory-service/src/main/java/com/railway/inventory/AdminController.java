package com.railway.inventory;

import com.railway.common.web.ApiException;
import com.railway.common.web.ServedByFilter;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Read-only views for the demo control room and for invariant checks. */
@RestController
@RequestMapping("/admin")
public class AdminController {

    private final JdbcTemplate jdbc;
    private final AllocationMode mode;

    public AdminController(JdbcTemplate jdbc, AllocationMode mode) {
        this.jdbc = jdbc;
        this.mode = mode;
    }

    /** SAFE (default) or NAIVE: the deliberately broken allocator used to demonstrate double booking. */
    @GetMapping("/allocation-mode")
    public Map<String, Object> allocationMode() {
        return Map.of("mode", mode.get().name(), "naiveRuns",
                jdbc.queryForList("SELECT run_id FROM naive_run ORDER BY first_used", String.class));
    }

    @PutMapping("/allocation-mode")
    public Map<String, Object> setAllocationMode(@RequestParam String mode) {
        this.mode.set(AllocationMode.Mode.valueOf(mode.toUpperCase()));
        return allocationMode();
    }

    public record SeatView(String seatNo, String status, String bookingId) {
    }

    public record ClassMap(String travelClass, int total, int available, int held, int booked, List<SeatView> seats) {
    }

    /** Seat map of a run: lets the UI show seats turning HELD/BOOKED live during a Tatkal spike. */
    @GetMapping("/runs/{runId}/seats")
    public Map<String, Object> seatMap(@PathVariable String runId) {
        List<String> classes = jdbc.queryForList(
                "SELECT DISTINCT travel_class FROM seat WHERE run_id = ? ORDER BY 1", String.class, runId);
        if (classes.isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "no such run " + runId);
        }
        List<ClassMap> maps = classes.stream().map(cls -> {
            List<SeatView> seats = jdbc.query("""
                            SELECT seat_no, status, booking_id FROM seat
                            WHERE run_id = ? AND travel_class = ? ORDER BY seat_idx""",
                    (rs, i) -> new SeatView(rs.getString(1), rs.getString(2), rs.getString(3)), runId, cls);
            return new ClassMap(cls, seats.size(),
                    (int) seats.stream().filter(s -> s.status().equals("AVAILABLE")).count(),
                    (int) seats.stream().filter(s -> s.status().equals("HELD")).count(),
                    (int) seats.stream().filter(s -> s.status().equals("BOOKED")).count(),
                    seats);
        }).toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("runId", runId);
        out.put("servedBy", ServedByFilter.instanceName());
        out.put("classes", maps);
        return out;
    }

    /** Booking id -> number of BOOKED seats, for the cross-service consistency check. */
    @GetMapping("/runs/{runId}/booked")
    public Map<String, Integer> bookedByBooking(@PathVariable String runId,
                                               @RequestParam(required = false) String travelClass) {
        Map<String, Integer> out = new LinkedHashMap<>();
        jdbc.query("""
                        SELECT booking_id, count(*) FROM seat WHERE run_id = ? AND status = 'BOOKED'
                          AND (?::text IS NULL OR travel_class = ?)
                        GROUP BY booking_id ORDER BY 1""",
                rs -> {
                    out.put(rs.getString(1), rs.getInt(2));
                }, runId, travelClass, travelClass);
        return out;
    }

    /** Local invariants of the seat store. Every number except the totals must be zero. */
    @GetMapping("/invariants")
    public Map<String, Object> invariants() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("seatsWithoutOwnerButTaken", count(
                "SELECT count(*) FROM seat WHERE status <> 'AVAILABLE' AND booking_id IS NULL"));
        out.put("bookingsSpanningRunsOrClasses", count("""
                SELECT count(*) FROM (SELECT booking_id FROM seat WHERE booking_id IS NOT NULL
                GROUP BY booking_id HAVING count(DISTINCT (run_id, travel_class)) > 1) x"""));
        out.put("bookingsMixingHeldAndBooked", count("""
                SELECT count(*) FROM (SELECT booking_id FROM seat WHERE booking_id IS NOT NULL
                GROUP BY booking_id HAVING count(DISTINCT status) > 1) x"""));
        out.put("holdsOverdueMoreThan30s", count(
                "SELECT count(*) FROM seat WHERE status = 'HELD' AND hold_expires_at < now() - interval '30 seconds'"));
        out.put("totalHeld", count("SELECT count(*) FROM seat WHERE status = 'HELD'"));
        out.put("totalBooked", count("SELECT count(*) FROM seat WHERE status = 'BOOKED'"));
        out.put("totalSeats", count("SELECT count(*) FROM seat"));
        return out;
    }

    private long count(String sql) {
        Long n = jdbc.queryForObject(sql, Long.class);
        return n == null ? 0 : n;
    }
}
