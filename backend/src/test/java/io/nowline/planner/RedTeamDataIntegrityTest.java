package io.nowline.planner.api;

import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.account.UserPreferenceService;
import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.notification.NotificationRepository;
import io.nowline.planner.notification.NotificationScheduler;
import io.nowline.planner.notification.NotificationService;
import io.nowline.planner.persistence.PlannerRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class RedTeamDataIntegrityTest {

    @Test
    void etagsAreBoundToTheAuthenticatedAccountAsWellAsTheRevision() {
        UUID firstUser = UUID.randomUUID();
        UUID secondUser = UUID.randomUUID();

        String firstTag = HttpPreconditions.etag(firstUser, 7);
        String secondTag = HttpPreconditions.etag(secondUser, 7);

        assertThat(firstTag).isNotEqualTo(secondTag);
        assertThat(HttpPreconditions.matchesForGet(firstTag, firstUser, 7)).isTrue();
        assertThat(HttpPreconditions.matchesForGet(firstTag, secondUser, 7)).isFalse();
        assertThat(HttpPreconditions.forPut(firstUser, firstTag, null).expectedRevision()).isEqualTo(7);
        assertThatThrownBy(() -> HttpPreconditions.forPut(secondUser, firstTag, null))
                .hasMessageContaining("현재 계정에 발급된 strong ETag");
    }

    @Test
    void timeBlockNotificationsFireOnlyOnTheStoredAbsoluteDate() {
        Instant now = Instant.parse("2026-09-02T09:50:00Z");
        UUID userId = UUID.randomUUID();
        UserPreferenceService preferences = mock(UserPreferenceService.class);
        PlannerRepository planner = mock(PlannerRepository.class);
        NotificationRepository deliveries = mock(NotificationRepository.class);
        NotificationService notifications = mock(NotificationService.class);

        when(preferences.reminderCandidates()).thenReturn(List.of(
                new UserPreferenceService.PreferenceRow(
                        userId,
                        new UserPreferenceService.Preferences("UTC", "ko", false, LocalTime.of(9, 0), 10))));

        PlannerSnapshot source = PlannerFixtures.snapshot();
        PlannerSnapshot snapshot = new PlannerSnapshot(
                source.version(),
                source.plan(),
                source.plannerWeekOffset(),
                source.tasks(),
                List.of(
                        new PlannerSnapshot.TimeBlock(
                                "today", null, "오늘 일정", PlannerSnapshot.DayKey.WED,
                                600, 60, false, 0, LocalDate.parse("2026-09-02")),
                        new PlannerSnapshot.TimeBlock(
                                "previous-week", null, "지난주 일정", PlannerSnapshot.DayKey.WED,
                                600, 60, false, 0, LocalDate.parse("2026-08-26")),
                        new PlannerSnapshot.TimeBlock(
                                "legacy", null, "날짜 없는 기존 일정", PlannerSnapshot.DayKey.WED,
                                600, 60, false, 0, null)),
                source.timeEntries(),
                source.outcomes(),
                source.timer(),
                source.review());
        when(planner.find(userId)).thenReturn(Optional.of(new PlannerEnvelope(7, snapshot)));

        NotificationScheduler scheduler = new NotificationScheduler(
                preferences,
                planner,
                deliveries,
                notifications,
                Clock.fixed(now, ZoneOffset.UTC));
        scheduler.generate();

        verify(deliveries).createDelivery(
                userId,
                "TIME_BLOCK",
                "block:today:2026-09-02",
                "오늘 일정",
                "10분 뒤 시작합니다.",
                "/today",
                now);
        verifyNoMoreInteractions(deliveries);
    }
}
