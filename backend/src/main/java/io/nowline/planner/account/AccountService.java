package io.nowline.planner.account;

import io.nowline.planner.domain.PlanHistory;
import io.nowline.planner.integration.calendar.GoogleCalendarConnectionService;
import io.nowline.planner.persistence.PlanHistoryRepository;
import io.nowline.planner.persistence.PlannerRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;
import static io.nowline.planner.persistence.JdbcValues.uuid;

@Service
public class AccountService {

    private final JdbcTemplate jdbc;
    private final PlannerRepository planner;
    private final PlanHistoryRepository plans;
    private final UserPreferenceService preferences;
    private final GoogleCalendarConnectionService calendar;
    private final AccountDeletionRepository deletion;

    public AccountService(
            JdbcTemplate jdbc,
            PlannerRepository planner,
            PlanHistoryRepository plans,
            UserPreferenceService preferences,
            GoogleCalendarConnectionService calendar,
            AccountDeletionRepository deletion
    ) {
        this.jdbc = jdbc;
        this.planner = planner;
        this.plans = plans;
        this.preferences = preferences;
        this.calendar = calendar;
        this.deletion = deletion;
    }

    @Transactional
    public Map<String, Object> export(UUID userId) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("format", "nowline-account-export-v1");
        result.put("exportedAt", Instant.now());
        result.put("user", jdbc.query("""
                SELECT user_id, oidc_issuer, oidc_subject, email, display_name, created_at, last_seen_at,
                       terms_accepted_at, privacy_accepted_at, policy_version
                FROM app_user WHERE user_id = ?
                """, rs -> {
            if (!rs.next()) return Map.of();
            LinkedHashMap<String, Object> user = new LinkedHashMap<>();
            user.put("id", uuid(rs, "user_id"));
            user.put("issuer", rs.getString("oidc_issuer"));
            user.put("subject", rs.getString("oidc_subject"));
            user.put("email", rs.getString("email"));
            user.put("displayName", rs.getString("display_name"));
            user.put("createdAt", rs.getTimestamp("created_at").toInstant());
            user.put("lastSeenAt", rs.getTimestamp("last_seen_at").toInstant());
            user.put("termsAcceptedAt", rs.getTimestamp("terms_accepted_at") == null
                    ? null : rs.getTimestamp("terms_accepted_at").toInstant());
            user.put("privacyAcceptedAt", rs.getTimestamp("privacy_accepted_at") == null
                    ? null : rs.getTimestamp("privacy_accepted_at").toInstant());
            user.put("policyVersion", rs.getString("policy_version"));
            return user;
        }, id(userId)));
        result.put("preferences", preferences.get(userId));
        result.put("activePlanner", planner.find(userId).orElse(null));

        List<Map<String, Object>> planExports = new ArrayList<>();
        for (PlanHistory.Summary summary : plans.list(userId)) {
            LinkedHashMap<String, Object> plan = new LinkedHashMap<>();
            plan.put("plan", summary);
            plan.put("snapshot", plans.find(userId, summary.id()).map(PlanHistory.Detail::snapshot).orElse(null));
            plan.put("audit", plans.auditEvents(userId, summary.id()));
            planExports.add(plan);
        }
        result.put("plans", planExports);
        result.put("googleCalendar", calendar.status(userId));
        result.put("notificationHistory", jdbc.query("""
                SELECT notification_type, title, body, target_path, scheduled_for,
                       delivered_at, status, created_at
                FROM notification_delivery WHERE user_id = ? ORDER BY created_at DESC LIMIT 10000
                """, (rs, row) -> {
            LinkedHashMap<String, Object> item = new LinkedHashMap<>();
            item.put("type", rs.getString("notification_type"));
            item.put("title", rs.getString("title"));
            item.put("body", rs.getString("body"));
            item.put("targetPath", rs.getString("target_path"));
            item.put("scheduledFor", rs.getTimestamp("scheduled_for").toInstant());
            item.put("deliveredAt", rs.getTimestamp("delivered_at") == null ? null : rs.getTimestamp("delivered_at").toInstant());
            item.put("status", rs.getString("status"));
            item.put("createdAt", rs.getTimestamp("created_at").toInstant());
            return item;
        }, id(userId)));
        return result;
    }

    public void delete(UUID userId) {
        try {
            calendar.disconnect(userId);
        } catch (RuntimeException ignored) {
            // Privacy deletion must proceed even if Google is temporarily unavailable.
        }
        deletion.deleteLocal(userId);
    }
}
