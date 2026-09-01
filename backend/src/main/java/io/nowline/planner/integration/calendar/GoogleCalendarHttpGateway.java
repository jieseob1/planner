package io.nowline.planner.integration.calendar;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

@Component
public class GoogleCalendarHttpGateway implements GoogleCalendarGateway {

    private final RestClient client;
    private final GoogleCalendarProperties properties;

    public GoogleCalendarHttpGateway(RestClient.Builder builder, GoogleCalendarProperties properties) {
        this.client = builder.build();
        this.properties = properties;
    }

    @Override
    public TokenResponse exchangeCode(String code, String codeVerifier) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("code", code);
        form.add("client_id", properties.clientId());
        form.add("client_secret", properties.clientSecret());
        form.add("redirect_uri", properties.redirectUri());
        form.add("grant_type", "authorization_code");
        form.add("code_verifier", codeVerifier);
        return token(form, "Google authorization code exchange failed");
    }

    @Override
    public TokenResponse refresh(String refreshToken) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("refresh_token", refreshToken);
        form.add("client_id", properties.clientId());
        form.add("client_secret", properties.clientSecret());
        form.add("grant_type", "refresh_token");
        return token(form, "Google access token refresh failed");
    }

    @Override
    public void revoke(String refreshToken) {
        try {
            client.post().uri(properties.revokeUri())
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body("token=" + java.net.URLEncoder.encode(refreshToken, java.nio.charset.StandardCharsets.UTF_8))
                    .retrieve().toBodilessEntity();
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() >= 500) {
                throw CalendarIntegrationException.authorizationFailed("Google token revocation failed", exception);
            }
        }
    }

    @Override
    public List<CalendarInfo> calendars(String accessToken) {
        try {
            CalendarListResponse response = client.get()
                    .uri(properties.apiBaseUri() + "/users/me/calendarList?minAccessRole=reader&showHidden=false")
                    .headers(headers -> headers.setBearerAuth(accessToken))
                    .retrieve()
                    .body(CalendarListResponse.class);
            if (response == null || response.items() == null) return List.of();
            return response.items().stream()
                    .map(item -> new CalendarInfo(
                            item.id(), item.summary(), Boolean.TRUE.equals(item.primary()), item.accessRole(), item.timeZone()))
                    .toList();
        } catch (RestClientResponseException exception) {
            throw CalendarIntegrationException.authorizationFailed("Google Calendar list request failed", exception);
        }
    }

    @Override
    public EventPage events(
            String accessToken,
            String calendarId,
            String syncToken,
            String pageToken,
            Instant timeMin,
            Instant timeMax
    ) {
        UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(properties.apiBaseUri())
                .pathSegment("calendars", calendarId, "events")
                .queryParam("maxResults", 2500)
                .queryParam("singleEvents", true)
                .queryParam("showDeleted", true);
        if (pageToken != null) uri.queryParam("pageToken", pageToken);
        if (syncToken != null) {
            uri.queryParam("syncToken", syncToken);
        } else {
            uri.queryParam("timeMin", timeMin.toString());
            uri.queryParam("timeMax", timeMax.toString());
        }
        try {
            EventsResponse response = client.get().uri(uri.build().encode().toUri())
                    .headers(headers -> headers.setBearerAuth(accessToken))
                    .retrieve().body(EventsResponse.class);
            if (response == null) return new EventPage(List.of(), null, null);
            List<CalendarEvent> items = response.items() == null ? List.of() : response.items().stream()
                    .map(this::toCalendarEvent)
                    .toList();
            return new EventPage(items, response.nextPageToken(), response.nextSyncToken());
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 410) throw new SyncTokenExpiredException();
            throw translate("Google Calendar event list failed", exception);
        }
    }

    @Override
    public CalendarEvent createEvent(String accessToken, String calendarId, EventWrite event) {
        try {
            EventEntry response = client.post().uri(eventUri(calendarId, null))
                    .headers(headers -> headers.setBearerAuth(accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(eventBody(event))
                    .retrieve().body(EventEntry.class);
            if (response == null) throw CalendarIntegrationException.upstream("Google returned no created event", null);
            return toCalendarEvent(response);
        } catch (RestClientResponseException exception) {
            throw translate("Google Calendar event create failed", exception);
        }
    }

    @Override
    public CalendarEvent updateEvent(String accessToken, String calendarId, String eventId, String etag, EventWrite event) {
        try {
            EventEntry response = client.put().uri(eventUri(calendarId, eventId))
                    .headers(headers -> {
                        headers.setBearerAuth(accessToken);
                        if (etag != null && !etag.isBlank()) headers.set(HttpHeaders.IF_MATCH, etag);
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(eventBody(event))
                    .retrieve().body(EventEntry.class);
            if (response == null) throw CalendarIntegrationException.upstream("Google returned no updated event", null);
            return toCalendarEvent(response);
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 412) throw CalendarIntegrationException.syncConflict();
            throw translate("Google Calendar event update failed", exception);
        }
    }

    @Override
    public void deleteEvent(String accessToken, String calendarId, String eventId, String etag) {
        try {
            client.delete().uri(eventUri(calendarId, eventId))
                    .headers(headers -> {
                        headers.setBearerAuth(accessToken);
                        if (etag != null && !etag.isBlank()) headers.set(HttpHeaders.IF_MATCH, etag);
                    })
                    .retrieve().toBodilessEntity();
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 404 || exception.getStatusCode().value() == 410) return;
            if (exception.getStatusCode().value() == 412) throw CalendarIntegrationException.syncConflict();
            throw translate("Google Calendar event delete failed", exception);
        }
    }

    @Override
    public WatchResponse watchEvents(
            String accessToken,
            String calendarId,
            String channelId,
            String channelToken,
            String webhookUri
    ) {
        try {
            WatchEntry response = client.post()
                    .uri(UriComponentsBuilder.fromUriString(properties.apiBaseUri())
                            .pathSegment("calendars", calendarId, "events", "watch")
                            .build().encode().toUri())
                    .headers(headers -> headers.setBearerAuth(accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "id", channelId,
                            "type", "web_hook",
                            "address", webhookUri,
                            "token", channelToken,
                            "params", Map.of("ttl", "604800")))
                    .retrieve().body(WatchEntry.class);
            if (response == null || response.resourceId() == null) {
                throw CalendarIntegrationException.upstream("Google returned no watch resource", null);
            }
            return new WatchResponse(response.resourceId(), Instant.ofEpochMilli(response.expiration()));
        } catch (RestClientResponseException exception) {
            throw translate("Google Calendar watch creation failed", exception);
        }
    }

    @Override
    public void stopWatch(String accessToken, String channelId, String resourceId) {
        try {
            client.post().uri(properties.apiBaseUri() + "/channels/stop")
                    .headers(headers -> headers.setBearerAuth(accessToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("id", channelId, "resourceId", resourceId))
                    .retrieve().toBodilessEntity();
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 404 || exception.getStatusCode().value() == 410) return;
            throw translate("Google Calendar watch stop failed", exception);
        }
    }

    private TokenResponse token(LinkedMultiValueMap<String, String> form, String failureMessage) {
        try {
            GoogleTokenResponse response = client.post().uri(properties.tokenUri())
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(GoogleTokenResponse.class);
            if (response == null || response.accessToken() == null || response.accessToken().isBlank()) {
                throw CalendarIntegrationException.authorizationFailed("Google returned no access token", null);
            }
            List<String> scopes = response.scope() == null || response.scope().isBlank()
                    ? List.of()
                    : Arrays.stream(response.scope().split("\\s+")).filter(value -> !value.isBlank()).toList();
            return new TokenResponse(
                    response.accessToken(), response.refreshToken(), response.expiresIn(), scopes, response.idToken());
        } catch (RestClientResponseException exception) {
            if (exception.getResponseBodyAsString().contains("invalid_grant")) {
                throw CalendarIntegrationException.reauthorize();
            }
            throw CalendarIntegrationException.authorizationFailed(failureMessage, exception);
        }
    }

    private URI eventUri(String calendarId, String eventId) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(properties.apiBaseUri())
                .pathSegment("calendars", calendarId, "events");
        if (eventId != null) builder.pathSegment(eventId);
        return builder.build().encode().toUri();
    }

    private Map<String, Object> eventBody(EventWrite event) {
        return Map.of(
                "summary", event.summary(),
                "start", Map.of("dateTime", event.startAt().toString(), "timeZone", event.timeZone()),
                "end", Map.of("dateTime", event.endAt().toString(), "timeZone", event.timeZone()),
                "extendedProperties", Map.of("private", Map.of("nowlineBlockId", event.nowlineBlockId())));
    }

    private CalendarEvent toCalendarEvent(EventEntry item) {
        String blockId = item.extendedProperties() == null || item.extendedProperties().privateValues() == null
                ? null : item.extendedProperties().privateValues().get("nowlineBlockId");
        return new CalendarEvent(
                item.id(), item.etag(), item.status(), item.summary(), item.start(), item.end(),
                item.recurringEventId(), item.updated(), blockId);
    }

    private CalendarIntegrationException translate(String message, RestClientResponseException exception) {
        HttpStatusCode status = exception.getStatusCode();
        if (status.value() == 401 || status.value() == 403) return CalendarIntegrationException.reauthorize();
        return CalendarIntegrationException.upstream(message, exception);
    }

    private record GoogleTokenResponse(
            @JsonProperty("access_token") String accessToken,
            @JsonProperty("refresh_token") String refreshToken,
            @JsonProperty("expires_in") long expiresIn,
            String scope,
            @JsonProperty("id_token") String idToken
    ) {
    }

    private record CalendarListResponse(List<CalendarEntry> items) {
    }

    private record CalendarEntry(
            String id,
            String summary,
            Boolean primary,
            String accessRole,
            String timeZone
    ) {
    }

    private record EventsResponse(
            List<EventEntry> items,
            @JsonProperty("nextPageToken") String nextPageToken,
            @JsonProperty("nextSyncToken") String nextSyncToken
    ) {
    }

    private record EventEntry(
            String id,
            String etag,
            String status,
            String summary,
            EventDateTime start,
            EventDateTime end,
            @JsonProperty("recurringEventId") String recurringEventId,
            Instant updated,
            ExtendedProperties extendedProperties
    ) {
    }

    private record ExtendedProperties(@JsonProperty("private") Map<String, String> privateValues) {
    }

    private record WatchEntry(String resourceId, long expiration) {
    }
}
