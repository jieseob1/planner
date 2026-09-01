package io.nowline.planner.config;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
@ConditionalOnProperty(name = "nowline.workers.enabled", havingValue = "true", matchIfMissing = true)
public class DataRetentionScheduler {

    private static final Logger log = LoggerFactory.getLogger(DataRetentionScheduler.class);
    private final JdbcTemplate jdbc;
    private final MeterRegistry meters;

    public DataRetentionScheduler(JdbcTemplate jdbc, MeterRegistry meters) {
        this.jdbc = jdbc;
        this.meters = meters;
    }

    @Scheduled(cron = "${nowline.retention.cron:0 35 3 * * *}", zone = "UTC")
    @Transactional
    public void purgeExpiredOperationalRows() {
        List<String> ownership = jdbc.query("""
                SELECT lock_name FROM maintenance_lock
                WHERE lock_name = 'nowline-data-retention'
                FOR UPDATE SKIP LOCKED
                """, (rs, row) -> rs.getString(1));
        if (ownership.isEmpty()) return;
        jdbc.update("""
                UPDATE maintenance_lock SET last_acquired_at = CURRENT_TIMESTAMP(6)
                WHERE lock_name = 'nowline-data-retention'
                """);

        int deleted = 0;
        deleted += jdbc.update("DELETE FROM api_rate_limit WHERE window_started_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 2 HOUR)");
        deleted += jdbc.update("DELETE FROM google_oauth_state WHERE expires_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 DAY)");
        deleted += jdbc.update("DELETE FROM planner_idempotency WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 30 DAY)");
        deleted += jdbc.update("DELETE FROM integration_job WHERE status = 'SUCCEEDED' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 30 DAY)");
        deleted += jdbc.update("DELETE FROM integration_job WHERE status = 'DEAD' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 90 DAY)");
        deleted += jdbc.update("DELETE FROM notification_delivery WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 365 DAY)");

        meters.counter("nowline.retention.runs", "result", "success").increment();
        meters.counter("nowline.retention.rows.deleted").increment(deleted);
        log.info("Operational data retention completed; deletedRows={}", deleted);
    }
}
