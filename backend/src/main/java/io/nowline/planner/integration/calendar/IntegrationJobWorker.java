package io.nowline.planner.integration.calendar;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.lang.management.ManagementFactory;
import java.util.UUID;

@Component
@ConditionalOnProperty(name = "nowline.workers.enabled", havingValue = "true", matchIfMissing = true)
public class IntegrationJobWorker {

    private static final Logger log = LoggerFactory.getLogger(IntegrationJobWorker.class);

    private final CalendarIntegrationRepository repository;
    private final GoogleCalendarSyncService syncService;
    private final GoogleCalendarWatchService watchService;
    private final MeterRegistry meters;
    private final String workerId;

    public IntegrationJobWorker(
            CalendarIntegrationRepository repository,
            GoogleCalendarSyncService syncService,
            GoogleCalendarWatchService watchService,
            MeterRegistry meters,
            @Value("${nowline.integration.worker-id:}") String configuredWorkerId
    ) {
        this.repository = repository;
        this.syncService = syncService;
        this.watchService = watchService;
        this.meters = meters;
        this.workerId = configuredWorkerId == null || configuredWorkerId.isBlank()
                ? ManagementFactory.getRuntimeMXBean().getName() + ":" + UUID.randomUUID()
                : configuredWorkerId;
    }

    @Scheduled(fixedDelayString = "${nowline.integration.poll-delay-ms:1000}")
    public void poll() {
        for (int count = 0; count < 10; count++) {
            CalendarIntegrationRepository.Job job = repository.claimJob(workerId).orElse(null);
            if (job == null) return;
            Timer.Sample sample = Timer.start(meters);
            try {
                switch (job.type()) {
                    case "GOOGLE_CALENDAR_SYNC" -> syncService.sync(job.userId());
                    case "GOOGLE_CALENDAR_WATCH_RENEW" -> watchService.renew(job.userId());
                    default -> throw new IllegalArgumentException("Unsupported integration job type: " + job.type());
                }
                repository.completeJob(job.jobId());
                meters.counter("nowline.integration.jobs", "type", job.type(), "result", "success").increment();
            } catch (CalendarIntegrationException exception) {
                repository.retryJob(job.jobId(), job.attempts(), exception.code());
                meters.counter("nowline.integration.jobs", "type", job.type(), "result", "retry").increment();
                log.warn("Integration job failed jobId={} type={} attempt={} code={}",
                        job.jobId(), job.type(), job.attempts(), exception.code());
            } catch (RuntimeException exception) {
                repository.retryJob(job.jobId(), job.attempts(), exception.getClass().getSimpleName());
                meters.counter("nowline.integration.jobs", "type", job.type(), "result", "error").increment();
                log.error("Integration job failed jobId={} type={} attempt={}",
                        job.jobId(), job.type(), job.attempts(), exception);
            } finally {
                sample.stop(meters.timer("nowline.integration.job.duration", "type", job.type()));
            }
        }
    }

    @Scheduled(fixedDelayString = "${nowline.integration.maintenance-delay-ms:900000}")
    public void maintenance() {
        repository.recoverAbandonedJobs();
        watchService.enqueueMaintenance();
    }
}
