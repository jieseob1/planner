package io.nowline.planner.integration.calendar;

import java.time.Instant;
import java.util.List;

public interface GoogleCalendarGateway {

    TokenResponse exchangeCode(String code, String codeVerifier);

    TokenResponse refresh(String refreshToken);

    void revoke(String refreshToken);

    List<CalendarInfo> calendars(String accessToken);

    EventPage events(
            String accessToken,
            String calendarId,
            String syncToken,
            String pageToken,
            Instant timeMin,
            Instant timeMax
    );

    CalendarEvent createEvent(String accessToken, String calendarId, EventWrite event);

    CalendarEvent updateEvent(String accessToken, String calendarId, String eventId, String etag, EventWrite event);

    void deleteEvent(String accessToken, String calendarId, String eventId, String etag);

    WatchResponse watchEvents(String accessToken, String calendarId, String channelId, String channelToken, String webhookUri);

    void stopWatch(String accessToken, String channelId, String resourceId);

    record TokenResponse(
            String accessToken,
            String refreshToken,
            long expiresIn,
            List<String> scopes,
            String idToken
    ) {
    }

    record CalendarInfo(String id, String summary, boolean primary, String accessRole, String timeZone) {
    }

    record EventPage(List<CalendarEvent> items, String nextPageToken, String nextSyncToken) {
    }

    record CalendarEvent(
            String id,
            String etag,
            String status,
            String summary,
            EventDateTime start,
            EventDateTime end,
            String recurringEventId,
            Instant updatedAt,
            String nowlineBlockId
    ) {
    }

    record EventDateTime(String dateTime, String date, String timeZone) {
    }

    record EventWrite(
            String summary,
            Instant startAt,
            Instant endAt,
            String timeZone,
            String nowlineBlockId
    ) {
    }

    record WatchResponse(String resourceId, Instant expirationAt) {
    }

    final class SyncTokenExpiredException extends RuntimeException {
    }
}
