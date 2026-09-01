package io.nowline.planner.api;

import io.nowline.planner.integration.calendar.GoogleCalendarWatchService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GoogleCalendarWebhookController {

    private final GoogleCalendarWatchService watchService;

    public GoogleCalendarWebhookController(GoogleCalendarWatchService watchService) {
        this.watchService = watchService;
    }

    @PostMapping("/api/v1/calendar/google/webhook")
    ResponseEntity<Void> notification(
            @RequestHeader(name = "X-Goog-Channel-ID", required = false) String channelId,
            @RequestHeader(name = "X-Goog-Resource-ID", required = false) String resourceId,
            @RequestHeader(name = "X-Goog-Channel-Token", required = false) String channelToken,
            @RequestHeader(name = "X-Goog-Message-Number", required = false) String messageNumber
    ) {
        // Google expects a quick 2xx. Unknown, expired, forged, and replayed messages are intentionally ignored.
        watchService.accept(channelId, resourceId, channelToken, messageNumber);
        return ResponseEntity.noContent().build();
    }
}
