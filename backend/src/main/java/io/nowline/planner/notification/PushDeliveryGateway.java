package io.nowline.planner.notification;

public interface PushDeliveryGateway {
    Result send(NotificationRepository.Device device, String subscriptionJson, Message message);

    boolean supports(String platform);

    record Message(String title, String body, String targetPath, String tag) {
    }

    enum Result {
        DELIVERED,
        PERMANENT_FAILURE,
        RETRYABLE_FAILURE,
        NOT_CONFIGURED
    }
}
