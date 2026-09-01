package io.nowline.planner.notification;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.Security;

@Component
public class WebPushDeliveryGateway implements PushDeliveryGateway {

    private final WebPushProperties properties;
    private final ObjectMapper objectMapper;
    private final PushService pushService;

    public WebPushDeliveryGateway(WebPushProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(new BouncyCastleProvider());
        }
        try {
            this.pushService = properties.configured()
                    ? new PushService(properties.publicKey(), properties.privateKey(), properties.subject())
                    : null;
        } catch (Exception exception) {
            throw new IllegalStateException("NOWLINE VAPID key configuration is invalid", exception);
        }
    }

    @Override
    public Result send(NotificationRepository.Device device, String subscriptionJson, Message message) {
        if (pushService == null) return Result.NOT_CONFIGURED;
        try {
            JsonNode value = objectMapper.readTree(subscriptionJson);
            String endpoint = required(value, "endpoint");
            String p256dh = required(value.path("keys"), "p256dh");
            String auth = required(value.path("keys"), "auth");
            if (!allowedEndpoint(endpoint)) return Result.PERMANENT_FAILURE;
            String payload = objectMapper.writeValueAsString(java.util.Map.of(
                    "title", message.title(),
                    "body", message.body(),
                    "url", message.targetPath(),
                    "tag", message.tag()));
            var response = pushService.send(new Notification(
                    endpoint, p256dh, auth, payload.getBytes(StandardCharsets.UTF_8), 3600));
            int status = response.getStatusLine().getStatusCode();
            if (status >= 200 && status < 300) return Result.DELIVERED;
            if (status == 404 || status == 410) return Result.PERMANENT_FAILURE;
            return Result.RETRYABLE_FAILURE;
        } catch (IllegalArgumentException exception) {
            return Result.PERMANENT_FAILURE;
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) Thread.currentThread().interrupt();
            return Result.RETRYABLE_FAILURE;
        }
    }

    @Override
    public boolean supports(String platform) {
        return "WEB".equals(platform);
    }

    private boolean allowedEndpoint(String endpoint) {
        URI uri;
        try {
            uri = URI.create(endpoint);
        } catch (RuntimeException exception) {
            return false;
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return false;
        String host = uri.getHost().toLowerCase(java.util.Locale.ROOT);
        return properties.allowedHostSuffixes() != null && properties.allowedHostSuffixes().stream()
                .map(value -> value.toLowerCase(java.util.Locale.ROOT).trim())
                .filter(value -> !value.isBlank())
                .anyMatch(suffix -> host.equals(suffix) || host.endsWith("." + suffix));
    }

    private String required(JsonNode node, String field) {
        String value = node.path(field).asText("");
        if (value.isBlank() || value.length() > 4096) throw new IllegalArgumentException("Invalid push subscription");
        return value;
    }
}
