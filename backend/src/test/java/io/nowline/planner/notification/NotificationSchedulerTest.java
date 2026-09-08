package io.nowline.planner.notification;

import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.account.UserPreferenceService;
import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.persistence.PlannerRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class NotificationSchedulerTest {
    private final UUID user = UUID.randomUUID();
    private final UserPreferenceService preferences = mock(UserPreferenceService.class);
    private final PlannerRepository planner = mock(PlannerRepository.class);
    private final NotificationRepository repository = mock(NotificationRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private UserPreferenceService.Preferences settings;
    private PlannerSnapshot snapshot;

    @BeforeEach
    void setup() {
        settings = new UserPreferenceService.Preferences("Asia/Seoul", "ko", false, LocalTime.of(8, 0), 15);
        snapshot = with(List.of(block("block", "2026-09-09", 5, null, false)), List.of());
        when(planner.find(user)).thenAnswer(ignored -> Optional.of(new PlannerEnvelope(1, snapshot)));
        when(preferences.reminderCandidates()).thenAnswer(ignored -> List.of(new UserPreferenceService.PreferenceRow(user, settings)));
        when(preferences.get(user)).thenAnswer(ignored -> settings);
    }

    @Test
    void generatesTomorrowAfterMidnightReminderAt2350Today() {
        scheduler("2026-09-08T14:50:00Z").generate();
        verify(repository).createDelivery(eq(user), eq("TIME_BLOCK"), eq(key("2026-09-08T15:05:00Z", 15)),
                eq("일정"), eq("15분 뒤 시작합니다."), eq("/today?date=2026-09-09"), eq(Instant.parse("2026-09-08T14:50:00Z")));
        verifyNoMoreInteractions(repository);
    }

    @Test
    void generatesMaximumOneDayLeadAcrossDateBoundary() {
        settings = new UserPreferenceService.Preferences("Asia/Seoul", "ko", false, LocalTime.of(8, 0), 1440);
        scheduler("2026-09-07T15:05:00Z").generate();
        verify(repository).createDelivery(eq(user), eq("TIME_BLOCK"), eq(key("2026-09-08T15:05:00Z", 1440)),
                anyString(), eq("1440분 뒤 시작합니다."), anyString(), eq(Instant.parse("2026-09-07T15:05:00Z")));
    }

    @Test
    void nullDatesOtherWeeksImportedEventsAndMissingTasksDoNotGenerate() {
        snapshot = with(List.of(block("old", "2026-09-02", 5, null, false),
                block("legacy", null, 5, null, false), block("google", "2026-09-09", 5, null, true),
                block("missing-task", "2026-09-09", 5, "deleted-task", false)), List.of());
        scheduler("2026-09-08T14:50:00Z").generate();
        verifyNoInteractions(repository);
    }

    @ParameterizedTest
    @EnumSource(value = PlannerSnapshot.TaskStatus.class, names = {"DONE", "CANCELLED"})
    void completedAndCancelledTasksDoNotGenerate(PlannerSnapshot.TaskStatus status) {
        snapshot = with(List.of(block("block", "2026-09-09", 5, "task", false)), List.of(task(status)));
        scheduler("2026-09-08T14:50:00Z").generate();
        verifyNoInteractions(repository);
    }

    @Test
    void sameScheduleKeepsDedupKeyAndChangedStartGetsNewKey() {
        scheduler("2026-09-08T14:50:00Z").generate();
        scheduler("2026-09-08T14:50:30Z").generate();
        snapshot = with(List.of(block("block", "2026-09-09", 35, null, false)), List.of());
        scheduler("2026-09-08T15:20:00Z").generate();
        ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
        verify(repository, times(3)).createDelivery(eq(user), eq("TIME_BLOCK"), keys.capture(), anyString(), anyString(), anyString(), any());
        assertThat(keys.getAllValues().get(0)).isEqualTo(keys.getAllValues().get(1));
        assertThat(keys.getAllValues().get(2)).isNotEqualTo(keys.getAllValues().get(0));
    }

    @Test
    void civilTimesDoNotShiftAfterDaylightSavingTransition() {
        settings = new UserPreferenceService.Preferences("America/New_York", "en", false, LocalTime.of(8, 0), 15);
        snapshot = with(List.of(block("block", "2026-03-08", 600, null, false)), List.of());
        scheduler("2026-03-08T13:45:00Z").generate();
        verify(repository).createDelivery(eq(user), eq("TIME_BLOCK"), eq(key("2026-03-08T14:00:00Z", 15)),
                anyString(), anyString(), anyString(), eq(Instant.parse("2026-03-08T13:45:00Z")));
    }

    @Test
    void currentQueuedReminderDispatchesWithFreshTitle() {
        var delivery = queued("2026-09-08T14:50:00Z");
        scheduler("2026-09-08T14:50:00Z").dispatch();
        verify(notifications).dispatch(delivery.withContent("일정", "15분 뒤 시작합니다.", "/today?date=2026-09-09"));
        verify(repository, never()).skipped(any(), any());
    }

    @Test
    void rescheduledQueuedReminderIsSkipped() {
        var delivery = queued("2026-09-08T14:50:00Z");
        snapshot = with(List.of(block("block", "2026-09-09", 35, null, false)), List.of());
        scheduler("2026-09-08T14:50:00Z").dispatch();
        assertSkipped(delivery);
    }

    @Test
    void deletedQueuedReminderIsSkipped() {
        var delivery = queued("2026-09-08T14:50:00Z");
        snapshot = with(List.of(), List.of());
        scheduler("2026-09-08T14:50:00Z").dispatch();
        assertSkipped(delivery);
    }

    @ParameterizedTest
    @EnumSource(value = PlannerSnapshot.TaskStatus.class, names = {"DONE", "CANCELLED"})
    void taskFinishedAfterEnqueuePreventsPush(PlannerSnapshot.TaskStatus status) {
        var delivery = queued("2026-09-08T14:50:00Z");
        snapshot = with(List.of(block("block", "2026-09-09", 5, "task", false)), List.of(task(status)));
        scheduler("2026-09-08T14:50:00Z").dispatch();
        assertSkipped(delivery);
    }

    @Test
    void changedLeadTimeAndTimezoneInvalidateQueuedReminder() {
        var delivery = queued("2026-09-08T14:50:00Z");
        settings = new UserPreferenceService.Preferences("UTC", "ko", false, LocalTime.of(8, 0), 10);
        scheduler("2026-09-08T14:50:00Z").dispatch();
        assertSkipped(delivery);
    }

    @Test
    void retriesPastTwoMinuteExpiryAreNotSent() {
        var delivery = queued("2026-09-08T14:50:00Z");
        scheduler("2026-09-08T14:52:01Z").dispatch();
        assertSkipped(delivery);
    }

    @Test
    void earlyClaimFromAnOldProducerIsNeverSent() {
        var delivery = queued("2026-09-08T14:50:00Z");
        scheduler("2026-09-08T14:49:59Z").dispatch();
        assertSkipped(delivery);
    }

    @Test
    void legacyQueuePayloadCannotBypassCurrentScheduleValidation() {
        var delivery = new NotificationRepository.Delivery(UUID.randomUUID(), user, "TIME_BLOCK", "stale", "stale", "/today", 1,
                "block:block:2026-09-09", Instant.parse("2026-09-08T14:50:00Z"));
        when(repository.claimDelivery()).thenReturn(Optional.of(delivery), Optional.empty());
        scheduler("2026-09-08T14:50:00Z").dispatch();
        assertSkipped(delivery);
    }

    @Test
    void disablingDailyReminderAfterEnqueuePreventsSend() {
        var delivery = new NotificationRepository.Delivery(UUID.randomUUID(), user, "DAILY_PLAN", "daily", "daily", "/today", 1,
                "daily:2026-09-08", Instant.parse("2026-09-07T23:00:00Z"));
        when(repository.claimDelivery()).thenReturn(Optional.of(delivery), Optional.empty());
        scheduler("2026-09-07T23:00:00Z").dispatch();
        assertSkipped(delivery);
    }

    @Test
    void currentDailyReminderStillSends() {
        settings = new UserPreferenceService.Preferences("Asia/Seoul", "ko", true, LocalTime.of(8, 0), 15);
        var delivery = new NotificationRepository.Delivery(UUID.randomUUID(), user, "DAILY_PLAN", "daily", "daily", "/today", 1,
                "daily:2026-09-08", Instant.parse("2026-09-07T23:00:00Z"));
        when(repository.claimDelivery()).thenReturn(Optional.of(delivery), Optional.empty());
        scheduler("2026-09-07T23:00:00Z").dispatch();
        verify(notifications).dispatch(delivery);
    }

    private NotificationScheduler scheduler(String now) {
        return new NotificationScheduler(preferences, planner, repository, notifications,
                Clock.fixed(Instant.parse(now), ZoneOffset.UTC));
    }

    private NotificationRepository.Delivery queued(String target) {
        var delivery = new NotificationRepository.Delivery(UUID.randomUUID(), user, "TIME_BLOCK", "old title", "old body", "/today", 1,
                key("2026-09-08T15:05:00Z", 15), Instant.parse(target));
        when(repository.claimDelivery()).thenReturn(Optional.of(delivery), Optional.empty());
        return delivery;
    }

    private void assertSkipped(NotificationRepository.Delivery delivery) {
        verify(repository).skipped(delivery.deliveryId(), "reminder-no-longer-current");
        verifyNoInteractions(notifications);
    }

    private String key(String start, int lead) {
        return "block:v2:block:" + Instant.parse(start).toEpochMilli() + ":" + lead;
    }

    private PlannerSnapshot.TimeBlock block(String id, String date, int start, String taskId, boolean external) {
        return new PlannerSnapshot.TimeBlock(id, taskId, "일정", PlannerSnapshot.DayKey.WED, start, 30, external, 0,
                date == null ? null : LocalDate.parse(date));
    }

    private PlannerSnapshot.Task task(PlannerSnapshot.TaskStatus status) {
        return new PlannerSnapshot.Task("task", "할 일", null, 30, status, false, 0, null);
    }

    private PlannerSnapshot with(List<PlannerSnapshot.TimeBlock> blocks, List<PlannerSnapshot.Task> tasks) {
        var source = PlannerFixtures.snapshot();
        return new PlannerSnapshot(source.version(), source.plan(), 0, tasks, blocks, List.of(), List.of(), null, source.review());
    }
}
