package io.nowline.planner.integration.calendar;

import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.service.PlannerService;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class GoogleCalendarSyncService {

    private static final int MIN_WEEK_OFFSET = -520;
    private static final int MAX_WEEK_OFFSET = 520;

    private final CalendarIntegrationRepository repository;
    private final GoogleCalendarConnectionService connections;
    private final GoogleCalendarGateway gateway;
    private final PlannerService planner;

    public GoogleCalendarSyncService(
            CalendarIntegrationRepository repository,
            GoogleCalendarConnectionService connections,
            GoogleCalendarGateway gateway,
            PlannerService planner
    ) {
        this.repository = repository;
        this.connections = connections;
        this.gateway = gateway;
        this.planner = planner;
    }

    public SyncResult sync(UUID userId) {
        CalendarIntegrationRepository.Connection connection = repository.findConnection(userId)
                .orElseThrow(CalendarIntegrationException::notConnected);
        if (connection.selectedCalendarId() == null || connection.selectedCalendarId().isBlank()) {
            throw CalendarIntegrationException.invalidSettings("동기화할 Google Calendar를 선택해 주세요.");
        }

        repository.markSyncing(userId);
        try {
            String accessToken = connections.accessToken(userId);
            ZoneId calendarZone = calendarZone(accessToken, connection.selectedCalendarId());
            FetchedEvents fetched = fetchEvents(accessToken, connection, false);
            if (fetched.reset()) {
                removeImportedBlocks(userId, repository.googleBlockIds(userId, connection.selectedCalendarId()));
                repository.clearGoogleLinks(userId, connection.selectedCalendarId());
            }

            int imported = importChanges(userId, connection, calendarZone, fetched.events());
            int exported = allowsExport(connection.syncDirection())
                    ? exportCurrentPlanner(userId, connection, accessToken, calendarZone)
                    : 0;
            repository.markReady(userId, fetched.nextSyncToken());
            return new SyncResult(imported, exported, fetched.events().size(), fetched.reset());
        } catch (CalendarIntegrationException exception) {
            repository.markFailed(userId,
                    "google-calendar-reauthorization-required".equals(exception.code()) ? "REAUTHORIZE" : "ERROR",
                    exception.code());
            throw exception;
        } catch (RuntimeException exception) {
            repository.markFailed(userId, "ERROR", "google-calendar-sync-failed");
            throw exception;
        }
    }

    private FetchedEvents fetchEvents(
            String accessToken,
            CalendarIntegrationRepository.Connection connection,
            boolean forcedFull
    ) {
        String syncToken = forcedFull ? null : connection.syncToken();
        String pageToken = null;
        String nextSyncToken = null;
        ArrayList<GoogleCalendarGateway.CalendarEvent> events = new ArrayList<>();
        Instant now = Instant.now();
        try {
            do {
                GoogleCalendarGateway.EventPage page = gateway.events(
                        accessToken,
                        connection.selectedCalendarId(),
                        syncToken,
                        pageToken,
                        now.minus(365, ChronoUnit.DAYS),
                        now.plus(3650, ChronoUnit.DAYS));
                events.addAll(page.items());
                pageToken = page.nextPageToken();
                if (page.nextSyncToken() != null) nextSyncToken = page.nextSyncToken();
            } while (pageToken != null);
            if (nextSyncToken == null || nextSyncToken.isBlank()) {
                throw CalendarIntegrationException.upstream("Google Calendar가 증분 동기화 토큰을 반환하지 않았습니다.", null);
            }
            return new FetchedEvents(List.copyOf(events), nextSyncToken, forcedFull);
        } catch (GoogleCalendarGateway.SyncTokenExpiredException exception) {
            if (forcedFull) throw CalendarIntegrationException.upstream("Google Calendar 전체 동기화에 실패했습니다.", exception);
            return fetchEvents(accessToken, connection, true);
        }
    }

    private int importChanges(
            UUID userId,
            CalendarIntegrationRepository.Connection connection,
            ZoneId calendarZone,
            List<GoogleCalendarGateway.CalendarEvent> events
    ) {
        Map<String, PlannerSnapshot.TimeBlock> upserts = new LinkedHashMap<>();
        Set<String> removals = new HashSet<>();
        int changed = 0;

        for (GoogleCalendarGateway.CalendarEvent event : events) {
            CalendarIntegrationRepository.EventLink existing = repository
                    .findLinkByEvent(userId, connection.selectedCalendarId(), event.id()).orElse(null);
            boolean trustedNowlineEvent = existing != null
                    && "NOWLINE".equals(existing.origin())
                    && existing.nowlineBlockId() != null
                    && existing.nowlineBlockId().equals(event.nowlineBlockId());
            String origin = trustedNowlineEvent ? "NOWLINE" : "GOOGLE";
            String blockId = trustedNowlineEvent ? existing.nowlineBlockId() : googleBlockId(connection.selectedCalendarId(), event.id());

            ParsedEvent parsed = parseEvent(event, calendarZone, blockId, !trustedNowlineEvent);
            String status = event.status() == null ? "confirmed" : event.status();
            if ("cancelled".equalsIgnoreCase(status)) {
                if (existing != null && existing.nowlineBlockId() != null) removals.add(existing.nowlineBlockId());
                removals.add(blockId);
            } else if (parsed.block() != null && shouldImport(connection.syncDirection(), trustedNowlineEvent)) {
                upserts.put(blockId, parsed.block());
            }

            repository.upsertEventLink(
                    userId,
                    connection.selectedCalendarId(),
                    event,
                    blockId,
                    origin,
                    parsed.startAt(),
                    parsed.endAt(),
                    parsed.timeZone(),
                    checksum(event.summary(), parsed.startAt(), parsed.endAt()));
            changed++;
        }

        if (!upserts.isEmpty() || !removals.isEmpty()) {
            planner.updateFromIntegration(userId, snapshot -> {
                LinkedHashMap<String, PlannerSnapshot.TimeBlock> blocks = new LinkedHashMap<>();
                snapshot.timeBlocks().forEach(block -> blocks.put(block.id(), block));
                removals.forEach(blocks::remove);
                blocks.putAll(upserts);
                return copyWithBlocks(snapshot, new ArrayList<>(blocks.values()));
            }, "GOOGLE_CALENDAR_IMPORTED");
        }
        return changed;
    }

    private int exportCurrentPlanner(
            UUID userId,
            CalendarIntegrationRepository.Connection connection,
            String accessToken,
            ZoneId zone
    ) {
        PlannerEnvelope envelope = planner.get(userId);
        Set<String> currentBlockIds = new HashSet<>();
        int changed = 0;
        for (PlannerSnapshot.TimeBlock block : envelope.snapshot().timeBlocks()) {
            if (block.externalOrFalse()) continue;
            currentBlockIds.add(block.id());
            GoogleCalendarGateway.EventWrite write = eventWrite(block, zone);
            String checksum = checksum(write.summary(), write.startAt(), write.endAt());
            CalendarIntegrationRepository.EventLink link = repository
                    .findNowlineLink(userId, connection.selectedCalendarId(), block.id()).orElse(null);
            if (link != null && checksum.equals(link.payloadChecksum()) && !"cancelled".equals(link.eventStatus())) {
                continue;
            }
            GoogleCalendarGateway.CalendarEvent event = link == null
                    ? gateway.createEvent(accessToken, connection.selectedCalendarId(), write)
                    : gateway.updateEvent(
                            accessToken,
                            connection.selectedCalendarId(),
                            link.googleEventId(),
                            link.googleEtag(),
                            write);
            repository.upsertEventLink(
                    userId,
                    connection.selectedCalendarId(),
                    event,
                    block.id(),
                    "NOWLINE",
                    write.startAt(),
                    write.endAt(),
                    zone.getId(),
                    checksum);
            changed++;
        }

        for (CalendarIntegrationRepository.EventLink stale : repository.nowlineLinks(userId, connection.selectedCalendarId())) {
            if (stale.nowlineBlockId() != null && !currentBlockIds.contains(stale.nowlineBlockId())) {
                gateway.deleteEvent(
                        accessToken,
                        connection.selectedCalendarId(),
                        stale.googleEventId(),
                        stale.googleEtag());
                repository.deleteEventLink(userId, stale.linkId());
                changed++;
            }
        }
        return changed;
    }

    private void removeImportedBlocks(UUID userId, List<String> blockIds) {
        if (blockIds.isEmpty()) return;
        Set<String> removing = Set.copyOf(blockIds);
        planner.updateFromIntegration(userId, snapshot -> copyWithBlocks(
                snapshot,
                snapshot.timeBlocks().stream().filter(block -> !removing.contains(block.id())).toList()),
                "GOOGLE_CALENDAR_FULL_RESYNC_RESET");
    }

    private ParsedEvent parseEvent(
            GoogleCalendarGateway.CalendarEvent event,
            ZoneId fallbackZone,
            String blockId,
            boolean external
    ) {
        if (event.start() == null || event.end() == null || "cancelled".equalsIgnoreCase(event.status())) {
            return new ParsedEvent(null, null, null, fallbackZone.getId());
        }
        ZoneId zone = safeZone(event.start().timeZone(), fallbackZone);
        ZonedDateTime start;
        ZonedDateTime end;
        if (event.start().dateTime() != null && event.end().dateTime() != null) {
            start = OffsetDateTime.parse(event.start().dateTime()).atZoneSameInstant(zone);
            end = OffsetDateTime.parse(event.end().dateTime()).atZoneSameInstant(zone);
        } else if (event.start().date() != null && event.end().date() != null) {
            start = LocalDate.parse(event.start().date()).atStartOfDay(zone);
            end = LocalDate.parse(event.end().date()).atStartOfDay(zone);
        } else {
            return new ParsedEvent(null, null, null, zone.getId());
        }
        if (!end.isAfter(start)) return new ParsedEvent(null, start.toInstant(), end.toInstant(), zone.getId());

        LocalDate baseMonday = LocalDate.now(zone).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate eventMonday = start.toLocalDate().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        long weekOffset = ChronoUnit.WEEKS.between(baseMonday, eventMonday);
        if (weekOffset < MIN_WEEK_OFFSET || weekOffset > MAX_WEEK_OFFSET) {
            return new ParsedEvent(null, start.toInstant(), end.toInstant(), zone.getId());
        }
        int startMinutes = start.getHour() * 60 + start.getMinute();
        long totalMinutes = Math.max(1, Duration.between(start, end).toMinutes());
        int duration = (int) Math.min(Math.min(totalMinutes, 1440L), 1440L - startMinutes);
        String title = event.summary() == null || event.summary().isBlank() ? "제목 없는 Google 일정" : event.summary();
        PlannerSnapshot.TimeBlock block = new PlannerSnapshot.TimeBlock(
                blockId,
                null,
                title.substring(0, Math.min(title.length(), 500)),
                dayKey(start.getDayOfWeek()),
                startMinutes,
                duration,
                external,
                (int) weekOffset);
        return new ParsedEvent(block, start.toInstant(), end.toInstant(), zone.getId());
    }

    private GoogleCalendarGateway.EventWrite eventWrite(PlannerSnapshot.TimeBlock block, ZoneId zone) {
        LocalDate baseMonday = LocalDate.now(zone).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate date = baseMonday.plusWeeks(block.weekOffsetOrZero()).plusDays(dayIndex(block.day()));
        ZonedDateTime start = date.atStartOfDay(zone).plusMinutes(block.startMinutes());
        return new GoogleCalendarGateway.EventWrite(
                block.title(),
                start.toInstant(),
                start.plusMinutes(block.durationMinutes()).toInstant(),
                zone.getId(),
                block.id());
    }

    private ZoneId calendarZone(String accessToken, String calendarId) {
        return gateway.calendars(accessToken).stream()
                .filter(calendar -> calendar.id().equals(calendarId))
                .findFirst()
                .map(calendar -> safeZone(calendar.timeZone(), ZoneOffset.UTC))
                .orElse(ZoneOffset.UTC);
    }

    private boolean allowsExport(String direction) {
        return "EXPORT_ONLY".equals(direction) || "BIDIRECTIONAL".equals(direction);
    }

    private boolean shouldImport(String direction, boolean trustedNowlineEvent) {
        if (trustedNowlineEvent) return "BIDIRECTIONAL".equals(direction);
        return "IMPORT_ONLY".equals(direction) || "BIDIRECTIONAL".equals(direction);
    }

    private PlannerSnapshot copyWithBlocks(PlannerSnapshot value, List<PlannerSnapshot.TimeBlock> blocks) {
        return new PlannerSnapshot(
                value.version(), value.plan(), value.plannerWeekOffset(), value.tasks(), List.copyOf(blocks),
                value.timeEntries(), value.outcomes(), value.timer(), value.review());
    }

    private PlannerSnapshot.DayKey dayKey(DayOfWeek value) {
        return switch (value) {
            case MONDAY -> PlannerSnapshot.DayKey.MON;
            case TUESDAY -> PlannerSnapshot.DayKey.TUE;
            case WEDNESDAY -> PlannerSnapshot.DayKey.WED;
            case THURSDAY -> PlannerSnapshot.DayKey.THU;
            case FRIDAY -> PlannerSnapshot.DayKey.FRI;
            case SATURDAY -> PlannerSnapshot.DayKey.SAT;
            case SUNDAY -> PlannerSnapshot.DayKey.SUN;
        };
    }

    private int dayIndex(PlannerSnapshot.DayKey value) {
        return switch (value) {
            case MON -> 0;
            case TUE -> 1;
            case WED -> 2;
            case THU -> 3;
            case FRI -> 4;
            case SAT -> 5;
            case SUN -> 6;
        };
    }

    private ZoneId safeZone(String value, ZoneId fallback) {
        if (value == null || value.isBlank()) return fallback;
        try {
            return ZoneId.of(value);
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private String googleBlockId(String calendarId, String eventId) {
        return "gcal-" + sha256(calendarId + "\n" + eventId).substring(0, 48);
    }

    private String checksum(String summary, Instant start, Instant end) {
        return sha256((summary == null ? "" : summary) + "\n" + start + "\n" + end);
    }

    private String sha256(String value) {
        try {
            return java.util.HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    public record SyncResult(int imported, int exported, int received, boolean fullReset) {
    }

    private record FetchedEvents(
            List<GoogleCalendarGateway.CalendarEvent> events,
            String nextSyncToken,
            boolean reset
    ) {
    }

    private record ParsedEvent(
            PlannerSnapshot.TimeBlock block,
            Instant startAt,
            Instant endAt,
            String timeZone
    ) {
    }
}
