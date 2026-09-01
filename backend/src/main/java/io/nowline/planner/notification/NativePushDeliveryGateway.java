package io.nowline.planner.notification;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

@Component
public class NativePushDeliveryGateway implements PushDeliveryGateway {

    private final NativePushProperties properties;
    private final ObjectMapper objectMapper;
    private final RestClient client;

    public NativePushDeliveryGateway(
            NativePushProperties properties,
            ObjectMapper objectMapper,
            RestClient.Builder builder
    ) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.client = builder.build();
    }

    @Override
    public Result send(NotificationRepository.Device device, String subscriptionJson, Message message) {
        if (!properties.configured()) return Result.NOT_CONFIGURED;
        try {
            JsonNode subscription = objectMapper.readTree(subscriptionJson);
            String token = subscription.path("token").asText("");
            if (token.isBlank() || token.length() > 4096) return Result.PERMANENT_FAILURE;
            client.post().uri(properties.deliveryUri())
                    .headers(headers -> headers.setBearerAuth(properties.bearerToken()))
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "platform", device.platform(),
                            "token", token,
                            "title", message.title(),
                            "body", message.body(),
                            "targetPath", message.targetPath(),
                            "deduplicationKey", message.tag()))
                    .retrieve().toBodilessEntity();
            return Result.DELIVERED;
        } catch (RestClientResponseException exception) {
            int status = exception.getStatusCode().value();
            if (status == 400 || status == 404 || status == 410) return Result.PERMANENT_FAILURE;
            return Result.RETRYABLE_FAILURE;
        } catch (RuntimeException exception) {
            return Result.RETRYABLE_FAILURE;
        }
    }

    @Override
    public boolean supports(String platform) {
        return "IOS".equals(platform) || "ANDROID".equals(platform);
    }
}
