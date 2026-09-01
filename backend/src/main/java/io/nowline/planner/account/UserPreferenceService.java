package io.nowline.planner.account;

import io.nowline.planner.integration.calendar.CalendarIntegrationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;

@Service
public class UserPreferenceService {

    private final JdbcTemplate jdbc;

    public UserPreferenceService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Preferences get(UUID userId) {
        ensure(userId);
        return jdbc.query("""
                SELECT timezone, locale, daily_reminder_enabled, daily_reminder_time, block_reminder_minutes
                FROM user_preference WHERE user_id = ?
                """, rs -> {
            if (!rs.next()) throw new IllegalStateException("User preferences disappeared");
            return new Preferences(
                    rs.getString("timezone"), rs.getString("locale"),
                    rs.getBoolean("daily_reminder_enabled"),
                    rs.getObject("daily_reminder_time", LocalTime.class),
                    rs.getInt("block_reminder_minutes"));
        }, id(userId));
    }

    @Transactional
    public Preferences update(UUID userId, Preferences requested) {
        validate(requested);
        jdbc.update("""
                INSERT INTO user_preference (
                    user_id, timezone, locale, daily_reminder_enabled, daily_reminder_time, block_reminder_minutes
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    timezone = VALUES(timezone),
                    locale = VALUES(locale),
                    daily_reminder_enabled = VALUES(daily_reminder_enabled),
                    daily_reminder_time = VALUES(daily_reminder_time),
                    block_reminder_minutes = VALUES(block_reminder_minutes),
                    updated_at = CURRENT_TIMESTAMP(6)
                """, id(userId), requested.timezone(), requested.locale(), requested.dailyReminderEnabled(),
                requested.dailyReminderTime(), requested.blockReminderMinutes());
        return get(userId);
    }

    @Transactional(readOnly = true)
    public List<PreferenceRow> reminderCandidates() {
        return jdbc.query("""
                SELECT user_id, timezone, locale, daily_reminder_enabled,
                       daily_reminder_time, block_reminder_minutes
                FROM user_preference
                WHERE daily_reminder_enabled OR block_reminder_minutes >= 0
                """, (rs, row) -> new PreferenceRow(
                UUID.fromString(rs.getString("user_id")),
                new Preferences(
                        rs.getString("timezone"), rs.getString("locale"),
                        rs.getBoolean("daily_reminder_enabled"),
                        rs.getObject("daily_reminder_time", LocalTime.class),
                        rs.getInt("block_reminder_minutes"))));
    }

    private void ensure(UUID userId) {
        jdbc.update("""
                INSERT IGNORE INTO user_preference (user_id, timezone, locale)
                SELECT user_id, timezone, locale FROM app_user WHERE user_id = ?
                """, id(userId));
    }

    private void validate(Preferences value) {
        try {
            ZoneId.of(value.timezone());
        } catch (RuntimeException exception) {
            throw CalendarIntegrationException.invalidSettings("올바른 IANA 시간대를 선택해 주세요.");
        }
        if (value.locale() == null || !value.locale().matches("^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$")) {
            throw CalendarIntegrationException.invalidSettings("올바른 언어 코드를 입력해 주세요.");
        }
        if (value.dailyReminderTime() == null
                || value.blockReminderMinutes() < 0 || value.blockReminderMinutes() > 1440) {
            throw CalendarIntegrationException.invalidSettings("알림 시간을 확인해 주세요.");
        }
    }

    public record Preferences(
            String timezone,
            String locale,
            boolean dailyReminderEnabled,
            LocalTime dailyReminderTime,
            int blockReminderMinutes
    ) {
    }

    public record PreferenceRow(UUID userId, Preferences preferences) {
    }
}
