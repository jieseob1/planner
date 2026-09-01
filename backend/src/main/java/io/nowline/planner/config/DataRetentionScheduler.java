package io.nowline.planner.config;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

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
        Boolean owner = jdbc.queryForObject(
                "SELECT pg_try_advisory_xact_lock(hashtext('nowline-data-retention'))", Boolean.class);
        if (!Boolean.TRUE.equals(owner)) return;

        int deleted = 0;
        deleted += jdbc.update("DELETE FROM api_rate_limit WHERE window_start < now() - interval '2 hours'");
        deleted += jdbc.update("DELETE FROM google_oauth_state WHERE expires_at < now() - interval '1 day'");
        deleted += jdbc.update("DELETE FROM planner_idempotency WHERE created_at < now() - interval '30 days'");
        deleted += jdbc.update("DELETE FROM integration_job WHERE status = 'SUCCEEDED' AND updated_at < now() - interval '30 days'");
        deleted += jdbc.update("DELETE FROM integration_job WHERE status = 'DEAD' AND updated_at < now() - interval '90 days'");
        deleted += jdbc.update("DELETE FROM notification_delivery WHERE created_at < now() - interval '365 days'");

        meters.counter("nowline.retention.runs", "result", "success").increment();
        meters.counter("nowline.retention.rows.deleted").increment(deleted);
        log.info("Operational data retention completed; deletedRows={}", deleted);
    }
}
