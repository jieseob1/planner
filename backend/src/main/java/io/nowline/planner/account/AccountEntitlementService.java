package io.nowline.planner.account;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;

@Service
public class AccountEntitlementService {

    private static final List<String> BETA_FEATURES = List.of(
            "annual-and-quarterly-plans",
            "multi-device-sync",
            "google-calendar-ready",
            "data-export"
    );
    private static final List<String> PRO_FEATURES = List.of(
            "annual-and-quarterly-plans",
            "multi-device-sync",
            "google-calendar-ready",
            "data-export",
            "premium-entitlement"
    );

    private final JdbcClient jdbc;

    public AccountEntitlementService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Entitlement get(UUID userId) {
        ensureBetaEntitlement(userId);
        return jdbc.sql("""
                        SELECT plan_code, status_code, provider_code, current_period_ends_at,
                               cancel_at_period_end, updated_at
                        FROM account_entitlement
                        WHERE user_id = :userId
                        """)
                .param("userId", id(userId))
                .query((rs, row) -> {
                    String plan = rs.getString("plan_code");
                    var periodEnd = rs.getTimestamp("current_period_ends_at");
                    return new Entitlement(
                            plan,
                            rs.getString("status_code"),
                            "PRO".equals(plan),
                            rs.getString("provider_code"),
                            periodEnd == null ? null : periodEnd.toInstant(),
                            rs.getBoolean("cancel_at_period_end"),
                            "PRO".equals(plan) ? PRO_FEATURES : BETA_FEATURES,
                            rs.getTimestamp("updated_at").toInstant());
                })
                .single();
    }

    public void ensureBetaEntitlement(UUID userId) {
        jdbc.sql("""
                        INSERT INTO account_entitlement (user_id, plan_code, status_code)
                        VALUES (:userId, 'BETA', 'ACTIVE') AS incoming
                        ON DUPLICATE KEY UPDATE user_id = incoming.user_id
                        """)
                .param("userId", id(userId))
                .update();
    }

    public record Entitlement(
            String plan,
            String status,
            boolean paid,
            String provider,
            Instant currentPeriodEndsAt,
            boolean cancelAtPeriodEnd,
            List<String> features,
            Instant updatedAt
    ) {}
}
