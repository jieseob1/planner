package io.nowline.planner.notification;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "nowline.web-push")
public record WebPushProperties(String publicKey, String privateKey, String subject, List<String> allowedHostSuffixes) {
    public boolean configured() {
        return present(publicKey) && present(privateKey)
                && present(subject) && (subject.startsWith("mailto:") || subject.startsWith("https://"));
    }

    private boolean present(String value) {
        return value != null && !value.isBlank();
    }
}
