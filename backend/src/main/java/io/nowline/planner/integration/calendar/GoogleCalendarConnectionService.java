package io.nowline.planner.integration.calendar;

import io.nowline.planner.security.SecretCipher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service
public class GoogleCalendarConnectionService {

    public static final List<String> REQUIRED_SCOPES = List.of(
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
    );

    private final GoogleCalendarProperties properties;
    private final CalendarIntegrationRepository repository;
    private final GoogleCalendarGateway gateway;
    private final SecretCipher cipher;
    private final SecureRandom random = new SecureRandom();

    public GoogleCalendarConnectionService(
            GoogleCalendarProperties properties,
            CalendarIntegrationRepository repository,
            GoogleCalendarGateway gateway,
            SecretCipher cipher
    ) {
        this.properties = properties;
        this.repository = repository;
        this.gateway = gateway;
        this.cipher = cipher;
    }

    @Transactional(readOnly = true)
    public Status status(UUID userId) {
        var connection = repository.findConnection(userId);
        if (connection.isEmpty()) {
            return new Status(properties.configured() && cipher.configured(), false, null, null,
                    "BIDIRECTIONAL", "DISCONNECTED", null, null, null);
        }
        CalendarIntegrationRepository.Connection value = connection.get();
        return new Status(
                properties.configured() && cipher.configured(),
                true,
                value.email(),
                value.selectedCalendarId(),
                value.syncDirection(),
                value.syncStatus(),
                value.lastSyncStartedAt(),
                value.lastSyncCompletedAt(),
                value.lastErrorCode());
    }

    @Transactional
    public ConnectResponse begin(UUID userId, String requestedReturnPath) {
        requireConfigured();
        repository.purgeExpiredStates();
        String state = randomToken(32);
        String stateHash = sha256(state);
        String verifier = randomToken(64);
        String challenge = sha256Base64Url(verifier);
        String returnPath = safeReturnPath(requestedReturnPath);
        repository.saveState(
                stateHash,
                userId,
                cipher.encrypt(verifier, oauthStateContext(stateHash)),
                returnPath,
                Instant.now().plus(10, ChronoUnit.MINUTES));

        String authorizationUrl = UriComponentsBuilder.fromUriString(properties.authorizationUri())
                .queryParam("client_id", properties.clientId())
                .queryParam("redirect_uri", properties.redirectUri())
                .queryParam("response_type", "code")
                .queryParam("scope", String.join(" ", REQUIRED_SCOPES))
                .queryParam("access_type", "offline")
                .queryParam("include_granted_scopes", "true")
                .queryParam("prompt", "consent")
                .queryParam("state", state)
                .queryParam("code_challenge", challenge)
                .queryParam("code_challenge_method", "S256")
                .build().encode().toUriString();
        return new ConnectResponse(authorizationUrl, Instant.now().plus(10, ChronoUnit.MINUTES));
    }

    @Transactional
    public String complete(String code, String state) {
        requireConfigured();
        if (code == null || code.isBlank() || state == null || state.isBlank()) {
            throw CalendarIntegrationException.invalidState();
        }
        String stateHash = sha256(state);
        CalendarIntegrationRepository.OAuthState pending = repository.consumeState(stateHash)
                .orElseThrow(CalendarIntegrationException::invalidState);
        String verifier = cipher.decrypt(pending.verifierCipher(), oauthStateContext(stateHash));
        GoogleCalendarGateway.TokenResponse tokens = gateway.exchangeCode(code, verifier);
        String refreshToken = tokens.refreshToken();
        if (refreshToken == null || refreshToken.isBlank()) {
            refreshToken = repository.findConnection(pending.userId())
                    .map(existing -> cipher.decrypt(existing.refreshTokenCipher(), refreshContext(pending.userId())))
                    .orElseThrow(() -> CalendarIntegrationException.authorizationFailed(
                            "Google did not return an offline refresh token. Revoke access and connect again.", null));
        }
        List<GoogleCalendarGateway.CalendarInfo> calendars = gateway.calendars(tokens.accessToken());
        GoogleCalendarGateway.CalendarInfo selected = calendars.stream()
                .filter(GoogleCalendarGateway.CalendarInfo::primary)
                .findFirst()
                .orElseGet(() -> calendars.stream().findFirst().orElse(null));
        List<String> scopes = tokens.scopes().isEmpty() ? REQUIRED_SCOPES : tokens.scopes();
        repository.upsertConnection(
                pending.userId(),
                selected == null ? null : selected.id(),
                cipher.encrypt(refreshToken, refreshContext(pending.userId())),
                scopes,
                selected == null ? null : selected.id());
        repository.enqueue(pending.userId(), "GOOGLE_CALENDAR_SYNC", "calendar-sync:" + pending.userId());
        repository.enqueue(pending.userId(), "GOOGLE_CALENDAR_WATCH_RENEW", "calendar-watch:" + pending.userId());
        return appendConnected(properties.frontendSuccessUri(), pending.returnPath());
    }

