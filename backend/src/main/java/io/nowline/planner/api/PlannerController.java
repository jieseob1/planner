package io.nowline.planner.api;

import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.security.CurrentUserService;
import io.nowline.planner.service.PlannerService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
@Validated
@RestController
@RequestMapping("/api/v1/planner")
public class PlannerController {

    public static final String IDEMPOTENCY_HEADER = "Idempotency-Key";

    private final PlannerService plannerService;
    private final CurrentUserService currentUserService;

    public PlannerController(PlannerService plannerService, CurrentUserService currentUserService) {
        this.plannerService = plannerService;
        this.currentUserService = currentUserService;
    }

    @GetMapping
    public ResponseEntity<PlannerEnvelope> get(
            @AuthenticationPrincipal Jwt jwt,
            @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch
    ) {
        var userId = currentUserService.resolve(jwt);
        PlannerEnvelope envelope = plannerService.get(userId);
        String etag = HttpPreconditions.etag(envelope.revision());
        if (HttpPreconditions.matchesForGet(ifNoneMatch, envelope.revision())) {
            return ResponseEntity.status(304).eTag(etag).cacheControl(CacheControl.noStore()).build();
        }
        return ResponseEntity.ok()
                .eTag(etag)
                .cacheControl(CacheControl.noStore())
                .body(envelope);
    }

    @PutMapping
    public ResponseEntity<PlannerEnvelope> put(
            @AuthenticationPrincipal Jwt jwt,
            @RequestHeader(IDEMPOTENCY_HEADER) @NotBlank @Size(max = 128) String idempotencyKey,
            @RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch,
            @Valid @RequestBody PlannerSnapshot snapshot
    ) {
        var userId = currentUserService.resolve(jwt);
        PlannerService.WriteResult result = plannerService.put(
                userId,
                idempotencyKey.trim(),
                HttpPreconditions.forPut(ifMatch, ifNoneMatch),
                snapshot
        );
        ResponseEntity.BodyBuilder response = ResponseEntity.status(result.status())
                .eTag(HttpPreconditions.etag(result.envelope().revision()))
                .cacheControl(CacheControl.noStore());
        if (result.status() == 201) {
            response.location(URI.create("/api/v1/planner"));
        }
        return response.body(result.envelope());
    }

    @DeleteMapping
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal Jwt jwt,
            @RequestHeader(IDEMPOTENCY_HEADER) @NotBlank @Size(max = 128) String idempotencyKey,
            @RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch
    ) {
        var userId = currentUserService.resolve(jwt);
        plannerService.delete(userId, idempotencyKey.trim(), HttpPreconditions.forDelete(ifMatch));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
