package io.nowline.planner.integration.calendar;

import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.UUID;

@Service
public class GoogleCalendarWatchService {

    private final CalendarIntegrationRepository repository;
    private final GoogleCalendarConnectionService connections;
    private final GoogleCalendarGateway gateway;
    private final GoogleCalendarProperties properties;
    private final SecureRandom random = new SecureRandom();

    public GoogleCalendarWatchService(
            CalendarIntegrationRepository repository,
            GoogleCalendarConnectionService connections,
            GoogleCalendarGateway gateway,
            GoogleCalendarProperties properties
    ) {
        this.repository = repository;
        this.connections = connections;
        this.gateway = gateway;
        this.properties = properties;
    }

    public boolean configured() {
        return properties.webhookUri() != null
                && properties.webhookUri().startsWith("https://")
                && !properties.webhookUri().contains("localhost");
    }

    public void renew(UUID userId) {
        if (!configured()) return;
        CalendarIntegrationRepository.Connection connection = repository.findConnection(userId)
                .orElseThrow(CalendarIntegrationException::notConnected);
        String calendarId = connection.selectedCalendarId();
        if (calendarId == null || calendarId.isBlank()) return;
        String accessToken = connections.accessToken(userId);
        CalendarIntegrationRepository.WatchChannel previous = repository.findWatch(userId, calendarId).orElse(null);
        UUID channelId = UUID.randomUUID();
        String token = randomToken();
        GoogleCalendarGateway.WatchResponse response = gateway.watchEvents(
                accessToken, calendarId, channelId.toString(), token, properties.webhookUri());
        repository.upsertWatch(userId, calendarId, channelId, response.resourceId(), sha256(token), response.expirationAt());
        if (previous != null && !previous.channelId().equals(channelId)) {
            try {
                gateway.stopWatch(accessToken, previous.channelId().toString(), previous.resourceId());
            } catch (RuntimeException ignored) {
                // The old channel has a bounded expiration. The newly persisted channel is authoritative.
            }
        }
    }

    public boolean accept(String channelId, String resourceId, String token, String messageNumber) {
        if (channelId == null || resourceId == null || token == null || messageNumber == null) return false;
        try {
            UUID id = UUID.fromString(channelId);
            long sequence = Long.parseLong(messageNumber);
            if (sequence < 0) return false;
            boolean accepted = repository.acceptWatchMessage(id, resourceId, sha256(token), sequence);
            if (!accepted) return false;
            CalendarIntegrationRepository.WatchChannel channel = repository.findWatchByChannel(id, resourceId)
                    .orElse(null);
            if (channel == null) return false;
            repository.enqueue(
                    channel.userId(),
                    "GOOGLE_CALENDAR_SYNC",
                    "calendar-sync:" + channel.userId());
            return true;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    public void enqueueMaintenance() {
        Instant renewBefore = Instant.now().plus(36, ChronoUnit.HOURS);
        repository.connectionsNeedingWatch(renewBefore).forEach(connection -> repository.enqueue(
                connection.userId(),
                "GOOGLE_CALENDAR_WATCH_RENEW",
                "calendar-watch:" + connection.userId()));
        Instant reconcileBefore = Instant.now().minus(6, ChronoUnit.HOURS);
        repository.connectionsNeedingReconciliation(reconcileBefore).forEach(userId -> repository.enqueue(
                userId,
                "GOOGLE_CALENDAR_SYNC",
                "calendar-sync:" + userId));
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String sha256(String value) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
