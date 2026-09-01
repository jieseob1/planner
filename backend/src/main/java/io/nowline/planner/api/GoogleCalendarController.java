package io.nowline.planner.api;

import io.nowline.planner.integration.calendar.GoogleCalendarConnectionService;
import io.nowline.planner.integration.calendar.GoogleCalendarGateway;
import io.nowline.planner.security.CurrentUserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;

@RestController
@RequestMapping("/api/v1/integrations/google-calendar")
public class GoogleCalendarController {

    private final GoogleCalendarConnectionService service;
    private final CurrentUserService currentUserService;

    public GoogleCalendarController(
            GoogleCalendarConnectionService service,
            CurrentUserService currentUserService
    ) {
        this.service = service;
        this.currentUserService = currentUserService;
    }

    @GetMapping("/status")
    ResponseEntity<GoogleCalendarConnectionService.Status> status(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.status(currentUserService.resolve(jwt)));
    }

    @PostMapping("/connect")
    ResponseEntity<GoogleCalendarConnectionService.ConnectResponse> connect(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody(required = false) ConnectRequest request
    ) {
        String returnPath = request == null ? null : request.returnPath();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.begin(currentUserService.resolve(jwt), returnPath));
    }

    @GetMapping("/oauth/callback")
    ResponseEntity<Void> callback(@RequestParam String code, @RequestParam String state) {
        return ResponseEntity.status(302)
                .location(URI.create(service.complete(code, state)))
                .cacheControl(CacheControl.noStore())
                .build();
    }

    @GetMapping("/calendars")
    ResponseEntity<List<GoogleCalendarGateway.CalendarInfo>> calendars(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.calendars(currentUserService.resolve(jwt)));
    }

    @PutMapping("/settings")
    ResponseEntity<GoogleCalendarConnectionService.Status> settings(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody SettingsRequest request
    ) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.updateSettings(
                        currentUserService.resolve(jwt), request.calendarId().trim(), request.direction()));
    }

    @PostMapping("/sync")
    ResponseEntity<Void> sync(@AuthenticationPrincipal Jwt jwt) {
        service.requestSync(currentUserService.resolve(jwt));
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).build();
    }

    @DeleteMapping
    ResponseEntity<Void> disconnect(@AuthenticationPrincipal Jwt jwt) {
        service.disconnect(currentUserService.resolve(jwt));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    public record ConnectRequest(@Size(max = 500) String returnPath) {
    }

    public record SettingsRequest(
            @NotBlank @Size(max = 1_024) String calendarId,
            @NotBlank String direction
    ) {
    }
}
