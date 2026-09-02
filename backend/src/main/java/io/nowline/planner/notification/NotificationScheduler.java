package io.nowline.planner.notification;

import io.nowline.planner.account.UserPreferenceService;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.persistence.PlannerRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

@Component
@ConditionalOnProperty(name = "nowline.workers.enabled", havingValue = "true", matchIfMissing = true)
public class NotificationScheduler {

    private final UserPreferenceService preferences;
    private final PlannerRepository planner;
    private final NotificationRepository repository;
    private final NotificationService notifications;
    private final Clock clock;

    @Autowired
    public NotificationScheduler(
            UserPreferenceService preferences,
            PlannerRepository planner,
            NotificationRepository repository,
            NotificationService notifications
    ) {
        this(preferences, planner, repository, notifications, Clock.systemUTC());
    }

    public NotificationScheduler(
            UserPreferenceService preferences,
            PlannerRepository planner,
            NotificationRepository repository,
            NotificationService notifications,
            Clock clock
    ) {
        this.preferences = preferences;
        this.planner = planner;
        this.repository = repository;
        this.notifications = notifications;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${nowline.notification.generate-delay-ms:30000}")
    public void generate() {
        Instant now = clock.instant();
        for (UserPreferenceService.PreferenceRow candidate : preferences.reminderCandidates()) {
            ZoneId zone = ZoneId.of(candidate.preferences().timezone());
            ZonedDateTime localNow = now.atZone(zone);
            var envelope = planner.find(candidate.userId()).orElse(null);
            if (envelope == null) continue;
            if (candidate.preferences().dailyReminderEnabled()) {
                Instant target = LocalDateTime.of(localNow.toLocalDate(), candidate.preferences().dailyReminderTime())
                        .atZone(zone).toInstant();
                if (due(now, target)) {
                    long taskCount = envelope.snapshot().tasks().stream()
                            .filter(task -> task.status() != PlannerSnapshot.TaskStatus.DONE
                                    && task.status() != PlannerSnapshot.TaskStatus.CANCELLED)
                            .count();
                    repository.createDelivery(
                            candidate.userId(), "DAILY_PLAN", "daily:" + localNow.toLocalDate(),
                            "오늘의 Goals to Today를 확인하세요",
                            "실행할 작업 " + taskCount + "개와 오늘 시간 블록을 확인할 시간입니다.",
                            "/today", target);
                }
            }

            for (PlannerSnapshot.TimeBlock block : envelope.snapshot().timeBlocks()) {
                if (block.externalOrFalse() || !localNow.toLocalDate().equals(block.date())) continue;
                Instant start = block.date().atStartOfDay(zone)
                        .plusMinutes(block.startMinutes()).toInstant();
                Instant target = start.minus(candidate.preferences().blockReminderMinutes(), java.time.temporal.ChronoUnit.MINUTES);
                if (due(now, target)) {
                    repository.createDelivery(
                            candidate.userId(), "TIME_BLOCK", "block:" + block.id() + ":" + block.date(),
                            block.title(),
                            candidate.preferences().blockReminderMinutes() + "분 뒤 시작합니다.",
                            "/today", target);
                }
            }
        }
    }

    @Scheduled(fixedDelayString = "${nowline.notification.dispatch-delay-ms:1000}")
    public void dispatch() {
        for (int count = 0; count < 20; count++) {
            NotificationRepository.Delivery delivery = repository.claimDelivery().orElse(null);
            if (delivery == null) return;
            notifications.dispatch(delivery);
        }
    }

    @Scheduled(fixedDelayString = "${nowline.notification.recovery-delay-ms:300000}")
    public void recover() {
        repository.recoverAbandoned();
    }

    private boolean due(Instant now, Instant target) {
        long seconds = Duration.between(target, now).getSeconds();
        return seconds >= -30 && seconds <= 120;
    }

}
