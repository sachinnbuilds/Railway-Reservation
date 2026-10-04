package com.railway.user;

import com.railway.common.web.ApiException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@RestController
public class UserController {

    public record RegisterRequest(@NotBlank @Size(max = 100) String name,
                                  @NotBlank @Email String email,
                                  @NotBlank @Size(min = 6, max = 72) String password) {
    }

    public record LoginRequest(@NotBlank String email, @NotBlank String password) {
    }

    public record UserView(String id, String name, String email) {
    }

    public record AuthResponse(String token, long expiresIn, UserView user) {
    }

    private record UserRow(UUID id, String name, String email, String passwordHash) {
    }

    private final JdbcTemplate jdbc;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(8);
    private final SecretKey key;
    private final long ttlSeconds;

    public UserController(JdbcTemplate jdbc, @Value("${jwt.secret}") String secret,
                          @Value("${jwt.ttl-seconds}") long ttlSeconds) {
        this.jdbc = jdbc;
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.ttlSeconds = ttlSeconds;
    }

    @PostMapping("/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthResponse register(@Valid @RequestBody RegisterRequest req) {
        UUID id = UUID.randomUUID();
        String email = normalize(req.email());
        try {
            jdbc.update("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)",
                    id, req.name().trim(), email, encoder.encode(req.password()));
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "an account with this email already exists");
        }
        return issue(new UserView(id.toString(), req.name().trim(), email));
    }

    @PostMapping("/auth/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest req) {
        List<UserRow> rows = jdbc.query("SELECT id, name, email, password_hash FROM users WHERE email = ?",
                (rs, i) -> new UserRow(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4)),
                normalize(req.email()));
        if (rows.isEmpty() || !encoder.matches(req.password(), rows.get(0).passwordHash())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS", "wrong email or password");
        }
        UserRow u = rows.get(0);
        return issue(new UserView(u.id().toString(), u.name(), u.email()));
    }

    @GetMapping("/users/me")
    public UserView me(@RequestHeader("X-User-Id") UUID userId) {
        return jdbc.query("SELECT id, name, email FROM users WHERE id = ?",
                        (rs, i) -> new UserView(rs.getString(1), rs.getString(2), rs.getString(3)), userId)
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "user not found"));
    }

    private AuthResponse issue(UserView user) {
        Instant now = Instant.now();
        String token = Jwts.builder()
                .subject(user.id())
                .claim("name", user.name())
                .claim("email", user.email())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(ttlSeconds)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
        return new AuthResponse(token, ttlSeconds, user);
    }

    private static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
