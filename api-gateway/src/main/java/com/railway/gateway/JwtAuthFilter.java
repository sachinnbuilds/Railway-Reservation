package com.railway.gateway;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Authenticates once at the edge. Downstream services trust {@code X-User-Id}, which only the
 * gateway may set: any client-supplied value is stripped on every request.
 */
@Component
public class JwtAuthFilter implements GlobalFilter, Ordered {

    public static final String USER_HEADER = "X-User-Id";

    /** Paths reachable without a token. Search is public so anonymous browsing never needs auth. */
    private static final List<String> PUBLIC_PREFIXES = List.of(
            "/api/auth/", "/api/search", "/api/stations", "/api/trains", "/fallback");

    private final SecretKey key;

    public JwtAuthFilter(@Value("${jwt.secret}") String secret) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest.Builder request = exchange.getRequest().mutate()
                .headers(h -> h.remove(USER_HEADER));
        String path = exchange.getRequest().getPath().value();
        String auth = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);

        if (auth != null && auth.startsWith("Bearer ")) {
            try {
                Claims claims = Jwts.parser().verifyWith(key).build()
                        .parseSignedClaims(auth.substring(7)).getPayload();
                request.header(USER_HEADER, claims.getSubject());
            } catch (JwtException | IllegalArgumentException e) {
                if (!isPublic(path)) {
                    return unauthorized(exchange, "invalid or expired token");
                }
            }
        } else if (!isPublic(path)) {
            return unauthorized(exchange, "login required");
        }
        return chain.filter(exchange.mutate().request(request.build()).build());
    }

    private static boolean isPublic(String path) {
        return PUBLIC_PREFIXES.stream().anyMatch(path::startsWith);
    }

    private static Mono<Void> unauthorized(ServerWebExchange exchange, String message) {
        var response = exchange.getResponse();
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        DataBuffer body = response.bufferFactory().wrap(
                ("{\"code\":\"UNAUTHORIZED\",\"message\":\"" + message + "\"}").getBytes(StandardCharsets.UTF_8));
        return response.writeWith(Mono.just(body));
    }

    @Override
    public int getOrder() {
        // Before routing filters, so the rate limiter can key on the authenticated user.
        return Ordered.HIGHEST_PRECEDENCE + 10;
    }
}
