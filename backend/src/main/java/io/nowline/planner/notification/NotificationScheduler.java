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

            var tasks = ReminderSchedule.tasks(envelope.snapshot());
            for (PlannerSnapshot.TimeBlock block : envelope.snapshot().timeBlocks()) {
                var reminder = ReminderSchedule.block(block, tasks, candidate.preferences());
                if (reminder != null && reminder.notStarted(now) && due(now, reminder.target())) {
                    repository.createDelivery(
                            candidate.userId(), "TIME_BLOCK", reminder.key(), reminder.title(), reminder.body(),
                            reminder.targetPath(), reminder.target());
                }
            }
        }
    }

    @Scheduled(fixedDelayString = "${nowline.notification.dispatch-delay-ms:1000}")
    public void dispatch() {
        for (int count = 0; count < 20; count++) {
            NotificationRepository.Delivery delivery = repository.claimDelivery().orElse(null);
            if (delivery == null) return;
            // The queue is a hint, not authority: a schedule may be edited or removed while queued/retrying.
            NotificationRepository.Delivery current = currentDelivery(delivery);
            if (current == null) {
                repository.skipped(delivery.deliveryId(), "reminder-no-longer-current");
            } else {
                notifications.dispatch(current);
            }
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

    private NotificationRepository.Delivery currentDelivery(NotificationRepository.Delivery delivery) {
        Instant now = clock.instant();
        if (delivery.scheduledFor() == null || delivery.deduplicationKey() == null
                || !ReminderSchedule.withinDispatchWindow(now, delivery.scheduledFor())) return null;
        var envelope = planner.find(delivery.userId()).orElse(null);
        if (envelope == null) return null;
        var currentPreferences = preferences.get(delivery.userId());
        if ("TIME_BLOCK".equals(delivery.type())) {
            var tasks = ReminderSchedule.tasks(envelope.snapshot());
            for (var block : envelope.snapshot().timeBlocks()) {
                var reminder = ReminderSchedule.block(block, tasks, currentPreferences);
                if (reminder != null && reminder.notStarted(now)
                        && reminder.key().equals(delivery.deduplicationKey())
                        && reminder.target().equals(delivery.scheduledFor())) {
                    return delivery.withContent(reminder.title(), reminder.body(), reminder.targetPath());
                }
            }
        } else if ("DAILY_PLAN".equals(delivery.type()) && currentPreferences.dailyReminderEnabled()) {
            var localNow = now.atZone(ZoneId.of(currentPreferences.timezone()));
            Instant target = localNow.toLocalDate().atTime(currentPreferences.dailyReminderTime())
                    .atZone(localNow.getZone()).toInstant();
            if (("daily:" + localNow.toLocalDate()).equals(delivery.deduplicationKey())
                    && target.equals(delivery.scheduledFor())) return delivery;
        }
        return null;
    }

}
