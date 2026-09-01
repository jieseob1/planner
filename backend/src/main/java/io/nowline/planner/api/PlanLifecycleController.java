package io.nowline.planner.api;

import io.nowline.planner.domain.PlanHistory;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.security.CurrentUserService;
import io.nowline.planner.service.PlanLifecycleService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/plans")
public class PlanLifecycleController {

    private final PlanLifecycleService service;
    private final CurrentUserService currentUserService;

    public PlanLifecycleController(PlanLifecycleService service, CurrentUserService currentUserService) {
        this.service = service;
        this.currentUserService = currentUserService;
    }

    @GetMapping
    ResponseEntity<PlanHistory.ListResponse> list(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new PlanHistory.ListResponse(service.list(currentUserService.resolve(jwt))));
    }

    @GetMapping("/{planId}")
    ResponseEntity<PlanHistory.Detail> get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID planId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.get(currentUserService.resolve(jwt), planId));
    }

    @PutMapping("/{planId}")
    ResponseEntity<PlanHistory.Detail> create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID planId,
            @Valid @RequestBody CreatePlanRequest request
    ) {
        PlanHistory.Detail created = service.create(
                currentUserService.resolve(jwt), planId, request.title(), request.snapshot());
        return ResponseEntity.created(URI.create("/api/v1/plans/" + planId))
                .cacheControl(CacheControl.noStore())
                .body(created);
    }

    @PostMapping("/{planId}/activate")
    ResponseEntity<PlanHistory.Detail> activate(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID planId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.activate(currentUserService.resolve(jwt), planId));
    }

    @PostMapping("/{planId}/close")
    ResponseEntity<PlanHistory.Summary> close(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID planId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.close(currentUserService.resolve(jwt), planId));
    }

    @PostMapping("/{planId}/archive")
    ResponseEntity<PlanHistory.Summary> archive(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID planId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.archive(currentUserService.resolve(jwt), planId));
    }

    @PostMapping("/{planId}/restore")
    ResponseEntity<PlanHistory.Summary> restore(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID planId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.restore(currentUserService.resolve(jwt), planId));
    }

    @GetMapping("/{planId}/audit")
    ResponseEntity<List<PlanHistory.AuditEvent>> audit(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID planId
    ) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(service.audit(currentUserService.resolve(jwt), planId));
    }

    public record CreatePlanRequest(
            @NotBlank @Size(max = 200) String title,
            @NotNull @Valid PlannerSnapshot snapshot
    ) {
    }
}
