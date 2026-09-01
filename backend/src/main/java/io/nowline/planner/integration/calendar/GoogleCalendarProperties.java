package io.nowline.planner.integration.calendar;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "nowline.google-calendar")
public record GoogleCalendarProperties(
        String clientId,
        String clientSecret,
        String redirectUri,
        String frontendSuccessUri,
        String webhookUri,
        String encryptionKeyBase64,
        String authorizationUri,
        String tokenUri,
        String revokeUri,
        String apiBaseUri
) {
    public boolean configured() {
        return present(clientId) && present(clientSecret) && present(redirectUri) && present(encryptionKeyBase64);
    }

    private boolean present(String value) {
        return value != null && !value.isBlank();
    }
}
