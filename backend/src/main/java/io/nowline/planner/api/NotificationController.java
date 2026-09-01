package io.nowline.planner.api;

import io.nowline.planner.notification.NotificationService;
import io.nowline.planner.security.CurrentUserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {

    private final NotificationService notifications;
    private final CurrentUserService currentUser;

    public NotificationController(NotificationService notifications, CurrentUserService currentUser) {
        this.notifications = notifications;
        this.currentUser = currentUser;
    }

    @GetMapping("/configuration")
    ResponseEntity<NotificationService.Configuration> configuration() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(notifications.configuration());
    }

    @PostMapping("/devices")
    ResponseEntity<Void> register(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody DeviceRequest request
    ) {
        notifications.register(
                currentUser.resolve(jwt), request.deviceId(), request.platform(), request.subscription(), request.label());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/devices/{deviceId}")
    ResponseEntity<Void> disable(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID deviceId) {
        notifications.disable(currentUser.resolve(jwt), deviceId);
        return ResponseEntity.noContent().build();
    }

    public record DeviceRequest(
            @NotNull UUID deviceId,
            @NotBlank String platform,
            @NotNull JsonNode subscription,
            @Size(max = 100) String label
    ) {
    }
}
