package io.nowline.planner.notification;

import io.micrometer.core.instrument.MeterRegistry;
import io.nowline.planner.security.SecretCipher;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class NotificationService {

    private final NotificationRepository repository;
    private final SecretCipher cipher;
    private final ObjectMapper objectMapper;
    private final List<PushDeliveryGateway> gateways;
    private final WebPushProperties webPush;
    private final NativePushProperties nativePush;
    private final MeterRegistry meters;

    public NotificationService(
            NotificationRepository repository,
            SecretCipher cipher,
            ObjectMapper objectMapper,
            List<PushDeliveryGateway> gateways,
            WebPushProperties webPush,
            NativePushProperties nativePush,
            MeterRegistry meters
    ) {
        this.repository = repository;
        this.cipher = cipher;
        this.objectMapper = objectMapper;
        this.gateways = List.copyOf(gateways);
        this.webPush = webPush;
        this.nativePush = nativePush;
        this.meters = meters;
    }

    public Configuration configuration() {
        return new Configuration(
                cipher.configured() && webPush.configured(),
                cipher.configured() && nativePush.configured(),
                webPush.publicKey());
    }

    public void register(UUID userId, UUID deviceId, String platformValue, JsonNode subscription, String label) {
        if (!cipher.configured()) throw new IllegalStateException("Notification subscription encryption is not configured");
        String platform = platformValue == null ? "" : platformValue.toUpperCase(Locale.ROOT);
        if (!List.of("WEB", "IOS", "ANDROID").contains(platform)) {
            throw new IllegalArgumentException("Unsupported notification platform");
        }
        validateSubscription(platform, subscription);
        try {
            String json = objectMapper.writeValueAsString(subscription);
            repository.upsertDevice(
                    userId, deviceId, platform,
                    cipher.encrypt(json, context(userId, deviceId)), label);
        } catch (JacksonException exception) {
            throw new IllegalArgumentException("Invalid notification subscription", exception);
        }
    }

    public void disable(UUID userId, UUID deviceId) {
        repository.disableDevice(userId, deviceId);
    }

    public void dispatch(NotificationRepository.Delivery delivery) {
        List<NotificationRepository.Device> devices = repository.activeDevices(delivery.userId());
        if (devices.isEmpty()) {
            repository.skipped(delivery.deliveryId(), "no-active-device");
            count(delivery.type(), "skipped");
            return;
        }

        boolean delivered = false;
        boolean retryable = false;
        boolean supported = false;
        PushDeliveryGateway.Message message = new PushDeliveryGateway.Message(
                delivery.title(), delivery.body(), delivery.targetPath(), delivery.type());
        for (NotificationRepository.Device device : devices) {
            PushDeliveryGateway gateway = gateways.stream()
                    .filter(candidate -> candidate.supports(device.platform()))
                    .findFirst().orElse(null);
            if (gateway == null) continue;
            supported = true;
            PushDeliveryGateway.Result result;
            try {
                String subscription = cipher.decrypt(device.cipher(), context(device.userId(), device.deviceId()));
                result = gateway.send(device, subscription, message);
            } catch (RuntimeException exception) {
                result = PushDeliveryGateway.Result.PERMANENT_FAILURE;
            }
            if (result == PushDeliveryGateway.Result.DELIVERED) delivered = true;
            if (result == PushDeliveryGateway.Result.RETRYABLE_FAILURE) retryable = true;
            if (result == PushDeliveryGateway.Result.PERMANENT_FAILURE) repository.disableDevice(device.deviceId());
        }

        if (delivered) {
            repository.delivered(delivery.deliveryId());
            count(delivery.type(), "delivered");
        } else if (retryable) {
            repository.failed(delivery.deliveryId(), delivery.attempts(), "push-provider-retryable");
            count(delivery.type(), "retry");
        } else {
            repository.skipped(delivery.deliveryId(), supported ? "push-provider-not-configured-or-device-expired" : "unsupported-device");
            count(delivery.type(), "skipped");
        }
    }

    private void count(String type, String result) {
        meters.counter("nowline.notifications", "type", type, "result", result).increment();
    }

    private void validateSubscription(String platform, JsonNode value) {
        if (value == null || !value.isObject()) throw new IllegalArgumentException("Invalid notification subscription");
        if ("WEB".equals(platform)) {
            require(value, "endpoint");
            require(value.path("keys"), "p256dh");
            require(value.path("keys"), "auth");
        } else {
            require(value, "token");
        }
    }

    private void require(JsonNode value, String field) {
        String text = value.path(field).asText("");
        if (text.isBlank() || text.length() > 4096) throw new IllegalArgumentException("Invalid notification subscription");
    }

    private String context(UUID userId, UUID deviceId) {
        return "notification-device:" + userId + ":" + deviceId;
    }

    public record Configuration(boolean webConfigured, boolean nativeConfigured, String webPublicKey) {
    }
}
