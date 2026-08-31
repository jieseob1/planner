package io.nowline.planner.api;

import io.nowline.planner.domain.PlannerEnvelope;
import io.nowline.planner.domain.PlannerSnapshot;
import io.nowline.planner.service.PlannerService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

@Validated
@RestController
@RequestMapping("/api/v1/planner")
public class PlannerController {

    public static final String USER_HEADER = "X-Nowline-User-Id";
    public static final String IDEMPOTENCY_HEADER = "Idempotency-Key";

    private final PlannerService plannerService;

    public PlannerController(PlannerService plannerService) {
        this.plannerService = plannerService;
    }

    @GetMapping
    public ResponseEntity<PlannerEnvelope> get(
            @RequestHeader(USER_HEADER) UUID userId,
            @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch
    ) {
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
            @RequestHeader(USER_HEADER) UUID userId,
            @RequestHeader(IDEMPOTENCY_HEADER) @NotBlank @Size(max = 128) String idempotencyKey,
            @RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch,
            @Valid @RequestBody PlannerSnapshot snapshot
    ) {
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
            @RequestHeader(USER_HEADER) UUID userId,
            @RequestHeader(IDEMPOTENCY_HEADER) @NotBlank @Size(max = 128) String idempotencyKey,
            @RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch
    ) {
        plannerService.delete(userId, idempotencyKey.trim(), HttpPreconditions.forDelete(ifMatch));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
