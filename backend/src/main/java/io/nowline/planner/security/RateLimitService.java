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
        jdbc.update("""
                        INSERT INTO api_rate_limit (rate_key, window_started_at, request_count, expires_at)
                        VALUES (?, ?, 1, ?)
                        ON DUPLICATE KEY UPDATE
                            window_started_at = IF(api_rate_limit.expires_at <= VALUES(window_started_at),
                                VALUES(window_started_at), api_rate_limit.window_started_at),
                            request_count = IF(api_rate_limit.expires_at <= VALUES(window_started_at),
                                1, api_rate_limit.request_count + 1),
                            expires_at = IF(api_rate_limit.expires_at <= VALUES(window_started_at),
                                VALUES(expires_at), api_rate_limit.expires_at)
                        """, key, Timestamp.from(now), Timestamp.from(expiresAt));
        Decision decision = jdbc.queryForObject("""
                        SELECT request_count, expires_at FROM api_rate_limit WHERE rate_key = ? FOR UPDATE
                        """, (rs, row) -> new Decision(
                        rs.getInt("request_count") <= limit,
                        Math.max(0, limit - rs.getInt("request_count")),
                        rs.getTimestamp("expires_at").toInstant()), key);
        if (decision == null) throw new IllegalStateException("Rate-limit decision was not returned");

        // Opportunistic bounded cleanup avoids a dedicated singleton scheduler.
        if (Math.floorMod(key.hashCode(), 1000) == 0) {
            jdbc.update("DELETE FROM api_rate_limit WHERE expires_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 HOUR)");
        }
        return decision;
    }

    public record Decision(boolean allowed, int remaining, Instant resetsAt) {}
}
