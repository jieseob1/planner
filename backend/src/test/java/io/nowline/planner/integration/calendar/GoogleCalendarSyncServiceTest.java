package io.nowline.planner.integration.calendar;

import io.nowline.planner.PlannerFixtures;
import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.service.PlannerService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.TemporalAdjusters;
import java.time.DayOfWeek;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.UnaryOperator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GoogleCalendarSyncServiceTest {

    @Mock CalendarIntegrationRepository repository;
    @Mock GoogleCalendarConnectionService connections;
    @Mock GoogleCalendarGateway gateway;
    @Mock PlannerService planner;

    private GoogleCalendarSyncService service;
    private UUID userId;

    @BeforeEach
    void setUp() {
        service = new GoogleCalendarSyncService(repository, connections, gateway, planner);
        userId = UUID.randomUUID();
        when(connections.accessToken(userId)).thenReturn("access-token");
        when(gateway.calendars("access-token")).thenReturn(List.of(
                new GoogleCalendarGateway.CalendarInfo("primary", "Primary", true, "owner", "UTC")));
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            UnaryOperator<PlannerSnapshot> updater = invocation.getArgument(1);
            PlannerSnapshot changed = updater.apply(PlannerFixtures.snapshot());
            return new PlannerEnvelope(2, changed);
        }).when(planner).updateFromIntegration(eq(userId), any(), any());
    }

    @Test
    void importsIncrementalEventAndPersistsNextSyncToken() {
        CalendarIntegrationRepository.Connection connection = connection("IMPORT_ONLY", "sync-old");
        when(repository.findConnection(userId)).thenReturn(Optional.of(connection));
        GoogleCalendarGateway.CalendarEvent event = event("event-1", "회의");
        when(gateway.events(eq("access-token"), eq("primary"), eq("sync-old"), isNull(), any(), any()))
                .thenReturn(new GoogleCalendarGateway.EventPage(List.of(event), null, "sync-new"));

        GoogleCalendarSyncService.SyncResult result = service.sync(userId);

        assertThat(result.received()).isEqualTo(1);
        ArgumentCaptor<UnaryOperator<PlannerSnapshot>> updater = ArgumentCaptor.forClass(UnaryOperator.class);
        verify(planner).updateFromIntegration(eq(userId), updater.capture(), eq("GOOGLE_CALENDAR_IMPORTED"));
        PlannerSnapshot changed = updater.getValue().apply(PlannerFixtures.snapshot());
        assertThat(changed.timeBlocks()).anySatisfy(block -> {
            assertThat(block.title()).isEqualTo("회의");
            assertThat(block.externalOrFalse()).isTrue();
            assertThat(block.weekOffsetOrZero()).isZero();
        });
        verify(repository).markReady(userId, "sync-new");
    }

    @Test
    void performsFullResetWhenGoogleExpiresSyncToken() {
        CalendarIntegrationRepository.Connection connection = connection("IMPORT_ONLY", "expired");
        when(repository.findConnection(userId)).thenReturn(Optional.of(connection));
        when(repository.googleBlockIds(userId, "primary")).thenReturn(List.of("gcal-old"));
        when(gateway.events(eq("access-token"), eq("primary"), eq("expired"), isNull(), any(), any()))
                .thenThrow(new GoogleCalendarGateway.SyncTokenExpiredException());
        when(gateway.events(eq("access-token"), eq("primary"), isNull(), isNull(), any(), any()))
                .thenReturn(new GoogleCalendarGateway.EventPage(List.of(), null, "full-sync-token"));

        GoogleCalendarSyncService.SyncResult result = service.sync(userId);

        assertThat(result.fullReset()).isTrue();
        verify(repository).clearGoogleLinks(userId, "primary");
        verify(repository).markReady(userId, "full-sync-token");
    }

    private CalendarIntegrationRepository.Connection connection(String direction, String syncToken) {
        Instant now = Instant.now();
        return new CalendarIntegrationRepository.Connection(
                userId, "account@example.com", "cipher", List.of(), "primary", direction,
                syncToken, "READY", now, now, null, now, now);
    }

    private GoogleCalendarGateway.CalendarEvent event(String id, String summary) {
        LocalDate monday = LocalDate.now(ZoneOffset.UTC)
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        Instant start = monday.atTime(10, 0).toInstant(ZoneOffset.UTC);
        Instant end = start.plusSeconds(3600);
        return new GoogleCalendarGateway.CalendarEvent(
                id,
                "etag-1",
                "confirmed",
                summary,
                new GoogleCalendarGateway.EventDateTime(start.toString(), null, "UTC"),
                new GoogleCalendarGateway.EventDateTime(end.toString(), null, "UTC"),
                null,
                Instant.now(),
                null);
    }
}
