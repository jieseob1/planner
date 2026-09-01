package io.nowline.planner.notification;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "nowline.native-push")
public record NativePushProperties(String deliveryUri, String bearerToken) {
    public boolean configured() {
        return deliveryUri != null && deliveryUri.startsWith("https://")
                && bearerToken != null && !bearerToken.isBlank();
    }
}
