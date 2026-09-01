package io.nowline.planner.security;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.sql.Timestamp;

@Service
public class RateLimitService {

    private final JdbcTemplate jdbc;

    public RateLimitService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Decision consume(String key, int limit, Duration window) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(window);
        Decision decision = jdbc.queryForObject("""
                        INSERT INTO api_rate_limit (rate_key, window_started_at, request_count, expires_at)
                        VALUES (?, ?, 1, ?)
                        ON CONFLICT (rate_key) DO UPDATE
                        SET window_started_at = CASE
                                WHEN api_rate_limit.expires_at <= EXCLUDED.window_started_at
                                THEN EXCLUDED.window_started_at ELSE api_rate_limit.window_started_at END,
                            request_count = CASE
                                WHEN api_rate_limit.expires_at <= EXCLUDED.window_started_at
                                THEN 1 ELSE api_rate_limit.request_count + 1 END,
                            expires_at = CASE
                                WHEN api_rate_limit.expires_at <= EXCLUDED.window_started_at
                                THEN EXCLUDED.expires_at ELSE api_rate_limit.expires_at END
                        RETURNING request_count, expires_at
                        """, (rs, row) -> new Decision(
                        rs.getInt("request_count") <= limit,
                        Math.max(0, limit - rs.getInt("request_count")),
                        rs.getTimestamp("expires_at").toInstant()), key, Timestamp.from(now), Timestamp.from(expiresAt));
        if (decision == null) throw new IllegalStateException("Rate-limit decision was not returned");

        // Opportunistic bounded cleanup avoids a dedicated singleton scheduler.
        if (Math.floorMod(key.hashCode(), 1000) == 0) {
            jdbc.update("DELETE FROM api_rate_limit WHERE expires_at < now() - interval '1 hour'");
        }
        return decision;
    }

    public record Decision(boolean allowed, int remaining, Instant resetsAt) {}
}
