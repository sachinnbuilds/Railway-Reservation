package com.railway.gateway;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.cloud.gateway.route.Route;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.cloud.gateway.filter.ratelimit.RedisRateLimiter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import reactor.core.publisher.Mono;

import java.net.InetSocketAddress;
import java.util.Optional;

/**
 * Redis token buckets, shared by every gateway instance. Browsing and booking get separate
 * buckets so a flood of searches can never use up booking capacity (and vice versa).
 * If Redis is unreachable, Spring's RedisRateLimiter fails open: traffic still flows, unthrottled.
 */
@Configuration
public class RateLimitConfig {

    /**
     * Bucket key = route + (user when logged in, otherwise client IP).
     * The route id must be part of the key: RedisRateLimiter names its Redis keys after this value
     * only, so without it a user's booking and browsing requests would drain one shared bucket.
     */
    @Bean
    @Primary
    KeyResolver userOrIpKeyResolver() {
        return exchange -> {
            Route route = exchange.getAttribute(ServerWebExchangeUtils.GATEWAY_ROUTE_ATTR);
            String bucket = route == null ? "default" : route.getId();
            String user = exchange.getRequest().getHeaders().getFirst(JwtAuthFilter.USER_HEADER);
            if (user != null) {
                return Mono.just(bucket + ":user:" + user);
            }
            String forwarded = exchange.getRequest().getHeaders().getFirst("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                return Mono.just(bucket + ":ip:" + forwarded.split(",")[0].trim());
            }
            return Mono.just(bucket + ":ip:" + Optional.ofNullable(exchange.getRequest().getRemoteAddress())
                    .map(InetSocketAddress::getHostString).orElse("unknown"));
        };
    }

    @Bean
    @Primary
    RedisRateLimiter searchRateLimiter(@Value("${ratelimit.search.rate:50}") int rate,
                                       @Value("${ratelimit.search.burst:100}") int burst) {
        return new RedisRateLimiter(rate, burst, 1);
    }

    @Bean
    RedisRateLimiter bookingRateLimiter(@Value("${ratelimit.booking.rate:2}") int rate,
                                        @Value("${ratelimit.booking.burst:5}") int burst) {
        return new RedisRateLimiter(rate, burst, 1);
    }
}
