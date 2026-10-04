package com.railway.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.InetAddress;

/**
 * Adds {@code X-Served-By: <service>@<container>} to every response, which makes client-side load
 * balancing across replicas visible in the browser and in load tests.
 */
@Component
public class ServedByFilter extends OncePerRequestFilter {

    private final String servedBy;

    public ServedByFilter(@Value("${spring.application.name}") String app) {
        this.servedBy = app + "@" + instanceName();
    }

    public static String instanceName() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (IOException e) {
            return "unknown";
        }
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("X-Served-By", servedBy);
        chain.doFilter(request, response);
    }
}