    @Transactional(readOnly = true)
    public List<GoogleCalendarGateway.CalendarInfo> calendars(UUID userId) {
        String accessToken = accessToken(userId);
        return gateway.calendars(accessToken);
    }

    @Transactional
    public Status updateSettings(UUID userId, String calendarId, String direction) {
        if (!List.of("IMPORT_ONLY", "EXPORT_ONLY", "BIDIRECTIONAL").contains(direction)) {
            throw CalendarIntegrationException.invalidSettings("지원하지 않는 캘린더 동기화 방향입니다.");
        }
        if (calendarId == null || calendarId.isBlank() || calendarId.length() > 1024) {
            throw CalendarIntegrationException.invalidSettings("동기화할 캘린더를 선택해 주세요.");
        }
        repository.findConnection(userId).orElseThrow(CalendarIntegrationException::notConnected);
        repository.updateSettings(userId, calendarId, direction);
        repository.enqueue(userId, "GOOGLE_CALENDAR_SYNC", "calendar-sync:" + userId);
        repository.enqueue(userId, "GOOGLE_CALENDAR_WATCH_RENEW", "calendar-watch:" + userId);
        return status(userId);
    }

    @Transactional
    public void requestSync(UUID userId) {
        repository.findConnection(userId).orElseThrow(CalendarIntegrationException::notConnected);
        repository.enqueue(userId, "GOOGLE_CALENDAR_SYNC", "calendar-sync:" + userId);
    }

    @Transactional
    public void disconnect(UUID userId) {
        repository.findConnection(userId).ifPresent(connection -> {
            String refreshToken = cipher.decrypt(connection.refreshTokenCipher(), refreshContext(userId));
            try {
                repository.findWatch(userId, connection.selectedCalendarId()).ifPresent(watch -> {
                    try {
                        String accessToken = gateway.refresh(refreshToken).accessToken();
                        gateway.stopWatch(accessToken, watch.channelId().toString(), watch.resourceId());
                    } catch (RuntimeException ignored) {
                        // The persisted credentials are still deleted and the remote channel expires within a week.
                    }
                });
                gateway.revoke(refreshToken);
            } finally {
                repository.deleteConnection(userId);
            }
        });
    }

    public String accessToken(UUID userId) {
        requireConfigured();
        CalendarIntegrationRepository.Connection connection = repository.findConnection(userId)
                .orElseThrow(CalendarIntegrationException::notConnected);
        String refreshToken = cipher.decrypt(connection.refreshTokenCipher(), refreshContext(userId));
        return gateway.refresh(refreshToken).accessToken();
    }

    private void requireConfigured() {
        if (!properties.configured() || !cipher.configured()) throw CalendarIntegrationException.notConfigured();
    }

    private String safeReturnPath(String value) {
        if (value == null || value.isBlank()) return "/plans";
        String trimmed = value.trim();
        if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.contains("\\")) return "/plans";
        return trimmed.substring(0, Math.min(trimmed.length(), 500));
    }

    private String appendConnected(String configuredUri, String returnPath) {
        return UriComponentsBuilder.fromUriString(configuredUri)
                .replaceQueryParam("calendar", "connected")
                .queryParam("returnTo", returnPath)
                .build().encode().toUriString();
    }

    private String refreshContext(UUID userId) {
        return "google-calendar-refresh:" + userId;
    }

    private String oauthStateContext(String hash) {
        return "google-calendar-oauth-state:" + hash;
    }

    private String randomToken(int bytes) {
        byte[] value = new byte[bytes];
        random.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private String sha256Base64Url(String value) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(digest(value.getBytes(StandardCharsets.US_ASCII)));
    }

    private String sha256(String value) {
        return java.util.HexFormat.of().formatHex(digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private byte[] digest(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    public record ConnectResponse(String authorizationUrl, Instant expiresAt) {
    }

    public record Status(
            boolean configured,
            boolean connected,
            String accountEmail,
            String calendarId,
            String direction,
            String syncStatus,
            Instant lastSyncStartedAt,
            Instant lastSyncCompletedAt,
            String lastErrorCode
    ) {
    }
}
