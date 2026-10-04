package com.railway.booking;

import io.github.resilience4j.bulkhead.Bulkhead;
import io.github.resilience4j.bulkhead.BulkheadFullException;
import io.github.resilience4j.bulkhead.BulkheadRegistry;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Calls the (mock) payment gateway through a bulkhead and a circuit breaker, and classifies every
 * outcome into exactly one of four cases. The important distinction is between
 * {@link NotAttempted} (we know no money moved) and {@link Unknown} (money may have moved).
 */
@Component
public class PaymentClient {

    public sealed interface Outcome permits Succeeded, Declined, NotAttempted, Unknown {
    }

    public record Succeeded(String paymentId) implements Outcome {
    }

    public record Declined(String reason) implements Outcome {
    }

    /** The request never reached the gateway, or the gateway refused it without charging. Safe to retry. */
    public record NotAttempted(String reason) implements Outcome {
    }

    /** Timed out or failed mid-flight: the charge may or may not have happened. Must be reconciled. */
    public record Unknown(String reason) implements Outcome {
    }

    public record ChargeRequest(UUID bookingId, UUID userId, BigDecimal amount, Instant notAfter) {
    }

    public record PaymentView(String paymentId, String bookingId, String status, BigDecimal amount, String reason) {
    }

    @Configuration
    static class Config {
        @Bean
        @LoadBalanced
        RestClient.Builder loadBalancedRestClientBuilder() {
            return RestClient.builder();
        }
    }

    private final RestClient http;
    private final CircuitBreaker breaker;
    private final Bulkhead bulkhead;

    public PaymentClient(RestClient.Builder builder, CircuitBreakerRegistry breakers, BulkheadRegistry bulkheads,
                         @Value("${booking.payment.connect-timeout}") Duration connectTimeout,
                         @Value("${booking.payment.read-timeout}") Duration readTimeout) {
        this.http = builder.baseUrl("http://payment-service")
                .requestFactory(ClientHttpRequestFactories.get(ClientHttpRequestFactorySettings.DEFAULTS
                        .withConnectTimeout(connectTimeout).withReadTimeout(readTimeout)))
                .build();
        this.breaker = breakers.circuitBreaker("payment");
        this.bulkhead = bulkheads.bulkhead("payment");
    }

    public Outcome charge(UUID bookingId, UUID userId, BigDecimal amount) {
        // The gateway must refuse this charge if it only arrives after notAfter. That bounds how long
        // a "lost" request can still turn into money moving, which the reconciler relies on.
        ChargeRequest req = new ChargeRequest(bookingId, userId, amount, Instant.now().plusSeconds(10));
        try {
            PaymentView view = Bulkhead.decorateSupplier(bulkhead, CircuitBreaker.decorateSupplier(breaker,
                    () -> http.post().uri("/payments").body(req).retrieve().body(PaymentView.class))).get();
            return classify(view);
        } catch (CallNotPermittedException e) {
            return new NotAttempted("payment gateway circuit is OPEN (failing fast)");
        } catch (BulkheadFullException e) {
            return new NotAttempted("too many payments in progress");
        } catch (HttpServerErrorException e) {
            if (e.getStatusCode() == HttpStatus.SERVICE_UNAVAILABLE) {
                return new NotAttempted("payment gateway is down");
            }
            return new Unknown("payment gateway error " + e.getStatusCode().value());
        } catch (HttpClientErrorException e) {
            return new Declined("payment rejected: " + e.getStatusCode().value());
        } catch (ResourceAccessException e) {
            return isConnectFailure(e)
                    ? new NotAttempted("payment gateway unreachable")
                    : new Unknown("payment gateway timed out");
        } catch (IllegalStateException e) {
            // Load balancer: no payment-service instance registered.
            return new NotAttempted("payment gateway unavailable");
        }
    }

    /** Authoritative status lookup used by the reconciler. Empty = gateway has no record of this booking. */
    public Optional<PaymentView> status(UUID bookingId) {
        try {
            return Optional.ofNullable(CircuitBreaker.decorateSupplier(breaker,
                    () -> http.get().uri("/payments/booking/{id}", bookingId).retrieve().body(PaymentView.class)).get());
        } catch (HttpClientErrorException.NotFound e) {
            return Optional.of(new PaymentView(null, bookingId.toString(), "NOT_FOUND", null, null));
        }
    }

    public PaymentView refund(UUID bookingId) {
        return CircuitBreaker.decorateSupplier(breaker,
                () -> http.post().uri("/payments/booking/{id}/refund", bookingId).retrieve().body(PaymentView.class)).get();
    }

    public CircuitBreaker breaker() {
        return breaker;
    }

    public Bulkhead bulkhead() {
        return bulkhead;
    }

    private static Outcome classify(PaymentView view) {
        if (view == null) {
            return new Unknown("empty response");
        }
        return switch (view.status()) {
            case "SUCCEEDED" -> new Succeeded(view.paymentId());
            case "DECLINED" -> new Declined(view.reason() == null ? "card declined" : view.reason());
            default -> new Unknown("payment status " + view.status());
        };
    }

    private static boolean isConnectFailure(ResourceAccessException e) {
        Throwable c = e.getCause();
        return c instanceof java.net.ConnectException || c instanceof java.net.UnknownHostException
                || c instanceof java.net.http.HttpConnectTimeoutException;
    }
}
