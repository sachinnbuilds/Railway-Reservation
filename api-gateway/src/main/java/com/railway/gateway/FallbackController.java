package com.railway.gateway;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

/**
 * Target of the gateway circuit breakers: when a downstream service is failing or slow, callers get
 * an immediate, well-formed 503 instead of waiting on a timeout (fail fast, no thread pile-up).
 */
@RestController
public class FallbackController {

    @RequestMapping("/fallback/{service}")
    public ResponseEntity<Map<String, Object>> fallback(@PathVariable String service) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                "code", "SERVICE_UNAVAILABLE",
                "message", service + " is temporarily unavailable, please retry shortly",
                "service", service,
                "timestamp", Instant.now().toString()));
    }
}
